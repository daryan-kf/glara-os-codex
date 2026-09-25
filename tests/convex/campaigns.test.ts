import pacificwest from "../../docs/pacificwest-campaign.json";
import { describe, it, expect, vi, afterEach } from "vitest";
import { convexTest } from "convex-test";
import { randomBytes, createHmac } from "node:crypto";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import {
  eventDay,
  intakeEnabled,
  phoneIdentity,
  sixMonthExpiry,
  campaignPacificZone,
  campaignInput,
} from "../../src/lib/campaigns/model";
const modules = import.meta.glob("../../convex/**/*.ts");
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});
async function fixture(overrides: Record<string, unknown> = {}) {
  vi.stubEnv("GLARA_ENVIRONMENT", "development");
  vi.stubEnv("GLARA_EXPO_ENABLED", "true");
  vi.stubEnv("GLARA_RECOVERY_MODE", "false");
  vi.stubEnv("GLARA_EXPO_INGRESS_SECRET", randomBytes(32).toString("hex"));
  const t = convexTest({ schema, modules, transactionLimits: true });
  const users = await t.run(async (ctx) => {
    const out = [];
    for (const role of [
      "owner",
      "admin",
      "sales",
      "marketing",
      "designer",
      "staging_crew",
    ] as const) {
      const id = await ctx.db.insert("users", {
        email: role + "@accounts.example.test",
      });
      const profile = await ctx.db.insert("profiles", {
        userId: id,
        display_name: role,
        roles: [role],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      });
      const session = await ctx.db.insert("authSessions", {
        userId: id,
        expirationTime: Date.now() + 3600000,
      });
      out.push({ id, role, profile, subject: id + "|" + session });
    }
    return out;
  });
  const actor = (role: string) =>
    t.withIdentity({ subject: users.find((u) => u.role === role)!.subject });
  const owner = actor("owner");
  const input = {
    name: "Fictional Expo",
    slug: "fictional-expo",
    public_title: "WIN A $2,000 GLARA STAGING CREDIT",
    public_description: "Fictional test campaign only.",
    prize_name: "Glara Staging Credit",
    prize_value_cents: 200000,
    starts_at: Date.now() - 60000,
    closes_at: Date.now() + 86400000,
    eligibility_summary: "Licensed Realtors whose primary market is Vancouver.",
    eligible_cities: ["Vancouver"],
    official_rules:
      "Fictional rules: one entry per licensed Realtor. No purchase necessary. One CAD $2,000 service-credit prize, selected randomly from eligible entries. Subject to identity verification.",
    rules_version: "1",
    privacy_notice:
      "Fictional privacy notice for isolated acceptance only. No customer information.",
    consent_text:
      "Optional fictional consent to marketing email from the test sponsor; withdraw at any time.",
    prize_terms:
      "Fictional approved terms for a single staging-service credit. No cash payment is recorded.",
    prize_terms_version: "1",
    prize_expires_at: Date.now() + 86400000 * 100,
    skill_question_required: true,
    assigned_to: users[0].id,
    legal_approved: true,
    ...overrides,
  };
  const id = await owner.mutation(api.campaigns.save, {
    version: 0,
    input: JSON.stringify(input),
  });
  const get = () => t.run((ctx) => ctx.db.get(id));
  const transition = async (to: "open" | "closed" | "cancelled") => {
    const c = await get();
    return owner.mutation(api.campaigns.transition, {
      id,
      version: c!.version,
      to,
    });
  };
  const registration = (n = 1) => ({
    slug: input.slug,
    first_name: "Fictional",
    last_name: "Realtor " + n,
    brokerage: "Fictional Brokerage",
    email: `entrant${n}@accounts.example.test`,
    phone: `604555${String(n).padStart(4, "0")}`,
    city: "Vancouver",
    licensed_realtor: true,
    annual_listings: "21+",
    rules_version: input.rules_version,
    rules_accepted: true,
    marketing_consent: false,
    source: "booth",
    website: "",
    started_at: Date.now() - 10000,
  });
  const enter = (n = 1, changes: Record<string, unknown> = {}) =>
    t.mutation(internal.campaigns.register, {
      input: JSON.stringify({ ...registration(n), ...changes }),
      network_key: "fictional-shared-network",
      identity_key: "fictional-identity-" + n,
      phone_identity_key: "fictional-phone-" + n,
    });
  const rows = () => t.run((ctx) => ctx.db.query("campaign_entries").collect());
  return {
    t,
    owner,
    actor,
    users,
    id,
    input,
    get,
    transition,
    registration,
    enter,
    rows,
  };
}
describe("expo registration and draw security", () => {
  it("defaults disabled and requires separate production approval", () => {
    expect(intakeEnabled({})).toBe(false);
    expect(
      intakeEnabled({
        GLARA_ENVIRONMENT: "production",
        GLARA_EXPO_ENABLED: "true",
        GLARA_PRODUCTION_APPROVED: "true",
      }),
    ).toBe(false);
    expect(phoneIdentity("+1 (604) 555-0123")).toBe("6045550123");
    expect(
      eventDay(
        Date.parse("2026-09-24T23:00:00-07:00"),
        Date.parse("2026-09-25T01:00:00-07:00"),
      ),
    ).toBe("day_2");
  });
  it("does not expose drafts; refuses disabled, scheduled, early, expired or cancelled submissions", async () => {
    const f = await fixture();
    expect(
      await f.t.query(api.campaigns.publicCampaign, { slug: f.input.slug }),
    ).toBeNull();
    expect((await f.enter()).status).toBe("closed");
    await f.transition("open");
    vi.stubEnv("GLARA_EXPO_ENABLED", "false");
    expect((await f.enter()).status).toBe("unavailable");
    vi.stubEnv("GLARA_EXPO_ENABLED", "true");
    await f.t.run((ctx) =>
      ctx.db.patch(f.id, { starts_at: Date.now() + 60000 }),
    );
    expect((await f.enter()).status).toBe("closed");
    await f.t.run((ctx) =>
      ctx.db.patch(f.id, {
        starts_at: Date.now() - 1000,
        closes_at: Date.now() - 1,
      }),
    );
    expect((await f.enter()).status).toBe("closed");
    expect(await f.rows()).toHaveLength(0);
  });
  it("creates one CRM prospect, next action, attributed activity and null-actor audit", async () => {
    const f = await fixture();
    await f.transition("open");
    expect((await f.enter()).status).toBe("received");
    const [entry] = await f.rows();
    const data = await f.t.run(async (ctx) => ({
      r: await ctx.db.get(entry.realtor_id!),
      activities: await ctx.db.query("activities").collect(),
      audit: await ctx.db.query("audit_logs").collect(),
      consents: await ctx.db.query("communication_consents").collect(),
    }));
    expect(data.r?.relationship_status).toBe("prospect");
    expect(
      data.activities.some(
        (x) => x.type === "follow_up" && x.status === "open" && x.due_at,
      ),
    ).toBe(true);
    expect(
      data.activities.some(
        (x) => x.actor_kind === "system" && x.type === "note",
      ),
    ).toBe(true);
    expect(
      data.audit.some(
        (x) => x.actor_id === null && x.action === "public_expo_entry_received",
      ),
    ).toBe(true);
    expect(data.consents).toHaveLength(0);
    expect(entry).toMatchObject({
      marketing_consent: false,
      eligibility_status: "eligible",
      source: "booth",
    });
  });
  it("collapses concurrent, case-normalized email and country-code phone duplicates", async () => {
    const f = await fixture();
    await f.transition("open");
    await Promise.all([f.enter(), f.enter()]);
    await f.enter(2, { phone: "+1 604 555 0001" });
    await f.enter(3, { email: "ENTRANT1@ACCOUNTS.EXAMPLE.TEST" });
    expect(await f.rows()).toHaveLength(1);
    expect(
      await f.t.run((ctx) => ctx.db.query("realtors").collect()),
    ).toHaveLength(1);
  });
  it("links repeat campaign participation without overwriting CRM fields", async () => {
    const f = await fixture();
    await f.transition("open");
    await f.enter();
    const [entry] = await f.rows();
    const other = await f.owner.mutation(api.campaigns.save, {
      version: 0,
      input: JSON.stringify({ ...f.input, slug: "second-expo" }),
    });
    await f.owner.mutation(api.campaigns.transition, {
      id: other,
      version: 1,
      to: "open",
    });
    await f.enter(1, { slug: "second-expo", first_name: "Changed" });
    const r = await f.t.run((ctx) => ctx.db.get(entry.realtor_id!));
    expect(r!.first_name).toBe("Fictional");
    expect(
      (await f.rows()).filter((e) => e.crm_origin === "existing"),
    ).toHaveLength(1);
  });
  it("quarantines conflicting and archived identities without public CRM disclosure", async () => {
    const f = await fixture();
    await f.transition("open");
    await f.enter();
    const [e] = await f.rows();
    const other = await f.owner.mutation(api.campaigns.save, {
      version: 0,
      input: JSON.stringify({ ...f.input, slug: "review-expo" }),
    });
    await f.owner.mutation(api.campaigns.transition, {
      id: other,
      version: 1,
      to: "open",
    });
    await f.t.run((ctx) =>
      ctx.db.patch(e.realtor_id!, { deleted_at: new Date().toISOString() }),
    );
    expect((await f.enter(1, { slug: "review-expo" })).status).toBe("received");
    expect((await f.rows()).find((e) => e.campaign_id === other)).toMatchObject(
      { realtor_id: null, eligibility_status: "pending", crm_origin: "review" },
    );
  });
  it("keeps consent optional, records exact opt-in evidence and preserves withdrawals", async () => {
    const f = await fixture();
    await f.transition("open");
    await f.enter(1, { marketing_consent: true });
    const [entry] = await f.rows();
    await f.t.run(async (ctx) => {
      await ctx.db.insert("communication_preferences", {
        recipient_key: "realtor:" + entry.realtor_id,
        channel: "email",
        scope: "commercial_marketing",
        status: "unsubscribed",
        reason: "Fictional withdrawal",
        created_at: Date.now(),
        updated_at: Date.now(),
        version: 1,
      });
      await ctx.db.insert("communication_suppressions", {
        email: entry.normalized_email,
        scope: "all_optional",
        reason: "complaint",
        created_at: Date.now(),
      });
    });
    await f.enter(1, { marketing_consent: false });
    const values = await f.t.run(async (ctx) => ({
      consents: await ctx.db.query("communication_consents").collect(),
      preferences: await ctx.db.query("communication_preferences").collect(),
      suppression: await ctx.db.query("communication_suppressions").collect(),
    }));
    expect(values.consents).toHaveLength(1);
    expect(values.consents[0]).toMatchObject({
      evidence: f.input.consent_text,
      actor_kind: "public_registration",
    });
    expect(values.preferences[0].status).toBe("unsubscribed");
    expect(values.suppression[0].revoked_at).toBeUndefined();
  });
  it("enforces licence, city, current rules and strict server fields", async () => {
    const f = await fixture();
    await f.transition("open");
    await f.enter(1, { licensed_realtor: false });
    await f.enter(2, { city: "Outside region" });
    expect(
      (await f.rows()).every((e) => e.eligibility_status === "ineligible"),
    ).toBe(true);
    expect((await f.enter(3, { rules_version: "old" })).status).toBe("closed");
    await expect(f.enter(3, { assigned_to: f.users[2].id })).rejects.toThrow();
    await expect(
      f.enter(3, { first_name: "<script>bad</script>" }),
    ).rejects.toThrow();
    await expect(f.enter(3, { rules_accepted: false })).rejects.toThrow();
  });
  it("persists abuse counters and tolerates shared booth Wi-Fi", async () => {
    const f = await fixture();
    await f.transition("open");
    for (let i = 1; i <= 12; i++)
      expect((await f.enter(i)).status).toBe("received");
    for (let i = 0; i < 8; i++) await f.enter(50, { website: "bot" });
    expect((await f.enter(50)).status).toBe("retry");
    expect(await f.rows()).toHaveLength(12);
  });
  it("denies direct unsigned calls and accepts only bounded signed payloads", async () => {
    const f = await fixture();
    await f.transition("open");
    const input = JSON.stringify(f.registration()),
      timestamp = Date.now(),
      network_key = "a".repeat(64);
    const signature = createHmac(
      "sha256",
      process.env.GLARA_EXPO_INGRESS_SECRET!,
    )
      .update(JSON.stringify([timestamp, network_key, input]))
      .digest("hex");
    expect(
      (
        await f.t.action(api.campaignActions.submit, {
          input,
          timestamp,
          network_key,
          signature: "b".repeat(64),
        })
      ).status,
    ).toBe("unavailable");
    expect(
      (
        await f.t.action(api.campaignActions.submit, {
          input,
          timestamp: timestamp - 120000,
          network_key,
          signature,
        })
      ).status,
    ).toBe("unavailable");
    expect(
      (
        await f.t.action(api.campaignActions.submit, {
          input,
          timestamp,
          network_key,
          signature,
        })
      ).status,
    ).toBe("received");
  });
  it("denies anonymous, Sales, Designer and Crew campaign administration", async () => {
    const f = await fixture();
    for (const c of [
      f.t,
      f.actor("sales"),
      f.actor("designer"),
      f.actor("staging_crew"),
    ]) {
      await expect(c.query(api.campaigns.list, {})).rejects.toThrow();
      await expect(
        c.mutation(api.campaigns.transition, {
          id: f.id,
          version: 1,
          to: "open",
        }),
      ).rejects.toThrow();
      await expect(
        c.action(api.campaignActions.draw, {
          id: f.id,
          redraw: false,
          reason: "",
        }),
      ).rejects.toThrow();
    }
    await expect(
      f.actor("marketing").mutation(api.campaigns.save, {
        version: 0,
        input: JSON.stringify(f.input),
      }),
    ).rejects.toThrow();
  });
  it("gives Marketing a safe entry projection, never private CRM notes or draw snapshots", async () => {
    const f = await fixture();
    await f.transition("open");
    await f.enter();
    const [e] = await f.rows();
    await f.t.run(async (ctx) => {
      const row = await ctx.db.query("realtor_private").first();
      await ctx.db.patch(row!._id, {
        notes: "SECRET SALES NOTE",
        average_listing_price: "9999999",
      });
    });
    const data = await f.actor("marketing").query(api.campaigns.entryList, {
      id: f.id,
      q: "",
      filter: "",
      paginationOpts: { cursor: null, numItems: 25 },
    });
    expect(data.page).toHaveLength(1);
    expect(JSON.stringify(data)).not.toContain("SECRET SALES NOTE");
    expect(JSON.stringify(data)).not.toContain("9999999");
    const detail = await f
      .actor("marketing")
      .query(api.campaigns.detail, { id: f.id });
    expect(detail.draws).toEqual([]);
    expect(detail.awards).toEqual([]);
    await expect(
      f
        .actor("sales")
        .query(api.campaigns.realtorHistory, { id: e.realtor_id! }),
    ).rejects.toThrow();
  });
  it("rejects an archived operator and stale version edits", async () => {
    const f = await fixture();
    await expect(
      f.owner.mutation(api.campaigns.save, {
        id: f.id,
        version: 0,
        input: JSON.stringify(f.input),
      }),
    ).rejects.toThrow();
    await f.t.run((ctx) =>
      ctx.db.patch(f.users[0].profile, {
        deleted_at: new Date().toISOString(),
      }),
    );
    await expect(f.owner.query(api.campaigns.list, {})).rejects.toThrow();
  });
  it("freezes eligibility at close and blocks a draw with unresolved entrants", async () => {
    const f = await fixture();
    await f.transition("open");
    await f.enter(1);
    const [e] = await f.rows();
    await f.t.run((ctx) =>
      ctx.db.patch(e._id, { eligibility_status: "pending" }),
    );
    await f.transition("closed");
    expect((await f.enter(2)).status).toBe("closed");
    await expect(
      f.owner.mutation(api.campaigns.reviewEligibility, {
        id: e._id,
        version: e.version,
        eligible: true,
        reason: "Fictional reviewed eligibility",
      }),
    ).rejects.toThrow();
    await expect(
      f.owner.action(api.campaignActions.draw, {
        id: f.id,
        redraw: false,
        reason: "",
      }),
    ).rejects.toThrow();
    await f.owner.mutation(api.campaigns.reviewEligibility, {
      id: e._id,
      version: e.version,
      eligible: false,
      reason: "Unresolved identity excluded",
    });
  });
  it("uses a unique frozen pool, secure random selection and idempotent concurrent draws", async () => {
    const f = await fixture();
    await f.transition("open");
    await f.enter(1, { annual_listings: "1–5" });
    await f.enter(2, { marketing_consent: true });
    await f.transition("closed");
    const selected = await Promise.all([
      f.owner.action(api.campaignActions.draw, {
        id: f.id,
        redraw: false,
        reason: "",
      }),
      f.owner.action(api.campaignActions.draw, {
        id: f.id,
        redraw: false,
        reason: "",
      }),
    ]);
    expect(selected[0]).toBe(selected[1]);
    const draws = await f.t.run((ctx) =>
      ctx.db.query("campaign_draws").collect(),
    );
    expect(draws).toHaveLength(1);
    expect(draws[0].entry_ids).toHaveLength(2);
    expect(new Set(draws[0].entry_ids).size).toBe(2);
    expect(draws[0].algorithm).toBe("node-crypto-randomInt-v1");
    expect(
      (await f.rows()).filter(
        (e) => e.eligibility_status === "selected_pending_verification",
      ),
    ).toHaveLength(1);
  });
  it("requires verification, preserves disqualification/redraw history and never fabricates a payment", async () => {
    const f = await fixture();
    await f.transition("open");
    await f.enter(1);
    await f.enter(2);
    await f.transition("closed");
    const first = await f.owner.action(api.campaignActions.draw, {
      id: f.id,
      redraw: false,
      reason: "",
    });
    let winner = (await f.rows()).find((e) => e._id === first)!;
    const verification = {
      id: first,
      version: winner.version,
      decision: "confirm" as const,
      identity_verified: true,
      license_verified: true,
      rules_verified: true,
      skill_question_passed: false,
      note: "Fictional verification reference",
    };
    await expect(
      f.owner.mutation(api.campaigns.verifyWinner, verification),
    ).rejects.toThrow();
    await f.owner.mutation(api.campaigns.verifyWinner, {
      ...verification,
      decision: "disqualify",
    });
    const second = await f.owner.action(api.campaignActions.draw, {
      id: f.id,
      redraw: true,
      reason: "Initial entrant failed verification",
    });
    expect(second).not.toBe(first);
    winner = (await f.rows()).find((e) => e._id === second)!;
    await f.owner.mutation(api.campaigns.verifyWinner, {
      ...verification,
      id: second,
      version: winner.version,
      skill_question_passed: true,
    });
    const data = await f.t.run(async (ctx) => ({
      awards: await ctx.db.query("campaign_awards").collect(),
      payments: await ctx.db.query("payments").collect(),
      draws: await ctx.db.query("campaign_draws").collect(),
    }));
    expect(data.awards).toHaveLength(1);
    expect(data.awards[0]).toMatchObject({
      original_cents: 200000,
      remaining_cents: 200000,
      status: "issued_unapplied",
    });
    expect(data.payments).toHaveLength(0);
    expect(data.draws).toHaveLength(2);
    expect(data.draws[1].previous_draw_id).toBe(data.draws[0]._id);
    expect((await f.get())!.status).toBe("completed");
  });
  it("resolves an existing contact mismatch only after an explicit pre-close identity review", async () => {
    const f = await fixture();
    await f.transition("open");
    await f.enter();
    const [original] = await f.rows();
    const id = await f.owner.mutation(api.campaigns.save, {
      version: 0,
      input: JSON.stringify({ ...f.input, slug: "identity-review" }),
    });
    await f.owner.mutation(api.campaigns.transition, {
      id,
      version: 1,
      to: "open",
    });
    await f.enter(1, {
      slug: "identity-review",
      phone: "6045550111",
      marketing_consent: true,
    });
    const pending = (await f.rows()).find((e) => e.campaign_id === id)!;
    expect(pending.eligibility_status).toBe("pending");
    await expect(
      f
        .actor("marketing")
        .query(api.campaigns.identityCandidates, { id: pending._id }),
    ).rejects.toThrow();
    const candidates = await f.owner.query(api.campaigns.identityCandidates, {
      id: pending._id,
    });
    expect(candidates[0].id).toBe(original.realtor_id);
    await f.owner.mutation(api.campaigns.resolveIdentity, {
      id: pending._id,
      version: pending.version,
      realtor_id: original.realtor_id!,
      note: "Verified by fictional booth review",
    });
    const resolved = (await f.rows()).find((e) => e._id === pending._id)!;
    expect(resolved).toMatchObject({
      realtor_id: original.realtor_id,
      eligibility_status: "eligible",
    });
    expect(resolved.pending_contact).toBeUndefined();
    expect(
      (await f.t.run((ctx) => ctx.db.get(original.realtor_id!)))!.phone,
    ).toBe("6045550001");
  });
  it("keeps ineligible and pending registrations out of a frozen pool and refuses tampered selection", async () => {
    const f = await fixture();
    await f.transition("open");
    await f.enter(1);
    await f.enter(2, { licensed_realtor: false });
    await f.transition("closed");
    const pool = await f.owner.mutation(internal.campaigns.freezeDraw, {
      id: f.id,
      redraw: false,
      reason: "",
    });
    expect(pool.eligible_count).toBe(1);
    await expect(
      f.owner.mutation(internal.campaigns.finishDraw, {
        id: pool._id,
        index: 1,
      }),
    ).rejects.toThrow();
    const entry = (await f.rows())[0];
    await expect(
      f.owner.mutation(api.campaigns.reviewEligibility, {
        id: entry._id,
        version: entry.version,
        eligible: false,
        reason: "Late change after draw freeze",
      }),
    ).rejects.toThrow();
  });
  it("never treats client attribution as eligibility, identity or event-day authority", async () => {
    const f = await fixture();
    await f.transition("open");
    await f.enter(1, { source: "day_2" });
    const [e] = await f.rows();
    expect(e.event_day).toBe("day_1");
    expect(e.eligibility_status).toBe("eligible");
    await expect(f.enter(2, { source: "owner" })).rejects.toThrow();
    await expect(
      f.enter(2, { utm_source: "attendee@example.test" }),
    ).rejects.toThrow();
  });
  it("checks publication approval and prevents changing rules after opening", async () => {
    const f = await fixture();
    await f.t.run((ctx) => ctx.db.patch(f.id, { legal_approved: false }));
    await expect(f.transition("open")).rejects.toThrow();
    await f.t.run((ctx) => ctx.db.patch(f.id, { legal_approved: true }));
    await f.transition("open");
    await expect(
      f.owner.mutation(api.campaigns.save, {
        id: f.id,
        version: (await f.get())!.version,
        input: JSON.stringify({ ...f.input, rules_version: "2" }),
      }),
    ).rejects.toThrow();
  });
  it("attributes resumed draw completion to the actual authenticated operator", async () => {
    const f = await fixture();
    await f.transition("open");
    await f.enter();
    await f.transition("closed");
    const pool = await f.owner.mutation(internal.campaigns.freezeDraw, {
      id: f.id,
      redraw: false,
      reason: "",
    });
    await f
      .actor("admin")
      .mutation(internal.campaigns.finishDraw, { id: pool._id, index: 0 });
    const audit = await f.t.run((ctx) =>
      ctx.db
        .query("audit_logs")
        .filter((q) => q.eq(q.field("action"), "draw_selection"))
        .first(),
    );
    expect(audit!.actor_id).toBe(f.users.find((u) => u.role === "admin")!.id);
    expect(pool.operator_id).toBe(f.users[0].id);
  });
});

describe("PacificWest configuration acceptance", () => {
  const starts = Date.parse("2026-09-28T08:00:00-07:00");
  const closes = Date.parse("2026-09-29T17:00:00-07:00");
  const terms = pacificwest.prize_terms;
  const settings = { ...pacificwest, prize_expires_at: undefined };
  async function pacific() {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(starts - 10000);
    const f = await fixture(settings);
    await f.t.run(async (ctx) => {
      for (const session of await ctx.db.query("authSessions").collect())
        await ctx.db.patch(session._id, {
          expirationTime: closes + 86400000 * 365,
        });
    });
    await f.transition("open");
    return f;
  }
  it("opens exactly September 28 at 08:00 PT, attributes both days, and closes exclusively September 29 at 17:00 PT", async () => {
    const f = await pacific();
    vi.setSystemTime(starts - 1);
    expect((await f.enter(1, { licensed_in_bc: true })).status).toBe("closed");
    vi.setSystemTime(starts);
    expect((await f.enter(1, { licensed_in_bc: true })).status).toBe(
      "received",
    );
    vi.setSystemTime(Date.parse("2026-09-29T00:00:00-07:00"));
    expect((await f.enter(2, { licensed_in_bc: true })).status).toBe(
      "received",
    );
    vi.setSystemTime(closes - 1);
    expect((await f.enter(3, { licensed_in_bc: true })).status).toBe(
      "received",
    );
    vi.setSystemTime(closes);
    expect((await f.enter(4, { licensed_in_bc: true })).status).toBe("closed");
    expect((await f.rows()).map((x) => x.event_day)).toEqual([
      "day_1",
      "day_2",
      "day_2",
    ]);
    expect(
      await f.t.query(api.campaigns.publicCampaign, { slug: f.input.slug }),
    ).toMatchObject({ state: "closed", eligible_province: "BC" });
  });
  it("accepts BC licence declarations across BC markets and rejects missing, outside-BC and unlicensed declarations", async () => {
    const f = await pacific();
    vi.setSystemTime(starts);
    expect(
      (await f.enter(1, { city: "Prince George", licensed_in_bc: true }))
        .status,
    ).toBe("received");
    expect(
      (await f.enter(2, { city: "Victoria", licensed_in_bc: true })).status,
    ).toBe("received");
    expect(
      (await f.enter(3, { city: "Vancouver", licensed_in_bc: false })).status,
    ).toBe("ineligible");
    expect((await f.enter(4, { city: "Vancouver" })).status).toBe("ineligible");
    expect(
      (
        await f.enter(5, {
          city: "Vancouver",
          licensed_in_bc: true,
          licensed_realtor: false,
        })
      ).status,
    ).toBe("ineligible");
    expect(
      (await f.rows()).filter((x) => x.eligibility_status === "eligible"),
    ).toHaveLength(2);
  });
  it("computes six Vancouver calendar months using permanent Pacific time, historical DST and month-end clamping", () => {
    expect(
      new Date(
        sixMonthExpiry(Date.parse("2026-10-01T10:15:30.123-07:00")),
      ).toISOString(),
    ).toBe("2027-04-01T17:15:30.123Z");
    expect(
      new Date(
        sixMonthExpiry(Date.parse("2026-09-29T17:00:00-07:00")),
      ).toISOString(),
    ).toBe("2027-03-30T00:00:00.000Z");
    const winterExpiry = sixMonthExpiry(
      Date.parse("2026-08-31T10:00:00-07:00"),
    );
    expect(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: campaignPacificZone(winterExpiry),
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h23",
      }).format(winterExpiry),
    ).toBe("10:00");
    expect(
      new Date(
        sixMonthExpiry(Date.parse("2026-08-31T10:00:00-07:00")),
      ).toISOString(),
    ).toBe("2027-02-28T17:00:00.000Z");
    expect(
      new Date(
        sixMonthExpiry(Date.parse("2023-08-31T10:00:00-07:00")),
      ).toISOString(),
    ).toBe("2024-02-29T18:00:00.000Z");
    expect(
      new Date(
        sixMonthExpiry(Date.parse("2026-09-14T02:30:00-07:00")),
      ).toISOString(),
    ).toBe("2027-03-14T09:30:00.000Z");
  });
  it("freezes an unweighted pool, requires skill verification, and issues the winner-bound unapplied credit with full remaining balance and relative expiry", async () => {
    const f = await pacific();
    vi.setSystemTime(starts);
    await f.enter(1, { licensed_in_bc: true, annual_listings: "1\u20135" });
    await f.enter(2, { licensed_in_bc: true, marketing_consent: true });
    vi.setSystemTime(closes);
    await f.transition("closed");
    const selected = await f.owner.action(api.campaignActions.draw, {
      id: f.id,
      redraw: false,
      reason: "",
    });
    const entry = (await f.rows()).find((e) => e._id === selected)!;
    const review = {
      id: selected,
      version: entry.version,
      decision: "confirm" as const,
      identity_verified: true,
      license_verified: true,
      rules_verified: true,
      skill_question_passed: false,
      note: "Isolated BC licence and identity verification reference",
    };
    await expect(
      f.owner.mutation(api.campaigns.verifyWinner, review),
    ).rejects.toThrow();
    vi.setSystemTime(Date.parse("2026-10-01T10:15:30-07:00"));
    await f.owner.mutation(api.campaigns.verifyWinner, {
      ...review,
      skill_question_passed: true,
    });
    const data = await f.t.run(async (ctx) => ({
      awards: await ctx.db.query("campaign_awards").collect(),
      payments: await ctx.db.query("payments").collect(),
      draws: await ctx.db.query("campaign_draws").collect(),
    }));
    expect(data.awards).toHaveLength(1);
    expect(data.payments).toHaveLength(0);
    expect(data.awards[0]).toMatchObject({
      entry_id: selected,
      original_cents: 200000,
      remaining_cents: 200000,
      issued_at: Date.now(),
      expires_at: Date.parse("2027-04-01T10:15:30-07:00"),
      terms,
      status: "issued_unapplied",
    });
    expect(data.draws[0].eligible_count).toBe(2);
    expect(new Set(data.draws[0].entry_ids).size).toBe(2);
    expect(data.draws[0].algorithm).toBe("node-crypto-randomInt-v1");
    await expect(
      f.owner.mutation(api.campaigns.verifyWinner, {
        ...review,
        skill_question_passed: true,
      }),
    ).rejects.toThrow();
  });
  it("rejects contradictory fixed/relative expiry and region configuration and preserves the legal approval gate", async () => {
    const f = await fixture({
      ...settings,
      legal_approved: false,
      official_rules: "PENDING final approved PacificWest rules",
      privacy_notice: "PENDING final PacificWest Privacy Notice",
    });
    expect(
      campaignInput.safeParse({
        ...f.input,
        prize_expires_at: closes + 86400000,
      }).success,
    ).toBe(false);
    expect(
      campaignInput.safeParse({ ...f.input, eligible_cities: ["Vancouver"] })
        .success,
    ).toBe(false);
    await expect(f.transition("open")).rejects.toThrow();
  });
});
