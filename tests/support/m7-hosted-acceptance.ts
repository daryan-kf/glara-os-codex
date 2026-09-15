import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference, type FunctionArgs } from "convex/server";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { operationsClient } from "./operations-fixture";
import { credentials } from "./identities";
import { day } from "../../src/lib/operations/model";
import type { SourceTable } from "../../src/lib/automation/model";
const results: { name: string; passed: boolean }[] = [];
let scopedRules: Doc<"automation_rules">[] = [];
let batches = 0;
let enrolled = 0;
async function check(name: string, run: () => Promise<unknown>) {
  try {
    await run();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (error) {
    results.push({ name, passed: false });
    throw new Error(name, { cause: error });
  }
}
function internalRun(name: string, args: object, expectFailure = false) {
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
  if (expectFailure) {
    assert.notEqual(r.status, 0);
    return null;
  }
  if (r.status !== 0)
    throw Error("Internal acceptance operation failed: " + r.stderr);
  return r.stdout.trim() ? (JSON.parse(r.stdout) as unknown) : null;
}
async function main() {
  if (
    process.env.GLARA_M7_ACCEPTANCE !== "yes" ||
    process.env.GLARA_CONVEX_ACCEPTANCE !== "yes"
  )
    throw Error("M7 development opt-in required");
  const { client: c, url } = await operationsClient(),
    sales = (await operationsClient("sales")).client;
  const user = (role: string) => credentials(role).id as Id<"users">;
  const suffix = randomUUID().slice(0, 8),
    marker = `Fictional M7 ${suffix}`;
  await c.mutation(api.automation.initialize, {});
  await check(
    "All 28 defaults remain disabled and initialization is idempotent",
    async () => {
      const before = await c.query(api.automation.rules, {});
      assert.equal(before.length, 28);
      assert.ok(before.every((r) => !r.record?.config.enabled));
      await c.mutation(api.automation.initialize, {});
      assert.deepEqual(await c.query(api.automation.rules, {}), before);
    },
  );
  async function enable(
    key: string,
    id: string,
    patch: Partial<Doc<"automation_rules">["config"]> = {},
  ) {
    const r = (await c.query(api.automation.rules, {})).find(
      (r) => r.key === key,
    )!.record!;
    if (!scopedRules.some((x) => x._id === r._id)) scopedRules.push(r);
    await c.mutation(api.automation.saveRule, {
      id: r._id,
      version: r.version,
      config: {
        ...r.config,
        enabled: true,
        activation: "current",
        entity_ids: [id],
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
    (await preview(table, id)).flatMap((g) => g.active);
  try {
    await check(
      "Anonymous and non-manager direct rule execution is denied",
      async () => {
        await assert.rejects(
          new ConvexHttpClient(url, { logger: false }).query(
            api.automation.rules,
            {},
          ),
        );
        for (const role of [
          "sales",
          "designer",
          "staging_crew",
          "marketing",
          "unassigned",
          "archived",
        ]) {
          const client = (await operationsClient(role)).client;
          await assert.rejects(client.query(api.automation.rules, {}));
          await assert.rejects(client.mutation(api.automation.initialize, {}));
        }
      },
    );
    const realtor = await c.mutation(api.crm.write, {
      input: JSON.stringify({
        op: "realtor_create",
        data: {
          first_name: "Fictional M7",
          last_name: suffix,
          assigned_to: user("sales"),
          relationship_status: "active_partner",
        },
      }),
    });
    const property = await c.mutation(api.sales.saveProperty, {
      version: 0,
      input: JSON.stringify({
        address_line_1: `Fictional ${suffix} M7 Avenue`,
        city: "Vancouver",
        province: "BC",
        property_type: "detached",
        occupancy_status: "vacant",
        realtor_id: realtor.id,
        seller_name: marker,
        notes: marker,
      }),
    });
    const opportunity = await c.mutation(api.sales.saveOpportunity, {
      version: 0,
      input: JSON.stringify({
        property_id: property,
        assigned_to: user("sales"),
        estimated_value: "5000",
        probability: 40,
        next_action_title: marker,
        next_action_date: "2099-01-01T18:00:00Z",
        notes: marker,
      }),
    });
    const quote = await c.mutation(api.sales.saveQuote, {
      version: 0,
      input: JSON.stringify({
        opportunity_id: opportunity,
        items: [{ description: marker, quantity: 1, unit_price: "5000" }],
        discount: "0",
        tax_rate: "5",
        valid_until: "2099-12-31",
      }),
    });
    await c.mutation(api.sales.quoteStatus, {
      id: quote,
      version: 1,
      status: "sent",
    });
    await enable("quote_day2", quote, { delay_days: 2 });
    await enable("quote_day5", quote, { delay_days: 5 });
    await check(
      "Actual day-2 and day-5 thresholds use one logical quote action",
      async () => {
        await run("quotes", quote);
        assert.equal((await active("quotes", quote)).length, 0);
        internalRun("m7AcceptanceControl:control", {
          table: "quotes",
          entity_id: quote,
          op: "clock",
          days: 3,
        });
        await run("quotes", quote);
        const first = (await active("quotes", quote))[0];
        assert.ok(first);
        internalRun("m7AcceptanceControl:control", {
          table: "quotes",
          entity_id: quote,
          op: "clock",
          days: 6,
        });
        await run("quotes", quote);
        const second = (await active("quotes", quote))[0];
        assert.equal(second.activity_id, first.activity_id);
        assert.match(second.reason, /5\+ days/);
        internalRun("m7AcceptanceControl:control", {
          table: "quotes",
          entity_id: quote,
          op: "clock",
          days: -1,
        });
        await run("quotes", quote);
        assert.equal((await active("quotes", quote)).length, 0);
        internalRun("m7AcceptanceControl:control", {
          table: "quotes",
          entity_id: quote,
          op: "clock",
          days: 3,
        });
      },
    );
    await check(
      "Quote preview is read-only and current source needs one follow-up",
      async () => {
        assert.equal((await active("quotes", quote)).length, 0);
        assert.equal(
          (await preview("quotes", quote)).find(
            (x) => x.family === "quote_followup",
          )?.drift,
          "missing",
        );
        assert.equal((await active("quotes", quote)).length, 0);
      },
    );
    await check(
      "Concurrent manual, scheduler and replay evaluations create one quote task",
      async () => {
        await Promise.all([run("quotes", quote), run("quotes", quote)]);
        internalRun("automation:work", { table: "quotes", entity_id: quote });
        assert.equal((await active("quotes", quote)).length, 1);
      },
    );
    await check(
      "Preview has no task, notification or execution side effects",
      async () => {
        const args = { table: "quotes", entity_id: quote, op: "snapshot" };
        const before = internalRun("m7AcceptanceControl:control", args);
        await preview("quotes", quote);
        await preview("quotes", quote);
        assert.deepEqual(
          internalRun("m7AcceptanceControl:control", args),
          before,
        );
      },
    );
    await check(
      "Sales receives the linked task and other roles receive no private reminder",
      async () => {
        const a = (await active("quotes", quote))[0];
        assert.equal(a.assigned_to, user("sales"));
        const tasks = await sales.query(api.automation.actions, {
          status: "active",
          paginationOpts: { cursor: null, numItems: 30 },
        });
        assert.ok(tasks.page.some((x) => x._id === a._id));
        for (const role of ["designer", "staging_crew", "marketing"]) {
          const client = (await operationsClient(role)).client;
          const n = await client.query(api.automation.notifications, {
            resolved: false,
            paginationOpts: { cursor: null, numItems: 30 },
          });
          assert.ok(!JSON.stringify(n).includes(quote));
        }
      },
    );
    await check(
      "Snooze hides notifications and returns after fixture expiry",
      async () => {
        const a = (await active("quotes", quote))[0];
        await sales.mutation(api.automation.changeAction, {
          id: a._id,
          updated_at: a.updated_at,
          op: "snooze",
          days: 1,
          reason: marker,
        });
        const n = await sales.query(api.automation.notifications, {
          resolved: false,
          paginationOpts: { cursor: null, numItems: 30 },
        });
        assert.ok(!n.page.some((n) => n.action_id === a._id));
        internalRun("m7AcceptanceControl:control", {
          table: "quotes",
          entity_id: quote,
          op: "expire_snooze",
        });
        const after = await sales.query(api.automation.notifications, {
          resolved: false,
          paginationOpts: { cursor: null, numItems: 30 },
        });
        assert.ok(after.page.some((n) => n.action_id === a._id));
      },
    );
    await check(
      "Completing a task preserves the unresolved quote condition",
      async () => {
        const a = (await active("quotes", quote))[0];
        await sales.mutation(api.automation.changeAction, {
          id: a._id,
          updated_at: a.updated_at,
          op: "complete",
          reason: "Fictional follow-up attempted",
        });
        await run("quotes", quote);
        assert.ok((await active("quotes", quote))[0].task_completed_at);
        await run("quotes", quote);
        assert.equal((await active("quotes", quote)).length, 1);
      },
    );
    // Age only M7 fixture metadata on the opportunity; authoritative business dates remain untouched.
    await enable("new_contact", opportunity);
    await check(
      "Suppression blocks creation until explicit fixture expiry",
      async () => {
        await c.mutation(api.automation.suppress, {
          table: "opportunities",
          entity_id: opportunity,
          family: "contact",
          days: 1,
          reason: "Fictional client delay",
        });
        await run("opportunities", opportunity);
        assert.equal((await active("opportunities", opportunity)).length, 0);
        internalRun("m7AcceptanceControl:control", {
          table: "opportunities",
          entity_id: opportunity,
          op: "expire_suppression",
        });
        await run("opportunities", opportunity);
        assert.equal((await active("opportunities", opportunity)).length, 1);
      },
    );
    await check(
      "Escalation reassigns the same task to Owner without duplication",
      async () => {
        const a = (await active("opportunities", opportunity))[0];
        internalRun("m7AcceptanceControl:control", {
          table: "opportunities",
          entity_id: opportunity,
          op: "age",
        });
        await run("opportunities", opportunity);
        const next = (await active("opportunities", opportunity))[0];
        assert.equal(next.activity_id, a.activity_id);
        assert.equal(next.assigned_to, user("owner"));
        assert.equal(next.level, 2);
      },
    );
    await check(
      "Version snapshots preserve old policy after a configuration change",
      async () => {
        await enable("new_contact", opportunity, { priority: "urgent" });
        await run("opportunities", opportunity);
        const r = (await c.query(api.automation.rules, {})).find(
          (r) => r.key === "new_contact",
        )!.record!;
        const h = await c.query(api.automation.history, {
          rule_id: r._id,
          paginationOpts: { cursor: null, numItems: 30 },
        });
        assert.ok(new Set(h.page.map((x) => x.rule_version)).size >= 2);
      },
    );
    await check(
      "Completed contact reminder reopens only after a new cooldown cycle",
      async () => {
        const old = (await active("opportunities", opportunity))[0];
        await c.mutation(api.automation.changeAction, {
          id: old._id,
          updated_at: old.updated_at,
          op: "complete",
          reason: "Fictional follow-up attempted",
        });
        await run("opportunities", opportunity);
        assert.ok(
          (await active("opportunities", opportunity))[0].task_completed_at,
        );
        internalRun("m7AcceptanceControl:control", {
          table: "opportunities",
          entity_id: opportunity,
          op: "age",
        });
        await run("opportunities", opportunity);
        const next = (await active("opportunities", opportunity))[0];
        assert.equal(next.cycle, old.cycle + 1);
        assert.notEqual(next.activity_id, old.activity_id);
      },
    );
    await c.mutation(api.sales.quoteStatus, {
      id: quote,
      version: 2,
      status: "accepted",
    });
    for (const stage of [
      "contacted",
      "interested",
      "consultation",
      "quote_sent",
      "negotiation",
      "won",
    ]) {
      const o = await c.query(api.sales.getOpportunity, { id: opportunity });
      await c.mutation(api.sales.transition, {
        id: opportunity,
        version: o!.opportunity.version,
        input: JSON.stringify({ stage }),
      });
    }
    await check(
      "Won opportunity resolves sales reminders from authoritative state",
      async () => {
        await run("quotes", quote);
        await run("opportunities", opportunity);
        assert.equal((await active("quotes", quote)).length, 0);
        assert.equal((await active("opportunities", opportunity)).length, 0);
      },
    );
    const project = (
      await c.mutation(api.operations.create, {
        opportunity_id: opportunity,
        source_quote_id: quote,
        project_manager_id: user("admin"),
        designer_id: user("designer"),
        staging_lead_id: user("staging_crew"),
        input: JSON.stringify({
          package_type: "standard",
          planned_end_date: "2099-12-31",
          priority: "normal",
          internal_notes: marker,
        }),
        rooms: [
          JSON.stringify({
            room_type: "living_room",
            room_name: "Living room",
            staging_scope: "full",
            style_direction: "Calm",
            notes: "",
            status: "design_ready",
            sort_order: 0,
          }),
        ],
      })
    ).id;
    const get = () => c.query(api.operations.get, { id: project });
    const advance = async (status: string, date?: string) =>
      c.mutation(api.operations.transition, {
        id: project,
        version: (await get()).version,
        status: status as Doc<"projects">["status"],
        date,
      });
    const complete = async (category: string) => {
      for (const item of (await get()).checklist.filter(
        (x) =>
          x.category === category && x.required && x.status !== "completed",
      ))
        await c.mutation(api.operations.checklist, {
          id: item._id,
          version: item.version,
          status: "completed",
        });
    };
    await advance("designing");
    await complete("pre_staging");
    await advance("ready_to_schedule");
    const eventDay = process.env.GLARA_M7_EVENT_DAY ?? day();
    async function schedule(type: "staging" | "destaging", hour: number) {
      return c.mutation(api.operations.schedule, {
        project_id: project,
        project_version: (await get()).version,
        version: 0,
        event_type: type,
        title: marker,
        description: "",
        location_note: "",
        start_at: `${eventDay}T${hour}:00:00Z`,
        end_at: `${eventDay}T${hour + 1}:00:00Z`,
        assigned_lead_id: user("staging_crew"),
      });
    }
    const category = await c.mutation(api.inventory.saveCategory, {
      version: 0,
      name: marker,
      active: true,
    });
    const location = await c.mutation(api.inventory.saveLocation, {
      version: 0,
      input: JSON.stringify({
        name: marker,
        type: "warehouse",
        address: "Fictional",
        active: true,
        staging_source: true,
        retail_source: false,
      }),
    });
    const product = await c.mutation(api.inventory.saveProduct, {
      category_id: category,
      version: 0,
      input: JSON.stringify({
        sku: suffix,
        name: marker,
        track_mode: "serialized",
        staging_eligible: true,
        retail_eligible: false,
        active: true,
      }),
    });
    const asset = (await c.mutation(api.inventory.receive, {
      product_id: product,
      location_id: location,
      quantity: 1,
      condition: "good",
      acquisition_date: day(),
      reason: marker,
    }))!;
    const line = await c.mutation(api.inventory.reserve, {
      project_id: project,
      project_room_id: (await get()).rooms[0]._id,
      product_id: product,
      location_id: location,
      asset_id: asset,
      quantity: 1,
      needed_from: eventDay,
      needed_until: day(),
      notes: marker,
      planned: false,
    });
    const getLine = async () =>
      (
        await c.query(api.inventory.projectInventory, { project_id: project })
      ).lines.find((r) => r._id === line)!;
    const move = async (
      action: FunctionArgs<typeof api.inventory.moveReservation>["action"],
    ) => {
      const r = await getLine();
      return c.mutation(api.inventory.moveReservation, {
        id: line,
        version: r.version,
        action,
        quantity: 1,
        asset_confirmation: r.asset_number ?? "",
        location_id: location,
        reason: marker,
      });
    };
    await schedule("staging", 18);
    await enable("prep_tomorrow", project, { delay_days: 1 });
    await check(
      "Upcoming staging with incomplete required checklist creates one action",
      async () => {
        await run("projects", project);
        await run("projects", project);
        assert.equal((await active("projects", project)).length, 1);
      },
    );
    await move("pick");
    await advance("staging");
    await move("install");
    await move("missing");
    await enable("missing_asset", asset);
    await check(
      "Missing asset generates one reminder without liability or valuation",
      async () => {
        await run("inventory_assets", asset);
        await run("inventory_assets", asset);
        const a = (await active("inventory_assets", asset))[0];
        assert.ok(a);
        assert.equal(a.impact_cents, "0");
      },
    );
    await move("found");
    await check(
      "Physical recovery resolves the asset reminder independently of commercial review",
      async () => {
        await run("inventory_assets", asset);
        assert.equal((await active("inventory_assets", asset)).length, 0);
      },
    );
    const returned = await getLine();
    await c.mutation(api.inventory.inspect, {
      reservation_id: line,
      asset_id: asset,
      product_id: product,
      location_id: location,
      version: returned.version,
      quantity: 1,
      from_state: "inspection",
      result: "available",
      condition: "good",
      notes: marker,
    });
    await complete("staging");
    await run("projects", project);
    await check(
      "Completing checklist resolves the preparation action",
      async () => assert.equal((await active("projects", project)).length, 0),
    );
    await advance("staged");
    await advance("sold", eventDay);
    await enable("sold_destage", project);
    await check(
      "Sold project produces a destaging reminder without creating an event",
      async () => {
        const before = (await get()).events.length;
        await run("projects", project);
        assert.equal((await active("projects", project)).length, 1);
        assert.equal((await get()).events.length, before);
      },
    );
    await schedule("destaging", 20);
    await run("projects", project);
    await complete("destaging");
    await advance("destaging");
    await advance("completed");
    await check(
      "Destaging and project completion resolve operations automation",
      async () => {
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
    const invoice = await c.mutation(api.commercial.saveInvoice, {
      project_id: project,
      customer_id: customer,
      version: 0,
      input: JSON.stringify({
        issue_date: day(),
        due_date: day(),
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
    await enable("invoice_due", invoice);
    await enable("invoice_overdue", invoice);
    await check(
      "Controlled isolated transaction failure rolls back task creation",
      async () => {
        internalRun(
          "m7AcceptanceControl:control",
          { table: "invoices", entity_id: invoice, op: "fail" },
          true,
        );
        assert.equal((await active("invoices", invoice)).length, 0);
      },
    );
    await check(
      "Failed work records three bounded attempts, is visible to Owner, and retries safely",
      async () => {
        const state = internalRun("m7AcceptanceControl:control", {
          table: "invoices",
          entity_id: invoice,
          op: "state",
        }) as { queue: { _id: Id<"automation_queue">; generation: number } };
        assert.ok(state.queue);
        for (let n = 0; n < 3; n++) {
          internalRun(
            "m7AcceptanceControl:control",
            { table: "invoices", entity_id: invoice, op: "fail" },
            true,
          );
          internalRun("automation:failed", {
            id: state.queue._id,
            generation: state.queue.generation,
          });
        }
        const h = await c.query(api.automation.health, {});
        assert.equal(
          h.failed.find((q) => q._id === state.queue._id)?.attempts,
          3,
        );
        await assert.rejects(
          sales.mutation(api.automation.retry, { id: state.queue._id }),
        );
        await c.mutation(api.automation.retry, { id: state.queue._id });
        await run("invoices", invoice);
        assert.equal((await active("invoices", invoice)).length, 1);
      },
    );
    await check(
      "Hosted concurrent collection evaluation creates exactly one active action",
      async () => {
        await Promise.all([
          run("invoices", invoice),
          run("invoices", invoice),
          run("invoices", invoice),
        ]);
        assert.equal((await active("invoices", invoice)).length, 1);
        assert.equal(
          (await active("invoices", invoice))[0].impact_cents,
          "10001",
        );
      },
    );
    const payment = await c.mutation(api.commercial.recordPayment, {
      project_id: project,
      customer_id: customer,
      amount: "100.01",
      method: "e_transfer",
      received_date: day(),
      external_reference: marker,
      notes: marker,
      request_key: randomUUID(),
      allocations: [{ invoice_id: invoice, amount: "100.01" }],
    });
    await check(
      "Payment resolves collection and dashboard coalesces the signal",
      async () => {
        await run("invoices", invoice);
        assert.equal((await active("invoices", invoice)).length, 0);
        assert.equal(
          (await c.query(api.commercial.invoice, { id: invoice }))
            .balance_cents,
          "0",
        );
        const center = await c.query(api.analyticsOperations.actionCenter, {});
        assert.ok(!center.actions.some((a) => a.id === invoice));
      },
    );
    await c.mutation(api.commercial.reversePayment, {
      id: payment,
      reason: marker,
    });
    await check(
      "Payment reversal requalifies the balance with a new action cycle",
      async () => {
        await run("invoices", invoice);
        const a = (await active("invoices", invoice))[0];
        assert.equal(a.cycle, 2);
        assert.equal(a.impact_cents, "10001");
      },
    );
    await c.mutation(api.commercial.recordPayment, {
      project_id: project,
      customer_id: customer,
      amount: "100.01",
      method: "e_transfer",
      received_date: day(),
      external_reference: marker,
      notes: marker,
      request_key: randomUUID(),
      allocations: [{ invoice_id: invoice, amount: "100.01" }],
    });
    await run("invoices", invoice);
    await check(
      "Public invocation of internal scheduler is rejected",
      async () => {
        await assert.rejects(
          c.action(makeFunctionReference<"action">("automation:tick"), {}),
        );
      },
    );
    writeFileSync(
      "test-results/m7-lifecycle-fixture.json",
      JSON.stringify({
        project,
        quote,
        opportunity,
        realtor: realtor.id,
        property,
        invoice,
        customer,
        asset,
        product,
        line,
        location,
        marker,
      }),
    );
    await check("Bounded bootstrap resumes across source tables", async () => {
      for (let n = 0; n < 10; n++) {
        const r = await c.mutation(api.automation.scanBatch, {});
        batches++;
        enrolled += r.count;
        assert.ok(r.count <= 20);
        if (r.done) break;
      }
      assert.ok(batches > 1);
    });
  } finally {
    for (const saved of scopedRules) {
      const current = (await c.query(api.automation.rules, {})).find(
        (r) => r.record?._id === saved._id,
      )!.record!;
      await c.mutation(api.automation.saveRule, {
        id: saved._id,
        version: current.version,
        config: saved.config,
      });
    }
    scopedRules = [];
  }
}
main()
  .catch((error: unknown) => {
    console.error("M7 hosted acceptance stopped:", error);
    process.exitCode = 1;
  })
  .finally(() =>
    writeFileSync(
      "docs/M7-hosted-results.json",
      JSON.stringify(
        {
          deployment: "woozy-jaguar-392",
          timestamp: new Date().toISOString(),
          results,
          passed: results.filter((r) => r.passed).length,
          failed: results.filter((r) => !r.passed).length,
          completed: process.exitCode !== 1,
          backlog: { batches, enrolled },
          fixture_controls:
            "Guarded fictional source timestamp corrections, M7 scheduling metadata and isolated transaction rollback; no real business event dates changed.",
        },
        null,
        2,
      ) + "\n",
    ),
  );
