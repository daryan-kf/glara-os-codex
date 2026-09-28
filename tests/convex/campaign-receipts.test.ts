import { afterEach, it, expect, vi } from "vitest";
import { convexTest } from "convex-test";
import { Webhook } from "svix";
import schema from "../../convex/schema";
import { internal } from "../../convex/_generated/api";
import original from "../fixtures/pacificwest-initial-launch.json";
import current from "../../docs/pacificwest-campaign.json";
const modules = import.meta.glob("../../convex/**/*.ts");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
async function setup() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(original.starts_at - 86400000);
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
  const t = convexTest({ schema, modules, transactionLimits: true });
  const cid = await t.mutation(internal.campaignLaunch.preparePacificWest, {
    owner_name: "Fictional Owner",
    owner_email: "owner@example.test",
    input: JSON.stringify(original),
  });
  await t.run(async (ctx) => {
    await ctx.db.patch(cid, {
      starts_at: current.starts_at,
      closes_at: current.closes_at,
      rules_version: current.rules_version,
    });
  });
  vi.setSystemTime(current.starts_at + 60000);
  for (const [k, v] of Object.entries({
    GLARA_EXPO_ENABLED: "true",
    GLARA_PRODUCTION_EMAIL_APPROVED: "true",
    GLARA_PRODUCTION_EXPO_RECEIPTS_APPROVED: "true",
    GLARA_EXPO_RECEIPTS_ENABLED: "true",
    GLARA_EXPO_RECEIPTS_MODE: "live",
    GLARA_EXPO_RECEIPTS_VERIFIED: "true",
    GLARA_EXPO_RESEND_KEY: "fictional-test-placeholder",
    M9_RESEND_WEBHOOK_SECRET:
      "whsec_" +
      Buffer.from("fictional webhook signing value").toString("base64"),
  }))
    vi.stubEnv(k, v);
  const enter = (overrides = {}) =>
    t.mutation(internal.campaigns.register, {
      input: JSON.stringify({
        slug: current.slug,
        first_name: "Fictional",
        last_name: "Realtor",
        brokerage: "Fictional Brokerage",
        email: "entry@example.test",
        phone: "6045550100",
        city: "Vancouver",
        licensed_realtor: true,
        licensed_in_bc: true,
        annual_listings: "21+",
        rules_version: current.rules_version,
        rules_accepted: true,
        marketing_consent: false,
        website: "",
        started_at: Date.now() - 10000,
        source: "direct",
        ...overrides,
      }),
      network_key: "a".repeat(64),
      identity_key: "b".repeat(64),
      phone_identity_key: "c".repeat(64),
    });
  const rows = () =>
    t.run((ctx) => ctx.db.query("campaign_receipts").collect());
  return { t, cid, enter, rows };
}
it("new entry queues one transactional receipt, even without marketing consent; duplicate queues nothing", async () => {
  const f = await setup();
  expect((await f.enter()).status).toBe("received");
  await f.enter();
  const rows = await f.rows();
  expect(rows).toHaveLength(1);
  expect(rows[0].body).toContain("October 2, 2026 at 5:00 PM");
  expect(rows[0].body).toContain("not a winner confirmation");
  await f.t.run(async (ctx) => {
    expect(await ctx.db.query("communication_consents").collect()).toHaveLength(
      0,
    );
    expect(await ctx.db.query("payments").collect()).toHaveLength(0);
  });
});
it("disabled and test-only configurations do not send or queue real entrants; registration still succeeds", async () => {
  for (const [k, v] of [
    ["GLARA_EXPO_RECEIPTS_ENABLED", "false"],
    ["GLARA_EXPO_RECEIPTS_MODE", "test"],
    ["GLARA_EXPO_RESEND_KEY", ""],
    ["GLARA_PRODUCTION_EMAIL_APPROVED", "false"],
  ]) {
    const f = await setup();
    vi.stubEnv(k, v);
    expect((await f.enter()).status).toBe("received");
    expect(await f.rows()).toHaveLength(0);
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await f.t.action(internal.campaignReceiptProvider.tick, {});
    expect(fetcher).not.toHaveBeenCalled();
  }
});
it("ineligible registrations do not get a receipt", async () => {
  const f = await setup();
  await f.enter({ licensed_in_bc: false });
  expect(await f.rows()).toHaveLength(0);
});
it("atomic claims prevent duplicate dispatch; provider failures never delete the entry", async () => {
  const f = await setup();
  await f.enter();
  const id = (await f.rows())[0]._id;
  const claims = await Promise.all([
    f.t.mutation(internal.campaignReceipts.claim, { id }),
    f.t.mutation(internal.campaignReceipts.claim, { id }),
  ]);
  expect(claims.filter(Boolean)).toHaveLength(1);
  await f.t.mutation(internal.campaignReceipts.outcome, {
    id,
    result: "unknown",
    code: "transport_uncertain",
  });
  expect((await f.rows())[0].status).toBe("unknown");
  expect(await f.t.query(internal.campaignReceipts.due, {})).toEqual([]);
  await f.t.run(async (ctx) => {
    expect(await ctx.db.query("campaign_entries").collect()).toHaveLength(1);
  });
});
it("honours hard-bounce and transactional suppression while preserving optional marketing unsubscribe", async () => {
  const f = await setup();
  await f.enter();
  const row = (await f.rows())[0];
  await f.t.run(async (ctx) => {
    const e = (await ctx.db.get(row.entry_id!))!;
    await ctx.db.insert("communication_preferences", {
      recipient_key: "realtor:" + e.realtor_id,
      channel: "email",
      scope: "all_optional",
      status: "unsubscribed",
      reason: "Fictional opt out",
      created_at: Date.now(),
      updated_at: Date.now(),
      version: 1,
    });
  });
  expect(
    await f.t.mutation(internal.campaignReceipts.claim, { id: row._id }),
  ).not.toBeNull();
  await f.t.run(async (ctx) => {
    await ctx.db.patch(row._id, { status: "ready" });
    await ctx.db.insert("communication_suppressions", {
      email: row.email,
      scope: "all",
      reason: "hard_bounce",
      created_at: Date.now(),
    });
  });
  vi.setSystemTime(Date.now() + 300001);
  expect(
    await f.t.mutation(internal.campaignReceipts.claim, { id: row._id }),
  ).toBeNull();
  expect((await f.rows())[0].status).toBe("blocked");
});
it("signed delivery before outcome is reconciled, duplicate events are safe, bounce suppresses later delivery", async () => {
  const f = await setup();
  await f.enter();
  const id = (await f.rows())[0]._id;
  await f.t.mutation(internal.campaignReceipts.claim, { id });
  const event = async (type: string, eventId: string) => {
    const payload = JSON.stringify({
      type,
      created_at: new Date().toISOString(),
      data: { email_id: "fake-provider-id" },
    });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = new Webhook(process.env.M9_RESEND_WEBHOOK_SECRET!).sign(
      eventId,
      new Date(Number(timestamp) * 1000),
      payload,
    );
    return f.t.action(internal.communicationProvider.verifyEvent, {
      payload,
      id: eventId,
      timestamp,
      signature,
    });
  };
  expect(await event("email.delivered", "evt1")).toBe(true);
  await f.t.mutation(internal.campaignReceipts.outcome, {
    id,
    result: "accepted",
    provider_id: "fake-provider-id",
    code: "accepted",
  });
  expect((await f.rows())[0].status).toBe("delivered");
  await event("email.bounced", "evt2");
  await event("email.bounced", "evt2");
  await event("email.delivered", "evt3");
  expect((await f.rows())[0].status).toBe("hard_bounce");
  await f.t.run(async (ctx) => {
    expect(
      await ctx.db.query("communication_suppressions").collect(),
    ).toHaveLength(1);
  });
});
it("worker sends only fixed receipt to stored email, and never re-sends after acceptance", async () => {
  const f = await setup();
  await f.enter();
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response(JSON.stringify({ id: "fake-provider-id" }), { status: 200 }),
    );
  vi.stubGlobal("fetch", fetcher);
  await f.t.action(internal.campaignReceiptProvider.tick, {});
  await f.t.action(internal.campaignReceiptProvider.tick, {});
  expect(fetcher).toHaveBeenCalledTimes(1);
  const options = fetcher.mock.calls[0][1];
  const data = JSON.parse(options.body);
  expect(data.to).toEqual(["entry@example.test"]);
  expect(data.reply_to).toBe("Support@glarahome.com");
  expect(options.headers["Idempotency-Key"]).toBe((await f.rows())[0].key);
});
it("crashed dispatch becomes unknown without an automatic retry; revoked enablement blocks dispatch", async () => {
  const f = await setup();
  await f.enter();
  const id = (await f.rows())[0]._id;
  await f.t.mutation(internal.campaignReceipts.claim, { id });
  vi.stubEnv("GLARA_EXPO_RECEIPTS_ENABLED", "false");
  expect(
    await f.t.query(internal.campaignReceipts.dispatchAllowed, { id }),
  ).toBe(false);
  vi.setSystemTime(Date.now() + 300001);
  await f.t.mutation(internal.campaignReceipts.sweep, {});
  expect((await f.rows())[0].status).toBe("unknown");
});
