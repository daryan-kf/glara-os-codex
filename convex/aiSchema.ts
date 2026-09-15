import { defineTable } from "convex/server";
import { v } from "convex/values";
export const scopeValue = v.object({
  feature: v.union(
    ...[
      "general",
      "executive",
      "realtor",
      "opportunity",
      "project",
      "inventory",
      "asset",
      "commercial",
      "automation",
      "marketing",
      "navigation",
    ].map((x) => v.literal(x)),
  ),
  entity_id: v.string(),
  period: v.string(),
  from: v.string(),
  until: v.string(),
  location_id: v.string(),
});
export const aiTables = {
  ai_settings: defineTable({
    key: v.literal("main"),
    config: v.string(),
    version: v.number(),
    updated_by: v.id("users"),
    updated_at: v.number(),
  }).index("by_key", ["key"]),
  ai_conversations: defineTable({
    user_id: v.id("users"),
    scope: scopeValue,
    title: v.string(),
    role_stamp: v.optional(v.string()),
    created_at: v.number(),
    updated_at: v.number(),
    archived: v.boolean(),
    turns: v.number(),
    purged: v.optional(v.boolean()),
    purged_at: v.optional(v.number()),
  })
    .index("by_user", ["user_id", "archived", "updated_at"])
    .index("by_retention", ["purged", "updated_at"]),
  ai_requests: defineTable({
    user_id: v.id("users"),
    conversation_id: v.id("ai_conversations"),
    request_key: v.string(),
    scope: scopeValue,
    question: v.string(),
    role_stamp: v.string(),
    context_digest: v.string(),
    evidence: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("failed"),
      v.literal("cancelled"),
    ),
    output: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
    created_at: v.number(),
    started_at: v.union(v.number(), v.null()),
    completed_at: v.union(v.number(), v.null()),
    retrieval_ms: v.number(),
    provider_ms: v.number(),
    input_tokens: v.number(),
    output_tokens: v.number(),
    reserved_micros: v.number(),
    charged_micros: v.number(),
    provider: v.string(),
    model: v.string(),
    config: v.string(),
    day: v.string(),
    month: v.string(),
    feedback: v.union(v.string(), v.null()),
    feedback_reason: v.union(v.string(), v.null()),
  })
    .index("by_key", ["user_id", "request_key"])
    .index("by_created", ["created_at"])
    .index("by_conversation", ["conversation_id", "created_at"])
    .index("by_user_day", ["user_id", "day"])
    .index("by_status", ["status", "created_at"]),
  ai_usage: defineTable({
    key: v.string(),
    requests: v.number(),
    reserved_micros: v.number(),
    charged_micros: v.number(),
    input_tokens: v.number(),
    output_tokens: v.number(),
    latency_ms: v.number(),
    failures: v.number(),
    invalid_outputs: v.number(),
  }).index("by_key", ["key"]),
  ai_action_proposals: defineTable({
    request_id: v.id("ai_requests"),
    user_id: v.id("users"),
    scope: scopeValue,
    type: v.literal("create_activity"),
    payload: v.string(),
    original_payload: v.string(),
    rationale: v.string(),
    evidence_keys: v.array(v.string()),
    context_digest: v.string(),
    role_stamp: v.string(),
    status: v.union(
      v.literal("proposed"),
      v.literal("rejected"),
      v.literal("expired"),
      v.literal("executed"),
    ),
    created_at: v.number(),
    expires_at: v.number(),
    executed_at: v.union(v.number(), v.null()),
    executed_by: v.union(v.id("users"), v.null()),
    result_id: v.union(v.string(), v.null()),
    edited: v.boolean(),
  })
    .index("by_request", ["request_id"])
    .index("by_user", ["user_id", "status", "created_at"]),
};
