import { afterEach, expect, it, vi } from "vitest";
import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { Password } from "@convex-dev/auth/providers/Password";
import { operationsFixture } from "../support/operations-unit-fixture";
import { api, internal } from "../../convex/_generated/api";
const key = generateKeyPairSync("rsa", { modulusLength: 2048 })
  .privateKey.export({ type: "pkcs8", format: "pem" })
  .toString();
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
async function fixture(expired = false, archived = false) {
  vi.stubEnv("JWT_PRIVATE_KEY", key);
  vi.stubEnv("CONVEX_SITE_URL", "https://fictional.convex.site");
  const f = await operationsFixture(),
    code = randomUUID(),
    email = "sales@accounts.example.test",
    password = randomUUID();
  const cryptoProvider = (
    Password() as unknown as {
      options: { crypto: { hashSecret(value: string): Promise<string> } };
    }
  ).options.crypto;
  const secret = await cryptoProvider.hashSecret(password);
  await f.t.run(async (ctx) => {
    const accountId = await ctx.db.insert("authAccounts", {
      userId: f.who("sales").id,
      provider: "password",
      providerAccountId: email,
      secret,
    });
    await ctx.db.insert("authVerificationCodes", {
      accountId,
      provider: "glara-email",
      code: createHash("sha256").update(code).digest("hex"),
      expirationTime: Date.now() + (expired ? -1000 : 60000),
      emailVerified: email,
    });
    if (archived) {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", f.who("sales").id))
        .unique();
      await ctx.db.patch(profile!._id, {
        deleted_at: new Date().toISOString(),
      });
    }
  });
  const redeem = (token: string = code, address: string = email) =>
    f.t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "reset-verification",
        email: address,
        code: token,
        newPassword: password + "-new",
      },
    });
  return { ...f, redeem, code, email };
}
it("framework recovery is single-use and destroys old sessions without sending email", async () => {
  const f = await fixture(),
    http = vi.fn(() => {
      throw Error("NO_PROVIDER_CALL");
    });
  vi.stubGlobal("fetch", http);
  const result = await f.redeem();
  expect(result.tokens?.token).toBeTruthy();
  await expect(f.redeem()).rejects.toThrow();
  await expect(f.c("sales").query(api.sales.summary, {})).rejects.toThrow();
  expect(http).not.toHaveBeenCalled();
});
it("expired recovery codes cannot change credentials or establish a session", async () => {
  const f = await fixture(true);
  await expect(f.redeem()).rejects.toThrow();
});
it("archived targets cannot redeem a previously issued code", async () => {
  const f = await fixture(false, true);
  await expect(f.redeem()).rejects.toThrow();
});
it("malformed and mismatched recovery codes are denied", async () => {
  const f = await fixture();
  await expect(f.redeem("bad-token")).rejects.toThrow();
  await expect(
    f.redeem(f.code, "owner@accounts.example.test"),
  ).rejects.toThrow();
});
it("recovery verification throttles repeated invalid codes", async () => {
  const f = await fixture();
  for (let n = 0; n < 6; n++)
    await expect(f.redeem("bad-" + n)).rejects.toThrow();
  await expect(f.redeem()).rejects.toThrow();
});

it("direct backend recovery is non-enumerating for unknown, active and archived accounts with delivery disabled", async () => {
  const f = await fixture();
  vi.stubEnv("AUTH_EMAIL_ENABLED", "false");
  const http = vi.fn(() => {
    throw Error("NO_PROVIDER_CALL");
  });
  vi.stubGlobal("fetch", http);
  const reset = (email: string) =>
    f.t.action(api.auth.signIn, {
      provider: "password",
      params: { flow: "reset", email },
    });
  expect(await reset(f.email)).toEqual(
    await reset("unknown@accounts.example.test"),
  );
  await f.t.run(async (ctx) => {
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", f.who("sales").id))
      .unique();
    await ctx.db.patch(p!._id, { deleted_at: new Date().toISOString() });
  });
  expect(await reset(f.email)).toEqual(
    await reset("unknown@accounts.example.test"),
  );
  expect(http).not.toHaveBeenCalled();
});
it("direct backend invalid sign-in errors are uniform and never expose credential/provider internals", async () => {
  const f = await fixture();
  const errors: string[] = [];
  for (const email of [f.email, "unknown@accounts.example.test"]) {
    try {
      await f.t.action(api.auth.signIn, {
        provider: "password",
        params: {
          flow: "signIn",
          email,
          password: "incorrect-fictional-password",
        },
      });
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  expect(errors).toHaveLength(2);
  expect(errors[0]).toBe(errors[1]);
  expect(errors[0]).toContain("AUTHENTICATION_FAILED");
  expect(errors[0]).not.toMatch(/InvalidAccountId|InvalidSecret|Scrypt|Resend/);
});
it("recovery issuance limits persist independently of failed actions and expire without unbounded retained identities", async () => {
  const f = await fixture();
  const key = "a".repeat(64);
  for (let n = 0; n < 5; n++)
    expect(
      await f.t.mutation(internal.authSecurity.attempt, {
        key,
        recovery: true,
      }),
    ).toBe(true);
  expect(
    await f.t.mutation(internal.authSecurity.attempt, { key, recovery: true }),
  ).toBe(false);
  await f.t.run(async (ctx) => {
    for (const row of await ctx.db.query("auth_attempt_windows").collect())
      await ctx.db.patch(row._id, { expires_at: Date.now() - 1 });
  });
  expect(
    await f.t.mutation(internal.authSecurity.attempt, { key, recovery: true }),
  ).toBe(true);
  expect(
    await f.t.run(
      async (ctx) =>
        (await ctx.db.query("auth_attempt_windows").collect()).length,
    ),
  ).toBe(2);
});
