import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { operationsFixture } from "../support/operations-unit-fixture";
import { commercialFixture } from "../support/commercial-unit-fixture";
import { communicationFixture } from "../support/communication-unit-fixture";
import { capabilities, type Capability } from "../../convex/emergencyModel";
import type { Id } from "../../convex/_generated/dataModel";
import { Password } from "@convex-dev/auth/providers/Password";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const reason = "Fictional incident containment verification";
async function change(
  f: Pick<Awaited<ReturnType<typeof operationsFixture>>, "c">,
  cap: Capability,
  frozen: boolean,
  version = 0,
) {
  await f.c("owner").mutation(api.emergency.change, {
    changes: [{ capability: cap, frozen, version }],
    reason,
    incident: "DRILL-M10-SAFE",
  });
}
it("only active Owner can atomically freeze and recover capabilities with server-derived audit actor", async () => {
  const f = await operationsFixture(),
    args = {
      changes: capabilities.map((capability) => ({
        capability,
        frozen: true,
        version: 0,
      })),
      reason,
      incident: "DRILL-M10-SAFE",
    };
  for (const role of [
    "admin",
    "sales",
    "designer",
    "staging_crew",
    "marketing",
  ] as const)
    await expect(
      f.c(role).mutation(api.emergency.change, args),
    ).rejects.toThrow();
  await expect(f.t.mutation(api.emergency.change, args)).rejects.toThrow();
  await f.c("owner").mutation(api.emergency.change, args);
  expect(
    (await f.c("admin").query(api.emergency.state, {})).every((x) => x.frozen),
  ).toBe(true);
  const audit = await f.t.run((ctx) => ctx.db.query("audit_logs").collect());
  const changes = audit.filter((x) => x.action === "EMERGENCY_CONTROL_CHANGED");
  expect(changes).toHaveLength(capabilities.length);
  expect(changes.every((x) => x.actor_id === f.who("owner").id)).toBe(true);
  await expect(
    f.c("owner").mutation(api.emergency.change, {
      ...args,
      changes: [
        { capability: "email", frozen: false, version: 1 },
        { capability: "ai", frozen: false, version: 0 },
      ],
    }),
  ).rejects.toThrow();
  expect(
    (await f.c("owner").query(api.emergency.state, {})).every((x) => x.frozen),
  ).toBe(true);
  await f.c("owner").mutation(api.emergency.change, {
    ...args,
    changes: capabilities.map((capability) => ({
      capability,
      frozen: false,
      version: 1,
    })),
  });
  expect(
    (await f.c("owner").query(api.emergency.state, {})).every((x) => !x.frozen),
  ).toBe(true);
});
it("financial and Inventory freezes deny source mutations while reads and independent capabilities survive", async () => {
  const f = await commercialFixture();
  await change(f, "financial", true);
  await expect(f.payment("10")).rejects.toThrow("CAPABILITY_FROZEN");
  expect(await f.owner.query(api.commercial.dashboard, {})).toBeTruthy();
  const line = await f.reserve(1);
  expect(line).toBeTruthy();
  await change(f, "inventory", true);
  await expect(f.move(line, "release")).rejects.toThrow();
  await expect(
    f.owner.mutation(api.inventory.saveCategory, {
      name: "Forbidden category",
      active: true,
      version: 0,
    }),
  ).rejects.toThrow("CAPABILITY_FROZEN");
  expect(await f.availability()).toBeTruthy();
  await change(f, "financial", false, 1);
  expect(await f.payment("10")).toBeTruthy();
  expect(
    (await f.owner.query(api.emergency.state, {})).find(
      (x) => x.capability === "inventory",
    )?.frozen,
  ).toBe(true);
});
it("automation freeze stops direct evaluation and worker dispatch without deleting queued evidence", async () => {
  const f = await operationsFixture();
  await f.c("owner").mutation(api.automation.initialize, {});
  const r = (await f.c("owner").query(api.automation.rules, {})).find(
    (x) => x.key === "new_contact",
  )!.record!;
  await f.c("owner").mutation(api.automation.saveRule, {
    id: r._id,
    version: r.version,
    config: { ...r.config, enabled: true, delay_days: 0 },
  });
  await change(f, "automation", true);
  expect(
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    }),
  ).toEqual({ created: 0 });
  expect(await f.t.action(internal.automation.tick, {})).toEqual({
    evaluated: 0,
  });
  expect(
    await f.t.run((ctx) => ctx.db.query("automation_actions").collect()),
  ).toHaveLength(0);
  await change(f, "automation", false, 1);
  expect(
    (
      await f.c("owner").mutation(api.automation.execute, {
        table: "opportunities",
        entity_id: f.oid,
      })
    ).created,
  ).toBe(1);
});
it("email freeze blocks an already claimed last-mile dispatch and preserves the queue", async () => {
  vi.stubEnv("M9_EMAIL_ENABLED", "true");
  vi.stubEnv("M9_EMAIL_VERIFIED", "true");
  vi.stubEnv("M9_EMAIL_TEST_ALLOWLIST", "m9-fictional@example.test");
  const f = await communicationFixture();
  await f.consent();
  const id = await f.create();
  await f.approve(id);
  const job = await f.queue(id);
  const claimed = await f.t.mutation(internal.communicationDelivery.claim, {
    id: job,
    token_hash: "a".repeat(64),
    unsubscribe_url: "https://example.test/preferences",
  });
  expect(claimed).not.toBeNull();
  await change(f, "email", true);
  expect(
    await f.t.mutation(internal.communicationDelivery.dispatch, {
      id: job,
      claim_version: claimed!.claim_version,
    }),
  ).toBe(false);
  const spy = vi.fn(() => {
    throw Error("Frozen provider must not run");
  });
  vi.stubGlobal("fetch", spy);
  await f.t.action(internal.communicationProvider.tick, {});
  expect(spy).not.toHaveBeenCalled();
  expect((await f.get(id)).row.status).toBe("queued");
});
it("recovery mode cannot be overridden by Owner and blocks onboarding, AI and Calendar", async () => {
  const f = await operationsFixture();
  const project = await f.create();
  await f.ready(project);
  await f.schedule(project);
  const event = await f.t.run((ctx) =>
    ctx.db.query("operations_events").first(),
  );
  vi.stubEnv("GLARA_RECOVERY_MODE", "true");
  await expect(change(f, "ai", false)).rejects.toThrow("RECOVERY_MODE");
  expect(
    (await f.c("owner").query(api.emergency.state, {})).every((x) => x.frozen),
  ).toBe(true);
  await expect(
    f.t.action(internal.admin.provision, {
      email: "fictional@example.test",
      name: "Fictional",
      roles: ["sales"],
    }),
  ).rejects.toThrow("restricted");
  await expect(
    f.c("owner").mutation(api.ai.request, { input: "{}" }),
  ).rejects.toThrow("CAPABILITY_FROZEN");
  await expect(
    f.c("owner").action(api.calendarProvider.sync, {
      source: { type: "operations_event", id: event!._id },
    }),
  ).rejects.toThrow();
});
it("supported account revocation destroys sessions/refresh tokens and codes; fresh login is denied", async () => {
  const f = await operationsFixture(),
    target = f.who("sales").id;
  const password = crypto.randomUUID();
  const hash = await (
    Password() as unknown as {
      options: { crypto: { hashSecret(value: string): Promise<string> } };
    }
  ).options.crypto.hashSecret(password);
  await f.t.run(async (ctx) => {
    const sessionId = f
      .who("sales")
      .subject.split("|")[1] as Id<"authSessions">;
    await ctx.db.insert("authRefreshTokens", {
      sessionId,
      expirationTime: Date.now() + 60000,
    });
    const accountId = await ctx.db.insert("authAccounts", {
      userId: target,
      provider: "password",
      providerAccountId: "sales@accounts.example.test",
      secret: hash,
    });
    await ctx.db.insert("authVerificationCodes", {
      accountId,
      provider: "glara-email",
      code: "fictional-hashed-code",
      expirationTime: Date.now() + 60000,
    });
  });
  await expect(
    f
      .c("sales")
      .action(api.securityAdmin.revokeUser, { userId: target, reason }),
  ).rejects.toThrow();
  const result = await f.c("owner").action(api.securityAdmin.revokeUser, {
    userId: target,
    reason,
    incident: "DRILL-M10-AUTH",
  });
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", target))
        .collect(),
    ),
  ).toHaveLength(0);
  expect(
    await f.t.run((ctx) => ctx.db.query("authRefreshTokens").collect()),
  ).toHaveLength(0);
  expect(
    await f.t.run((ctx) => ctx.db.query("authVerificationCodes").collect()),
  ).toHaveLength(0);
  expect(
    (
      await f.t.run((ctx) =>
        ctx.db.get(result.operation_id as Id<"security_revocations">),
      )
    )?.status,
  ).toBe("complete");
  await expect(f.c("sales").query(api.sales.summary, {})).rejects.toThrow();
  await expect(
    f.t.action(api.auth.signIn, {
      provider: "password",
      params: {
        flow: "signIn",
        email: "sales@accounts.example.test",
        password,
      },
    }),
  ).rejects.toThrow("AUTHENTICATION_FAILED");
});

it("platform role changes revoke old sessions and pending recovery before restoring access", async () => {
  const f = await operationsFixture();
  await f.t.action(internal.admin.setProfile, {
    userId: f.who("sales").id,
    name: "Fictional promoted user",
    roles: ["admin"],
    archived: false,
  });
  await expect(
    f.c("sales").query(api.operationalHealth.health, {}),
  ).rejects.toThrow();
  const sessions = await f.t.run((ctx) =>
    ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", f.who("sales").id))
      .collect(),
  );
  expect(sessions).toEqual([]);
});
it("interrupted and competing platform profile changes remain contained", async () => {
  const f = await operationsFixture(),
    args = {
      userId: f.who("sales").id,
      name: "Fictional change",
      roles: ["admin" as const],
      archived: false,
    };
  const first = await f.t.mutation(internal.admin.beginProfileChange, {
    userId: args.userId,
  });
  await expect(f.c("sales").query(api.sales.summary, {})).rejects.toThrow();
  await f.t.mutation(internal.admin.beginProfileChange, {
    userId: args.userId,
  });
  await expect(
    f.t.mutation(internal.admin.finishProfileChange, { ...args, lock: first }),
  ).rejects.toThrow();
  await expect(f.c("sales").query(api.sales.summary, {})).rejects.toThrow();
});
