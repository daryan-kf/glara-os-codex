import { defineTable } from "convex/server";
import { v } from "convex/values";
export const calendarSource = v.union(
  v.object({
    type: v.literal("operations_event"),
    id: v.id("operations_events"),
  }),
  v.object({ type: v.literal("consultation"), id: v.id("consultations") }),
);
export const projectionValue = v.object({
  title: v.string(),
  location: v.string(),
  start: v.string(),
  end: v.string(),
  cancelled: v.boolean(),
  revision: v.number(),
});
export const calendarTables = {
  calendar_connections: defineTable({
    key: v.literal("development"),
    provider: v.literal("google"),
    calendar_id: v.string(),
    enabled: v.boolean(),
    version: v.number(),
    created_by: v.id("users"),
    created_at: v.number(),
    updated_at: v.number(),
  }).index("by_key", ["key"]),
  calendar_projections: defineTable({
    source: calendarSource,
    source_key: v.string(),
    connection_id: v.id("calendar_connections"),
    external_id: v.string(),
    status: v.union(
      v.literal("pending"),
      v.literal("syncing"),
      v.literal("synced"),
      v.literal("failed"),
      v.literal("conflict"),
      v.literal("unknown"),
      v.literal("cancelled"),
      v.literal("ignored"),
    ),
    snapshot: projectionValue,
    provider_etag: v.optional(v.string()),
    version: v.number(),
    lease_until: v.optional(v.number()),
    last_sync_at: v.optional(v.number()),
    last_code: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
  })
    .index("by_source", ["source_key", "connection_id"])
    .index("by_external", ["external_id"])
    .index("by_status", ["status", "updated_at"]),
  calendar_sync_events: defineTable({
    projection_id: v.id("calendar_projections"),
    actor_id: v.id("users"),
    action: v.string(),
    result: v.string(),
    source_revision: v.number(),
    created_at: v.number(),
  }).index("by_projection", ["projection_id", "created_at"]),
  calendar_conflicts: defineTable({
    projection_id: v.id("calendar_projections"),
    observed_etag: v.string(),
    reason: v.string(),
    resolved_at: v.optional(v.number()),
    resolved_by: v.optional(v.id("users")),
    resolution: v.optional(
      v.union(v.literal("keep_glara"), v.literal("ignore")),
    ),
    created_at: v.number(),
  }).index("by_projection", ["projection_id", "created_at"]),
};
