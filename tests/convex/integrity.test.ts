import { expect, it } from "vitest";
import { operationsFixture } from "../support/operations-unit-fixture";
import { commercialFixture } from "../support/commercial-unit-fixture";
import { api } from "../../convex/_generated/api";
it("whole-ledger checks are privileged, bounded, read-only and detect injected allocation/stock drift", async () => {
  const f = await commercialFixture(),
    invoice = await f.manual();
  await f.issue(invoice);
  const payment = await f.payment("25", [
    { invoice_id: invoice, amount: "25" },
  ]);
  for (const role of [
    "sales",
    "designer",
    "staging_crew",
    "marketing",
  ] as const)
    await expect(
      f.c(role).query(api.integrity.page, { domain: "payments", cursor: null }),
    ).rejects.toThrow();
  for (const domain of [
    "payments",
    "invoices",
    "stock",
    "movements",
    "reservations",
    "automation",
  ] as const)
    expect(
      (
        await f.owner.query(api.integrity.page, { domain, cursor: null })
      ).entries.flatMap((x) => x.issues),
    ).toEqual([]);
  await f.t.run(async (ctx) => {
    const a = await ctx.db
      .query("payment_allocations")
      .withIndex("by_payment", (q) => q.eq("payment_id", payment))
      .first();
    await ctx.db.patch(a!._id, { amount_cents: "999999" });
  });
  expect(
    (
      await f.owner.query(api.integrity.page, {
        domain: "payments",
        cursor: null,
      })
    ).entries[0].issues,
  ).toContain("OVERALLOCATION");
  const value = await f.t.run((ctx) =>
    ctx.db
      .query("payment_allocations")
      .withIndex("by_payment", (q) => q.eq("payment_id", payment))
      .first(),
  );
  expect(value!.amount_cents).toBe("999999");
});

it("reconciliation preserves audited duplicate repairs but rejects unrelated execution linkage", async () => {
  const f = await operationsFixture(),
    owner = f.c("owner");
  await owner.mutation(api.automation.initialize, {});
  const rule = (await owner.query(api.automation.rules, {})).find(
    (x) => x.key === "new_contact",
  )!.record!;
  await owner.mutation(api.automation.saveRule, {
    id: rule._id,
    version: rule.version,
    config: { ...rule.config, enabled: true, delay_days: 0 },
  });
  await owner.mutation(api.automation.execute, {
    table: "opportunities",
    entity_id: f.oid,
  });
  const duplicate = await f.t.run(async (ctx) => {
    const row = await ctx.db.query("automation_actions").first();
    const { _id, _creationTime, ...data } = row!;
    void _id;
    void _creationTime;
    return ctx.db.insert("automation_actions", {
      ...data,
      status: "resolved",
      resolved_at: Date.now(),
      resolution: "Duplicate linkage repaired",
    });
  });
  const first = await owner.query(api.integrity.page, {
    domain: "automation",
    cursor: null,
  });
  expect(first.entries.find((x) => x.key === duplicate)).toMatchObject({
    kind: "resolved_duplicate_history",
    issues: [],
  });
  await f.t.run((ctx) =>
    ctx.db.patch(duplicate, { resolution: "Unrelated resolution" }),
  );
  expect(
    (
      await owner.query(api.integrity.page, {
        domain: "automation",
        cursor: null,
      })
    ).entries.find((x) => x.key === duplicate)?.issues,
  ).toContain("EXECUTION_LINK");
});
