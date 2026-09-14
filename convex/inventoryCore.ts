import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { deny, requireRoles } from "./access";
import { context, now, type Ctx } from "./operationsCore";
import {
  peakDemand,
  usable,
  type StockState,
  type ReservationState,
  liveReservation,
} from "../src/lib/inventory/model";

export const catalogUser = (ctx: Ctx) =>
  requireRoles(ctx, ["owner", "admin", "designer"]);
export const manager = (ctx: Ctx) => requireRoles(ctx, ["owner", "admin"]);
export async function projectUser(
  ctx: Ctx,
  id: Id<"projects">,
  edit = false,
  design = false,
) {
  const u = await requireRoles(
    ctx,
    design
      ? ["owner", "admin", "designer"]
      : ["owner", "admin", "designer", "staging_crew"],
  );
  const data = await context(
    ctx,
    id,
    design ? ["manage", "design"] : ["manage", "design", "crew"],
    edit,
  );
  return { ...data, u };
}
export async function activeProduct(ctx: Ctx, id: Id<"products">) {
  const p = await ctx.db.get(id);
  if (!p || p.deleted_at || !p.active)
    return deny("UNAVAILABLE", "Product unavailable.");
  return p;
}
export async function activeLocation(ctx: Ctx, id: Id<"inventory_locations">) {
  const l = await ctx.db.get(id);
  if (!l || l.deleted_at || !l.active)
    return deny("UNAVAILABLE", "Location unavailable.");
  return l;
}
export async function projectLines(ctx: Ctx, id: Id<"projects">) {
  const rows = await ctx.db
    .query("inventory_reservations")
    .withIndex("by_project", (q) => q.eq("project_id", id))
    .take(201);
  if (rows.length > 200) deny("LIMIT", "Project inventory limit reached.");
  return rows;
}
export async function productLines(ctx: Ctx, id: Id<"products">) {
  const rows = await ctx.db
    .query("inventory_reservations")
    .withIndex("by_product", (q) => q.eq("product_id", id).eq("active", true))
    .take(401);
  if (rows.length > 400) deny("LIMIT", "Inventory allocation limit reached.");
  return rows;
}
export async function assetLines(ctx: Ctx, id: Id<"inventory_assets">) {
  const rows = await ctx.db
    .query("inventory_reservations")
    .withIndex("by_asset", (q) => q.eq("asset_id", id).eq("active", true))
    .take(101);
  if (rows.length > 100) deny("LIMIT", "Asset allocation limit reached.");
  return rows;
}
export async function balance(
  ctx: Ctx,
  product: Id<"products">,
  location: Id<"inventory_locations">,
) {
  return ctx.db
    .query("inventory_stock")
    .withIndex("by_product_location", (q) =>
      q.eq("product_id", product).eq("location_id", location),
    )
    .unique();
}
export async function changeBalance(
  ctx: MutationCtx,
  product: Id<"products">,
  location: Id<"inventory_locations">,
  bucket: StockState,
  delta: number,
) {
  const row = await balance(ctx, product, location);
  const next = (row?.[bucket] ?? 0) + delta;
  if (!Number.isSafeInteger(next) || next < 0 || next > 1000000)
    deny("STOCK_CONFLICT", "Insufficient usable stock.");
  if (row)
    await ctx.db.patch(row._id, {
      [bucket]: next,
      version: row.version + 1,
      updated_at: now(),
    });
  else
    await ctx.db.insert("inventory_stock", {
      product_id: product,
      location_id: location,
      available: 0,
      inspection: 0,
      cleaning: 0,
      repair: 0,
      damaged: 0,
      missing: 0,
      sold: 0,
      retired: 0,
      [bucket]: next,
      version: 1,
      created_at: now(),
      updated_at: now(),
    });
}
export async function movement(
  ctx: MutationCtx,
  actor: Id<"users">,
  data: Omit<
    Doc<"inventory_movements">,
    "_id" | "_creationTime" | "actor_id" | "occurred_at" | "created_at"
  >,
) {
  for (const delta of data.stock_deltas)
    await changeBalance(
      ctx,
      data.product_id,
      delta.location_id,
      delta.bucket,
      delta.delta,
    );
  const id = await ctx.db.insert("inventory_movements", {
    ...data,
    actor_id: actor,
    occurred_at: now(),
    created_at: now(),
  });
  await ctx.db.insert("audit_logs", {
    actor_id: actor,
    entity: "inventory",
    entity_id: data.asset_id ?? data.product_id,
    action: data.movement_type,
    old_value: null,
    new_value: {
      movement_id: id,
      quantity: data.quantity,
      project_id: data.project_id,
    },
    created_at: now(),
  });
  return id;
}
export async function audit(
  ctx: MutationCtx,
  actor: Id<"users">,
  id: string,
  action: string,
  previous: unknown,
  next: unknown,
) {
  await ctx.db.insert("audit_logs", {
    actor_id: actor,
    entity: "inventory",
    entity_id: id,
    action,
    old_value: previous,
    new_value: next,
    created_at: now(),
  });
}
export async function available(
  ctx: Ctx,
  product: Doc<"products">,
  location: Id<"inventory_locations">,
  from: string,
  until: string,
  assetId?: Id<"inventory_assets">,
  exclude?: Id<"inventory_reservations">,
  allocated?: Doc<"inventory_reservations">[],
) {
  const l = await activeLocation(ctx, location);
  if (!product.staging_eligible || !l.staging_source) return 0;
  if (product.track_mode === "serialized") {
    if (!assetId) return 0;
    const a = await ctx.db.get(assetId);
    if (
      !a ||
      a.deleted_at ||
      a.product_id !== product._id ||
      a.location_id !== location ||
      a.status !== "available" ||
      !a.staging_eligible ||
      !usable(a.condition)
    )
      return 0;
    const rows = (allocated ?? (await assetLines(ctx, assetId))).filter(
      (r) => r._id !== exclude && r.state !== "planned",
    );
    return rows.some(
      (r) =>
        r.state !== "reserved" ||
        (r.needed_from <= until && r.needed_until >= from),
    )
      ? 0
      : 1;
  }
  const stock = await balance(ctx, product._id, location);
  const reservations = (
    allocated ?? (await productLines(ctx, product._id))
  ).filter(
    (r) =>
      r._id !== exclude && r.location_id === location && r.state === "reserved",
  );
  return Math.max(
    0,
    (stock?.available ?? 0) - peakDemand(reservations, from, until),
  );
}
/** A permanent removal must preserve every future reservation, not just today's. */
export async function removable(
  ctx: Ctx,
  product: Id<"products">,
  location: Id<"inventory_locations">,
) {
  const stock = await balance(ctx, product, location);
  const reservations = (await productLines(ctx, product)).filter(
    (r) => r.location_id === location && r.state === "reserved",
  );
  return Math.max(
    0,
    (stock?.available ?? 0) -
      peakDemand(reservations, "0000-01-01", "9999-12-31"),
  );
}
export async function splitLine(
  ctx: MutationCtx,
  line: Doc<"inventory_reservations">,
  quantity: number,
  state: ReservationState,
  patch: Partial<
    Pick<
      Doc<"inventory_reservations">,
      | "return_location_id"
      | "exception"
      | "exception_approved"
      | "installed_at"
      | "return_outcome"
    >
  > = {},
) {
  if (
    quantity > line.quantity ||
    quantity < 1 ||
    !Number.isSafeInteger(quantity) ||
    (line.asset_id && quantity !== 1)
  )
    deny("INVALID_INPUT", "Review the quantity.");
  if (quantity === line.quantity) {
    await ctx.db.patch(line._id, {
      state,
      active: liveReservation(state),
      exception_approved:
        state === line.state ? line.exception_approved : false,
      ...patch,
      updated_at: now(),
      version: line.version + 1,
    });
    return line._id;
  }
  if ((await projectLines(ctx, line.project_id)).length >= 200)
    deny("LIMIT", "Project inventory limit reached.");
  if (
    liveReservation(state) &&
    (await productLines(ctx, line.product_id)).length >= 400
  )
    deny("LIMIT", "Product allocation limit reached.");
  const { _id, _creationTime, ...fields } = line;
  void _creationTime;
  await ctx.db.patch(_id, {
    quantity: line.quantity - quantity,
    updated_at: now(),
    version: line.version + 1,
  });
  return ctx.db.insert("inventory_reservations", {
    ...fields,
    parent_id: line.parent_id ?? _id,
    quantity,
    state,
    active: liveReservation(state),
    exception_approved: state === line.state ? line.exception_approved : false,
    ...patch,
    version: 1,
    created_at: now(),
    updated_at: now(),
  });
}
export async function inventoryGate(
  ctx: Ctx,
  project: Id<"projects">,
  stage: "staged" | "completed" | "cancelled" | "archive",
) {
  const rows = await projectLines(ctx, project);
  const unresolved = rows.filter((r) => liveReservation(r.state));
  const blocked =
    stage === "staged"
      ? unresolved.some((r) => r.state !== "installed" && !r.exception_approved)
      : stage === "completed"
        ? unresolved.some(
            (r) =>
              [
                "planned",
                "reserved",
                "picked",
                "installed",
                "returning",
              ].includes(r.state) ||
              (r.state === "missing" && !r.exception_approved) ||
              (r.state === "damaged" && !r.return_location_id),
          )
        : unresolved.length > 0;
  if (blocked)
    deny(
      "INVENTORY_GATE",
      "Reconcile project inventory before this transition.",
    );
}

/** Cancellation releases commitments only; physical inventory must be reconciled first. */
export async function cancelInventory(
  ctx: MutationCtx,
  project: Id<"projects">,
  actor: Id<"users">,
) {
  const rows = (await projectLines(ctx, project)).filter((r) => r.active);
  if (rows.some((r) => !["planned", "reserved"].includes(r.state)))
    deny(
      "INVENTORY_GATE",
      "Reconcile picked and installed inventory before cancellation.",
    );
  for (const r of rows) {
    await splitLine(ctx, r, r.quantity, "released");
    await movement(ctx, actor, {
      product_id: r.product_id,
      asset_id: r.asset_id,
      quantity: r.quantity,
      from_location_id: null,
      to_location_id: null,
      project_id: project,
      project_room_id: r.project_room_id,
      reservation_id: r._id,
      movement_type: "release_reservation",
      reason: "Project cancelled before pickup.",
      stock_deltas: [],
    });
  }
}
