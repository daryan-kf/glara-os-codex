import assert from "node:assert/strict";
import type { FunctionReturnType } from "convex/server";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { operationsClient, wonFixture } from "./operations-fixture";
import { credentials } from "./identities";
const results: { name: string; passed: boolean }[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch {
    results.push({ name, passed: false });
    throw Error(name);
  }
}
async function main() {
  if (
    process.env.GLARA_CONVEX_ACCEPTANCE !== "yes" ||
    process.env.GLARA_M6_ACCEPTANCE !== "yes"
  )
    throw Error("Explicit M6 fictional acceptance opt-in required");
  const { client: c } = await operationsClient(),
    f = await wonFixture(c),
    marker = "Fictional M6 historical import template";
  const project = (
    await c.mutation(api.operations.create, {
      ...f.createArgs,
      input: JSON.stringify({
        ...JSON.parse(f.createArgs.input),
        internal_notes: marker,
      }),
    })
  ).id;
  const customer = await c.mutation(api.commercial.saveCustomer, {
    version: 0,
    input: JSON.stringify({
      type: "seller",
      name: "Fictional M6 history",
      contact: "Fictional",
      email: "m6@accounts.example.test",
      phone: "",
      company: "",
      address: "100 Fictional Avenue, Vancouver BC",
    }),
  });
  const invoice = await c.mutation(api.commercial.saveInvoice, {
    project_id: project,
    customer_id: customer,
    version: 0,
    input: JSON.stringify({
      issue_date: "2026-06-15",
      due_date: "2026-06-30",
      notes: marker,
      items: [
        {
          description: "Fictional service",
          quantity: 1,
          unit_amount: "100",
          discount: "0",
          taxes: [],
        },
      ],
    }),
  });
  await c.mutation(api.commercial.invoiceAction, {
    id: invoice,
    version: 1,
    action: "issue",
    reason: "Fictional M6 import template",
  });
  const payment = await c.mutation(api.commercial.recordPayment, {
    project_id: project,
    customer_id: customer,
    amount: "40",
    method: "e_transfer",
    received_date: "2026-06-20",
    external_reference: marker,
    notes: "",
    request_key: crypto.randomUUID(),
    allocations: [{ invoice_id: invoice, amount: "40" }],
  });
  const imported = spawnSync(
    process.execPath,
    [
      "node_modules/convex/bin/main.js",
      "run",
      "m6HistoricalImport:importHistory",
      JSON.stringify({ project, invoice, payment }),
      "--env-file",
      ".env.local",
    ],
    { encoding: "utf8", env: process.env },
  );
  if (imported.status !== 0) {
    writeFileSync("test-results/m6-history-import-error.log", imported.stderr);
    throw Error("Historical fixture import failed; inspect local diagnostic");
  }
  const h = JSON.parse(imported.stdout.trim()) as {
    project: Id<"projects">;
    opportunity: Id<"opportunities">;
    realtor: Id<"realtors">;
    invoice: Id<"invoices">;
    payment: Id<"payments">;
    original_salesperson: Id<"users">;
  };
  writeFileSync("test-results/m6-history-fixture.json", JSON.stringify(h));
  const query = (
    month: string,
    filter = JSON.stringify({ dimension: "realtor", member: h.realtor }),
  ) =>
    c.query(api.analytics.summary, {
      period: JSON.stringify({
        period: "custom",
        from: month + "-01",
        until: month + (["2026-06"].includes(month) ? "-30" : "-31"),
      }),
      filter,
    });
  await check("May creation cohort is independent from June Won", async () => {
    const m = await query("2026-05");
    assert.equal(m.flows.opportunities_created, "1");
    assert.equal(m.flows.cohort_opportunities, "1");
    assert.equal(m.flows.cohort_won, "1");
    assert.equal(m.flows.opportunities_won ?? "0", "0");
  });
  await check(
    "June contains Won, first staged, issue and actual cash receipt",
    async () => {
      const m = await query("2026-06");
      for (const key of ["opportunities_won", "projects_staged"])
        assert.equal(m.flows[key], "1");
      assert.equal(m.flows.invoiced_cents, "10000");
      assert.equal(m.flows.cash_received_cents, "4000");
      assert.equal(m.flows.payments_recorded ?? "0", "0");
    },
  );
  await check(
    "July records entry and allocation without company cash duplication",
    async () => {
      const m = await query("2026-07");
      assert.equal(m.flows.payments_recorded, "1");
      assert.equal(m.flows.cash_received_cents ?? "0", "0");
      assert.equal(m.flows.allocations_cents, "4000");
    },
  );
  await check(
    "August credit does not rewrite June cash and changes current AR",
    async () => {
      const m = await query("2026-08");
      assert.equal(m.flows.credits_cents, "1000");
      assert.equal(m.flows.cash_received_cents ?? "0", "0");
      assert.equal(m.current.outstanding_ar_cents, "5000");
      assert.equal((await query("2026-06")).flows.credits_cents ?? "0", "0");
    },
  );
  const original = await query(
    "2026-06",
    JSON.stringify({
      dimension: "salesperson",
      member: h.original_salesperson,
    }),
  );
  const o = (await c.query(api.sales.getOpportunity, { id: h.opportunity }))!
    .opportunity;
  await c.mutation(api.sales.saveOpportunity, {
    id: h.opportunity,
    version: o.version,
    input: JSON.stringify({
      property_id: o.property_id,
      assigned_to: credentials("admin").id,
      estimated_value: "5000",
      probability: o.probability,
      notes: "Fictional later reassignment",
      next_action_title: "",
      next_action_date: "",
    }),
  });
  await check(
    "Real reassignment preserves original historical Won and cash attribution",
    async () => {
      const after = await query(
        "2026-06",
        JSON.stringify({
          dimension: "salesperson",
          member: h.original_salesperson,
        }),
      );
      assert.equal(
        after.flows.opportunities_won,
        original.flows.opportunities_won,
      );
      assert.equal(
        after.flows.cash_received_cents,
        original.flows.cash_received_cents,
      );
    },
  );
  for (const [date, expected] of [
    ["2026-06-30", "10000"],
    ["2026-07-31", "6000"],
    ["2026-08-31", "5000"],
  ])
    await check(
      "Historical AR at " + date + " uses historical evidence",
      async () => {
        let cursor: string | null = null,
          found = false;
        for (let page = 0; page < 200; page++) {
          const r: FunctionReturnType<
            typeof api.analyticsHistory.historicalAR
          > = await c.query(api.analyticsHistory.historicalAR, {
            as_of: date!,
            pagination: { numItems: 20, cursor },
          });
          const row = r.page.find((x) => x.id === h.invoice);
          if (row) {
            assert.equal(row.balance_cents, expected);
            found = true;
            break;
          }
          if (r.isDone) break;
          cursor = r.continueCursor;
        }
        assert.equal(found, true);
      },
    );
  const template = await c.query(api.operations.get, { id: project });
  await c.mutation(api.operations.transition, {
    id: project,
    version: template.version,
    status: "cancelled",
    reason: "Fictional template cleanup after historical fixture import",
  });
  console.log(
    "Historical assertions complete; final global reconciliation runs after other hosted regressions finish.",
  );
}
main()
  .catch((e) => {
    console.error(
      e instanceof Error ? e.message : "M6 historical acceptance failed",
    );
    process.exitCode = 1;
  })
  .finally(() =>
    writeFileSync(
      "docs/M6-hosted-correction-results.json",
      JSON.stringify(
        {
          deployment: "woozy-jaguar-392",
          timestamp: new Date().toISOString(),
          results,
          passed: results.filter((r) => r.passed).length,
          failed: results.filter((r) => !r.passed).length,
          completed: process.exitCode !== 1,
          fixture_method:
            "New fictional historical records imported through temporary internal development-only helper; no existing records redated; subsequent reassignment uses real public business mutation",
          reconciliation:
            "See final M6 hosted API independent reconciliation result",
        },
        null,
        2,
      ) + "\n",
    ),
  );
