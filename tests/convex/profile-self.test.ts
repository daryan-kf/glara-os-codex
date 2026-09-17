import { convexTest } from "convex-test";
import { describe, it, expect } from "vitest";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import { Password } from "@convex-dev/auth/providers/Password";
import type { Role } from "../../src/lib/permissions";
const modules = import.meta.glob("../../convex/**/*.ts");
const hashSecret = (value: string) =>
  (
    Password() as unknown as {
      options: { crypto: { hashSecret(value: string): Promise<string> } };
    }
  ).options.crypto.hashSecret(value);
async function fixture() {
  const t = convexTest(schema, modules);
  const users = await t.run(async (ctx) => {
    const result = {} as Record<Role | "unassigned" | "archived", string>;
    for (const role of [
      "owner",
      "sales",
      "admin",
      "marketing",
      "designer",
      "staging_crew",
      "unassigned",
      "archived",
    ] as const) {
      const id = await ctx.db.insert("users", {
        email: role + "@accounts.example.test",
      });
      await ctx.db.insert("profiles", {
        userId: id,
        display_name: "Fictional " + role,
        roles:
          role === "unassigned" ? [] : [role === "archived" ? "sales" : role],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: role === "archived" ? new Date().toISOString() : null,
      });
      result[role] = id;
    }
    return result;
  });
  const sessions = await t.run(async (ctx) =>
    Object.fromEntries(
      await Promise.all(
        Object.entries(users).map(async ([role, id]) => [
          role,
          await ctx.db.insert("authSessions", {
            userId: ctx.db.normalizeId("users", id)!,
            expirationTime: Date.now() + 86400000,
          }),
        ]),
      ),
    ),
  );
  const client = (role: keyof typeof users) =>
    t.withIdentity({ subject: users[role] + "|" + sessions[role] });
  return { t, users, sessions, client };
}
async function withPasswordAccount(password: string) {
  const f = await fixture();
  const secret = await hashSecret(password);
  await f.t.run(async (ctx) => {
    await ctx.db.insert("authAccounts", {
      provider: "password",
      providerAccountId: "sales@accounts.example.test",
      secret,
      userId: ctx.db.normalizeId("users", f.users.sales)!,
    });
  });
  return f;
}
describe("self-service display name", () => {
  it("updates the caller's own name and writes an attributed audit event", async () => {
    const f = await fixture();
    await f.client("sales").mutation(api.profiles.updateName, {
      name: "  Taylor Field  ",
    });
    const profile = await f.t.run((ctx) =>
      ctx.db
        .query("profiles")
        .withIndex("by_user", (q) =>
          q.eq("userId", ctx.db.normalizeId("users", f.users.sales)!),
        )
        .unique(),
    );
    expect(profile?.display_name).toBe("Taylor Field");
    const audit = await f.t.run((ctx) =>
      ctx.db
        .query("audit_logs")
        .withIndex("by_entity", (q) => q.eq("entity_id", f.users.sales))
        .unique(),
    );
    expect(audit?.action).toBe("PROFILE_NAME_CHANGED");
    expect(audit?.actor_id).toBe(f.users.sales);
    expect(audit?.old_value).toEqual({ display_name: "Fictional sales" });
    expect(audit?.new_value).toEqual({ display_name: "Taylor Field" });
  });
  it("rejects invalid names and unauthorized callers", async () => {
    const f = await fixture();
    await expect(
      f.client("sales").mutation(api.profiles.updateName, { name: "   " }),
    ).rejects.toThrow("INVALID_INPUT");
    await expect(
      f.client("sales").mutation(api.profiles.updateName, {
        name: "x".repeat(121),
      }),
    ).rejects.toThrow("INVALID_INPUT");
    for (const role of ["unassigned", "archived"] as const)
      await expect(
        f.client(role).mutation(api.profiles.updateName, { name: "Valid" }),
      ).rejects.toThrow("FORBIDDEN");
    await expect(
      f.t.mutation(api.profiles.updateName, { name: "Valid" }),
    ).rejects.toThrow("FORBIDDEN");
  });
});
describe("self-service password change", () => {
  it("verifies the current password, replaces the secret, audits and revokes every session", async () => {
    const f = await withPasswordAccount("original-password-12");
    const before = await f.t.run(
      async (ctx) => (await ctx.db.query("authAccounts").unique())!.secret,
    );
    await f.client("sales").action(api.profiles.changePassword, {
      currentPassword: "original-password-12",
      newPassword: "replacement-password-12",
    });
    const account = await f.t.run((ctx) =>
      ctx.db.query("authAccounts").unique(),
    );
    expect(account?.secret).not.toBe(before);
    const audit = await f.t.run((ctx) =>
      ctx.db
        .query("audit_logs")
        .withIndex("by_entity", (q) => q.eq("entity_id", f.users.sales))
        .unique(),
    );
    expect(audit?.action).toBe("PASSWORD_CHANGED");
    expect(audit?.actor_id).toBe(f.users.sales);
    const sessions = await f.t.run(async (ctx) =>
      (await ctx.db.query("authSessions").collect()).filter(
        (s) => s.userId === ctx.db.normalizeId("users", f.users.sales),
      ),
    );
    expect(sessions).toEqual([]);
    expect(await f.client("sales").query(api.profiles.viewer, {})).toBeNull();
  });
  it("rejects a wrong current password without changing the secret", async () => {
    const f = await withPasswordAccount("original-password-12");
    const before = await f.t.run(
      async (ctx) => (await ctx.db.query("authAccounts").unique())!.secret,
    );
    await expect(
      f.client("sales").action(api.profiles.changePassword, {
        currentPassword: "not-the-password-12",
        newPassword: "replacement-password-12",
      }),
    ).rejects.toThrow("AUTHENTICATION_FAILED");
    const account = await f.t.run((ctx) =>
      ctx.db.query("authAccounts").unique(),
    );
    expect(account?.secret).toBe(before);
    expect(
      await f.t.run(
        async (ctx) => (await ctx.db.query("audit_logs").collect()).length,
      ),
    ).toBe(0);
  });
  it("rejects weak or reused passwords and unauthorized callers before any provider call", async () => {
    const f = await withPasswordAccount("original-password-12");
    await expect(
      f.client("sales").action(api.profiles.changePassword, {
        currentPassword: "original-password-12",
        newPassword: "short",
      }),
    ).rejects.toThrow("INVALID_INPUT");
    await expect(
      f.client("sales").action(api.profiles.changePassword, {
        currentPassword: "original-password-12",
        newPassword: "original-password-12",
      }),
    ).rejects.toThrow("INVALID_INPUT");
    await expect(
      f.t.action(api.profiles.changePassword, {
        currentPassword: "original-password-12",
        newPassword: "replacement-password-12",
      }),
    ).rejects.toThrow("AUTHENTICATION_FAILED");
    for (const role of ["unassigned", "archived"] as const)
      await expect(
        f.client(role).action(api.profiles.changePassword, {
          currentPassword: "original-password-12",
          newPassword: "replacement-password-12",
        }),
      ).rejects.toThrow("AUTHENTICATION_FAILED");
  });
});
