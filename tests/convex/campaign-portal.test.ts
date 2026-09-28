import { campaignPasswordValid } from "../../src/lib/campaigns/portal";
import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import approved from "../fixtures/pacificwest-initial-launch.json";
import {
  campaignPortalEnabled,
  campaignPortalPathAllowed,
} from "../../src/lib/campaigns/portal";
const modules = import.meta.glob("../../convex/**/*.ts");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
const enabled = {
  GLARA_ENVIRONMENT: "production",
  GLARA_PUBLIC_CAMPAIGN_ONLY: "true",
  GLARA_PRODUCTION_APPROVED: "true",
  GLARA_PRODUCTION_EXPO_APPROVED: "true",
  GLARA_EXPO_ADMIN_ENABLED: "true",
  GLARA_PRODUCTION_EXPO_ADMIN_APPROVED: "true",
  GLARA_RECOVERY_MODE: "false",
};
async function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(approved.starts_at - 60000);
  for (const [k, v] of Object.entries({
    ...enabled,
    GLARA_PACIFICWEST_PROVISIONING_APPROVED: "true",
    GLARA_EXPO_ENABLED: "false",
    M9_EMAIL_ENABLED: "false",
    M9_CALENDAR_ENABLED: "false",
    AUTH_EMAIL_ENABLED: "false",
    GLARA_AI_SECURITY_APPROVED: "false",
    GLARA_AUTOMATION_ENABLED: "false",
  }))
    vi.stubEnv(k, v);
  const t = convexTest({ schema, modules, transactionLimits: true });
  const campaignId = await t.mutation(
    internal.campaignLaunch.preparePacificWest,
    {
      input: JSON.stringify(approved),
      owner_name: "Fictional Owner",
      owner_email: "owner@accounts.example.test",
    },
  );
  const actor = await t.run(async (ctx) => {
    const user = (await ctx.db.query("users").first())!;
    const profile = (await ctx.db.query("profiles").first())!;
    const session = await ctx.db.insert("authSessions", {
      userId: user._id,
      expirationTime: approved.starts_at + 3600000,
    });
    await ctx.db.insert("authAccounts", {
      userId: user._id,
      provider: "password",
      providerAccountId: user.email!,
    });
    return {
      userId: user._id,
      profileId: profile._id,
      session,
      subject: user._id + "|" + session,
    };
  });
  vi.stubEnv("GLARA_EXPO_ADMIN_USER_ID", actor.userId);
  vi.stubEnv("GLARA_EXPO_ENABLED", "true");
  vi.setSystemTime(approved.starts_at);
  await t.mutation(internal.campaigns.register, {
    input: JSON.stringify({
      slug: "pacificwest-2026",
      first_name: "Fictional",
      last_name: "Participant",
      brokerage: "Fictional Brokerage",
      email: "participant@accounts.example.test",
      phone: "6045550123",
      city: "Vancouver",
      licensed_realtor: true,
      licensed_in_bc: true,
      annual_listings: "11–20",
      rules_version: approved.rules_version,
      rules_accepted: true,
      marketing_consent: false,
      website: "",
      source: "direct",
      started_at: Date.now() - 10000,
    }),
    network_key: "a".repeat(64),
    identity_key: "b".repeat(64),
    phone_identity_key: "c".repeat(64),
  });
  return {
    t,
    actor,
    campaignId,
    owner: t.withIdentity({ subject: actor.subject }),
  };
}
const args = {
  search: "",
  check: 0,
  paginationOpts: { numItems: 25, cursor: null },
};
it("portal is default closed, scoped to exact routes and fails closed on recovery/unapproved production", () => {
  expect(campaignPortalEnabled({})).toBe(false);
  expect(campaignPortalEnabled(enabled)).toBe(true);
  for (const [k, v] of [
    ["GLARA_EXPO_ADMIN_ENABLED", "false"],
    ["GLARA_PRODUCTION_EXPO_ADMIN_APPROVED", "false"],
    ["GLARA_PRODUCTION_APPROVED", "false"],
    ["GLARA_PUBLIC_CAMPAIGN_ONLY", "false"],
    ["GLARA_RECOVERY_MODE", "true"],
    ["GLARA_ENVIRONMENT", "unknown"],
    ["GLARA_ACCEPTANCE_MODE", "true"],
    ["GLARA_ACCEPTANCE_PASSWORDS", "not-empty"],
  ])
    expect(campaignPortalEnabled({ ...enabled, [k]: v })).toBe(false);
  for (const path of [
    "/campaign-admin",
    "/campaign-admin/",
    "/api/campaign-auth",
  ])
    expect(campaignPortalPathAllowed(path)).toBe(true);
  for (const path of [
    "/dashboard",
    "/campaign-admin/export",
    "/campaign-admin-other",
    "/api/campaign-auth/other",
    "/api/auth",
  ])
    expect(campaignPortalPathAllowed(path)).toBe(false);
});
it("anonymous and unapproved identities cannot enumerate real contacts", async () => {
  const f = await fixture();
  expect(await f.t.query(api.campaignPortal.viewer, { check: 0 })).toBeNull();
  await expect(
    f.t.query(api.campaignPortal.registrations, args),
  ).rejects.toThrow();
  await expect(
    f.t.query(api.campaignPortal.summary, { check: 0 }),
  ).rejects.toThrow();
  vi.stubEnv("GLARA_EXPO_ADMIN_USER_ID", "another-owner");
  expect(
    await f.owner.query(api.campaignPortal.viewer, { check: 0 }),
  ).toBeNull();
  await expect(
    f.owner.query(api.campaignPortal.registrations, args),
  ).rejects.toThrow();
});
it("verified Owner reads the campaign projection with separate consent and no private CRM fields", async () => {
  const f = await fixture();
  expect(
    await f.owner.query(api.campaignPortal.summary, { check: 0 }),
  ).toMatchObject({ total: 1, eligible: 1, review: 0, optedIn: 0 });
  const result = await f.owner.query(api.campaignPortal.registrations, args);
  expect(result.page).toHaveLength(1);
  expect(result.page[0]).toMatchObject({
    first_name: "Fictional",
    last_name: "Participant",
    brokerage: "Fictional Brokerage",
    email: "participant@accounts.example.test",
    phone: "6045550123",
    marketing_consent: false,
    licensed_in_bc: true,
    receipt_status: "not_queued",
    crm_origin: "new",
  });
  expect(result.page[0]).not.toHaveProperty("notes");
  expect(result.page[0]).not.toHaveProperty("provider_id");
  expect(
    (
      await f.owner.query(api.campaignPortal.registrations, {
        ...args,
        search: "BROKERAGE",
      })
    ).page,
  ).toHaveLength(1);
  expect(
    (
      await f.owner.query(api.campaignPortal.registrations, {
        ...args,
        search: "absent",
      })
    ).page,
  ).toHaveLength(0);
});
it("portal access cannot access normal staff queries or mutate campaign state", async () => {
  const f = await fixture();
  expect(
    await f.owner.query(api.campaignPortal.viewer, { check: 0 }),
  ).not.toBeNull();
  expect(await f.owner.query(api.profiles.viewer, {})).toBeNull();
  await expect(f.owner.query(api.campaigns.list, {})).rejects.toThrow();
  await expect(
    f.owner.query(api.campaigns.entryList, {
      id: f.campaignId,
      q: "",
      filter: "",
      paginationOpts: args.paginationOpts,
    }),
  ).rejects.toThrow();
  await expect(
    f.owner.mutation(api.campaigns.transition, {
      id: f.campaignId,
      version: 1,
      to: "closed",
    }),
  ).rejects.toThrow();
});
it("all other roles, archived/contained owners and revoked sessions fail closed", async () => {
  const f = await fixture();
  for (const roles of [
    ["admin"],
    ["marketing"],
    ["sales"],
    ["designer"],
    ["staging_crew"],
    [],
  ] as const) {
    await f.t.run((ctx) =>
      ctx.db.patch(f.actor.profileId, { roles: [...roles] }),
    );
    await expect(
      f.owner.query(api.campaignPortal.registrations, args),
    ).rejects.toThrow();
  }
  await f.t.run((ctx) =>
    ctx.db.patch(f.actor.profileId, {
      roles: ["owner"],
      deleted_at: new Date().toISOString(),
    }),
  );
  expect(
    await f.t.query(internal.authSecurity.eligible, {
      email: "owner@accounts.example.test",
    }),
  ).toBe(false);
  await expect(
    f.owner.query(api.campaignPortal.registrations, args),
  ).rejects.toThrow();
  await f.t.run((ctx) =>
    ctx.db.patch(f.actor.profileId, {
      deleted_at: null,
      pending_change_token: "contained",
    }),
  );
  await expect(
    f.owner.query(api.campaignPortal.registrations, args),
  ).rejects.toThrow();
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.actor.profileId, { pending_change_token: undefined });
    await ctx.db.delete(f.actor.session);
  });
  await expect(
    f.owner.query(api.campaignPortal.registrations, args),
  ).rejects.toThrow();
});
it("expired sessions and forged refresh values never extend authorization", async () => {
  const f = await fixture();
  vi.setSystemTime(approved.starts_at + 3600001);
  expect(
    await f.owner.query(api.campaignPortal.viewer, { check: -999999 }),
  ).toBeNull();
  await expect(
    f.owner.query(api.campaignPortal.registrations, { ...args, check: 999999 }),
  ).rejects.toThrow();
});
it("only the configured active Owner can use password eligibility in public-only mode", async () => {
  const f = await fixture();
  expect(
    await f.t.query(internal.authSecurity.eligible, {
      email: "owner@accounts.example.test",
    }),
  ).toBe(true);
  expect(
    await f.t.query(internal.authSecurity.eligible, {
      email: "other@accounts.example.test",
    }),
  ).toBe(false);
  vi.stubEnv("GLARA_EXPO_ADMIN_ENABLED", "false");
  expect(
    await f.t.query(internal.authSecurity.eligible, {
      email: "owner@accounts.example.test",
    }),
  ).toBe(false);
  expect(
    await f.t.mutation(internal.authSecurity.attempt, {
      key: "a".repeat(64),
      recovery: false,
    }),
  ).toBe(false);
  await expect(
    f.owner.query(api.campaignPortal.registrations, args),
  ).rejects.toThrow();
});
it("receipt joins and unresolved identities render without private message content", async () => {
  const f = await fixture();
  await f.t.run(async (ctx) => {
    const entry = (await ctx.db.query("campaign_entries").first())!;
    await ctx.db.patch(entry._id, {
      realtor_id: null,
      crm_origin: "review",
      eligibility_status: "pending",
      pending_contact: {
        first_name: "Pending",
        last_name: "Identity",
        brokerage: "Review Brokerage",
        city: "Victoria",
      },
    });
    await ctx.db.insert("campaign_receipts", {
      entry_id: entry._id,
      campaign_id: f.campaignId,
      key: `expo-receipt:${entry._id}`,
      email: entry.normalized_email,
      subject: "Private subject",
      body: "Private email body",
      template_version: "test",
      rules_version: "test",
      test: false,
      status: "delivered",
      attempts: 1,
      next_at: Date.now(),
      created_at: Date.now(),
      updated_at: Date.now(),
    });
  });
  const result = await f.owner.query(api.campaignPortal.registrations, args);
  expect(result.page[0]).toMatchObject({
    first_name: "Pending",
    brokerage: "Review Brokerage",
    eligibility: "pending",
    receipt_status: "delivered",
  });
  expect(JSON.stringify(result)).not.toContain("Private email body");
  expect(
    await f.owner.query(api.campaignPortal.summary, { check: 0 }),
  ).toMatchObject({ review: 1 });
});
it("bounded pagination and search validation reject oversized requests", async () => {
  const f = await fixture();
  for (const numItems of [0, 51, 1.5])
    await expect(
      f.owner.query(api.campaignPortal.registrations, {
        ...args,
        paginationOpts: { cursor: null, numItems },
      }),
    ).rejects.toThrow();
  await expect(
    f.owner.query(api.campaignPortal.registrations, {
      ...args,
      search: "x".repeat(101),
    }),
  ).rejects.toThrow();
});
it("access audit actor comes from session and repeated openings do not duplicate audit", async () => {
  const f = await fixture();
  await expect(
    f.t.mutation(api.campaignPortal.recordAccess, {}),
  ).rejects.toThrow();
  await f.owner.mutation(api.campaignPortal.recordAccess, {});
  await f.owner.mutation(api.campaignPortal.recordAccess, {});
  const logs = await f.t.run((ctx) => ctx.db.query("audit_logs").collect());
  const views = logs.filter((r) => r.action === "CAMPAIGN_PORTAL_VIEWED");
  expect(views).toHaveLength(1);
  expect(views[0].actor_id).toBe(f.actor.userId);
  expect(views[0].new_value).toEqual({ scope: "pacificwest-2026:read" });
});

it("portal password policy accepts eight characters and rejects out-of-bounds or non-string input", () => {
  expect(campaignPasswordValid("Test123!")).toBe(true);
  expect(campaignPasswordValid("Short7!")).toBe(false);
  expect(campaignPasswordValid("x".repeat(128))).toBe(true);
  expect(campaignPasswordValid("x".repeat(129))).toBe(false);
  expect(campaignPasswordValid(null)).toBe(false);
  expect(campaignPasswordValid({ length: 8 })).toBe(false);
});
