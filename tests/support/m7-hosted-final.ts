import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { operationsClient } from "./operations-fixture";
import { day } from "../../src/lib/operations/model";
const results: { name: string; passed: boolean }[] = [];
let dispatch: unknown = null;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, passed: false });
    throw new Error(name, { cause: e });
  }
}
function internal(name: string, args: object, fail = false): unknown {
  const r = spawnSync(
    process.execPath,
    [
      "node_modules/convex/bin/main.js",
      "run",
      name,
      JSON.stringify(args),
      "--env-file",
      ".env.local",
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (fail) {
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /CONTROLLED_ACCEPTANCE_FAILURE/);
    return null;
  }
  if (r.status !== 0) throw Error(r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
async function main() {
  if (
    process.env.GLARA_M7_ACCEPTANCE !== "yes" ||
    !process.env.GLARA_M7_BROWSER_FIXTURE
  )
    throw Error("Development opt-in required");
  const f = JSON.parse(
    readFileSync(process.env.GLARA_M7_BROWSER_FIXTURE, "utf8"),
  ) as {
    project: Id<"projects">;
    customer: Id<"commercial_customers">;
    marker: string;
  };
  const { client: c, url } = await operationsClient();
  const marker = f.marker + " final " + randomUUID().slice(0, 8);
  const originals: Doc<"automation_rules">[] = [];
  async function enable(key: string, id: string) {
    const r = (await c.query(api.automation.rules, {})).find(
      (x) => x.key === key,
    )!.record!;
    originals.push(r);
    await c.mutation(api.automation.saveRule, {
      id: r._id,
      version: r.version,
      config: {
        ...r.config,
        enabled: true,
        delay_days: 0,
        entity_ids: [id],
        daily_limit: 100,
        activation: "current",
      },
    });
    return r;
  }
  const invoice = await c.mutation(api.commercial.saveInvoice, {
    project_id: f.project,
    customer_id: f.customer,
    version: 0,
    input: JSON.stringify({
      issue_date: day(),
      due_date: day(),
      notes: marker,
      items: [
        {
          description: marker,
          quantity: 1,
          unit_amount: "100",
          discount: "0",
          taxes: [],
        },
      ],
    }),
  });
  const control = (op: string) =>
    internal("m7AcceptanceControl:control", {
      table: "invoices",
      entity_id: invoice,
      op,
    });
  const run = () =>
    c.mutation(api.automation.execute, {
      table: "invoices",
      entity_id: invoice,
    });
  try {
    const rule = await enable("invoice_escalation", invoice);
    await c.mutation(api.commercial.invoiceAction, {
      id: invoice,
      version: 1,
      action: "issue",
      reason: marker,
    });
    const state = control("state") as { queue: Doc<"automation_queue"> };
    await check(
      "Hosted controlled failure rolls back every task, notification and execution write",
      async () => {
        const before = control("snapshot");
        internal(
          "m7AcceptanceControl:control",
          { table: "invoices", entity_id: invoice, op: "fail" },
          true,
        );
        assert.deepEqual(control("snapshot"), before);
      },
    );
    await check(
      "Failure policy records exact 5/10/15-minute offsets and retains terminal failure",
      async () => {
        for (let attempt = 1; attempt <= 3; attempt++) {
          internal("automation:failed", {
            id: state.queue._id,
            generation: state.queue.generation,
          });
          const q = (control("state") as { queue: Doc<"automation_queue"> })
            .queue;
          assert.equal(q.attempts, attempt);
          assert.equal(q.due_at - q.last_attempt!, attempt * 300000);
          assert.equal(q.last_code, "EVALUATION_FAILED");
          assert.equal(q.status, attempt === 3 ? "failed" : "pending");
        }
        assert.ok(
          (await c.query(api.automation.health, {})).failed.some(
            (x) => x._id === state.queue._id,
          ),
        );
        await c.mutation(api.automation.retry, { id: state.queue._id });
        await run();
        const snap = control("snapshot") as {
          actions: Doc<"automation_actions">[];
          executions: Doc<"automation_executions">[];
        };
        assert.equal(
          snap.actions.filter((x) => x.status === "active").length,
          1,
        );
        assert.ok(
          snap.executions
            .filter((x) => x.status === "failed")
            .every((x) => x.actor_id === null && x.actor_kind === "system"),
        );
      },
    );
    const action = (
      await c.query(api.automation.preview, {
        table: "invoices",
        entity_id: invoice,
      })
    ).flatMap((x) => x.active)[0];
    const snap = control("snapshot") as {
      notifications: Doc<"notifications">[];
    };
    await check(
      "Every M7 administration endpoint rejects Sales/Designer/Crew/Marketing direct calls",
      async () => {
        for (const role of ["sales", "designer", "staging_crew", "marketing"]) {
          const client = (await operationsClient(role)).client;
          for (const request of [
            () => client.query(api.automation.rules, {}),
            () => client.query(api.automation.team, {}),
            () => client.query(api.automation.health, {}),
            () =>
              client.query(api.automation.history, {
                paginationOpts: { cursor: null, numItems: 10 },
              }),
            () =>
              client.query(api.automation.preview, {
                table: "invoices",
                entity_id: invoice,
              }),
            () => client.mutation(api.automation.initialize, {}),
            () =>
              client.mutation(api.automation.saveRule, {
                id: rule._id,
                version: rule.version,
                config: rule.config,
              }),
            () =>
              client.mutation(api.automation.execute, {
                table: "invoices",
                entity_id: invoice,
              }),
            () =>
              client.mutation(api.automation.repair, {
                table: "invoices",
                entity_id: invoice,
              }),
            () => client.mutation(api.automation.scanBatch, {}),
            () =>
              client.mutation(api.automation.retry, { id: state.queue._id }),
            () =>
              client.mutation(api.automation.suppress, {
                table: "invoices",
                entity_id: invoice,
                family: "collection",
                days: 1,
                reason: marker,
              }),
            () =>
              client.mutation(api.automation.changeAction, {
                id: action._id,
                updated_at: action.updated_at,
                op: "complete",
                reason: marker,
              }),
            () =>
              client.mutation(api.automation.readNotification, {
                id: snap.notifications[0]._id,
              }),
          ])
            await assert.rejects(request);
        }
      },
    );
    await check(
      "Anonymous, archived and unassigned callers cannot read personal automation surfaces",
      async () => {
        const clients = [
          new ConvexHttpClient(url, { logger: false }),
          (await operationsClient("archived")).client,
          (await operationsClient("unassigned")).client,
        ];
        for (const client of clients) {
          await assert.rejects(
            client.query(api.automation.actions, {
              status: "active",
              paginationOpts: { cursor: null, numItems: 10 },
            }),
          );
          await assert.rejects(
            client.query(api.automation.notifications, {
              resolved: false,
              paginationOpts: { cursor: null, numItems: 10 },
            }),
          );
          await assert.rejects(
            client.query(api.automation.notificationBadge, {}),
          );
          await assert.rejects(
            client.action(
              makeFunctionReference<"action">("automation:tick"),
              {},
            ),
          );
        }
      },
    );
    await check(
      "Admin evaluates valid work while forged extra financial commands are rejected",
      async () => {
        const admin = (await operationsClient("admin")).client;
        await admin.mutation(api.automation.execute, {
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
    await c.mutation(api.commercial.recordPayment, {
      project_id: f.project,
      customer_id: f.customer,
      amount: "100",
      method: "e_transfer",
      received_date: day(),
      external_reference: marker,
      notes: marker,
      request_key: randomUUID(),
      allocations: [{ invoice_id: invoice, amount: "100" }],
    });
    await run();
    await enable("customer_credit", f.customer);
    await check(
      "Paid-invoice credit balance creates a customer review without refund or allocation",
      async () => {
        await c.mutation(api.commercial.creditInvoice, {
          invoice_id: invoice,
          amount: "10",
          reason: marker,
        });
        const before = await c.query(api.commercial.invoice, { id: invoice });
        await c.mutation(api.automation.execute, {
          table: "commercial_customers",
          entity_id: f.customer,
        });
        const a = (
          await c.query(api.automation.preview, {
            table: "commercial_customers",
            entity_id: f.customer,
          })
        ).flatMap((x) => x.active);
        assert.equal(a.length, 1);
        assert.equal(a[0].impact_cents, "1000");
        assert.deepEqual(
          await c.query(api.commercial.invoice, { id: invoice }),
          before,
        );
        await c.mutation(api.automation.changeAction, {
          id: a[0]._id,
          updated_at: a[0].updated_at,
          op: "resolve",
          reason: marker,
        });
      },
    );
    await check(
      "History pagination is bounded, resumable and has no repeated execution IDs",
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
          next.page.every((x) => !first.page.some((y) => y._id === x._id)),
        );
      },
    );
  } finally {
    for (const saved of originals) {
      const current = (await c.query(api.automation.rules, {})).find(
        (x) => x.record?._id === saved._id,
      )!.record!;
      await c.mutation(api.automation.saveRule, {
        id: saved._id,
        version: current.version,
        config: saved.config,
      });
    }
  }
  await check(
    "Actual internal dispatcher remains bounded to 100 queued source evaluations",
    async () => {
      dispatch = internal("automation:tick", {});
      assert.ok((dispatch as { evaluated: number }).evaluated <= 100);
    },
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() =>
    writeFileSync(
      "docs/M7-hosted-final-results.json",
      JSON.stringify(
        {
          deployment: "woozy-jaguar-392",
          timestamp: new Date().toISOString(),
          results,
          dispatch,
          passed: results.filter((x) => x.passed).length,
          failed: results.filter((x) => !x.passed).length,
          completed: process.exitCode !== 1,
        },
        null,
        2,
      ) + "\n",
    ),
  );
