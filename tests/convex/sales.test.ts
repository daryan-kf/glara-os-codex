import { convexTest } from "convex-test";
import { it, expect, describe } from "vitest";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import type { Role } from "../../src/lib/permissions";
const modules = import.meta.glob("../../convex/**/*.ts");
async function fixture() {
  const t = convexTest(schema, modules);
  const identities = await t.run(async (ctx) => {
    const rows = [];
    for (const role of [
      "owner",
      "sales",
      "admin",
      "marketing",
      "designer",
      "staging_crew",
    ] as Role[]) {
      const user = await ctx.db.insert("users", {
        email: role + "@accounts.example.test",
      });
      await ctx.db.insert("profiles", {
        userId: user,
        display_name: role,
        roles: [role],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      });
      const session = await ctx.db.insert("authSessions", {
        userId: user,
        expirationTime: Date.now() + 86400000,
      });
      rows.push({ role, user, subject: user + "|" + session });
    }
    return rows;
  });
  const who = (r: Role) => identities.find((u) => u.role === r)!;
  const c = (r: Role) => t.withIdentity({ subject: who(r).subject });
  const realtor = await c("sales").mutation(api.crm.write, {
    input: JSON.stringify({
      op: "realtor_create",
      data: {
        first_name: "Sales",
        last_name: "Fictional",
        assigned_to: who("sales").user,
        relationship_status: "active_partner",
      },
    }),
  });
  const data = {
    address_line_1: "100 Fictional Lane",
    city: "Vancouver",
    province: "BC",
    property_type: "detached",
    occupancy_status: "vacant",
    realtor_id: realtor.id,
    seller_name: "Private seller",
    notes: "Private property notes",
  };
  const pid = await c("sales").mutation(api.sales.saveProperty, {
    version: 0,
    input: JSON.stringify(data),
  });
  const oppData = {
    property_id: pid,
    assigned_to: who("sales").user,
    estimated_value: "5000.01",
    probability: 20,
    next_action_title: "Call agent",
    next_action_date: "2099-01-01T18:00:00Z",
    notes: "Private sales",
  };
  const oid = await c("sales").mutation(api.sales.saveOpportunity, {
    version: 0,
    input: JSON.stringify(oppData),
  });
  const quoteData = {
    opportunity_id: oid,
    items: [
      { description: "Fictional staging", quantity: 2, unit_price: "100.01" },
    ],
    discount: "0.00",
    tax_rate: "5.00",
    valid_until: "2099-01-01",
  };
  return { t, c, who, realtor, data, pid, oppData, oid, quoteData };
}
describe("M2 Convex sales security and integrity", () => {
  it("denies direct commercial functions to non-sales roles and anonymous callers", async () => {
    const f = await fixture();
    for (const role of ["marketing", "designer", "staging_crew"] as Role[]) {
      await expect(f.c(role).query(api.sales.pipeline, {})).rejects.toThrow();
      await expect(
        f.c(role).query(api.sales.getOpportunity, { id: f.oid }),
      ).rejects.toThrow();
      await expect(
        f.c(role).mutation(api.sales.saveQuote, {
          version: 0,
          input: JSON.stringify(f.quoteData),
        }),
      ).rejects.toThrow();
    }
    await expect(f.t.query(api.sales.summary, {})).rejects.toThrow();
    await expect(
      f.c("staging_crew").query(api.sales.getProperty, { id: f.pid }),
    ).rejects.toThrow();
  });
  it("projects safe property fields and isolates seller, notes and quotes", async () => {
    const f = await fixture();
    for (const role of ["marketing", "designer"] as Role[]) {
      const result = await f
        .c(role)
        .query(api.sales.getProperty, { id: f.pid });
      expect(result?.commercial).toBe(false);
      expect(JSON.stringify(result)).not.toContain("Private");
      expect(result?.property).not.toHaveProperty("listing_price_cents");
      expect(result).not.toHaveProperty("opportunities");
      const list = await f.c(role).query(api.sales.listProperties, {
        paginationOpts: { numItems: 25, cursor: null },
      });
      expect(list.page[0]).not.toHaveProperty("seller_name");
    }
  });
  it("prevents normalized address/MLS duplicates and rejects stale property edits", async () => {
    const f = await fixture();
    await expect(
      f.c("owner").mutation(api.sales.saveProperty, {
        version: 0,
        input: JSON.stringify({
          ...f.data,
          address_line_1: "100 FICTIONAL LANE",
        }),
      }),
    ).rejects.toThrow();
    await f.c("sales").mutation(api.sales.saveProperty, {
      id: f.pid,
      version: 1,
      input: JSON.stringify({ ...f.data, mls_number: "M2-100" }),
    });
    await expect(
      f.c("sales").mutation(api.sales.saveProperty, {
        id: f.pid,
        version: 1,
        input: JSON.stringify(f.data),
      }),
    ).rejects.toThrow();
    await expect(
      f.c("sales").mutation(api.sales.saveProperty, {
        version: 0,
        input: JSON.stringify({
          ...f.data,
          address_line_1: "Another address",
          mls_number: "m2100",
        }),
      }),
    ).rejects.toThrow();
  });
  it("requires initial next action atomically and validates parent relationships", async () => {
    const f = await fixture();
    const before = await f.t.run((ctx) => ctx.db.query("audit_logs").collect());
    const p = await f.c("sales").mutation(api.sales.saveProperty, {
      version: 0,
      input: JSON.stringify({
        ...f.data,
        address_line_1: "200 Fictional Lane",
      }),
    });
    const audit = await f.t.run((ctx) => ctx.db.query("audit_logs").collect());
    await expect(
      f.c("sales").mutation(api.sales.saveOpportunity, {
        version: 0,
        input: JSON.stringify({
          ...f.oppData,
          property_id: p,
          next_action_title: "",
          next_action_date: "",
        }),
      }),
    ).rejects.toThrow();
    expect(
      await f.t.run((ctx) => ctx.db.query("audit_logs").collect()),
    ).toEqual(audit);
    expect(before.length).toBeLessThan(audit.length);
    await expect(
      f.c("sales").mutation(api.sales.saveOpportunity, {
        version: 0,
        input: JSON.stringify(f.oppData),
      }),
    ).rejects.toThrow();
  });
  it("uses explicit stage transitions and preserves loss/win history without projects", async () => {
    const f = await fixture();
    await expect(
      f.c("sales").mutation(api.sales.transition, {
        id: f.oid,
        version: 1,
        input: JSON.stringify({ stage: "won" }),
      }),
    ).rejects.toThrow();
    await expect(
      f.c("sales").mutation(api.sales.transition, {
        id: f.oid,
        version: 1,
        input: JSON.stringify({ stage: "lost" }),
      }),
    ).rejects.toThrow();
    await f.c("sales").mutation(api.sales.transition, {
      id: f.oid,
      version: 1,
      input: JSON.stringify({
        stage: "lost",
        lost_reason: "price",
        lost_notes: "Budget",
      }),
    });
    let o = (await f.c("sales").query(api.sales.getOpportunity, { id: f.oid }))!
      .opportunity;
    expect(o.lost_at).not.toBeNull();
    expect(o.lost_reason).toBe("price");
    await f.c("sales").mutation(api.sales.transition, {
      id: f.oid,
      version: 2,
      input: JSON.stringify({ stage: "contacted" }),
    });
    o = (await f.c("sales").query(api.sales.getOpportunity, { id: f.oid }))!
      .opportunity;
    expect(o.lost_at).toBeNull();
    expect(o.lost_reason).toBe("");
    expect((await f.c("sales").query(api.sales.summary, {})).open_count).toBe(
      1,
    );
  });
  it("rejects concurrent stale updates and keeps metrics exact", async () => {
    const f = await fixture();
    const results = await Promise.allSettled(
      ["6000.00", "7000.00"].map((estimated_value) =>
        f.c("sales").mutation(api.sales.saveOpportunity, {
          id: f.oid,
          version: 1,
          input: JSON.stringify({
            ...f.oppData,
            estimated_value,
            next_action_title: "",
            next_action_date: "",
          }),
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const o = (await f
      .c("sales")
      .query(api.sales.getOpportunity, { id: f.oid }))!.opportunity;
    expect(
      (await f.c("sales").query(api.sales.summary, {})).open_value_cents,
    ).toBe(o.estimated_value_cents);
  });
  it("does not let M1 activity functions bypass the opportunity next-action invariant", async () => {
    const f = await fixture();
    const a = (await f
      .c("sales")
      .query(api.sales.getOpportunity, { id: f.oid }))!.activities[0];
    await expect(
      f.c("sales").mutation(api.crm.write, {
        input: JSON.stringify({ op: "activity_cancel", id: a._id, data: {} }),
      }),
    ).rejects.toThrow();
    const audit = await f.t.run((ctx) => ctx.db.query("audit_logs").collect());
    await expect(
      f
        .c("sales")
        .mutation(api.sales.finishAction, { id: a._id, status: "completed" }),
    ).rejects.toThrow();
    expect(
      await f.t.run((ctx) => ctx.db.query("audit_logs").collect()),
    ).toEqual(audit);
    await f.c("sales").mutation(api.sales.finishAction, {
      id: a._id,
      status: "cancelled",
      replacement_title: "New call",
      replacement_due: "2099-01-03T18:00:00Z",
    });
    const result = await f
      .c("sales")
      .query(api.sales.getOpportunity, { id: f.oid });
    expect(
      result!.activities.find((x) => x._id === a._id)?.completed_at,
    ).toBeNull();
    expect(result!.opportunity.next_action?.title).toBe("New call");
  });
  it("stores consultation status/version and rejects stale or archived edits", async () => {
    const f = await fixture();
    const cid = await f.c("admin").mutation(api.sales.saveConsultation, {
      version: 0,
      input: JSON.stringify({
        opportunity_id: f.oid,
        assigned_to: f.who("admin").user,
        scheduled_at: "2099-01-01T10:00:00-08:00",
        consultation_type: "onsite",
        notes: "Fictional",
      }),
    });
    await f.c("admin").mutation(api.sales.consultationStatus, {
      id: cid,
      version: 1,
      status: "completed",
    });
    await expect(
      f.c("admin").mutation(api.sales.consultationStatus, {
        id: cid,
        version: 1,
        status: "cancelled",
      }),
    ).rejects.toThrow();
    const c = await f.t.run((ctx) => ctx.db.get(cid));
    expect(c?.completed_at).not.toBeNull();
    expect(c?.scheduled_at).toBe("2099-01-01T18:00:00.000Z");
  });
  it("calculates quotes server-side and enforces configurable discount authority", async () => {
    const f = await fixture();
    await expect(
      f.c("sales").mutation(api.sales.saveQuote, {
        version: 0,
        input: JSON.stringify({ ...f.quoteData, discount: "1.00" }),
      }),
    ).rejects.toThrow();
    await f.c("owner").mutation(api.sales.setDiscountSettings, {
      version: 0,
      sales_bps: 1000,
      admin_bps: 2000,
    });
    const id = await f.c("sales").mutation(api.sales.saveQuote, {
      version: 0,
      input: JSON.stringify({
        ...f.quoteData,
        discount: "1.00",
        total_cents: "1",
        created_by: f.who("owner").user,
      }),
    });
    const q = await f.c("sales").query(api.sales.getQuote, { id });
    expect(q?.quote.total_cents).toBe("20897");
    expect(q?.quote.created_by).toBe(f.who("sales").user);
    await expect(
      f.c("sales").mutation(api.sales.setDiscountSettings, {
        version: 1,
        sales_bps: 10000,
        admin_bps: 10000,
      }),
    ).rejects.toThrow();
  });
  it("preserves sent terms, creates explicit revisions and rejects accepted edits", async () => {
    const f = await fixture();
    const id = await f.c("sales").mutation(api.sales.saveQuote, {
      version: 0,
      input: JSON.stringify(f.quoteData),
    });
    await f
      .c("sales")
      .mutation(api.sales.quoteStatus, { id, version: 1, status: "sent" });
    await expect(
      f.c("owner").mutation(api.sales.saveQuote, {
        id,
        version: 2,
        input: JSON.stringify(f.quoteData),
      }),
    ).rejects.toThrow();
    const revised = await f
      .c("sales")
      .mutation(api.sales.reviseQuote, { id, version: 2 });
    expect(
      (await f.c("sales").query(api.sales.getQuote, { id }))?.quote.status,
    ).toBe("superseded");
    const r = await f.c("sales").query(api.sales.getQuote, { id: revised });
    expect(r?.quote.revision_of).toBe(id);
    expect(r?.items).toHaveLength(1);
    await f.c("sales").mutation(api.sales.quoteStatus, {
      id: revised,
      version: 1,
      status: "sent",
    });
    await f.c("sales").mutation(api.sales.quoteStatus, {
      id: revised,
      version: 2,
      status: "accepted",
    });
    await expect(
      f.c("owner").mutation(api.sales.reviseQuote, { id: revised, version: 3 }),
    ).rejects.toThrow();
    expect(
      (await f.c("sales").query(api.sales.getOpportunity, { id: f.oid }))!
        .opportunity.stage,
    ).toBe("new");
  });
  it("generates collision-safe quote numbers and rejects expired acceptance", async () => {
    const f = await fixture();
    const ids = await Promise.all(
      [1, 2, 3].map(() =>
        f.c("owner").mutation(api.sales.saveQuote, {
          version: 0,
          input: JSON.stringify(f.quoteData),
        }),
      ),
    );
    const quotes = await Promise.all(
      ids.map((id) => f.c("owner").query(api.sales.getQuote, { id })),
    );
    expect(new Set(quotes.map((q) => q!.quote.number)).size).toBe(3);
    const id = ids[0];
    await f
      .c("owner")
      .mutation(api.sales.quoteStatus, { id, version: 1, status: "sent" });
    await f.t.run((ctx) => ctx.db.patch(id, { valid_until: "2000-01-01" }));
    await expect(
      f.c("owner").mutation(api.sales.quoteStatus, {
        id,
        version: 2,
        status: "accepted",
      }),
    ).rejects.toThrow();
  });
  it("archives and restores opportunities while retaining their quote/activity history", async () => {
    const f = await fixture();
    await expect(
      f.c("sales").mutation(api.sales.archive, {
        kind: "properties",
        id: f.pid,
        version: 1,
        restore: false,
      }),
    ).rejects.toThrow();
    await f.c("sales").mutation(api.sales.archive, {
      kind: "opportunities",
      id: f.oid,
      version: 1,
      restore: false,
    });
    expect((await f.c("sales").query(api.sales.summary, {})).open_count).toBe(
      0,
    );
    await expect(
      f.c("sales").mutation(api.sales.archive, {
        kind: "opportunities",
        id: f.oid,
        version: 2,
        restore: true,
      }),
    ).rejects.toThrow();
    await f.c("admin").mutation(api.sales.archive, {
      kind: "opportunities",
      id: f.oid,
      version: 2,
      restore: true,
    });
    expect((await f.c("sales").query(api.sales.summary, {})).open_count).toBe(
      1,
    );
    expect(
      (await f.c("sales").query(api.sales.getOpportunity, { id: f.oid }))!
        .activities,
    ).toHaveLength(1);
  });
  it("uses server-derived audit actors and bounds lists and pipeline cards", async () => {
    const f = await fixture();
    await expect(
      f.c("sales").query(api.sales.listOpportunities, {
        paginationOpts: { numItems: 1000, cursor: null },
      }),
    ).rejects.toThrow();
    const ranking = await f.c("sales").query(api.sales.topRealtors, {});
    expect(ranking[0].count).toBe(1);
    await expect(
      f.c("marketing").query(api.sales.topRealtors, {}),
    ).rejects.toThrow();
    const board = await f.c("admin").query(api.sales.pipeline, {});
    expect(board).toHaveLength(8);
    expect(board.find((c) => c.stage === "new")?.rows).toHaveLength(1);
    const audit = await f
      .c("owner")
      .query(api.profiles.audit, { entity_id: f.oid });
    expect(audit.every((a) => a.actor_id === f.who("sales").user)).toBe(true);
  });
});
