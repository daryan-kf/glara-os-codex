import { defineTable } from "convex/server";
import { v } from "convex/values";
import {
  statuses,
  priorities,
  roomTypes,
  roomStatuses,
  scopes,
  categories,
  checkStatuses,
  eventTypes,
  eventStatuses,
  teamRoles,
  visibility,
  noteTypes,
  mediaCategories,
} from "../src/lib/operations/model";
export const projectStatus = v.union(...statuses.map((s) => v.literal(s)));
export const category = v.union(...categories.map((s) => v.literal(s)));
export const checkStatus = v.union(...checkStatuses.map((s) => v.literal(s)));
export const eventType = v.union(...eventTypes.map((s) => v.literal(s)));
export const eventStatus = v.union(...eventStatuses.map((s) => v.literal(s)));
export const teamRole = v.union(...teamRoles.map((s) => v.literal(s)));
export const noteVisibility = v.union(...visibility.map((s) => v.literal(s)));
export const noteType = v.union(...noteTypes.map((s) => v.literal(s)));
const nullable = v.union(v.string(), v.null());
const user = v.union(v.id("users"), v.null());
const stamps = {
  created_at: v.string(),
  updated_at: v.string(),
  deleted_at: nullable,
};
const templateFields = {
  category,
  title: v.string(),
  description: v.string(),
  required: v.boolean(),
  gate_key: v.string(),
  default_assignee_role: v.union(
    v.literal("project_manager"),
    v.literal("designer"),
    v.literal("staging_lead"),
  ),
  relative_due_rule: v.union(
    v.literal("none"),
    v.literal("staging_previous_day"),
    v.literal("staging_day"),
    v.literal("destaging_day"),
  ),
};
export const operationsTables = {
  projects: defineTable({
    project_number: v.string(),
    opportunity_id: v.id("opportunities"),
    property_id: v.id("properties"),
    realtor_id: v.id("realtors"),
    source_quote_id: v.union(v.id("quotes"), v.null()),
    status: projectStatus,
    priority: v.union(...priorities.map((s) => v.literal(s))),
    project_manager_id: user,
    designer_id: user,
    staging_lead_id: user,
    package_type: v.string(),
    planned_end_date: v.string(),
    actual_end_date: v.string(),
    listing_live_date: v.string(),
    pending_sale_date: v.string(),
    sold_date: v.string(),
    completed_at: nullable,
    cancelled_at: nullable,
    cancellation_reason: v.string(),
    cancellation_notes: v.string(),
    internal_notes: v.string(),
    version: v.number(),
    ...stamps,
  })
    .index("by_source_quote", ["source_quote_id"])
    .index("by_opportunity", ["opportunity_id", "deleted_at"])
    .index("by_property", ["property_id", "deleted_at"])
    .index("by_realtor", ["realtor_id", "deleted_at"])
    .index("by_status", ["deleted_at", "status"])
    .index("by_status_end", ["deleted_at", "status", "planned_end_date"])
    .index("by_project_manager", ["project_manager_id", "deleted_at"])
    .index("by_designer", ["designer_id", "deleted_at"])
    .index("by_staging_lead", ["staging_lead_id", "deleted_at"])
    .index("by_planned_end", ["deleted_at", "planned_end_date"])
    .index("by_archived", ["deleted_at"])
    .searchIndex("search", {
      searchField: "project_number",
      filterFields: ["deleted_at"],
    }),
  project_counters: defineTable({ key: v.string(), value: v.number() }).index(
    "by_key",
    ["key"],
  ),
  project_rooms: defineTable({
    project_id: v.id("projects"),
    room_type: v.union(...roomTypes.map((s) => v.literal(s))),
    room_name: v.string(),
    staging_scope: v.union(...scopes.map((s) => v.literal(s))),
    style_direction: v.string(),
    notes: v.string(),
    status: v.union(...roomStatuses.map((s) => v.literal(s))),
    sort_order: v.number(),
    version: v.number(),
    ...stamps,
  })
    .index("by_project", ["project_id", "deleted_at"])
    .index("by_project_sort", ["project_id", "deleted_at", "sort_order"]),
  project_checklist_templates: defineTable({
    name: v.string(),
    description: v.string(),
    is_default: v.boolean(),
    active: v.boolean(),
    version: v.number(),
    ...stamps,
  })
    .index("by_default", ["is_default", "deleted_at"])
    .index("by_active", ["active", "deleted_at"]),
  project_checklist_template_items: defineTable({
    template_id: v.id("project_checklist_templates"),
    ...templateFields,
    sort_order: v.number(),
    active: v.boolean(),
    ...stamps,
  }).index("by_template", ["template_id", "deleted_at", "sort_order"]),
  project_checklist_items: defineTable({
    project_id: v.id("projects"),
    source_template_id: v.id("project_checklist_templates"),
    source_template_item_id: v.id("project_checklist_template_items"),
    ...templateFields,
    status: checkStatus,
    assigned_to: user,
    due_at: nullable,
    completed_at: nullable,
    completed_by: user,
    skipped_at: nullable,
    skipped_by: user,
    skip_reason: v.string(),
    sort_order: v.number(),
    version: v.number(),
    ...stamps,
  })
    .index("by_project", ["project_id", "deleted_at"])
    .index("by_project_status", ["project_id", "status", "deleted_at"])
    .index("by_assigned", ["assigned_to", "status", "deleted_at"])
    .index("by_due", ["status", "deleted_at", "due_at"])
    .index("by_gate", ["project_id", "gate_key", "deleted_at"]),
  project_team_assignments: defineTable({
    project_id: v.id("projects"),
    user_id: v.id("users"),
    role: teamRole,
    active: v.boolean(),
    assigned_at: v.string(),
    removed_at: nullable,
    version: v.number(),
    ...stamps,
  })
    .index("by_project", ["project_id", "active"])
    .index("by_user", ["user_id", "active"]),
  operations_events: defineTable({
    project_id: v.id("projects"),
    event_type: eventType,
    title: v.string(),
    description: v.string(),
    start_at: v.string(),
    end_at: v.string(),
    local_day: v.string(),
    assigned_lead_id: v.id("users"),
    status: eventStatus,
    location_note: v.string(),
    version: v.number(),
    created_by: v.id("users"),
    ...stamps,
  })
    .index("by_project", ["project_id", "deleted_at"])
    .index("by_start", ["deleted_at", "start_at"])
    .index("by_type_start", ["event_type", "deleted_at", "start_at"])
    .index("by_assigned_start", ["assigned_lead_id", "deleted_at", "start_at"])
    .index("by_day", ["local_day", "deleted_at"]),
  project_access_details: defineTable({
    project_id: v.id("projects"),
    access_type: v.string(),
    instructions: v.string(),
    parking_notes: v.string(),
    loading_notes: v.string(),
    elevator_notes: v.string(),
    concierge_notes: v.string(),
    key_pickup_notes: v.string(),
    sensitive_access_code: v.string(),
    version: v.number(),
    ...stamps,
  }).index("by_project", ["project_id"]),
  project_notes: defineTable({
    project_id: v.id("projects"),
    author_id: v.id("users"),
    note_type: noteType,
    body: v.string(),
    visibility: noteVisibility,
    ...stamps,
  }).index("by_project", ["project_id", "deleted_at", "created_at"]),
  project_media: defineTable({
    project_id: v.id("projects"),
    room_id: v.optional(v.id("project_rooms")),
    storage_id: v.id("_storage"),
    media_type: v.union(
      v.literal("image"),
      v.literal("video"),
      v.literal("document"),
    ),
    category: v.union(...mediaCategories.map((s) => v.literal(s))),
    caption: v.string(),
    uploaded_by: v.id("users"),
    ...stamps,
  }).index("by_project", ["project_id", "deleted_at"]),
  operations_settings: defineTable({
    key: v.string(),
    max_stagings_per_day: v.number(),
    max_destagings_per_day: v.number(),
    package_alert_days: v.array(v.number()),
    package_types: v.array(v.string()),
    version: v.number(),
    ...stamps,
  }).index("by_key", ["key"]),
};
