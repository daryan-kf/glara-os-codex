import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { operationsClient, wonFixture } from "./operations-fixture";
import { api } from "../../convex/_generated/api";
import { day } from "../../src/lib/operations/model";
import type { Id } from "../../convex/_generated/dataModel";
async function main() {
  const { client: c } = await operationsClient();
  const f = await wonFixture(c),
    f2 = await wonFixture(c);
  const p = (await c.mutation(api.operations.create, f.createArgs)).id,
    p2 = (await c.mutation(api.operations.create, f2.createArgs)).id;
  const get = () => c.query(api.operations.get, { id: p });
  const room = (await get()).rooms[0]._id,
    room2 = (await c.query(api.operations.get, { id: p2 })).rooms[0]._id;
  const category = await c.mutation(api.inventory.saveCategory, {
    version: 0,
    name: `Fictional quantity ${f.suffix}`,
    active: true,
  });
  const location = await c.mutation(api.inventory.saveLocation, {
    version: 0,
    input: JSON.stringify({
      name: `Fictional quantity ${f.suffix}`,
      type: "warehouse",
      address: "Fictional",
      active: true,
      staging_source: true,
      retail_source: true,
    }),
  });
  const product = await c.mutation(api.inventory.saveProduct, {
    version: 0,
    category_id: category,
    input: JSON.stringify({
      sku: `Q30-${f.suffix}`,
      name: `Fictional thirty pillows ${f.suffix}`,
      track_mode: "quantity",
      active: true,
      staging_eligible: true,
      retail_eligible: true,
    }),
  });
  await c.mutation(api.inventory.receive, {
    product_id: product,
    location_id: location,
    quantity: 30,
    condition: "good",
    acquisition_date: day(),
    reason: "Fictional thirty-unit acceptance receipt",
  });
  const results: { name: string; passed: boolean }[] = [];
  const record = (name: string) => {
    results.push({ name, passed: true });
    console.log("PASS " + name);
  };
  const reserve = (
    project_id: Id<"projects">,
    project_room_id: Id<"project_rooms">,
    quantity: number,
  ) =>
    c.mutation(api.inventory.reserve, {
      project_id,
      project_room_id,
      product_id: product,
      location_id: location,
      quantity,
      needed_from: day(),
      needed_until: day(),
      planned: false,
      notes: "Fictional two-project allocation",
    });
  const r = await reserve(p, room, 10);
  await reserve(p2, room2, 8);
  const available = () =>
    c.query(api.inventory.availability, {
      product_id: product,
      location_id: location,
      needed_from: day(),
      needed_until: day(),
    });
  assert.equal((await available()).available, 12);
  assert.equal((await available()).stock!.available, 30);
  record(
    "30 received, A10 and B8 reserved, 12 free without physical depletion",
  );
  await assert.rejects(reserve(p2, room2, 13));
  record("over-reservation rejected against combined project demand");
  const rows = () => c.query(api.inventory.projectInventory, { project_id: p });
  const move = async (
    id: Id<"inventory_reservations">,
    action: "pick" | "install" | "destage" | "return" | "missing" | "found",
    quantity: number,
  ) => {
    const row = (await rows()).lines.find((r) => r._id === id)!;
    return c.mutation(api.inventory.moveReservation, {
      id,
      version: row.version,
      action,
      quantity,
      asset_confirmation: "",
      location_id: location,
      reason: "Fictional quantity reconciliation",
    });
  };
  const checks = async (category: string) => {
    for (const x of (await get()).checklist.filter(
      (x) => x.required && x.category === category,
    ))
      await c.mutation(api.operations.checklist, {
        id: x._id,
        version: x.version,
        status: "completed",
      });
  };
  const advance = async (
    status:
      | "designing"
      | "ready_to_schedule"
      | "staging"
      | "staged"
      | "listing_live"
      | "sold"
      | "destaging"
      | "completed",
    date?: string,
  ) =>
    c.mutation(api.operations.transition, {
      id: p,
      version: (await get()).version,
      status,
      date,
    });
  const historical = "2026-08-20";
  const schedule = async (type: "staging" | "destaging", hour: number) =>
    c.mutation(api.operations.schedule, {
      project_id: p,
      project_version: (await get()).version,
      version: 0,
      event_type: type,
      title: "Fictional quantity acceptance " + type,
      description: "Historical acceptance fixture",
      location_note: "",
      start_at: `${historical}T${hour}:00:00Z`,
      end_at: `${historical}T${hour}:30:00Z`,
      assigned_lead_id: f.createArgs.staging_lead_id!,
    });
  await advance("designing");
  await checks("pre_staging");
  await advance("ready_to_schedule");
  await schedule("staging", 10);
  await advance("staging");
  await move(r, "pick", 10);
  await move(r, "install", 10);
  assert.equal((await available()).stock!.available, 20);
  assert.equal((await available()).available, 12);
  record(
    "picking and installation preserve B's eight-unit reservation without double subtraction",
  );
  await checks("staging");
  await advance("staged");
  await advance("listing_live", historical);
  await advance("sold", historical);
  await schedule("destaging", 12);
  await checks("destaging");
  await advance("destaging");
  await move(r, "destage", 10);
  const returned = await move(r, "return", 9);
  await move(r, "missing", 1);
  assert.equal((await available()).stock!.inspection, 9);
  assert.equal((await available()).stock!.missing, 1);
  await assert.rejects(advance("completed"));
  record(
    "nine returned and one missing remain explicit; unreconciled completion denied",
  );
  await move(r, "found", 1);
  for (const id of [r, returned]) {
    const row = (await rows()).lines.find((x) => x._id === id)!;
    await c.mutation(api.inventory.inspect, {
      reservation_id: id,
      product_id: product,
      location_id: location,
      version: row.version,
      quantity: row.quantity,
      from_state: "inspection",
      result: "available",
      condition: "good",
      notes: "Fictional recovered and inspected units",
    });
  }
  assert.equal((await available()).stock!.available, 30);
  assert.equal((await available()).available, 22);
  await advance("completed");
  record(
    "recovery and inspections restore thirty physical units; B still protects eight",
  );
  await c.mutation(api.operations.transition, {
    id: p2,
    version: (await c.query(api.operations.get, { id: p2 })).version,
    status: "cancelled",
    reason: "Fictional quantity cleanup",
  });
  assert.equal((await available()).available, 30);
  record(
    "cancellation releases B's reservation without changing physical stock",
  );
  const totals: Record<string, number> = {};
  let cursor: string | null = null,
    done = false;
  while (!done) {
    const h: import("convex/server").FunctionReturnType<
      typeof api.inventory.history
    > = await c.query(api.inventory.history, {
      product_id: product,
      paginationOpts: { cursor, numItems: 20 },
    });
    for (const m of h.page)
      for (const d of m.stock_deltas)
        totals[d.bucket] = (totals[d.bucket] ?? 0) + d.delta;
    cursor = h.continueCursor;
    done = h.isDone;
  }
  const stock = (await available()).stock!;
  for (const bucket of [
    "available",
    "inspection",
    "cleaning",
    "repair",
    "damaged",
    "missing",
    "sold",
    "retired",
  ] as const)
    assert.equal(stock[bucket], totals[bucket] ?? 0);
  record(
    "every quantity bucket reconciles exactly to the append-only hosted ledger",
  );
  for (const id of [p, p2])
    await c.mutation(api.operations.archive, {
      id,
      version: (await c.query(api.operations.get, { id })).version,
      restore: false,
    });
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/m4-quantity-hosted.json",
    JSON.stringify(
      {
        deployment: "woozy-jaguar-392",
        executedAt: new Date().toISOString(),
        results,
      },
      null,
      2,
    ),
  );
  console.log(`${results.length}/${results.length} M4 quantity checks passed`);
}
main().catch((e) => {
  console.error(
    "M4 quantity acceptance failed" +
      ((e as { data?: { code?: string } }).data?.code
        ? ": " + (e as { data: { code: string } }).data.code
        : ""),
  );
  process.exitCode = 1;
});
