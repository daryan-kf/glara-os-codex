import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  assetStates,
  conditions,
  stockStates,
  reservationStates,
  movementTypes,
  locationTypes,
  damageStatuses,
} from "../src/lib/inventory/model";
const nullable = v.union(v.string(), v.null());
const asset = v.union(v.id("inventory_assets"), v.null());
const location = v.union(v.id("inventory_locations"), v.null());
const project = v.union(v.id("projects"), v.null());
const room = v.union(v.id("project_rooms"), v.null());
const reservation = v.union(v.id("inventory_reservations"), v.null());
const stamps = {
  created_at: v.string(),
  updated_at: v.string(),
  deleted_at: nullable,
};
export const inventoryTables = {
  inventory_categories: defineTable({
    name: v.string(),
    name_key: v.string(),
    active: v.boolean(),
    version: v.number(),
    ...stamps,
  })
    .index("by_name", ["name_key"])
    .index("by_active", ["active"]),
  inventory_locations: defineTable({
    name: v.string(),
    name_key: v.string(),
    type: v.union(...locationTypes.map((s) => v.literal(s))),
    address: v.string(),
    staging_source: v.boolean(),
    retail_source: v.boolean(),
    active: v.boolean(),
    version: v.number(),
    ...stamps,
  })
    .index("by_name", ["name_key"])
    .index("by_active", ["active"]),
  products: defineTable({
    sku: v.string(),
    name: v.string(),
    category_id: v.id("inventory_categories"),
    brand: v.string(),
    collection: v.string(),
    description: v.string(),
    color: v.string(),
    material: v.string(),
    dimensions: v.string(),
    weight: v.string(),
    track_mode: v.union(v.literal("serialized"), v.literal("quantity")),
    staging_eligible: v.boolean(),
    retail_eligible: v.boolean(),
    active: v.boolean(),
    search_text: v.string(),
    version: v.number(),
    ...stamps,
  })
    .index("by_sku", ["sku", "deleted_at"])
    .index("by_active", ["deleted_at", "active"])
    .index("by_category", ["category_id", "deleted_at"])
    .searchIndex("search", {
      searchField: "search_text",
      filterFields: ["deleted_at", "active", "category_id"],
    }),
  inventory_assets: defineTable({
    asset_number: v.string(),
    product_id: v.id("products"),
    location_id: location,
    project_id: project,
    project_room_id: room,
    status: v.union(...assetStates.map((s) => v.literal(s))),
    condition: v.union(...conditions.map((s) => v.literal(s))),
    staging_eligible: v.boolean(),
    acquisition_date: v.string(),
    staging_use_count: v.number(),
    last_inspected_at: nullable,
    notes: v.string(),
    version: v.number(),
    ...stamps,
  })
    .index("by_number", ["asset_number"])
    .index("by_product_location", ["product_id", "location_id", "deleted_at"])
    .index("by_product", ["product_id", "deleted_at"])
    .index("by_location", ["location_id", "status"])
    .index("by_status", ["status"]),
  inventory_stock: defineTable({
    product_id: v.id("products"),
    location_id: v.id("inventory_locations"),
    available: v.number(),
    inspection: v.number(),
    cleaning: v.number(),
    repair: v.number(),
    damaged: v.number(),
    missing: v.number(),
    sold: v.number(),
    retired: v.number(),
    version: v.number(),
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_product_location", ["product_id", "location_id"])
    .index("by_location", ["location_id"])
    .index("by_missing", ["missing"]),
  inventory_counters: defineTable({ key: v.string(), value: v.number() }).index(
    "by_key",
    ["key"],
  ),
  inventory_reservations: defineTable({
    product_id: v.id("products"),
    asset_id: asset,
    location_id: v.id("inventory_locations"),
    return_location_id: location,
    project_id: v.id("projects"),
    project_room_id: v.id("project_rooms"),
    parent_id: reservation,
    quantity: v.number(),
    state: v.union(...reservationStates.map((s) => v.literal(s))),
    active: v.boolean(),
    needed_from: v.string(),
    needed_until: v.string(),
    reserved_at: v.string(),
    reserved_by: v.id("users"),
    notes: v.string(),
    exception: v.string(),
    exception_approved: v.boolean(),
    installed_at: v.optional(v.string()),
    return_outcome: v.optional(
      v.union(
        v.literal("good"),
        v.literal("damaged"),
        v.literal("cleaning"),
        v.literal("repair"),
      ),
    ),
    version: v.number(),
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_product", ["product_id", "active"])
    .index("by_asset", ["asset_id", "active"])
    .index("by_project", ["project_id"])
    .index("by_room", ["project_room_id", "active"])
    .index("by_location", ["location_id", "active"])
    .index("by_state", ["state", "active"]),
  inventory_movements: defineTable({
    product_id: v.id("products"),
    asset_id: asset,
    quantity: v.number(),
    from_location_id: location,
    to_location_id: location,
    project_id: project,
    project_room_id: room,
    reservation_id: reservation,
    movement_type: v.union(...movementTypes.map((s) => v.literal(s))),
    reason: v.string(),
    actor_id: v.id("users"),
    occurred_at: v.string(),
    created_at: v.string(),
    stock_deltas: v.array(
      v.object({
        location_id: v.id("inventory_locations"),
        bucket: v.union(...stockStates.map((s) => v.literal(s))),
        delta: v.number(),
      }),
    ),
  })
    .index("by_product", ["product_id"])
    .index("by_asset", ["asset_id"])
    .index("by_project", ["project_id"]),
  inventory_inspections: defineTable({
    product_id: v.id("products"),
    asset_id: asset,
    reservation_id: reservation,
    project_id: project,
    location_id: v.id("inventory_locations"),
    quantity: v.number(),
    condition_before: nullable,
    condition_after: v.union(...conditions.map((s) => v.literal(s))),
    result: v.union(
      v.literal("available"),
      v.literal("cleaning"),
      v.literal("repair"),
      v.literal("damaged"),
      v.literal("retired"),
    ),
    notes: v.string(),
    inspected_by: v.id("users"),
    inspected_at: v.string(),
  })
    .index("by_asset", ["asset_id"])
    .index("by_product", ["product_id"])
    .index("by_project", ["project_id"]),
  inventory_damage: defineTable({
    product_id: v.id("products"),
    asset_id: asset,
    reservation_id: reservation,
    project_id: project,
    project_room_id: room,
    quantity: v.number(),
    damage_type: v.string(),
    severity: v.union(
      v.literal("minor"),
      v.literal("major"),
      v.literal("critical"),
    ),
    description: v.string(),
    status: v.union(...damageStatuses.map((s) => v.literal(s))),
    resolution: v.string(),
    discovered_at: v.string(),
    discovered_by: v.id("users"),
    version: v.number(),
    created_at: v.string(),
    updated_at: v.string(),
  })
    .index("by_asset", ["asset_id"])
    .index("by_product", ["product_id"])
    .index("by_project", ["project_id"])
    .index("by_status", ["status"]),
};
