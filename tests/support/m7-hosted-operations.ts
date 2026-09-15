import type { FunctionReturnType } from "convex/server";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { operationsClient } from "./operations-fixture";
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
const date = (n: number) =>
  day(new Date(Date.now() + n * 86400000).toISOString());
async function main() {
  if (process.env.GLARA_M7_ACCEPTANCE !== "yes")
    throw Error("M7 development opt-in required");
  const { client: c } = await operationsClient();
  const f = JSON.parse(
    readFileSync("test-results/m7-matrix-fixture.json", "utf8"),
  ) as {
    project: Id<"projects">;
    customer: Id<"commercial_customers">;
    agreement: Id<"agreements">;
    marker: string;
  };
  const stock = JSON.parse(
    readFileSync("test-results/m7-lifecycle-fixture.json", "utf8"),
  ) as {
    asset: Id<"inventory_assets">;
    product: Id<"products">;
    location: Id<"inventory_locations">;
  };
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
  const active = async (table: SourceTable, entity_id: string) =>
    (await c.query(api.automation.preview, { table, entity_id })).flatMap(
      (x) => x.active,
    );
  const get = () => c.query(api.operations.get, { id: f.project });
  const who = (r: string) => credentials(r).id as Id<"users">;
  try {
    for (const role of ["designer", "staging_crew"]) {
      const task = await c.mutation(api.operations.saveTask, {
        project_id: f.project,
        version: 0,
        title: f.marker,
        description: f.marker,
        due_at: new Date(Date.now() - 86400000).toISOString(),
        assigned_to: who(role),
        status: "open",
      });
      await enable("required_task", [task], { assignment: "entity_owner" });
      await check(
        `${role} receives authorized operational task and completes it without financial data`,
        async () => {
          const client = (await operationsClient(role)).client;
          await run("activities", task);
          const a = (await active("activities", task))[0];
          assert.equal(a.assigned_to, who(role));
          assert.equal(a.activity_id, task);
          assert.equal(a.impact_cents, "0");
          const feed = await client.query(api.automation.actions, {
            status: "active",
            paginationOpts: { cursor: null, numItems: 30 },
          });
          assert.ok(feed.page.some((x) => x._id === a._id));
          await client.mutation(api.automation.changeAction, {
            id: a._id,
            updated_at: a.updated_at,
            op: "complete",
            reason: f.marker,
          });
          await run("activities", task);
          assert.equal((await active("activities", task)).length, 0);
        },
      );
    }
    const category = await c.mutation(api.inventory.saveCategory, {
      version: 0,
      name: f.marker + " quantity " + Date.now(),
      active: true,
    });
    const product = await c.mutation(api.inventory.saveProduct, {
      version: 0,
      category_id: category,
      input: JSON.stringify({
        sku: `M7Q-${Date.now()}`,
        name: f.marker,
        track_mode: "quantity",
        active: true,
        staging_eligible: true,
        retail_eligible: false,
      }),
    });
    const room = (await get()).rooms[0]._id;
    const line = await c.mutation(api.inventory.reserve, {
      project_id: f.project,
      project_room_id: room,
      product_id: product,
      location_id: stock.location,
      quantity: 2,
      needed_from: day(),
      needed_until: date(10),
      notes: f.marker,
      planned: true,
    });
    const inventory = () =>
      c.query(api.inventory.projectInventory, { project_id: f.project });
    const row = async (id: Id<"inventory_reservations">) =>
      (await inventory()).lines.find((x) => x._id === id)!;
    const move = async (
      id: Id<"inventory_reservations">,
      action: "confirm" | "release" | "damage" | "receive_damage",
    ) => {
      const r = await row(id);
      return c.mutation(api.inventory.moveReservation, {
        id,
        version: r.version,
        action,
        quantity: r.quantity,
        asset_confirmation: r.asset_number ?? "",
        location_id: stock.location,
        reason: f.marker,
      });
    };
    await enable("inventory_shortage", [line]);
    await check(
      "M4 shortage creates one preparation task without allocating stock",
      async () => {
        const stockBefore = await c.query(api.inventory.product, {
          id: product,
        });
        const history = () =>
          c.query(api.inventory.history, {
            product_id: product,
            paginationOpts: { cursor: null, numItems: 100 },
          });
        const historyBefore = await history();
        assert.equal(historyBefore.isDone, true);
        await Promise.all([
          run("inventory_reservations", line),
          run("inventory_reservations", line),
        ]);
        assert.equal((await active("inventory_reservations", line)).length, 1);
        assert.equal((await row(line)).state, "planned");
        assert.deepEqual(
          await c.query(api.inventory.product, { id: product }),
          stockBefore,
        );
        assert.deepEqual(await history(), historyBefore);
        await c.mutation(api.inventory.receive, {
          product_id: product,
          location_id: stock.location,
          quantity: 2,
          condition: "good",
          acquisition_date: day(),
          reason: f.marker,
        });
        await move(line, "confirm");
        await run("inventory_reservations", line);
        assert.equal((await active("inventory_reservations", line)).length, 0);
        await move(line, "release");
      },
    );
    const serial = await c.mutation(api.inventory.reserve, {
      project_id: f.project,
      project_room_id: room,
      product_id: stock.product,
      asset_id: stock.asset,
      location_id: stock.location,
      quantity: 1,
      needed_from: day(),
      needed_until: date(10),
      notes: f.marker,
      planned: false,
    });
    await move(serial, "damage");
    const incident = (
      await c.query(api.commercial.project, { project_id: f.project })
    ).unassessed_incidents[0];
    if (!incident) throw Error("Fictional incident unavailable");
    await enable("damage_review", [incident.id]);
    let assessment: Id<"damage_charge_assessments">;
    await check(
      "Damage reminder neither determines liability nor creates an assessment",
      async () => {
        const before = await c.query(api.commercial.project, {
          project_id: f.project,
        });
        await run("inventory_damage", incident.id);
        assert.equal((await active("inventory_damage", incident.id)).length, 1);
        assert.deepEqual(
          (await c.query(api.commercial.project, { project_id: f.project }))
            .assessments,
          before.assessments,
        );
        assessment = await c.mutation(api.commercial.createAssessment, {
          project_id: f.project,
          damage_record_id: incident.id,
          agreement_id: f.agreement,
        });
        await run("inventory_damage", incident.id);
        assert.equal((await active("inventory_damage", incident.id)).length, 0);
      },
    );
    await c.mutation(api.commercial.reviewAssessment, {
      id: assessment!,
      version: 1,
      input: JSON.stringify({
        liability_basis: "client_damage",
        valuation_basis: "repair_cost",
        notes: f.marker,
        description: f.marker,
        proposed_amount: "10",
        taxes: [],
      }),
    });
    await c.mutation(api.commercial.decideAssessment, {
      id: assessment!,
      version: 2,
      decision: "approve",
      approved_amount: "10",
      reason: f.marker,
    });
    await enable("assessment_invoice", [assessment!]);
    await check(
      "Approved assessment reminder preserves amount and waits for explicit M5 invoice",
      async () => {
        const before = await c.query(api.commercial.assessment, {
          id: assessment!,
        });
        await run("damage_charge_assessments", assessment!);
        assert.equal(
          (await active("damage_charge_assessments", assessment!)).length,
          1,
        );
        assert.deepEqual(
          await c.query(api.commercial.assessment, { id: assessment! }),
          before,
        );
        await c.mutation(api.commercial.sourceInvoice, {
          project_id: f.project,
          customer_id: f.customer,
          source_type: "assessment",
          assessment_id: assessment!,
          issue_date: day(),
          due_date: day(),
        });
        await run("damage_charge_assessments", assessment!);
        assert.equal(
          (await active("damage_charge_assessments", assessment!)).length,
          0,
        );
      },
    );
    await move(serial, "receive_damage");
    const inspect = async (
      from_state: "inspection" | "repair",
      result: "repair" | "available",
    ) =>
      c.mutation(api.inventory.inspect, {
        reservation_id: serial,
        asset_id: stock.asset,
        product_id: stock.product,
        location_id: stock.location,
        version: (await row(serial)).version,
        quantity: 1,
        from_state,
        result,
        condition: result === "repair" ? "damaged" : "good",
        notes: f.marker,
      });
    await inspect("inspection", "repair");
    await enable("repair_backlog", [stock.asset]);
    await check(
      "Repair reminder does not repair inventory and resolves after M4 inspection",
      async () => {
        const assetBefore = await c.query(api.inventory.asset, {
          id: stock.asset,
        });
        await run("inventory_assets", stock.asset);
        assert.deepEqual(
          await c.query(api.inventory.asset, { id: stock.asset }),
          assetBefore,
        );
        assert.equal((await active("inventory_assets", stock.asset)).length, 1);
        assert.equal(
          (await c.query(api.inventory.asset, { id: stock.asset })).status,
          "repair",
        );
        await inspect("repair", "available");
        await run("inventory_assets", stock.asset);
        assert.equal((await active("inventory_assets", stock.asset)).length, 0);
      },
    );
    await c.mutation(api.operations.transition, {
      id: f.project,
      version: (await get()).version,
      status: "designing",
    });
    for (const x of (await get()).checklist.filter(
      (x) => x.category === "pre_staging" && x.required,
    ))
      await c.mutation(api.operations.checklist, {
        id: x._id,
        version: x.version,
        status: "completed",
      });
    await c.mutation(api.operations.transition, {
      id: f.project,
      version: (await get()).version,
      status: "ready_to_schedule",
    });
    const schedule = async (offset: number, id?: Id<"operations_events">) => {
      const old = id
        ? (await get()).events.find((x) => x._id === id)
        : undefined;
      const busy: { id: string; start_at: string; end_at: string }[] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 20; page++) {
        const result: FunctionReturnType<typeof api.operations.agenda> =
          await c.query(api.operations.agenda, {
            start_day: date(offset),
            end_day: date(offset),
            paginationOpts: { numItems: 50, cursor },
          });
        busy.push(...result.page);
        if (result.isDone) break;
        cursor = result.continueCursor;
        if (page === 19) throw Error("Fixture calendar exceeds bounded scan");
      }
      const slot = Array.from({ length: 13 }, (_, i) => i + 10)
        .map((hour) => ({
          start:
            date(offset) + "T" + String(hour).padStart(2, "0") + ":13:00.000Z",
          end:
            date(offset) + "T" + String(hour).padStart(2, "0") + ":43:00.000Z",
        }))
        .find(
          (slot) =>
            !busy.some(
              (e) =>
                e.id !== id && e.start_at < slot.end && e.end_at > slot.start,
            ),
        );
      if (!slot) throw Error("No free fictional acceptance time slot");
      return c.mutation(api.operations.schedule, {
        project_id: f.project,
        project_version: (await get()).version,
        id,
        version: old?.version ?? 0,
        event_type: "staging",
        title: f.marker,
        description: f.marker,
        location_note: "Fictional acceptance only",
        start_at: slot.start,
        end_at: slot.end,
        assigned_lead_id: who("admin"),
      });
    };
    const event = await schedule(2);
    await enable("prep_day3", [f.project], { delay_days: 3 });
    await enable("prep_tomorrow", [f.project], { delay_days: 1 });
    await check(
      "Real upcoming staging progresses from 3-day to tomorrow urgency without weakening M3",
      async () => {
        await run("projects", f.project);
        let a = (await active("projects", f.project)).find(
          (x) => x.family === "preparation",
        )!;
        assert.ok(a);
        assert.equal(a.priority, "high");
        const id = a._id;
        await schedule(1, event);
        await run("projects", f.project);
        a = (await active("projects", f.project)).find(
          (x) => x.family === "preparation",
        )!;
        assert.equal(a._id, id);
        assert.equal(a.priority, "urgent");
        const p = await get();
        const required = p.checklist.find(
          (x) => x.category === "pre_staging" && x.required,
        )!;
        await assert.rejects(
          c.mutation(api.operations.checklist, {
            id: required._id,
            version: required.version,
            status: "pending",
          }),
        );
        for (const x of p.checklist.filter(
          (x) => x.category === "staging" && x.required,
        ))
          await c.mutation(api.operations.checklist, {
            id: x._id,
            version: x.version,
            status: "completed",
          });
        await run("projects", f.project);
        assert.ok(
          !(await active("projects", f.project)).some(
            (x) => x.family === "preparation",
          ),
        );
        assert.equal((await get()).status, "scheduled");
      },
    );
  } finally {
    const project = await c.query(api.operations.get, { id: f.project });
    for (const event of project.events.filter(
      (e) => e.status === "scheduled" && e.description === f.marker,
    ))
      await c.mutation(api.operations.eventState, {
        id: event._id,
        version: event.version,
        status: "cancelled",
        reason: "Fictional M7 acceptance cleanup; history retained",
      });
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
      "docs/M7-hosted-operations-results.json",
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
