import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { operationsClient, wonFixture } from "./operations-fixture";
import { credentials } from "./identities";
import { day } from "../../src/lib/operations/model";
import type { SourceTable } from "../../src/lib/automation/model";
const results: { name: string; passed: boolean }[] = [];
async function check(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, passed: false });
    throw new Error(name, { cause: e });
  }
}
function control(
  table: SourceTable,
  entity_id: string,
  op: string,
  days?: number,
): unknown {
  const r = spawnSync(
    process.execPath,
    [
      "node_modules/convex/bin/main.js",
      "run",
      "m7AcceptanceControl:control",
      JSON.stringify({
        table,
        entity_id,
        op,
        ...(days === undefined ? {} : { days }),
      }),
      "--env-file",
      ".env.local",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (r.status !== 0) throw Error(r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
const date = (offset: number) =>
  day(new Date(Date.now() + offset * 86400000).toISOString());
async function main() {
  if (
    process.env.GLARA_M7_ACCEPTANCE !== "yes" ||
    process.env.GLARA_CONVEX_ACCEPTANCE !== "yes"
  )
    throw Error("Development opt-in required");
  const { client: c } = await operationsClient(),
    sales = (await operationsClient("sales")).client;
  const user = (r: string) => credentials(r).id as Id<"users">;
  const marker = `Fictional M7 matrix ${randomUUID().slice(0, 8)}`;
  const originals = new Map<string, Doc<"automation_rules">>();
  async function enable(
    key: string,
    ids: string[],
    patch: Partial<Doc<"automation_rules">["config"]> = {},
  ) {
    const r = (await c.query(api.automation.rules, {})).find(
      (x) => x.key === key,
    )!.record!;
    if (!originals.has(key)) originals.set(key, r);
    await c.mutation(api.automation.saveRule, {
      id: r._id,
      version: r.version,
      config: {
        ...r.config,
        enabled: true,
        activation: "current",
        entity_ids: ids,
        delay_days: 0,
        ...patch,
      },
    });
  }
  const run = (table: SourceTable, entity_id: string) =>
    c.mutation(
      api.automation.execute,
      { table, entity_id },
      { skipQueue: true },
    );
  const preview = (table: SourceTable, entity_id: string) =>
    c.query(api.automation.preview, { table, entity_id });
  const active = async (table: SourceTable, id: string) =>
    (await preview(table, id)).flatMap((x) => x.active);
  const crm = (input: object) =>
    c.mutation(api.crm.write, { input: JSON.stringify(input) });
  try {
    const r = (
      await crm({
        op: "realtor_create",
        data: {
          first_name: "Fictional M7",
          last_name: marker,
          assigned_to: user("sales"),
          relationship_status: "active_partner",
          notes: marker,
        },
      })
    ).id as Id<"realtors">;
    await enable("dormant_realtor", [r], { delay_days: 30 });
    await check(
      "Nurture uses historical inactivity and current communication resolves it",
      async () => {
        control("realtors", r, "clock", 31);
        await run("realtors", r);
        assert.equal((await active("realtors", r)).length, 1);
        await crm({
          op: "activity_create",
          data: {
            realtor_id: r,
            type: "call",
            title: marker,
            description: marker,
            status: "completed",
            completed_at: new Date().toISOString(),
            due_at: "",
            priority: "normal",
            assigned_to: user("sales"),
          },
        });
        await run("realtors", r);
        assert.equal((await active("realtors", r)).length, 0);
      },
    );
    const task = (
      await crm({
        op: "activity_create",
        data: {
          realtor_id: r,
          type: "follow_up",
          title: marker,
          description: marker,
          status: "open",
          completed_at: "",
          due_at: new Date(Date.now() - 86400000).toISOString(),
          priority: "normal",
          assigned_to: user("sales"),
        },
      })
    ).id as Id<"activities">;
    await enable("next_action", [task]);
    await check(
      "Overdue manual next action is adopted rather than duplicated",
      async () => {
        await Promise.all([run("activities", task), run("activities", task)]);
        const a = await active("activities", task);
        assert.equal(a.length, 1);
        assert.equal(a[0].activity_id, task);
        await crm({ op: "activity_complete", id: task, data: {} });
        await run("activities", task);
        assert.equal((await active("activities", task)).length, 0);
      },
    );
    const f = await wonFixture(c);
    const newOpportunity = async () => {
      const property = await c.mutation(api.sales.saveProperty, {
        version: 0,
        input: JSON.stringify({
          address_line_1: `Fictional M7 ${randomUUID().slice(0, 8)} Avenue`,
          city: "Vancouver",
          province: "BC",
          property_type: "detached",
          occupancy_status: "vacant",
          realtor_id: f.realtor.id,
          notes: marker,
        }),
      });
      return c.mutation(api.sales.saveOpportunity, {
        version: 0,
        input: JSON.stringify({
          property_id: property,
          assigned_to: user("sales"),
          estimated_value: "50000",
          probability: 40,
          next_action_title: marker,
          next_action_date: "2099-01-01T18:00:00Z",
          notes: marker,
        }),
      });
    };
    for (const reason of [
      "timing",
      "no_response",
      "price",
      "seller_declined",
    ]) {
      const id = await newOpportunity();
      await c.mutation(api.sales.transition, {
        id,
        version: 1,
        input: JSON.stringify({ stage: "lost", lost_reason: reason }),
      });
      await enable("lost_reactivation", [id], { delay_days: 30 });
      await check(`Lost reactivation eligibility: ${reason}`, async () => {
        control("opportunities", id, "clock", 31);
        await run("opportunities", id);
        assert.equal(
          (await active("opportunities", id)).length,
          ["timing", "no_response"].includes(reason) ? 1 : 0,
        );
      });
    }
    const o1 = await newOpportunity(),
      o2 = await newOpportunity();
    await enable("stale_opportunity", [o1, o2], {
      daily_limit: 1,
      minimum_cents: "1",
    });
    await check(
      "Circuit limit bounds actions and keeps a visible management warning",
      async () => {
        await Promise.all([run("opportunities", o1), run("opportunities", o2)]);
        assert.ok(
          (await active("opportunities", o1)).length +
            (await active("opportunities", o2)).length <=
            1,
        );
        assert.ok(
          (await c.query(api.automation.health, {})).limited.length > 0,
        );
        assert.ok(
          (
            await c.query(api.analyticsOperations.actionCenter, {})
          ).actions.some((x) => x.href === "/automation"),
        );
      },
    );
    await enable("new_contact", [o1]);
    await check(
      "Suppression/evaluation race leaves no active contact or unresolved notification",
      async () => {
        await Promise.all([
          run("opportunities", o1),
          c.mutation(
            api.automation.suppress,
            {
              table: "opportunities",
              entity_id: o1,
              family: "contact",
              days: 1,
              reason: marker,
            },
            { skipQueue: true },
          ),
        ]);
        assert.ok(
          !(await active("opportunities", o1)).some(
            (x) => x.family === "contact",
          ),
        );
        await assert.rejects(
          sales.mutation(api.automation.suppress, {
            table: "opportunities",
            entity_id: o1,
            family: "contact",
            days: 1,
            reason: marker,
          }),
        );
      },
    );
    await enable("new_contact", [o2]);
    await run("opportunities", o2);
    await check(
      "Version race rejects stale updates and execution snapshots stay consistent",
      async () => {
        const rule = (await c.query(api.automation.rules, {})).find(
          (x) => x.key === "new_contact",
        )!.record!;
        const settled = await Promise.allSettled([
          c.mutation(
            api.automation.saveRule,
            {
              id: rule._id,
              version: rule.version,
              config: { ...rule.config, priority: "urgent" },
            },
            { skipQueue: true },
          ),
          c.mutation(
            api.automation.saveRule,
            {
              id: rule._id,
              version: rule.version,
              config: { ...rule.config, priority: "normal" },
            },
            { skipQueue: true },
          ),
          run("opportunities", o2),
        ]);
        assert.equal(settled.filter((x) => x.status === "rejected").length, 1);
        await run("opportunities", o2);
        const history = await c.query(api.automation.history, {
          rule_id: rule._id,
          paginationOpts: { cursor: null, numItems: 30 },
        });
        const byVersion = new Map<number, string>();
        for (const e of history.page) {
          const config = JSON.stringify(e.config);
          if (byVersion.has(e.rule_version))
            assert.equal(byVersion.get(e.rule_version), config);
          byVersion.set(e.rule_version, config);
        }
      },
    );
    await check(
      "Preview detects duplicate linkage; explicit repair changes no source facts",
      async () => {
        control("opportunities", o2, "duplicate");
        assert.ok(
          (await preview("opportunities", o2)).some(
            (x) => x.drift === "duplicate",
          ),
        );
        const before = (
          control("opportunities", o2, "snapshot") as { source: unknown }
        ).source;
        await c.mutation(api.automation.repair, {
          table: "opportunities",
          entity_id: o2,
        });
        assert.ok(
          !(await preview("opportunities", o2)).some(
            (x) => x.drift === "duplicate",
          ),
        );
        assert.deepEqual(
          (control("opportunities", o2, "snapshot") as { source: unknown })
            .source,
          before,
        );
      },
    );
    await check(
      "Disabled policy retains history and future-only activation skips existing backlog",
      async () => {
        const old = (await active("opportunities", o2))[0];
        assert.ok(old);
        await enable("new_contact", [o2], { enabled: false });
        await run("opportunities", o2);
        assert.ok(
          (await active("opportunities", o2)).some((x) => x._id === old._id),
        );
        await enable("new_contact", [o2], { activation: "future" });
        await run("opportunities", o2);
        assert.ok(
          !(await active("opportunities", o2)).some(
            (x) => x.family === "contact",
          ),
        );
        await enable("new_contact", [o2], { activation: "current" });
        await run("opportunities", o2);
        assert.ok(
          (await active("opportunities", o2)).some(
            (x) => x.family === "contact",
          ),
        );
      },
    );
    await enable("won_handoff", [f.opportunity]);
    await check(
      "Won handoff produces work without creating a project",
      async () => {
        await run("opportunities", f.opportunity);
        assert.equal((await active("opportunities", f.opportunity)).length, 1);
      },
    );
    const project = (
      await c.mutation(api.operations.create, {
        ...f.createArgs,
        input: JSON.stringify({
          package_type: "standard",
          planned_end_date: "2099-12-31",
          priority: "normal",
          internal_notes: marker,
        }),
      })
    ).id;
    const get = () => c.query(api.operations.get, { id: project });
    await check(
      "Authorized project creation resolves won handoff",
      async () => {
        await run("opportunities", f.opportunity);
        assert.equal((await active("opportunities", f.opportunity)).length, 0);
      },
    );
    await enable("package_expiry", [project], { delay_days: 30 });
    await check(
      "Package 30/14/7-day and expired thresholds coalesce into one action",
      async () => {
        control("projects", project, "clock", -31);
        await run("projects", project);
        assert.equal((await active("projects", project)).length, 0);
        let id: string | undefined;
        for (const remaining of [30, 14, 7, -1]) {
          control("projects", project, "clock", -remaining);
          await run("projects", project);
          const a = (await active("projects", project))[0];
          assert.ok(a);
          if (id) assert.equal(a._id, id);
          id = a._id;
        }
        control("projects", project, "clock", -90);
        await run("projects", project);
        assert.equal((await active("projects", project)).length, 0);
      },
    );
    const customer = await c.mutation(api.commercial.saveCustomer, {
      version: 0,
      input: JSON.stringify({
        type: "seller",
        name: marker,
        contact: "Fictional",
        email: "m7@accounts.example.test",
        phone: "",
        company: "",
        address: "Fictional address",
      }),
    });
    const evidence = JSON.stringify({
      name: marker,
      email: "m7@accounts.example.test",
      method: "manual_record",
      reference: marker,
    });
    const agreement = await c.mutation(api.commercial.saveAgreement, {
      project_id: project,
      customer_id: customer,
      source_quote_id: f.quote,
      version: 0,
      input: JSON.stringify({
        effective_date: day(),
        staging_start_date: day(),
        package_end_date: date(90),
        description: marker,
        scope: "Living room",
        subtotal: "5000",
        discount: "0",
        taxes: [{ name: "Fictional configured tax", basis_points: 500 }],
        deposit_type: "percentage",
        deposit_value: "50",
        payment_terms: marker,
        extension_terms: marker,
        cancellation_terms: marker,
        liability_terms: marker,
        special_terms: "",
        override_reason: marker,
      }),
    });
    await c.mutation(api.commercial.agreementAction, {
      id: agreement,
      version: 1,
      action: "send",
      reason: marker,
    });
    await c.mutation(api.commercial.agreementAction, {
      id: agreement,
      version: 2,
      action: "accept",
      reason: marker,
      evidence,
    });
    await enable("deposit_unpaid", [agreement]);
    await check(
      "Unpaid deposit creates only a reminder; agreement/project stay unchanged",
      async () => {
        const before = await c.query(api.commercial.agreement, {
            id: agreement,
          }),
          p = await get();
        await run("agreements", agreement);
        assert.equal((await active("agreements", agreement)).length, 1);
        assert.deepEqual(
          await c.query(api.commercial.agreement, { id: agreement }),
          before,
        );
        assert.equal((await get()).status, p.status);
      },
    );
    const extension = await c.mutation(api.commercial.createExtension, {
      agreement_id: agreement,
      project_version: (await get()).version,
      input: JSON.stringify({
        new_end_date: date(120),
        type: "monthly",
        rate: "100",
        quantity: 1,
        taxes: [],
        reason: marker,
      }),
    });
    await c.mutation(api.commercial.extensionAction, {
      id: extension,
      version: 1,
      accept: true,
      evidence,
    });
    await enable("extension_invoice", [extension]);
    await check(
      "Accepted extension is reminded once and explicit draft invoice resolves it",
      async () => {
        await Promise.all([
          run("package_extensions", extension),
          run("package_extensions", extension),
        ]);
        assert.equal((await active("package_extensions", extension)).length, 1);
        await c.mutation(api.commercial.sourceInvoice, {
          project_id: project,
          customer_id: customer,
          source_type: "extension",
          extension_id: extension,
          issue_date: day(),
          due_date: day(),
        });
        await run("package_extensions", extension);
        assert.equal((await active("package_extensions", extension)).length, 0);
      },
    );
    const invoice = await c.mutation(api.commercial.saveInvoice, {
      project_id: project,
      customer_id: customer,
      version: 0,
      input: JSON.stringify({
        issue_date: date(-60),
        due_date: day(),
        notes: marker,
        items: [
          {
            description: marker,
            quantity: 1,
            unit_amount: "400",
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
      reason: marker,
    });
    await enable("invoice_due", [invoice]);
    await enable("invoice_overdue", [invoice], { delay_days: 7 });
    await enable("invoice_escalation", [invoice], { delay_days: 14 });
    await check(
      "Invoice due/7/14-day progression keeps one task and exact balance",
      async () => {
        let id: string | undefined;
        for (const age of [0, 7, 14]) {
          control("invoices", invoice, "clock", age);
          await run("invoices", invoice);
          const a = (await active("invoices", invoice))[0];
          assert.equal(a.impact_cents, "40000");
          if (id) assert.equal(a.activity_id, id);
          id = a.activity_id;
          if (age === 14) assert.equal(a.level, 2);
        }
      },
    );
    const payment = await c.mutation(api.commercial.recordPayment, {
      project_id: project,
      customer_id: customer,
      amount: "100",
      method: "e_transfer",
      received_date: date(-20),
      external_reference: marker,
      notes: marker,
      request_key: randomUUID(),
      allocations: [],
    });
    await enable("unallocated_payment", [payment], { delay_days: 14 });
    await enable("customer_credit", [customer], { delay_days: 14 });
    await check(
      "Aged unallocated cash and customer credit use original receipt date; no auto-allocation/refund",
      async () => {
        const before = await c.query(api.commercial.payment, { id: payment });
        await run("payments", payment);
        await run("commercial_customers", customer);
        assert.equal((await active("payments", payment)).length, 1);
        assert.equal(
          (await active("commercial_customers", customer)).length,
          1,
        );
        assert.deepEqual(
          await c.query(api.commercial.payment, { id: payment }),
          before,
        );
        await c.mutation(api.commercial.allocatePayment, {
          id: payment,
          allocations: [{ invoice_id: invoice, amount: "100" }],
        });
        await run("payments", payment);
        await run("commercial_customers", customer);
        assert.equal((await active("payments", payment)).length, 0);
        assert.equal(
          (await active("commercial_customers", customer)).length,
          0,
        );
      },
    );
    await check(
      "Concurrent payment/evaluation leaves no false overdue warning",
      async () => {
        await Promise.all([
          run("invoices", invoice),
          c.mutation(
            api.commercial.recordPayment,
            {
              project_id: project,
              customer_id: customer,
              amount: "300",
              method: "e_transfer",
              received_date: day(),
              external_reference: marker,
              notes: marker,
              request_key: randomUUID(),
              allocations: [{ invoice_id: invoice, amount: "300" }],
            },
            { skipQueue: true },
          ),
        ]);
        assert.ok(
          !(
            await c.query(api.analyticsOperations.actionCenter, {})
          ).actions.some((x) => x.id === invoice),
        );
        await run("invoices", invoice);
        assert.equal((await active("invoices", invoice)).length, 0);
      },
    );
    await check(
      "Private commercial automation payloads stay out of restricted roles",
      async () => {
        for (const role of ["sales", "designer", "staging_crew", "marketing"]) {
          const client = (await operationsClient(role)).client;
          const tasks = await client.query(api.automation.actions, {
            status: "active",
            paginationOpts: { cursor: null, numItems: 30 },
          });
          assert.ok(
            !tasks.page.some(
              (x) => x.domain === "commercial" || x.domain === "management",
            ),
          );
          await assert.rejects(
            client.mutation(api.automation.execute, {
              table: "agreements",
              entity_id: agreement,
            }),
          );
        }
      },
    );
    writeFileSync(
      "test-results/m7-matrix-fixture.json",
      JSON.stringify({
        project,
        customer,
        agreement,
        invoice,
        marker,
        realtor: r,
        opportunity: o2,
      }),
    );
  } finally {
    for (const [key, saved] of originals) {
      const r = (await c.query(api.automation.rules, {})).find(
        (x) => x.key === key,
      )!.record!;
      await c.mutation(api.automation.saveRule, {
        id: r._id,
        version: r.version,
        config: saved.config,
      });
    }
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() =>
    writeFileSync(
      "docs/M7-hosted-matrix-results.json",
      JSON.stringify(
        {
          deployment: "woozy-jaguar-392",
          timestamp: new Date().toISOString(),
          results,
          passed: results.filter((x) => x.passed).length,
          failed: results.filter((x) => !x.passed).length,
          completed: process.exitCode !== 1,
        },
        null,
        2,
      ) + "\n",
    ),
  );
