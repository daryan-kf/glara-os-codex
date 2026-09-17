import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { operationsClient } from "./operations-fixture";
import { day } from "../../src/lib/operations/model";
const results: { name: string; passed: boolean }[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, passed: false });
    throw e;
  } finally {
    writeFileSync(
      process.env.GLARA_M10_ACCEPTANCE === "yes"
        ? ".acceptance/m10/m7-native-regression.json"
        : ".acceptance/m8/resume/m7-native-regression.json",
      JSON.stringify({ timestamp: new Date().toISOString(), results }, null, 2),
    );
  }
}
async function main() {
  assert.equal(process.env.GLARA_M7_ACCEPTANCE, "yes");
  const { client: c, url } = await operationsClient(),
    f = JSON.parse(
      readFileSync(
        process.env.GLARA_M7_BROWSER_FIXTURE ??
          "test-results/m7-matrix-fixture.json",
        "utf8",
      ),
    ) as {
      project: Id<"projects">;
      customer: Id<"commercial_customers">;
      marker: string;
    };
  const marker = f.marker + " final " + randomUUID().slice(0, 8);
  const saved = new Map<string, Doc<"automation_rules">>();
  const enable = async (
    key: string,
    entity_ids: string[],
    patch: Partial<Doc<"automation_rules">["config"]> = {},
  ) => {
    const r = (await c.query(api.automation.rules, {})).find(
      (x) => x.key === key,
    )!.record!;
    if (!saved.has(key)) saved.set(key, r);
    await c.mutation(api.automation.saveRule, {
      id: r._id,
      version: r.version,
      config: {
        ...r.config,
        enabled: true,
        entity_ids,
        delay_days: 0,
        daily_limit: 100,
        ...patch,
      },
    });
    return r;
  };
  const invoice = await c.mutation(api.commercial.saveInvoice, {
    project_id: f.project,
    customer_id: f.customer,
    version: 0,
    input: JSON.stringify({
      issue_date: day(new Date(Date.now() - 60 * 86400000).toISOString()),
      due_date: day(new Date(Date.now() - 14 * 86400000).toISOString()),
      notes: marker,
      items: [
        {
          description: marker,
          quantity: 1,
          unit_amount: "100.01",
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
  const run = () =>
    c.mutation(
      api.automation.execute,
      { table: "invoices", entity_id: invoice },
      { skipQueue: true },
    );
  const preview = () =>
    c.query(api.automation.preview, { table: "invoices", entity_id: invoice });
  const active = async () => (await preview()).flatMap((x) => x.active);
  try {
    const rule = await enable("invoice_due", [invoice]);
    await check(
      "Native preview is read-only for source, actions and execution history",
      async () => {
        const before = await c.query(api.commercial.invoice, { id: invoice }),
          h = await c.query(api.automation.history, {
            rule_id: rule._id,
            paginationOpts: { cursor: null, numItems: 30 },
          });
        assert.ok((await preview()).some((x) => x.drift === "missing"));
        await preview();
        assert.equal((await active()).length, 0);
        assert.deepEqual(
          await c.query(api.commercial.invoice, { id: invoice }),
          before,
        );
        assert.deepEqual(
          await c.query(api.automation.history, {
            rule_id: rule._id,
            paginationOpts: { cursor: null, numItems: 30 },
          }),
          h,
        );
      },
    );
    await check(
      "Native concurrent collection creates one exact-value action without financial changes",
      async () => {
        const before = await c.query(api.commercial.invoice, { id: invoice });
        await Promise.all([run(), run(), run()]);
        assert.equal((await active()).length, 1);
        assert.equal((await active())[0].impact_cents, "10001");
        assert.deepEqual(
          await c.query(api.commercial.invoice, { id: invoice }),
          before,
        );
      },
    );
    const action = (await active())[0];
    for (const role of ["sales", "designer", "staging_crew", "marketing"])
      await check(
        "Native " +
          role +
          " cannot administer automation or operate private collection",
        async () => {
          const x = (await operationsClient(role)).client;
          const calls = [
            () => x.query(api.automation.rules, {}),
            () => x.query(api.automation.team, {}),
            () => x.query(api.automation.health, {}),
            () =>
              x.query(api.automation.history, {
                paginationOpts: { cursor: null, numItems: 10 },
              }),
            () =>
              x.query(api.automation.preview, {
                table: "invoices",
                entity_id: invoice,
              }),
            () => x.mutation(api.automation.initialize, {}),
            () =>
              x.mutation(api.automation.saveRule, {
                id: rule._id,
                version: rule.version,
                config: rule.config,
              }),
            () =>
              x.mutation(api.automation.execute, {
                table: "invoices",
                entity_id: invoice,
              }),
            () =>
              x.mutation(api.automation.repair, {
                table: "invoices",
                entity_id: invoice,
              }),
            () => x.mutation(api.automation.scanBatch, {}),
            () =>
              x.mutation(api.automation.suppress, {
                table: "invoices",
                entity_id: invoice,
                family: "collection",
                days: 1,
                reason: marker,
              }),
            () =>
              x.mutation(api.automation.changeAction, {
                id: action._id,
                updated_at: action.updated_at,
                op: "complete",
                reason: marker,
              }),
          ];
          for (const call of calls) await assert.rejects(call);
          const feed = await x.query(api.automation.actions, {
            status: "active",
            paginationOpts: { cursor: null, numItems: 30 },
          });
          assert.ok(feed.page.every((a) => a._id !== action._id));
        },
      );
    await check(
      "Native anonymous archived unassigned callers and public scheduler denied",
      async () => {
        for (const role of ["archived", "unassigned"])
          await assert.rejects(
            () => operationsClient(role),
            /AUTHENTICATION_FAILED/,
          );
        const clients = [new ConvexHttpClient(url, { logger: false })];
        for (const x of clients) {
          await assert.rejects(
            x.query(api.automation.actions, {
              status: "active",
              paginationOpts: { cursor: null, numItems: 10 },
            }),
          );
          await assert.rejects(
            x.query(api.automation.notifications, {
              resolved: false,
              paginationOpts: { cursor: null, numItems: 10 },
            }),
          );
          await assert.rejects(x.query(api.automation.notificationBadge, {}));
          await assert.rejects(
            x.action(makeFunctionReference<"action">("automation:tick"), {}),
          );
        }
      },
    );
    await check(
      "Native Admin executes legitimate work; forged financial command is rejected",
      async () => {
        await (
          await operationsClient("admin")
        ).client.mutation(api.automation.execute, {
          table: "invoices",
          entity_id: invoice,
        });
        const before = await c.query(api.commercial.invoice, { id: invoice });
        await assert.rejects(
          c.mutation(makeFunctionReference<"mutation">("automation:execute"), {
            table: "invoices",
            entity_id: invoice,
            record_payment: "100",
          }),
        );
        assert.deepEqual(
          await c.query(api.commercial.invoice, { id: invoice }),
          before,
        );
      },
    );
    await check(
      "Native version race rejects stale rule writes and preserves execution policy snapshots",
      async () => {
        const r = (await c.query(api.automation.rules, {})).find(
          (x) => x.key === "invoice_due",
        )!.record!;
        const settled = await Promise.allSettled([
          c.mutation(
            api.automation.saveRule,
            {
              id: r._id,
              version: r.version,
              config: { ...r.config, priority: "urgent" },
            },
            { skipQueue: true },
          ),
          c.mutation(
            api.automation.saveRule,
            {
              id: r._id,
              version: r.version,
              config: { ...r.config, priority: "normal" },
            },
            { skipQueue: true },
          ),
          run(),
        ]);
        assert.equal(settled.filter((x) => x.status === "rejected").length, 1);
        await run();
        const h = await c.query(api.automation.history, {
          rule_id: r._id,
          paginationOpts: { cursor: null, numItems: 30 },
        });
        const versions = new Map<number, string>();
        for (const e of h.page) {
          const config = JSON.stringify(e.config);
          if (versions.has(e.rule_version))
            assert.equal(versions.get(e.rule_version), config);
          versions.set(e.rule_version, config);
        }
      },
    );
    await check(
      "Native escalation thresholds coalesce on an actually fourteen-day-overdue invoice",
      async () => {
        const id = (await active())[0]._id;
        for (const delay_days of [7, 14, 30]) {
          await enable("invoice_escalation", [invoice], { delay_days });
          await run();
          assert.equal((await active()).length, 1);
          assert.equal((await active())[0]._id, id);
          assert.equal((await active())[0].impact_cents, "10001");
          const signal = (await preview())
            .flatMap((x) => x.rules)
            .find((x) => x.key === "invoice_escalation")!;
          assert.equal(signal.eligible, delay_days <= 14);
        }
      },
    );
    await check(
      "Native snooze validates bounds and hides its notification without changing invoice",
      async () => {
        const a = (await active())[0],
          before = await c.query(api.commercial.invoice, { id: invoice });
        await assert.rejects(
          c.mutation(api.automation.changeAction, {
            id: a._id,
            updated_at: a.updated_at,
            op: "snooze",
            days: 0,
            reason: marker,
          }),
        );
        await c.mutation(api.automation.changeAction, {
          id: a._id,
          updated_at: a.updated_at,
          op: "snooze",
          days: 1,
          reason: marker,
        });
        const row = (await active())[0];
        assert.ok(row.snoozed_until > Date.now());
        const notes = await c.query(api.automation.notifications, {
          resolved: false,
          paginationOpts: { cursor: null, numItems: 30 },
        });
        assert.ok(notes.page.every((n) => n.action_id !== row._id));
        assert.deepEqual(
          await c.query(api.commercial.invoice, { id: invoice }),
          before,
        );
      },
    );
    await check(
      "Native task completion cannot settle an outstanding invoice",
      async () => {
        const a = (await active())[0];
        await c.mutation(api.automation.changeAction, {
          id: a._id,
          updated_at: a.updated_at,
          op: "complete",
          reason: marker,
        });
        await run();
        assert.equal(
          (await c.query(api.commercial.invoice, { id: invoice }))
            .balance_cents,
          "10001",
        );
        assert.equal((await active()).length, 1);
      },
    );
    const pay = () =>
      c.mutation(api.commercial.recordPayment, {
        project_id: f.project,
        customer_id: f.customer,
        amount: "100.01",
        method: "e_transfer",
        received_date: day(),
        external_reference: marker,
        notes: marker,
        request_key: randomUUID(),
        allocations: [{ invoice_id: invoice, amount: "100.01" }],
      });
    let payment: Id<"payments">;
    await check(
      "Native concurrent payment/evaluation removes false collection warning",
      async () => {
        const [p] = await Promise.all([pay(), run()]);
        payment = p;
        await run();
        assert.equal((await active()).length, 0);
        assert.equal(
          (await c.query(api.commercial.invoice, { id: invoice }))
            .balance_cents,
          "0",
        );
        assert.ok(
          !(
            await c.query(api.analyticsOperations.actionCenter, {})
          ).actions.some((a) => a.id === invoice),
        );
      },
    );
    await check(
      "Native reversal opens one new collection cycle with exact original amount",
      async () => {
        await c.mutation(api.commercial.reversePayment, {
          id: payment!,
          reason: marker,
        });
        await run();
        const a = (await active())[0];
        assert.equal(a.cycle, 2);
        assert.equal(a.impact_cents, "10001");
        assert.equal((await active()).length, 1);
      },
    );
    const finalPayment = await pay();
    await run();
    await check(
      "Native paid-invoice credit review neither refunds nor allocates cash",
      async () => {
        await c.mutation(api.commercial.creditInvoice, {
          invoice_id: invoice,
          amount: "10",
          reason: marker,
        });
        await enable("customer_credit", [f.customer]);
        const before = await c.query(api.commercial.invoice, { id: invoice });
        await c.mutation(api.automation.execute, {
          table: "commercial_customers",
          entity_id: f.customer,
        });
        const rows = (
          await c.query(api.automation.preview, {
            table: "commercial_customers",
            entity_id: f.customer,
          })
        ).flatMap((x) => x.active);
        assert.equal(rows.length, 1);
        assert.equal(rows[0].impact_cents, "1000");
        assert.deepEqual(
          await c.query(api.commercial.invoice, { id: invoice }),
          before,
        );
        await c.mutation(api.automation.changeAction, {
          id: rows[0]._id,
          updated_at: rows[0].updated_at,
          op: "resolve",
          reason: marker,
        });
      },
    );
    await check(
      "Native history pagination is bounded and resumes without duplicate IDs",
      async () => {
        const first = await c.query(api.automation.history, {
          paginationOpts: { cursor: null, numItems: 2 },
        });
        assert.equal(first.page.length, 2);
        assert.equal(first.isDone, false);
        const next = await c.query(api.automation.history, {
          paginationOpts: { cursor: first.continueCursor, numItems: 2 },
        });
        assert.ok(
          next.page.every((x) => !first.page.some((y) => x._id === y._id)),
        );
      },
    );
    await check(
      "Native suppression closes work and survives concurrent evaluation and repair",
      async () => {
        await c.mutation(api.commercial.reversePayment, {
          id: finalPayment,
          reason: marker,
        });
        await run();
        assert.equal((await active()).length, 1);
        const before = await c.query(api.commercial.invoice, { id: invoice });
        for (const days of [0, 91])
          await assert.rejects(
            c.mutation(api.automation.suppress, {
              table: "invoices",
              entity_id: invoice,
              family: "collection",
              days,
              reason: marker,
            }),
          );
        await c.mutation(api.automation.suppress, {
          table: "invoices",
          entity_id: invoice,
          family: "collection",
          days: 1,
          reason: marker,
        });
        await Promise.all([
          run(),
          run(),
          c.mutation(api.automation.repair, {
            table: "invoices",
            entity_id: invoice,
          }),
        ]);
        assert.equal((await active()).length, 0);
        assert.ok((await preview()).some((x) => x.suppressed));
        assert.deepEqual(
          await c.query(api.commercial.invoice, { id: invoice }),
          before,
        );
      },
    );
    await check(
      "Authenticated callers cannot invoke internal scheduler or removed helpers",
      async () => {
        for (const role of [
          "owner",
          "admin",
          "sales",
          "designer",
          "staging_crew",
          "marketing",
        ]) {
          const client = (await operationsClient(role)).client;
          await assert.rejects(
            client.action(
              makeFunctionReference<"action">("automation:tick"),
              {},
            ),
            /internal|public function|Could not find/i,
          );
        }
        for (const helper of [
          "m7AcceptanceControl:snapshot",
          "m8AcceptanceControl:dataset",
        ]) {
          await assert.rejects(
            c.query(makeFunctionReference<"query">(helper), {}),
            /Could not find public function/,
          );
        }
      },
    );
    await check(
      "Native repair and final source comparison preserve commercial facts",
      async () => {
        const before = await c.query(api.commercial.invoice, { id: invoice });
        await c.mutation(api.automation.repair, {
          table: "invoices",
          entity_id: invoice,
        });
        assert.deepEqual(
          await c.query(api.commercial.invoice, { id: invoice }),
          before,
        );
        assert.equal(
          (
            await c.query(api.analytics.compareSource, {
              table: "invoices",
              id: invoice,
            })
          ).drift.length,
          0,
        );
      },
    );
  } finally {
    for (const [key, original] of saved) {
      const r = (await c.query(api.automation.rules, {})).find(
        (x) => x.key === key,
      )!.record!;
      await c.mutation(api.automation.saveRule, {
        id: r._id,
        version: r.version,
        config: original.config,
      });
    }
  }
  await check(
    "Native final rules disabled and no failed automation work",
    async () => {
      assert.ok(
        (await c.query(api.automation.rules, {})).every(
          (x) => !x.record?.config.enabled,
        ),
      );
      assert.equal((await c.query(api.automation.health, {})).failed.length, 0);
    },
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Native M7 regression failed");
  process.exitCode = 1;
});
