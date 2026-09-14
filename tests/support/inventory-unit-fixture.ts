import type { FunctionArgs } from "convex/server";
import { operationsFixture } from "../support/operations-unit-fixture";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { day } from "../../src/lib/operations/model";
export async function inventoryFixture(
  mode: "quantity" | "serialized" = "quantity",
) {
  const f = await operationsFixture(),
    owner = f.c("owner"),
    project = await f.create();
  const room = (await f.get(project)).rooms[0]._id;
  const category = await owner.mutation(api.inventory.saveCategory, {
    name: "Chairs",
    active: true,
    version: 0,
  });
  const location = await owner.mutation(api.inventory.saveLocation, {
    version: 0,
    input: JSON.stringify({
      name: "Fictional warehouse",
      type: "warehouse",
      address: "Fictional",
      active: true,
      staging_source: true,
      retail_source: true,
    }),
  });
  const product = await owner.mutation(api.inventory.saveProduct, {
    category_id: category,
    version: 0,
    input: JSON.stringify({
      sku: " test-chair ",
      name: "Fictional chair",
      track_mode: mode,
      staging_eligible: true,
      retail_eligible: true,
      active: true,
    }),
  });
  const asset = await owner.mutation(api.inventory.receive, {
    product_id: product,
    location_id: location,
    quantity: mode === "quantity" ? 10 : 1,
    condition: "good",
    acquisition_date: day(),
    reason: "Fictional receipt",
  });
  const reserve = (n: number, from = day(), until = "2099-01-01") =>
    owner.mutation(api.inventory.reserve, {
      project_id: project,
      project_room_id: room,
      product_id: product,
      location_id: location,
      asset_id: asset ?? undefined,
      quantity: n,
      needed_from: from,
      needed_until: until,
      notes: "",
      planned: false,
    });
  const getLine = async (id: Id<"inventory_reservations">) =>
    (
      await owner.query(api.inventory.projectInventory, { project_id: project })
    ).lines.find((r) => r._id === id)!;
  const move = async (
    id: Id<"inventory_reservations">,
    action: FunctionArgs<typeof api.inventory.moveReservation>["action"],
    n = 1,
  ) => {
    const row = await getLine(id);
    return owner.mutation(api.inventory.moveReservation, {
      id,
      version: row.version,
      action,
      quantity: n,
      asset_confirmation: row.asset_number ?? "",
      location_id: location,
      reason: "Fictional acceptance movement",
    });
  };
  const availability = (from = day(), until = "2099-01-01") =>
    owner.query(api.inventory.availability, {
      product_id: product,
      location_id: location,
      needed_from: from,
      needed_until: until,
    });
  const stage = (status: "scheduled" | "staging" | "destaging" | "completed") =>
    f.t.run(async (ctx) => {
      await ctx.db.patch(project, { status });
    });
  const inspect = async (
    id: Id<"inventory_reservations">,
    result: "available" | "cleaning" | "repair" | "damaged" | "retired",
    count = 1,
  ) => {
    const r = await getLine(id);
    return owner.mutation(api.inventory.inspect, {
      reservation_id: id,
      asset_id: asset ?? undefined,
      product_id: product,
      location_id: location,
      version: r.version,
      quantity: count,
      from_state: r.state as "inspection",
      result,
      condition: "good",
      notes: "Fictional inspection",
    });
  };
  return {
    ...f,
    owner,
    project,
    room,
    category,
    location,
    product,
    asset,
    reserve,
    getLine,
    move,
    availability,
    stage,
    inspect,
  };
}
