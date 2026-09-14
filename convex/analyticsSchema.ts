import { defineTable } from "convex/server";
import { v } from "convex/values";
export const dimensionsValue = v.object({
  salesperson: v.optional(v.string()),
  realtor: v.optional(v.string()),
  lead_source: v.optional(v.string()),
  city: v.optional(v.string()),
  project: v.optional(v.string()),
  product: v.optional(v.string()),
  category: v.optional(v.string()),
  method: v.optional(v.string()),
  due_date: v.optional(v.string()),
});
export const eventContextFields = {
  event_contexts: v.optional(
    v.record(
      v.string(),
      v.object({ event_at: v.string(), dimensions: dimensionsValue }),
    ),
  ),
};
export const analyticsTables = {
  analytics_reconciliations: defineTable({
    actor_id: v.id("users"),
    status: v.string(),
    phase: v.string(),
    table_index: v.number(),
    cursor: v.union(v.string(), v.null()),
    revision: v.number(),
    scanned: v.number(),
    source_drift: v.number(),
    bucket_drift: v.number(),
    created_at: v.string(),
    completed_at: v.union(v.string(), v.null()),
  }),
  analytics_expected: defineTable({
    run_id: v.id("analytics_reconciliations"),
    key: v.string(),
    grain: v.string(),
    period: v.string(),
    metric: v.string(),
    dimension: v.string(),
    member: v.string(),
    value: v.string(),
    actual: v.optional(v.string()),
    checked: v.boolean(),
  })
    .index("by_run_key", ["run_id", "key"])
    .index("by_run_checked", ["run_id", "checked"]),
  analytics_changes: defineTable({
    source_table: v.string(),
    source_id: v.string(),
    version: v.number(),
    actor_id: v.union(v.id("users"), v.null()),
    reason: v.string(),
    changes: v.array(
      v.object({
        key: v.string(),
        old_day: v.union(v.string(), v.null()),
        new_day: v.union(v.string(), v.null()),
        old_value: v.union(v.string(), v.null()),
        new_value: v.union(v.string(), v.null()),
      }),
    ),
    created_at: v.string(),
  })
    .index("by_source", ["source_table", "source_id"])
    .index("by_created", ["created_at"]),
  analytics_facts: defineTable({
    source_table: v.string(),
    source_id: v.string(),
    key: v.string(),
    metric: v.string(),
    scope: v.union(
      v.literal("flow"),
      v.literal("outcome"),
      v.literal("current"),
    ),
    event_at: v.string(),
    precision: v.union(v.literal("instant"), v.literal("business_date")),
    day: v.string(),
    month: v.string(),
    value: v.string(),
    dimensions: dimensionsValue,
    href: v.string(),
    label: v.string(),
    version: v.number(),
    active: v.boolean(),
    processed_at: v.string(),
  })
    .index("by_source", ["source_table", "source_id"])
    .index("by_metric_day", ["metric", "active", "day"])
    .index("by_metric_month", ["metric", "active", "month"])
    .index("by_salesperson", [
      "dimensions.salesperson",
      "metric",
      "active",
      "day",
    ])
    .index("by_realtor", ["dimensions.realtor", "metric", "active", "day"])
    .index("by_lead_source", [
      "dimensions.lead_source",
      "metric",
      "active",
      "day",
    ])
    .index("by_city", ["dimensions.city", "metric", "active", "day"])
    .index("by_project", ["dimensions.project", "metric", "active", "day"])
    .index("by_product", ["dimensions.product", "metric", "active", "day"]),
  analytics_buckets: defineTable({
    key: v.string(),
    grain: v.string(),
    period: v.string(),
    metric: v.string(),
    dimension: v.string(),
    member: v.string(),
    value: v.string(),
    version: v.number(),
    processed_at: v.string(),
  })
    .index("by_key", ["key"])
    .index("by_period", ["grain", "period", "dimension", "member"])
    .index("by_metric", ["grain", "metric", "dimension", "member", "period"])
    .index("by_members", ["grain", "period", "metric", "dimension"]),
  analytics_settings: defineTable({
    key: v.string(),
    minimum: v.number(),
    target: v.number(),
    stretch: v.number(),
    unused_days: v.number(),
    stale_sales_days: v.number(),
    high_value_cents: v.string(),
    vip_projects: v.number(),
    vip_value_cents: v.string(),
    dormant_days: v.number(),
    version: v.number(),
    updated_at: v.string(),
  }).index("by_key", ["key"]),
  analytics_state: defineTable({
    key: v.string(),
    ready: v.boolean(),
    revision: v.number(),
    source_through: v.string(),
    backfill_complete: v.optional(v.boolean()),
    backfill_table: v.optional(v.string()),
    backfill_cursor: v.optional(v.union(v.string(), v.null())),
  }).index("by_key", ["key"]),
};
