import { afterEach, expect, it, vi } from "vitest";
import { convexTest } from "convex-test";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import approved from "../fixtures/pacificwest-initial-launch.json";
import { campaignPathAllowed } from "../../src/lib/campaigns/public-deployment";
const modules = import.meta.glob("../../convex/**/*.ts");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
function fixture() {
  vi.useFakeTimers();
  vi.setSystemTime(approved.starts_at - 86400000);
  for (const [k, v] of Object.entries({
    GLARA_ENVIRONMENT: "production",
    GLARA_PUBLIC_CAMPAIGN_ONLY: "true",
    GLARA_PACIFICWEST_PROVISIONING_APPROVED: "true",
    GLARA_PRODUCTION_APPROVED: "true",
    GLARA_PRODUCTION_EXPO_APPROVED: "true",
    GLARA_RECOVERY_MODE: "false",
    GLARA_EXPO_ENABLED: "false",
    M9_EMAIL_ENABLED: "false",
    M9_CALENDAR_ENABLED: "false",
    AUTH_EMAIL_ENABLED: "false",
    GLARA_AI_SECURITY_APPROVED: "false",
    GLARA_AUTOMATION_ENABLED: "false",
  }))
    vi.stubEnv(k, v);
  return convexTest({ schema, modules, transactionLimits: true });
}
const owner = {
  input: JSON.stringify(approved),
  owner_name: "Fictional Owner",
  owner_email: "owner@accounts.example.test",
};
it("public-only routing excludes staff, auth, similar prefixes and other campaigns", () => {
  for (const p of [
    "/win",
    "/win/",
    "/api/giveaway",
    "/giveaway/pacificwest-2026",
    "/glara-win-assets/_next/static/a.js",
  ])
    expect(campaignPathAllowed(p)).toBe(true);
  for (const p of [
    "/",
    "/login",
    "/dashboard",
    "/api/auth",
    "/api/giveaway/extra",
    "/win-extra",
    "/giveaway/other",
    "/glara-win-assets/private",
  ])
    expect(campaignPathAllowed(p)).toBe(false);
});
it("production setup is restartable, audited as platform action, and creates no login credentials", async () => {
  const t = fixture();
  const id = await t.mutation(
    internal.campaignLaunch.preparePacificWest,
    owner,
  );
  expect(
    await t.mutation(internal.campaignLaunch.preparePacificWest, owner),
  ).toBe(id);
  await t.run(async (ctx) => {
    expect(await ctx.db.query("marketing_campaigns").collect()).toHaveLength(1);
    expect(await ctx.db.query("users").collect()).toHaveLength(1);
    expect(await ctx.db.query("authAccounts").collect()).toHaveLength(0);
    expect(await ctx.db.query("authSessions").collect()).toHaveLength(0);
    const audit = await ctx.db.query("audit_logs").first();
    expect(audit?.actor_id).toBeNull();
    expect(audit?.action).toBe("PLATFORM_APPROVED_CAMPAIGN_PROVISIONED");
  });
  await expect(
    t.mutation(internal.campaignLaunch.preparePacificWest, {
      ...owner,
      owner_email: "changed@accounts.example.test",
    }),
  ).rejects.toThrow();
});
it("setup refuses unapproved, enabled or non-production environments", async () => {
  for (const [k, v] of [
    ["GLARA_ENVIRONMENT", "development"],
    ["GLARA_PACIFICWEST_PROVISIONING_APPROVED", "false"],
    ["GLARA_PUBLIC_CAMPAIGN_ONLY", "false"],
    ["GLARA_EXPO_ENABLED", "true"],
    ["M9_EMAIL_ENABLED", "true"],
  ]) {
    const t = fixture();
    vi.stubEnv(k, v);
    await expect(
      t.mutation(internal.campaignLaunch.preparePacificWest, owner),
    ).rejects.toThrow();
    await t.run(async (ctx) => {
      expect(await ctx.db.query("users").collect()).toHaveLength(0);
    });
  }
});
it("public-only deployment denies even a valid Owner session and password authentication", async () => {
  const t = fixture();
  await t.mutation(internal.campaignLaunch.preparePacificWest, owner);
  const subject = await t.run(async (ctx) => {
    const user = (await ctx.db.query("users").first())!;
    const session = await ctx.db.insert("authSessions", {
      userId: user._id,
      expirationTime: Date.now() + 3600000,
    });
    return user._id + "|" + session;
  });
  await expect(
    t.withIdentity({ subject }).query(api.campaigns.list, {}),
  ).rejects.toThrow();
  expect(
    await t.query(internal.authSecurity.eligible, { email: owner.owner_email }),
  ).toBe(false);
  expect(
    await t.mutation(internal.authSecurity.attempt, {
      key: "a".repeat(64),
      recovery: false,
    }),
  ).toBe(false);
});
it("production-only campaign preserves exact boundaries, CRM writes and duplicate prevention", async () => {
  const t = fixture();
  await t.mutation(internal.campaignLaunch.preparePacificWest, owner);
  expect(
    (await t.query(api.campaigns.publicCampaign, { slug: approved.slug }))
      ?.state,
  ).toBe("scheduled");
  vi.stubEnv("GLARA_EXPO_ENABLED", "true");
  const submit = () =>
    t.mutation(internal.campaigns.register, {
      input: JSON.stringify({
        slug: approved.slug,
        first_name: "Fictional",
        last_name: "Realtor",
        brokerage: "Fictional Brokerage",
        email: "entry@accounts.example.test",
        phone: "6045550100",
        city: "Vancouver",
        licensed_realtor: true,
        licensed_in_bc: true,
        annual_listings: "21+",
        rules_version: approved.rules_version,
        rules_accepted: true,
        marketing_consent: false,
        website: "",
        started_at: Date.now() - 10000,
        source: "direct",
      }),
      network_key: "a".repeat(64),
      identity_key: "b".repeat(64),
      phone_identity_key: "c".repeat(64),
    });
  expect((await submit()).status).toBe("closed");
  vi.setSystemTime(approved.starts_at);
  expect((await submit()).status).toBe("received");
  expect((await submit()).status).toBe("received");
  vi.setSystemTime(approved.closes_at);
  expect((await submit()).status).toBe("closed");
  await t.run(async (ctx) => {
    expect(await ctx.db.query("campaign_entries").collect()).toHaveLength(1);
    expect(await ctx.db.query("realtors").collect()).toHaveLength(1);
    expect(await ctx.db.query("payments").collect()).toHaveLength(0);
  });
});

it("Owner schedule correction opens immediately, preserves prize terms, audits and closes Friday", async () => {
  const t = fixture();
  await t.mutation(internal.campaignLaunch.preparePacificWest, owner);
  vi.setSystemTime(Date.parse("2026-09-28T02:02:38Z"));
  vi.stubEnv("GLARA_PACIFICWEST_SCHEDULE_CHANGE_APPROVED", "true");
  vi.stubEnv("GLARA_EXPO_ENABLED", "true");
  const result = await t.mutation(internal.campaignLaunch.openPacificWestNow, {
    expected_version: 1,
  });
  expect(result.starts_at).toBe(Date.now());
  expect(result.closes_at).toBe(Date.parse("2026-10-03T00:00:00Z"));
  expect(result.official_rules).toContain(
    "September 27, 2026 at 7:02:38 PM Pacific Time",
  );
  expect(result.official_rules).not.toContain("September 29, 2026 at 5:00 PM");
  expect(
    (await t.query(api.campaigns.publicCampaign, { slug: approved.slug }))
      ?.state,
  ).toBe("open");
  await t.run(async (ctx) => {
    const c = await ctx.db.get(result.campaign_id);
    expect(c?.prize_terms).toBe(approved.prize_terms);
    expect(c?.consent_text).toBe(approved.consent_text);
    const audits = await ctx.db.query("audit_logs").collect();
    expect(audits.at(-1)?.action).toBe(
      "PLATFORM_OWNER_APPROVED_CAMPAIGN_SCHEDULE_CHANGED",
    );
    expect(audits.at(-1)?.actor_id).toBeNull();
  });
  await expect(
    t.mutation(internal.campaignLaunch.openPacificWestNow, {
      expected_version: 1,
    }),
  ).rejects.toThrow();
  vi.setSystemTime(result.closes_at - 1);
  expect(
    (await t.query(api.campaigns.publicCampaign, { slug: approved.slug }))
      ?.state,
  ).toBe("open");
  vi.setSystemTime(result.closes_at);
  expect(
    (await t.query(api.campaigns.publicCampaign, { slug: approved.slug }))
      ?.state,
  ).toBe("closed");
});
it("schedule correction fails closed without approval, with unsafe providers, or stale version", async () => {
  const t = fixture();
  await t.mutation(internal.campaignLaunch.preparePacificWest, owner);
  vi.setSystemTime(Date.parse("2026-09-28T02:02:38Z"));
  await expect(
    t.mutation(internal.campaignLaunch.openPacificWestNow, {
      expected_version: 1,
    }),
  ).rejects.toThrow();
  vi.stubEnv("GLARA_PACIFICWEST_SCHEDULE_CHANGE_APPROVED", "true");
  await expect(
    t.mutation(internal.campaignLaunch.openPacificWestNow, {
      expected_version: 2,
    }),
  ).rejects.toThrow();
  vi.stubEnv("M9_EMAIL_ENABLED", "true");
  await expect(
    t.mutation(internal.campaignLaunch.openPacificWestNow, {
      expected_version: 1,
    }),
  ).rejects.toThrow();
});

it("schedule correction refuses a frozen draw even if the campaign still looks scheduled", async () => {
  const t = fixture();
  const id = await t.mutation(
    internal.campaignLaunch.preparePacificWest,
    owner,
  );
  vi.setSystemTime(Date.parse("2026-09-28T02:02:38Z"));
  vi.stubEnv("GLARA_PACIFICWEST_SCHEDULE_CHANGE_APPROVED", "true");
  await t.run(async (ctx) => {
    const c = (await ctx.db.get(id))!;
    await ctx.db.insert("campaign_draws", {
      campaign_id: id,
      rules_version: c.rules_version,
      closed_at: Date.now(),
      entry_ids: [],
      eligible_count: 0,
      operator_id: c.assigned_to,
      created_at: Date.now(),
      algorithm: "node-crypto-randomInt-v1",
      reason: "Fictional test",
    });
  });
  await expect(
    t.mutation(internal.campaignLaunch.openPacificWestNow, {
      expected_version: 1,
    }),
  ).rejects.toThrow("Entries or draws exist");
});
