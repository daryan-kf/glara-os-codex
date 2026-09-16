import { capabilityValue } from "./emergencyModel";
import { calendarTables } from "./calendarSchema";
import { communicationTables } from "./communicationSchema";
import { aiTables } from "./aiSchema";
import { automationTables } from "./automationSchema";
import { eventContextFields, analyticsTables } from "./analyticsSchema";
import { commercialTables } from "./commercialSchema";
import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { operationsTables } from "./operationsSchema";
import { inventoryTables } from "./inventorySchema";
const nullable = v.union(v.string(), v.null());
const stamps = {
  created_at: v.string(),
  updated_at: v.string(),
  deleted_at: nullable,
};
export const roleValue = v.union(
  v.literal("owner"),
  v.literal("sales"),
  v.literal("admin"),
  v.literal("marketing"),
  v.literal("designer"),
  v.literal("staging_crew"),
);
export default defineSchema({
  ...authTables,
  emergency_controls: defineTable({
    capability: capabilityValue,
    frozen: v.boolean(),
    version: v.number(),
    changed_by: v.id("users"),
    reason: v.string(),
    incident: v.union(v.string(), v.null()),
    updated_at: v.number(),
  }).index("by_capability", ["capability"]),
  security_revocations: defineTable({
    target_id: v.id("users"),
    actor_id: v.id("users"),
    reason: v.string(),
    incident: v.union(v.string(), v.null()),
    status: v.union(v.literal("pending"), v.literal("complete")),
    created_at: v.number(),
    completed_at: v.optional(v.number()),
  }).index("by_target", ["target_id"]),
  ...communicationTables,
  ...calendarTables,
  ...aiTables,
  ...automationTables,
  ...analyticsTables,
  ...operationsTables,
  ...inventoryTables,
  ...commercialTables,
  profiles: defineTable({
    userId: v.id("users"),
    display_name: v.string(),
    roles: v.array(roleValue),
    ...stamps,
  }).index("by_user", ["userId"]),
  brokerages: defineTable({
    name: v.string(),
    office_name: nullable,
    website: nullable,
    phone: nullable,
    address: nullable,
    city: nullable,
    province: v.string(),
    postal_code: nullable,
    notes: nullable,
    version: v.number(),
    ...stamps,
  }).index("by_name", ["name"]),
  lead_sources: defineTable({ name: v.string(), ...stamps }).index("by_name", [
    "name",
  ]),
  realtors: defineTable({
    ...eventContextFields,
    sales_search_text: v.optional(v.string()),
    first_name: v.string(),
    last_name: v.string(),
    email: nullable,
    phone: nullable,
    phone_key: nullable,
    instagram: nullable,
    website: nullable,
    brokerage_id: v.union(v.id("brokerages"), v.null()),
    primary_city: nullable,
    primary_area: nullable,
    secondary_areas: v.array(v.string()),
    luxury_agent: v.boolean(),
    relationship_status: v.union(
      v.literal("prospect"),
      v.literal("new_partner"),
      v.literal("active_partner"),
      v.literal("vip"),
      v.literal("at_risk"),
      v.literal("dormant"),
    ),
    lead_source_id: v.union(v.id("lead_sources"), v.null()),
    assigned_to: v.id("users"),
    version: v.number(),
    ...stamps,
  })
    .index("by_email", ["email"])
    .index("by_phone", ["phone_key"])
    .index("by_archived", ["deleted_at"])
    .searchIndex("by_sales_name", {
      searchField: "sales_search_text",
      filterFields: ["deleted_at"],
    }),
  realtor_private: defineTable({
    realtor_id: v.id("realtors"),
    notes: nullable,
    estimated_listings_per_year: v.union(v.number(), v.null()),
    average_listing_price: nullable,
    relationship_score: v.union(v.number(), v.null()),
    lead_score: v.union(v.number(), v.null()),
    ...stamps,
  }).index("by_realtor", ["realtor_id"]),
  activities: defineTable({
    automation_key: v.optional(v.string()),
    automation_domain: v.optional(v.string()),
    automation_rule_id: v.optional(v.id("automation_rules")),
    actor_kind: v.optional(v.literal("system")),
    ...eventContextFields,
    project_id: v.optional(v.id("projects")),
    project_room_id: v.optional(v.id("project_rooms")),
    version: v.optional(v.number()),
    completed_by: v.optional(v.id("users")),
    realtor_id: v.optional(v.id("realtors")),
    opportunity_id: v.optional(v.id("opportunities")),
    property_id: v.optional(v.id("properties")),
    type: v.union(
      v.literal("call"),
      v.literal("email"),
      v.literal("instagram_dm"),
      v.literal("sms"),
      v.literal("meeting"),
      v.literal("consultation"),
      v.literal("follow_up"),
      v.literal("task"),
      v.literal("note"),
    ),
    title: v.string(),
    description: nullable,
    due_at: nullable,
    completed_at: nullable,
    status: v.union(
      v.literal("open"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
    priority: v.union(v.literal("low"), v.literal("normal"), v.literal("high")),
    assigned_to: v.id("users"),
    created_by: v.id("users"),
    replaces_activity_id: v.union(v.id("activities"), v.null()),
    ...stamps,
  })
    .index("by_realtor_completed", ["realtor_id", "completed_at"])
    .index("by_realtor", ["realtor_id"])
    .index("by_project", ["project_id", "deleted_at"])
    .index("by_project_room", ["project_room_id", "status", "deleted_at"])
    .index("by_status", ["status", "deleted_at"])
    .index("by_opportunity", [
      "opportunity_id",
      "status",
      "deleted_at",
      "due_at",
    ])
    .index("by_property", ["property_id", "deleted_at"])
    .index("by_due", ["status", "deleted_at", "due_at"]),

  properties: defineTable({
    address_line_1: v.string(),
    address_line_2: v.string(),
    city: v.string(),
    province: v.string(),
    postal_code: v.string(),
    property_type: v.string(),
    occupancy_status: v.string(),
    bedrooms: v.union(v.number(), v.null()),
    bathrooms: v.union(v.number(), v.null()),
    square_feet: v.union(v.number(), v.null()),
    listing_price_cents: nullable,
    mls_number: v.string(),
    listing_date: v.string(),
    realtor_id: v.id("realtors"),
    seller_name: v.string(),
    notes: v.string(),
    address_key: v.string(),
    mls_key: v.string(),
    search_text: v.string(),
    version: v.number(),
    ...stamps,
  })
    .index("by_realtor", ["realtor_id", "deleted_at"])
    .index("by_city", ["city", "deleted_at"])
    .index("by_mls", ["mls_key", "deleted_at"])
    .index("by_address", ["address_key", "deleted_at"])
    .index("by_archived", ["deleted_at"])
    .searchIndex("search", {
      searchField: "search_text",
      filterFields: ["deleted_at"],
    }),
  opportunities: defineTable({
    ...eventContextFields,
    property_id: v.id("properties"),
    realtor_id: v.id("realtors"),
    assigned_to: v.id("users"),
    stage: v.union(
      ...[
        "new",
        "contacted",
        "interested",
        "consultation",
        "quote_sent",
        "negotiation",
        "won",
        "lost",
      ].map((x) => v.literal(x)),
    ),
    stage_changed_at: v.string(),
    ranking_counted: v.optional(v.boolean()),
    estimated_value_cents: v.string(),
    probability: v.number(),
    expected_close_date: v.string(),
    lead_source_id: v.union(v.id("lead_sources"), v.null()),
    notes: v.string(),
    lost_reason: v.string(),
    lost_notes: v.string(),
    won_at: nullable,
    lost_at: nullable,
    version: v.number(),
    ...stamps,
  })
    .index("by_stage", ["deleted_at", "stage"])
    .index("by_property", ["property_id", "deleted_at"])
    .index("by_realtor", ["realtor_id", "deleted_at"])
    .index("by_assigned", ["assigned_to", "deleted_at"])
    .index("by_archived", ["deleted_at"]),
  consultations: defineTable({
    ...eventContextFields,
    opportunity_id: v.id("opportunities"),
    scheduled_at: v.string(),
    completed_at: nullable,
    assigned_to: v.id("users"),
    consultation_type: v.string(),
    notes: v.string(),
    status: v.string(),
    version: v.number(),
    ...stamps,
  }).index("by_opportunity", ["opportunity_id", "deleted_at"]),
  quotes: defineTable({
    ...eventContextFields,
    number: v.string(),
    opportunity_id: v.id("opportunities"),
    status: v.string(),
    subtotal_cents: v.string(),
    discount_cents: v.string(),
    tax_cents: v.string(),
    total_cents: v.string(),
    tax_basis_points: v.number(),
    valid_until: v.string(),
    sent_at: nullable,
    accepted_at: nullable,
    declined_at: nullable,
    revision_of: v.union(v.id("quotes"), v.null()),
    customer_snapshot: v.string(),
    version: v.number(),
    created_by: v.id("users"),
    ...stamps,
  })
    .index("by_opportunity", ["opportunity_id", "deleted_at"])
    .index("by_status", ["deleted_at", "status", "valid_until"]),
  quote_items: defineTable({
    quote_id: v.id("quotes"),
    description: v.string(),
    quantity: v.number(),
    unit_price_cents: v.string(),
    total_cents: v.string(),
    sort_order: v.number(),
  }).index("by_quote", ["quote_id"]),
  sales_realtor_counts: defineTable({
    realtor_id: v.id("realtors"),
    count: v.number(),
  })
    .index("by_realtor", ["realtor_id"])
    .index("by_count", ["count"]),
  sales_counters: defineTable({ key: v.string(), value: v.number() }).index(
    "by_key",
    ["key"],
  ),
  sales_metrics: defineTable({
    key: v.string(),
    count: v.number(),
    cents: v.string(),
  }).index("by_key", ["key"]),
  sales_settings: defineTable({
    key: v.string(),
    sales_discount_bps: v.number(),
    admin_discount_bps: v.number(),
    version: v.number(),
  }).index("by_key", ["key"]),
  // Audit snapshots deliberately accept heterogeneous document shapes; callers cannot write this table directly.
  audit_logs: defineTable({
    actor_id: v.union(v.id("users"), v.null()),
    action: v.string(),
    entity: v.string(),
    entity_id: v.string(),
    old_value: v.any(),
    new_value: v.any(),
    created_at: v.string(),
  }).index("by_entity", ["entity_id"]),
});
