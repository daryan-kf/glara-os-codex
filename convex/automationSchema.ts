import { defineTable } from "convex/server";
import { v } from "convex/values";
import { sourceTables, domains } from "../src/lib/automation/model";
export const sourceTable = v.union(...sourceTables.map((t) => v.literal(t)));
export const domain = v.union(...domains.map((t) => v.literal(t)));
const nullable = v.union(v.string(), v.null());
export const config = v.object({
  enabled: v.boolean(),
  entity_ids: v.optional(v.array(v.string())),
  delay_days: v.number(),
  cooldown_days: v.number(),
  priority: v.union(
    v.literal("normal"),
    v.literal("high"),
    v.literal("urgent"),
  ),
  assignment: v.union(
    v.literal("entity_owner"),
    v.literal("project_manager"),
    v.literal("admin"),
    v.literal("owner"),
    v.literal("specific_user"),
  ),
  user_id: nullable,
  escalation_days: v.array(v.number()),
  minimum_cents: v.string(),
  activation: v.union(v.literal("current"), v.literal("future")),
  daily_limit: v.number(),
});
export const automationTables = {
  automation_rules: defineTable({
    key: v.string(),
    config,
    version: v.number(),
    enabled_at: v.number(),
    created_by: v.id("users"),
    updated_by: v.id("users"),
    created_at: v.string(),
    updated_at: v.string(),
    deleted_at: nullable,
  }).index("by_key", ["key"]),
  automation_rule_versions: defineTable({
    rule_id: v.id("automation_rules"),
    version: v.number(),
    config,
    actor_id: v.id("users"),
    created_at: v.string(),
  }).index("by_rule_version", ["rule_id", "version"]),
  automation_queue: defineTable({
    table: sourceTable,
    entity_id: v.string(),
    due_at: v.number(),
    generation: v.number(),
    attempts: v.number(),
    status: v.union(v.literal("pending"), v.literal("failed")),
    last_code: nullable,
    last_attempt: v.union(v.number(), v.null()),
    observed_at: v.number(),
  })
    .index("by_source", ["table", "entity_id"])
    .index("by_due", ["status", "due_at"]),
  automation_actions: defineTable({
    key: v.string(),
    table: sourceTable,
    entity_id: v.string(),
    family: v.string(),
    domain,
    rule_id: v.id("automation_rules"),
    rule_version: v.number(),
    cycle: v.number(),
    trigger: v.string(),
    reason: v.string(),
    href: v.string(),
    impact_cents: v.string(),
    impact_key: v.string(),
    priority_rank: v.number(),
    order_at: v.number(),
    priority: v.string(),
    status: v.union(v.literal("active"), v.literal("resolved")),
    activity_id: v.id("activities"),
    assigned_to: v.id("users"),
    level: v.number(),
    snoozed_until: v.number(),
    created_at: v.number(),
    updated_at: v.number(),
    resolved_at: v.union(v.number(), v.null()),
    resolution: nullable,
    execution_id: v.union(v.id("automation_executions"), v.null()),
    task_completed_at: v.union(v.number(), v.null()),
    next_cycle_at: v.number(),
  })
    .index("by_key", ["key", "status"])
    .index("by_source", ["table", "entity_id", "status"])
    .index("by_status", ["status", "priority_rank", "impact_key", "order_at"])
    .index("by_assigned", [
      "assigned_to",
      "status",
      "priority_rank",
      "impact_key",
      "order_at",
    ])
    .index("by_activity", ["activity_id"])
    .index("by_rule", ["rule_id", "created_at"]),
  automation_executions: defineTable({
    dedupe_key: v.string(),
    rule_id: v.id("automation_rules"),
    rule_version: v.number(),
    config,
    table: sourceTable,
    entity_id: v.string(),
    action_id: v.union(v.id("automation_actions"), v.null()),
    actor_id: v.union(v.id("users"), v.null()),
    actor_kind: v.union(v.literal("system"), v.literal("user")),
    status: v.string(),
    trigger: v.string(),
    reason: v.string(),
    evaluated_at: v.number(),
  })
    .index("by_dedupe", ["dedupe_key"])
    .index("by_source", ["table", "entity_id", "evaluated_at"])
    .index("by_rule", ["rule_id", "evaluated_at"])
    .index("by_status", ["status", "evaluated_at"]),
  automation_suppressions: defineTable({
    key: v.string(),
    until: v.number(),
    reason: v.string(),
    actor_id: v.id("users"),
    created_at: v.number(),
  }).index("by_key", ["key"]),
  automation_escalations: defineTable({
    action_id: v.id("automation_actions"),
    cycle: v.number(),
    level: v.number(),
    from_user: v.id("users"),
    to_user: v.id("users"),
    created_at: v.number(),
  }).index("by_action", ["action_id", "cycle", "level"]),
  notifications: defineTable({
    action_id: v.id("automation_actions"),
    recipient_id: v.id("users"),
    created_at: v.number(),
    read_at: v.union(v.number(), v.null()),
    resolved_at: v.union(v.number(), v.null()),
  })
    .index("by_action", ["action_id", "recipient_id"])
    .index("by_recipient", ["recipient_id", "resolved_at", "created_at"]),
  automation_limits: defineTable({
    day: v.string(),
    key: v.string(),
    count: v.number(),
    paused: v.boolean(),
  })
    .index("by_key", ["key"])
    .index("by_day_paused", ["day", "paused"]),
  automation_scan: defineTable({
    key: v.string(),
    table_index: v.number(),
    cursor: nullable,
    finished: v.boolean(),
    updated_at: v.number(),
  }).index("by_key", ["key"]),
};
