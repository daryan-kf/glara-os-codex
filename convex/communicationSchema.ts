import { kinds } from "../src/lib/communications/model";
import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  categories,
  states,
  bases,
  scopes,
} from "../src/lib/communications/model";
export const categoryValue = v.union(...categories.map(v.literal));
export const scopeValue = v.union(...scopes.map(v.literal));
export const recipientValue = v.union(
  v.object({ type: v.literal("realtor"), id: v.id("realtors") }),
  v.object({ type: v.literal("customer"), id: v.id("commercial_customers") }),
);
export const sourceValue = v.union(
  v.object({ type: v.literal("realtor"), id: v.id("realtors") }),
  v.object({ type: v.literal("opportunity"), id: v.id("opportunities") }),
  v.object({ type: v.literal("quote"), id: v.id("quotes") }),
  v.object({ type: v.literal("consultation"), id: v.id("consultations") }),
  v.object({ type: v.literal("project"), id: v.id("projects") }),
  v.object({ type: v.literal("invoice"), id: v.id("invoices") }),
  v.object({ type: v.literal("payment"), id: v.id("payments") }),
);
const stamp = {
  created_at: v.number(),
  updated_at: v.number(),
  version: v.number(),
};
export const communicationTables = {
  communications: defineTable({
    kind: v.union(...kinds.map(v.literal)),
    recipient: recipientValue,
    recipient_key: v.string(),
    source: sourceValue,
    source_key: v.string(),
    category: categoryValue,
    subject: v.string(),
    body: v.string(),
    status: v.union(...states.map(v.literal)),
    requested_by: v.id("users"),
    approved_by: v.optional(v.id("users")),
    template_version_id: v.optional(v.id("communication_template_versions")),
    activity_id: v.optional(v.id("activities")),
    ai_draft_id: v.optional(v.id("ai_requests")),
    send_key: v.string(),
    scheduled_at: v.number(),
    deleted_at: v.optional(v.number()),
    decision_id: v.optional(v.id("communication_eligibility_decisions")),
    snapshot: v.optional(
      v.object({
        email: v.string(),
        name: v.string(),
        subject: v.string(),
        body: v.string(),
        source_fingerprint: v.string(),
        signature: v.string(),
        template_version_id: v.optional(
          v.id("communication_template_versions"),
        ),
      }),
    ),
    ...stamp,
  })
    .index("by_recipient", ["recipient_key", "created_at"])
    .index("by_source", ["source_key", "created_at"])
    .index("by_status", ["status", "scheduled_at"])
    .index("by_requester", ["requested_by", "created_at"])
    .index("by_requester_status", ["requested_by", "status", "created_at"])
    .index("by_send_key", ["send_key"])
    .index("by_activity", ["activity_id", "created_at"])
    .searchIndex("search_subject", {
      searchField: "subject",
      filterFields: [
        "requested_by",
        "status",
        "category",
        "source_key",
        "recipient_key",
      ],
    }),
  communication_templates: defineTable({
    key: v.string(),
    name: v.string(),
    category: categoryValue,
    active: v.boolean(),
    current_version_id: v.optional(v.id("communication_template_versions")),
    ...stamp,
  })
    .index("by_key", ["key"])
    .index("by_active", ["active"]),
  communication_template_versions: defineTable({
    template_id: v.id("communication_templates"),
    revision: v.number(),
    subject: v.string(),
    body: v.string(),
    created_by: v.id("users"),
    created_at: v.number(),
  }).index("by_template", ["template_id", "revision"]),
  communication_preferences: defineTable({
    recipient_key: v.string(),
    channel: v.literal("email"),
    scope: scopeValue,
    status: v.union(
      v.literal("allowed"),
      v.literal("unsubscribed"),
      v.literal("unknown"),
    ),
    recorded_by: v.optional(v.id("users")),
    reason: v.string(),
    ...stamp,
  }).index("by_recipient", ["recipient_key", "channel", "scope"]),
  communication_consents: defineTable({
    recipient_key: v.string(),
    scope: scopeValue,
    basis: v.union(...bases.map(v.literal)),
    evidence: v.string(),
    source: v.string(),
    observed_at: v.number(),
    expires_at: v.optional(v.number()),
    revoked_at: v.optional(v.number()),
    recorded_by: v.id("users"),
    created_at: v.number(),
  }).index("by_recipient", ["recipient_key", "created_at"]),
  communication_eligibility_decisions: defineTable({
    communication_id: v.id("communications"),
    phase: v.union(v.literal("approval"), v.literal("dispatch")),
    allowed: v.boolean(),
    reasons: v.array(v.string()),
    consent_ids: v.array(v.id("communication_consents")),
    preference_ids: v.array(v.id("communication_preferences")),
    suppression_ids: v.array(v.id("communication_suppressions")),
    recipient_email: v.string(),
    source_fingerprint: v.string(),
    policy_version: v.string(),
    actor_id: v.id("users"),
    created_at: v.number(),
  }).index("by_communication", ["communication_id", "created_at"]),
  communication_suppressions: defineTable({
    email: v.string(),
    scope: scopeValue,
    reason: v.string(),
    recorded_by: v.optional(v.id("users")),
    revoked_at: v.optional(v.number()),
    revoked_by: v.optional(v.id("users")),
    revoke_reason: v.optional(v.string()),
    created_at: v.number(),
  }).index("by_email", ["email", "created_at"]),
  communication_unsubscribe_tokens: defineTable({
    token_hash: v.string(),
    generation: v.optional(v.number()),
    recipient_key: v.string(),
    scope: scopeValue,
    revoked_at: v.optional(v.number()),
    expires_at: v.number(),
    used_at: v.optional(v.number()),
    created_at: v.number(),
  }).index("by_hash", ["token_hash"]),
  communication_outbox: defineTable({
    communication_id: v.id("communications"),
    send_key: v.string(),
    status: v.union(
      v.literal("ready"),
      v.literal("claimed"),
      v.literal("complete"),
      v.literal("cancelled"),
      v.literal("unknown"),
      v.literal("failed"),
    ),
    payload: v.optional(
      v.object({ body: v.string(), from: v.string(), reply_to: v.string() }),
    ),
    attempts: v.number(),
    next_attempt_at: v.number(),
    claimed_at: v.optional(v.number()),
    lease_until: v.optional(v.number()),
    dispatch_started_at: v.optional(v.number()),
    claim_version: v.optional(v.number()),
    last_code: v.optional(v.string()),
    ...stamp,
  })
    .index("by_communication", ["communication_id"])
    .index("by_send_key", ["send_key"])
    .index("by_due", ["status", "next_attempt_at"])
    .index("by_lease", ["status", "lease_until"]),
  communication_provider_messages: defineTable({
    communication_id: v.id("communications"),
    provider: v.literal("resend"),
    provider_id: v.string(),
    send_key: v.string(),
    created_at: v.number(),
  })
    .index("by_provider", ["provider", "provider_id"])
    .index("by_communication", ["communication_id"]),
  communication_delivery_events: defineTable({
    communication_id: v.optional(v.id("communications")),
    provider_id: v.string(),
    event_id: v.string(),
    kind: v.union(
      v.literal("accepted"),
      v.literal("delivered"),
      v.literal("hard_bounce"),
      v.literal("soft_bounce"),
      v.literal("complaint"),
      v.literal("failed"),
    ),
    occurred_at: v.number(),
    created_at: v.number(),
  })
    .index("by_event", ["event_id"])
    .index("by_communication", ["communication_id", "occurred_at"])
    .index("by_provider", ["provider_id"])
    .index("by_provider_kind", ["provider_id", "kind"])
    .index("by_unmapped", ["provider_id", "communication_id"]),
  communication_public_limits: defineTable({
    key: v.string(),
    count: v.number(),
    window: v.number(),
  }).index("by_key", ["key"]),
  communication_rate_buckets: defineTable({
    key: v.string(),
    count: v.number(),
    window: v.number(),
  }).index("by_key", ["key"]),
  communication_settings: defineTable({
    key: v.literal("company"),
    signature: v.string(),
    secondary_approval: v.boolean(),
    paused: v.boolean(),
    queue_lag_minutes: v.optional(v.number()),
    consecutive_failures: v.optional(v.number()),
    circuit_reason: v.optional(v.string()),
    token_generation: v.optional(v.number()),
    webhook_failures: v.optional(v.number()),
    transactional_basis: v.optional(
      v.union(
        v.literal("documented_service"),
        v.literal("explicit_request_only"),
      ),
    ),
    ...stamp,
  }).index("by_key", ["key"]),
};
