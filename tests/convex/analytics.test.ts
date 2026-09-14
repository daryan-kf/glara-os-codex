import { describe, it, expect } from "vitest";
import {
  fact,
  bucketChanges,
  dimensionNames,
  exactWeighted,
  ratio,
} from "../../src/lib/analytics/model";
import {
  applySource,
  factValue,
  sourceFacts,
} from "../../convex/analyticsLedger";
import { sourceProjection } from "../../convex/analyticsSources";
import { commercialFixture } from "../support/commercial-unit-fixture";
import { api } from "../../convex/_generated/api";
import type { Role } from "../../src/lib/permissions";
const payment = (at: string, value = "25000") =>
  fact({
    key: "receipt:cash_received_cents",
    metric: "cash_received_cents",
    scope: "flow",
    event_at: at,
    precision: "business_date",
    value,
    dimensions: {
      salesperson: "sales-a",
      realtor: "realtor-a",
      lead_source: "referral",
      city: "Vancouver",
    },
    href: "/payments/example",
    label: "Fictional receipt",
  });
const period = JSON.stringify({ period: "this_month" });
describe("M6 exact event correction arithmetic", () => {
  it("moves a backdated receipt across months without changing all-time cash", () => {
    const changes = bucketChanges(
      [payment("2026-09-30")],
      [payment("2026-10-01")],
    ).filter((c) => c.dimension === "company");
    expect(
      changes
        .filter((c) => c.grain === "month")
        .map((c) => [c.period, c.value]),
    ).toEqual([
      ["2026-09", "-25000"],
      ["2026-10", "25000"],
    ]);
    expect(changes.reduce((n, c) => n + BigInt(c.value), 0n)).toBe(0n);
  });
  it("nets a same-month date correction before monthly writes", () => {
    const changes = bucketChanges(
      [payment("2026-09-02")],
      [payment("2026-09-29")],
    );
    expect(changes.some((c) => c.grain === "month")).toBe(false);
    expect(
      changes
        .filter((c) => c.dimension === "company")
        .map((c) => [c.period, c.value]),
    ).toEqual([
      ["2026-09-02", "-25000"],
      ["2026-09-29", "25000"],
    ]);
  });
  it("dimension correction conserves company total and all dimensional totals", () => {
    const before = payment("2026-09-02"),
      after = {
        ...before,
        dimensions: { ...before.dimensions, salesperson: "sales-b" },
      };
    const changes = bucketChanges([before], [after]);
    expect(changes.every((c) => c.dimension === "salesperson")).toBe(true);
    for (const d of dimensionNames)
      expect(
        changes
          .filter((c) => c.dimension === d)
          .reduce((n, c) => n + BigInt(c.value), 0n),
      ).toBe(0n);
  });
  it("later reversal is a separate flow and leaves the earlier gross receipt", () => {
    const original = payment("2026-09-15"),
      reverse = fact({
        ...original,
        key: "reversal:cash_reversed_cents",
        metric: "cash_reversed_cents",
        event_at: "2026-10-03",
      });
    const changes = bucketChanges([original], [original, reverse]);
    expect(changes.every((c) => c.metric === "cash_reversed_cents")).toBe(true);
    expect(changes.some((c) => c.period === "2026-09")).toBe(false);
  });
  it("zero denominators and large exact cents remain well-defined", () => {
    expect(ratio(0, 0)).toBeNull();
    expect(ratio(1, 4)).toBe("2500");
    expect(exactWeighted("9007199254740993", 50)).toBe("4503599627370497");
    expect(() => exactWeighted("100", 50.5)).toThrow();
  });
});
describe("M6 transactional projections and security", () => {
  it("counts each invoiced project once, keeps credits and AR separate from issue history", async () => {
    const f = await commercialFixture();
    const a = await f.manual("100"),
      b = await f.manual("200");
    await f.issue(a);
    await f.issue(b);
    let report = await f.owner.query(api.analytics.summary, { period });
    expect(report.flows.invoiced_cents).toBe("30000");
    expect(report.current.invoiced_projects).toBe("1");
    expect(report.current.outstanding_ar_cents).toBe("30000");
    await f.payment("40", [{ invoice_id: a, amount: "40" }]);
    report = await f.owner.query(api.analytics.summary, { period });
    expect(report.current.outstanding_ar_cents).toBe("26000");
    expect(report.flows.cash_received_cents).toBe("4000");
    expect(
      (
        await f.owner.query(api.analytics.compareSource, {
          table: "invoices",
          id: a,
        })
      ).drift,
    ).toEqual([]);
    expect(
      (
        await f.owner.query(api.analytics.compareSource, {
          table: "projects",
          id: f.project,
        })
      ).drift,
    ).toEqual([]);
  });
  it("void excludes collectible totals without deleting gross issue history", async () => {
    const f = await commercialFixture();
    const a = await f.manual("100");
    await f.issue(a);
    await f.owner.mutation(api.commercial.invoiceAction, {
      id: a,
      version: (await f.invoice(a)).version,
      action: "void",
      reason: "Fictional void acceptance",
    });
    const r = await f.owner.query(api.analytics.summary, { period });
    expect(r.flows.invoiced_cents).toBe("10000");
    expect(r.flows.voided_cents).toBe("10000");
    expect(r.current.collectible_cents ?? "0").toBe("0");
    expect(r.current.invoiced_projects ?? "0").toBe("0");
  });
  it("reversal changes current balances atomically and never counts allocation as company cash", async () => {
    const f = await commercialFixture();
    const a = await f.manual("100");
    await f.issue(a);
    const p = await f.payment("40", [{ invoice_id: a, amount: "40" }]);
    await f.owner.mutation(api.commercial.reversePayment, {
      id: p,
      reason: "Fictional duplicate receipt",
    });
    const r = await f.owner.query(api.analytics.summary, { period });
    expect(r.flows.cash_received_cents).toBe("4000");
    expect(r.flows.cash_reversed_cents).toBe("4000");
    expect(r.derived.net_cash_cents).toBe("0");
    expect(r.current.outstanding_ar_cents).toBe("10000");
    expect(r.current.current_valid_collected_cents ?? "0").toBe("0");
    for (const [table, id] of [
      ["payments", p],
      ["invoices", a],
    ] as const)
      expect(
        (await f.owner.query(api.analytics.compareSource, { table, id })).drift,
      ).toEqual([]);
  });
  it.each(["designer", "staging_crew"] as Role[])(
    "denies %s the analytics API directly",
    async (role) => {
      const f = await commercialFixture();
      await expect(
        f.c(role).query(api.analytics.summary, { period }),
      ).rejects.toThrow();
      await expect(f.c(role).query(api.analytics.aging, {})).rejects.toThrow();
    },
  );
  it("Sales cannot choose a company or another salesperson scope or request financial drills", async () => {
    const f = await commercialFixture();
    await f.payment("10");
    const c = f.c("sales"),
      r = await c.query(api.analytics.summary, { period });
    expect(
      Object.keys(r.flows).some(
        (k) => k.includes("cash") || k.includes("invoice"),
      ),
    ).toBe(false);
    expect(r.derived.net_cash_cents).toBeNull();
    for (const filter of [
      { dimension: "company", member: "all" },
      { dimension: "salesperson", member: f.who("owner").id },
    ])
      await expect(
        c.query(api.analytics.summary, {
          period,
          filter: JSON.stringify(filter),
        }),
      ).rejects.toThrow();
    await expect(
      c.query(api.analytics.drill, {
        metric: "cash_received_cents",
        period,
        pagination: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow();
  });
  it("Marketing receives no financial facts, realtor identity, or source event contexts", async () => {
    const f = await commercialFixture();
    await f.payment("10");
    const c = f.c("marketing"),
      r = await c.query(api.analytics.summary, { period });
    expect(
      Object.keys(r.flows).every((k) =>
        [
          "realtors_created",
          "opportunities_created",
          "projects_staged",
          "projects_listing_live",
          "projects_sold",
        ].includes(k),
      ),
    ).toBe(true);
    expect(r.derived.net_cash_cents).toBeNull();
    expect(JSON.stringify(r)).not.toContain(f.project);
    expect(JSON.stringify(r)).not.toContain("event_contexts");
    await expect(
      c.query(api.analytics.drill, {
        metric: "realtors_created",
        period,
        pagination: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow();
    await expect(
      c.query(api.analytics.compareSource, { table: "payments", id: "fake" }),
    ).rejects.toThrow();
  });
  it("rebuild is idempotent and rejects stale source versions", async () => {
    const f = await commercialFixture();
    const id = await f.payment("250");
    await f.t.run(async (ctx) => {
      const p = await sourceProjection(ctx, "payments", id),
        before = await ctx.db.query("analytics_buckets").collect();
      expect(
        (await applySource(ctx, "payments", id, p.facts, p.version)).reason,
      ).toBe("unchanged");
      expect(
        (await applySource(ctx, "payments", id, [], p.version - 1)).reason,
      ).toBe("stale_source_version");
      const after = await ctx.db.query("analytics_buckets").collect();
      expect(after).toEqual(before);
      expect(
        (await sourceFacts(ctx, "payments", id))
          .filter((r) => r.active)
          .map(factValue),
      ).toEqual(p.facts);
    });
  });
  it("archives do not erase issued history and snapshot attribution survives reassignment", async () => {
    const f = await commercialFixture();
    const id = await f.payment("25");
    const before = await f.t.run((ctx) =>
      sourceProjection(ctx, "payments", id),
    );
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.createArgs.opportunity_id, {
        assigned_to: f.who("owner").id,
      });
    });
    const after = await f.t.run((ctx) => sourceProjection(ctx, "payments", id));
    expect(after.facts.filter((x) => x.scope === "flow")).toEqual(
      before.facts.filter((x) => x.scope === "flow"),
    );
  });
  it("configuration uses server-derived audit actor, optimistic versions and strict validation", async () => {
    const f = await commercialFixture();
    const old = await f.owner.query(api.analytics.settings, {});
    const { defaultTargets } = await import("../../src/lib/analytics/model");
    await expect(
      f.c("admin").mutation(api.analytics.saveSettings, {
        version: 0,
        input: JSON.stringify(defaultTargets),
      }),
    ).rejects.toThrow();
    await f.owner.mutation(api.analytics.saveSettings, {
      version: old.version,
      input: JSON.stringify({ ...defaultTargets, target: 40 }),
    });
    await expect(
      f.owner.mutation(api.analytics.saveSettings, {
        version: old.version,
        input: JSON.stringify(defaultTargets),
      }),
    ).rejects.toThrow();
    await expect(
      f.owner.mutation(api.analytics.saveSettings, {
        version: 1,
        input: JSON.stringify({
          ...defaultTargets,
          actor_id: f.who("admin").id,
        }),
      }),
    ).rejects.toThrow();
  });
});
it("reuses operational rules and denies financial history, capacity and maintenance to restricted roles", async () => {
  const f = await commercialFixture();
  await f.agreement();
  const actions = await f.owner.query(api.analyticsOperations.actionCenter, {});
  expect(actions.actions.some((a) => a.reason.includes("deposit"))).toBe(true);
  expect(
    (await f.owner.query(api.analyticsOperations.forecast, { days: 7 })).rows,
  ).toHaveLength(7);
  for (const role of [
    "sales",
    "designer",
    "staging_crew",
    "marketing",
  ] as const) {
    await expect(
      f.c(role).query(api.analyticsHistory.historicalAR, {
        as_of: new Date().toISOString().slice(0, 10),
        pagination: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow();
    await expect(
      f.c(role).query(api.analyticsOperations.forecast, { days: 7 }),
    ).rejects.toThrow();
    await expect(
      f.c(role).query(api.analyticsHistory.underused, {
        pagination: { numItems: 10, cursor: null },
      }),
    ).rejects.toThrow();
  }
  const salesActions = await f
    .c("sales")
    .query(api.analyticsOperations.actionCenter, {});
  expect(salesActions.actions.every((a) => a.domain !== "commercial")).toBe(
    true,
  );
  await expect(
    f.c("marketing").query(api.analyticsOperations.actionCenter, {}),
  ).rejects.toThrow();
});
it("drills current project state independently of the selected historical period", async () => {
  const f = await commercialFixture();
  const facts = await f.t.run(async (ctx) =>
    (await ctx.db.query("analytics_facts").collect()).filter(
      (r) => r.active && r.metric.startsWith("project_status_"),
    ),
  );
  expect(facts.length).toBeGreaterThan(0);
  const metric = facts[0]!.metric;
  const result = await f.owner.query(api.analytics.drill, {
    metric,
    period: JSON.stringify({ period: "previous_month" }),
    pagination: { numItems: 50, cursor: null },
  });
  expect(result.page.length).toBe(
    facts.filter((r) => r.metric === metric).length,
  );
  expect(result.page.every((r) => r.scope === "current")).toBe(true);
});
