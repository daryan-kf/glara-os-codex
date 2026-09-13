import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
import { v } from "convex/values";
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
    .index("by_archived", ["deleted_at"]),
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
    realtor_id: v.id("realtors"),
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
    .index("by_realtor", ["realtor_id"])
    .index("by_status", ["status", "deleted_at"]),
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
