import { it, expect, afterEach, vi, describe } from "vitest";
import { api } from "../../convex/_generated/api";
import { commercialFixture } from "../support/commercial-unit-fixture";
import { operationsFixture } from "../support/operations-unit-fixture";
import { sourceProjection } from "../../convex/analyticsSources";
import { applySource } from "../../convex/analyticsLedger";
import { dollars, decimal } from "../../src/lib/sales/model";
const clock = (at: string) => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(at);
};
afterEach(() => vi.useRealTimers());
const period = (month: string) =>
  JSON.stringify({
    period: "custom",
    from: month + "-01",
    until:
      month === "2026-09"
        ? "2026-09-30"
        : month === "2026-10"
          ? "2026-10-31"
          : month + "-28",
  });
async function extend(f: Awaited<ReturnType<typeof operationsFixture>>) {
  await f.t.run(async (ctx) => {
    for (const s of await ctx.db.query("authSessions").collect())
      await ctx.db.patch(s._id, { expirationTime: Date.parse("2099-01-01") });
  });
}
describe("M6 source event-time correction acceptance", () => {
  it("preserves September receipt history through October entry and November credit/reversal, and reconstructs AR", async () => {
    clock("2026-09-15T18:00:00Z");
    const f = await commercialFixture();
    await extend(f);
    const i = await f.manual("100");
    await f.issue(i);
    clock("2026-10-05T18:00:00Z");
    const p = await f.owner.mutation(api.commercial.recordPayment, {
      project_id: f.project,
      customer_id: f.customer,
      amount: "40",
      method: "e_transfer",
      received_date: "2026-09-20",
      external_reference: "Fictional late entry",
      notes: "",
      request_key: crypto.randomUUID(),
      allocations: [{ invoice_id: i, amount: "40" }],
    });
    let sep = await f.owner.query(api.analytics.summary, {
      period: period("2026-09"),
    });
    expect(sep.flows.invoiced_cents).toBe("10000");
    expect(sep.flows.cash_received_cents).toBe("4000");
    expect(sep.flows.payments_recorded ?? "0").toBe("0");
    clock("2026-11-08T18:00:00Z");
    await f.owner.mutation(api.commercial.creditInvoice, {
      invoice_id: i,
      amount: "10",
      reason: "Fictional later service credit",
    });
    await f.owner.mutation(api.commercial.reversePayment, {
      id: p,
      reason: "Fictional later reversal",
    });
    sep = await f.owner.query(api.analytics.summary, {
      period: period("2026-09"),
    });
    const oct = await f.owner.query(api.analytics.summary, {
      period: period("2026-10"),
    });
    expect(sep.flows.cash_received_cents).toBe("4000");
    expect(sep.flows.credits_cents ?? "0").toBe("0");
    expect(sep.flows.cash_reversed_cents ?? "0").toBe("0");
    expect(oct.flows.cash_received_cents ?? "0").toBe("0");
    expect(oct.flows.payments_recorded).toBe("1");
    const now = await f.owner.query(api.analytics.summary, {
      period: JSON.stringify({ period: "this_month" }),
    });
    expect(now.flows.credits_cents).toBe("1000");
    expect(now.flows.cash_reversed_cents).toBe("4000");
    expect(now.current.outstanding_ar_cents).toBe("9000");
    const september = await f.owner.query(api.analyticsHistory.historicalAR, {
        as_of: "2026-09-30",
        pagination: { numItems: 20, cursor: null },
      }),
      october = await f.owner.query(api.analyticsHistory.historicalAR, {
        as_of: "2026-10-31",
        pagination: { numItems: 20, cursor: null },
      });
    expect(september.page_subtotal_cents).toBe("10000");
    expect(october.page_subtotal_cents).toBe("6000");
  });
  it("moves a source correction across months and ignores duplicate/stale projection application", async () => {
    clock("2026-11-08T18:00:00Z");
    const f = await commercialFixture(),
      id = await f.payment("50");
    await f.t.run(async (ctx) => {
      await ctx.db.patch(id, { received_date: "2026-09-30" });
      const p = await sourceProjection(ctx, "payments", id);
      await applySource(ctx, "payments", id, p.facts, p.version);
    });
    await f.t.run(async (ctx) => {
      await ctx.db.patch(id, { received_date: "2026-10-01" });
      const p = await sourceProjection(ctx, "payments", id);
      await applySource(ctx, "payments", id, p.facts, p.version);
      expect(
        (await applySource(ctx, "payments", id, p.facts, p.version)).reason,
      ).toBe("unchanged");
      expect(
        (await applySource(ctx, "payments", id, [], p.version - 1)).reason,
      ).toBe("stale_source_version");
    });
    expect(
      (
        await f.owner.query(api.analytics.summary, {
          period: period("2026-09"),
        })
      ).flows.cash_received_cents ?? "0",
    ).toBe("0");
    expect(
      (
        await f.owner.query(api.analytics.summary, {
          period: period("2026-10"),
        })
      ).flows.cash_received_cents,
    ).toBe("5000");
  });
  it("Won → reopened → Won replaces the closed outcome and keeps recorded transition history", async () => {
    clock("2026-09-10T18:00:00Z");
    const f = await operationsFixture();
    await extend(f);
    const transition = async (stage: string) => {
      const o = (await f
        .c("sales")
        .query(api.sales.getOpportunity, { id: f.oid }))!.opportunity;
      await f.c("sales").mutation(api.sales.transition, {
        id: f.oid,
        version: o.version,
        input: JSON.stringify({ stage }),
      });
    };
    await transition("contacted");
    await transition("interested");
    await transition("consultation");
    const q = await f.c("sales").mutation(api.sales.saveQuote, {
      version: 0,
      input: JSON.stringify({
        opportunity_id: f.oid,
        items: [
          {
            description: "Fictional staging",
            quantity: 1,
            unit_price: "100",
          },
        ],
        discount: "0",
        tax_rate: "0",
        valid_until: "2099-01-01",
      }),
    });
    await f
      .c("sales")
      .mutation(api.sales.quoteStatus, { id: q, version: 1, status: "sent" });
    await transition("quote_sent");
    await transition("negotiation");
    await transition("won");
    clock("2026-10-10T18:00:00Z");
    await transition("contacted");
    expect(
      (
        await f
          .c("owner")
          .query(api.analytics.summary, { period: period("2026-09") })
      ).flows.opportunities_won ?? "0",
    ).toBe("0");
    await transition("interested");
    await transition("consultation");
    await transition("quote_sent");
    await transition("negotiation");
    await transition("won");
    clock("2026-11-08T18:00:00Z");
    const sep = await f
        .c("owner")
        .query(api.analytics.summary, { period: period("2026-09") }),
      oct = await f
        .c("owner")
        .query(api.analytics.summary, { period: period("2026-10") });
    expect(sep.flows.opportunities_won ?? "0").toBe("0");
    expect(oct.flows.opportunities_won).toBe("1");
    expect(sep.flows.reached_won).toBe("1");
    expect(sep.flows.cohort_won).toBe("1");
  });
  it("invalid staging is rejected, then genuine staging counts once despite later updates", async () => {
    const f = await operationsFixture(),
      id = await f.create();
    await expect(f.advance(id, "staged")).rejects.toThrow();
    expect(
      (
        await f.c("owner").query(api.analytics.summary, {
          period: JSON.stringify({ period: "this_month" }),
        })
      ).flows.projects_staged ?? "0",
    ).toBe("0");
    await f.ready(id);
    await f.schedule(id);
    await f.advance(id, "staging");
    await f.complete(id, "staging");
    await f.advance(id, "staged");
    await f.t.run(async (ctx) => {
      const p = await sourceProjection(ctx, "projects", id);
      await applySource(ctx, "projects", id, p.facts, p.version);
      await applySource(ctx, "projects", id, p.facts, p.version);
    });
    expect(
      (
        await f.c("owner").query(api.analytics.summary, {
          period: JSON.stringify({ period: "this_month" }),
        })
      ).flows.projects_staged,
    ).toBe("1");
  });
  it("sold business-date correction moves only the sale period", async () => {
    clock("2026-11-08T18:00:00Z");
    const f = await commercialFixture();
    const set = async (date: string, version: number) =>
      f.t.run(async (ctx) => {
        await ctx.db.patch(f.project, { sold_date: date, version });
        const p = await sourceProjection(ctx, "projects", f.project);
        await applySource(ctx, "projects", f.project, p.facts, p.version);
      });
    await set("2026-09-30", 2);
    await set("2026-10-01", 3);
    expect(
      (
        await f.owner.query(api.analytics.summary, {
          period: period("2026-09"),
        })
      ).flows.projects_sold ?? "0",
    ).toBe("0");
    expect(
      (
        await f.owner.query(api.analytics.summary, {
          period: period("2026-10"),
        })
      ).flows.projects_sold,
    ).toBe("1");
  });
  it("damage discovery correction does not move approved commercial liability", async () => {
    clock("2026-11-08T18:00:00Z");
    const f = await commercialFixture(),
      incident = await f.incident(),
      assessment = await f.assessment(incident.damage._id);
    const before = await f.t.run((ctx) =>
      sourceProjection(ctx, "damage_charge_assessments", assessment),
    );
    await f.t.run(async (ctx) => {
      await ctx.db.patch(incident.damage._id, {
        discovered_at: "2026-09-15T18:00:00Z",
        version: incident.damage.version + 1,
      });
      const p = await sourceProjection(
        ctx,
        "inventory_damage",
        incident.damage._id,
      );
      await applySource(
        ctx,
        "inventory_damage",
        incident.damage._id,
        p.facts,
        p.version,
      );
    });
    const after = await f.t.run((ctx) =>
      sourceProjection(ctx, "damage_charge_assessments", assessment),
    );
    expect(after.facts).toEqual(before.facts);
  });
  it("negative net cash uses exact signed CAD display", () => {
    expect(decimal(-1n)).toBe("-0.01");
    expect(dollars("-123456")).toBe("$-1,234.56");
  });
});
it("retains issued and collected history when a project is archived", async () => {
  const f = await commercialFixture(),
    i = await f.manual("100");
  await f.issue(i);
  await f.payment("10");
  const before = await f.owner.query(api.analytics.summary, {
    period: JSON.stringify({ period: "this_month" }),
  });
  await f.t.run(async (ctx) => {
    await ctx.db.patch(f.project, {
      deleted_at: new Date().toISOString(),
      version: 2,
    });
    const p = await sourceProjection(ctx, "projects", f.project);
    await applySource(ctx, "projects", f.project, p.facts, p.version);
  });
  const after = await f.owner.query(api.analytics.summary, {
    period: JSON.stringify({ period: "this_month" }),
  });
  expect(after.flows.invoiced_cents).toBe(before.flows.invoiced_cents);
  expect(after.flows.cash_received_cents).toBe(
    before.flows.cash_received_cents,
  );
  expect(after.current.active_projects ?? "0").toBe("0");
});
it("keeps an approved/invoiced damage charge in September when credited in November", async () => {
  clock("2026-09-16T18:00:00Z");
  const f = await commercialFixture();
  await extend(f);
  const incident = await f.incident(),
    a = await f.assessment(incident.damage._id);
  await f.review(a, "100");
  await f.approve(a, "100");
  const i = await f.charge(a);
  await f.issue(i);
  clock("2026-11-08T18:00:00Z");
  await f.owner.mutation(api.commercial.creditInvoice, {
    invoice_id: i,
    amount: "25",
    reason: "Fictional later repair recovery credit",
  });
  const sep = await f.owner.query(api.analytics.summary, {
      period: period("2026-09"),
    }),
    nov = await f.owner.query(api.analytics.summary, {
      period: JSON.stringify({ period: "this_month" }),
    });
  expect(sep.flows.approved_damage_cents).toBe("10000");
  expect(sep.flows.invoiced_assessment_cents).toBe("10500");
  expect(sep.flows.credits_cents ?? "0").toBe("0");
  expect(nov.flows.credits_cents).toBe("2500");
});
it("records a later inventory adjustment without rewriting the original receipt", async () => {
  clock("2026-09-16T18:00:00Z");
  const f = await commercialFixture("quantity");
  await extend(f);
  clock("2026-11-08T18:00:00Z");
  const stock = await f.t.run((ctx) =>
    ctx.db
      .query("inventory_stock")
      .withIndex("by_product_location", (q) =>
        q.eq("product_id", f.product).eq("location_id", f.location),
      )
      .unique(),
  );
  await f.owner.mutation(api.inventory.transferOrDispose, {
    product_id: f.product,
    location_id: f.location,
    version: stock!.version,
    quantity: 1,
    action: "adjustment",
    reason: "Fictional count correction",
  });
  const sep = await f.owner.query(api.analytics.summary, {
      period: period("2026-09"),
    }),
    nov = await f.owner.query(api.analytics.summary, {
      period: JSON.stringify({ period: "this_month" }),
    });
  expect(sep.flows.inventory_received).toBe("10");
  expect(sep.flows.inventory_adjustment ?? "0").toBe("0");
  expect(nov.flows.inventory_adjustment).toBe("1");
});
it("concurrent credit correction and receipt reversal preserve exact receivables", async () => {
  const f = await commercialFixture(),
    i = await f.manual("100");
  await f.issue(i);
  const p = await f.payment("40", [{ invoice_id: i, amount: "40" }]);
  await Promise.all([
    f.owner.mutation(api.commercial.creditInvoice, {
      invoice_id: i,
      amount: "10",
      reason: "Fictional independent service correction",
    }),
    f.owner.mutation(api.commercial.reversePayment, {
      id: p,
      reason: "Fictional duplicate receipt correction",
    }),
  ]);
  const result = await f.owner.query(api.analytics.summary, {
    period: JSON.stringify({ period: "this_month" }),
  });
  expect(result.current.outstanding_ar_cents).toBe("9000");
  expect(result.flows.invoiced_cents).toBe("10000");
  expect(result.flows.cash_received_cents).toBe("4000");
  expect(result.flows.cash_reversed_cents).toBe("4000");
  expect(result.flows.credits_cents).toBe("1000");
  expect(
    (
      await f.owner.query(api.analytics.compareSource, {
        table: "invoices",
        id: i,
      })
    ).drift,
  ).toEqual([]);
});
it("backdated cash keeps the salesperson responsible on the receipt date, after a later reassignment", async () => {
  clock("2026-09-15T18:00:00Z");
  const f = await commercialFixture();
  await extend(f);
  clock("2026-10-02T18:00:00Z");
  await f.owner.mutation(api.sales.saveOpportunity, {
    id: f.oid,
    version: 1,
    input: JSON.stringify({
      property_id: f.pid,
      assigned_to: f.who("owner").id,
      estimated_value: "5000",
      probability: 100,
    }),
  });
  const p = await f.owner.mutation(api.commercial.recordPayment, {
    project_id: f.project,
    customer_id: f.customer,
    amount: "40",
    method: "e_transfer",
    received_date: "2026-09-20",
    external_reference: "Fictional late receipt after reassignment",
    notes: "",
    request_key: crypto.randomUUID(),
    allocations: [],
  });
  const facts = await f.t.run((ctx) => sourceProjection(ctx, "payments", p));
  expect(
    facts.facts.find((x) => x.metric === "cash_received_cents")?.dimensions
      .salesperson,
  ).toBe(f.who("sales").id);
  expect(
    facts.facts.find((x) => x.metric === "payments_recorded")?.dimensions
      .salesperson,
  ).toBe(f.who("owner").id);
});
it("serializes explicit projection correction against payment reversal without duplicating cash", async () => {
  clock("2026-11-08T18:00:00Z");
  const f = await commercialFixture(),
    p = await f.payment("50");
  // Fixture-only source correction: M5 deliberately exposes no receipt-date editing API.
  await f.t.run((ctx) => ctx.db.patch(p, { received_date: "2026-09-30" }));
  const proof = await f.owner.query(api.analytics.compareSource, {
    table: "payments",
    id: p,
  });
  const outcomes = await Promise.allSettled([
    f.owner.mutation(api.analytics.repairSource, {
      table: "payments",
      id: p,
      metric: "cash_received_cents",
      source_version: proof.source_version,
      revision: proof.revision,
      reason: "Reconcile a fictional corrected source date",
    }),
    f.owner.mutation(api.commercial.reversePayment, {
      id: p,
      reason: "Fictional concurrent reversal",
    }),
  ]);
  expect(outcomes[1].status).toBe("fulfilled");
  const sep = await f.owner.query(api.analytics.summary, {
      period: period("2026-09"),
    }),
    nov = await f.owner.query(api.analytics.summary, {
      period: JSON.stringify({ period: "this_month" }),
    });
  expect(sep.flows.cash_received_cents).toBe("5000");
  expect(nov.flows.cash_received_cents ?? "0").toBe("0");
  expect(nov.flows.cash_reversed_cents).toBe("5000");
  expect(nov.current.current_valid_collected_cents ?? "0").toBe("0");
});
