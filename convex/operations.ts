import { assertEndChange } from "./commercialCore";
import { updateMetrics } from "./sales";
import { inventoryGate, cancelInventory } from "./inventoryCore";
import { vancouverUtc } from "../src/lib/operations/time";
import { query, mutation, type MutationCtx } from "./functions";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { z } from "zod";
import type { Doc, Id } from "./_generated/dataModel";
import { deny } from "./access";
import {
  projectStatus,
  checkStatus,
  eventType,
  eventStatus,
  teamRole,
  noteType,
  noteVisibility,
} from "./operationsSchema";
import * as core from "./operationsCore";
import {
  statuses,
  projectInput,
  roomInput,
  accessInput,
  templateItemInput,
  defaultItems,
  defaultSettings,
  graph,
  closed,
  day,
  addDays,
  dateInput,
  instant,
} from "../src/lib/operations/model";
const pageArgs = { paginationOpts: paginationOptsValidator };
const pageLimit = (n: number) => Math.min(25, Math.max(1, Math.floor(n)));
const text = (s: string, max = 2000) => {
  if (s.length > max) deny("INVALID_INPUT", "Text is too long.");
  return s.trim();
};
export const list = query({
  args: {
    ...pageArgs,
    status: v.optional(projectStatus),
    manager: v.optional(v.id("users")),
    designer: v.optional(v.id("users")),
    realtor: v.optional(v.id("realtors")),
    property: v.optional(v.id("properties")),
    city: v.optional(v.string()),
    staging_day: v.optional(v.string()),
    attention: v.optional(v.string()),
    overdue: v.optional(v.boolean()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const u = await core.staff(ctx);
    const base = ctx.db.query("projects");
    const scan = a.manager
      ? base.withIndex("by_project_manager", (q) =>
          a.archived
            ? q.eq("project_manager_id", a.manager!).gt("deleted_at", null)
            : q.eq("project_manager_id", a.manager!).eq("deleted_at", null),
        )
      : a.designer
        ? base.withIndex("by_designer", (q) =>
            a.archived
              ? q.eq("designer_id", a.designer!).gt("deleted_at", null)
              : q.eq("designer_id", a.designer!).eq("deleted_at", null),
          )
        : a.realtor
          ? base.withIndex("by_realtor", (q) =>
              a.archived
                ? q.eq("realtor_id", a.realtor!).gt("deleted_at", null)
                : q.eq("realtor_id", a.realtor!).eq("deleted_at", null),
            )
          : a.property
            ? base.withIndex("by_property", (q) =>
                a.archived
                  ? q.eq("property_id", a.property!).gt("deleted_at", null)
                  : q.eq("property_id", a.property!).eq("deleted_at", null),
              )
            : a.status && !a.archived
              ? base.withIndex("by_status", (q) =>
                  q.eq("deleted_at", null).eq("status", a.status!),
                )
              : base.withIndex("by_archived", (q) =>
                  a.archived
                    ? q.gt("deleted_at", null)
                    : q.eq("deleted_at", null),
                );
    const result = await scan.order("desc").paginate({
      ...a.paginationOpts,
      numItems: Math.min(12, pageLimit(a.paginationOpts.numItems)),
      maximumRowsRead: 256,
    });
    const rows = [];
    for (const p of result.page) {
      if (
        Boolean(p.deleted_at) !== Boolean(a.archived) ||
        (a.status && p.status !== a.status) ||
        (a.manager && p.project_manager_id !== a.manager) ||
        (a.designer && p.designer_id !== a.designer) ||
        (a.realtor && p.realtor_id !== a.realtor) ||
        (a.property && p.property_id !== a.property) ||
        (!a.status && !a.archived && closed(p.status))
      )
        continue;
      const level = await core.access(ctx, p, u);
      if (!level) continue;
      const card = await core.card(ctx, p, level);
      if (
        (a.city &&
          !card.city.toLowerCase().includes(text(a.city, 100).toLowerCase())) ||
        (a.staging_day &&
          (!card.staging_date || day(card.staging_date) !== a.staging_day)) ||
        (a.attention && card.attention_level !== a.attention) ||
        (a.overdue && !card.overdue_count)
      )
        continue;
      rows.push(card);
    }
    return { ...result, page: rows };
  },
});
export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const { p, a, u } = await core.context(ctx, id);
    const operational = a === "manage" || a === "design" || a === "crew";
    const result = {
      ...(await core.card(ctx, p, a)),
      version: p.version,
      package_type: p.package_type,
      actual_end_date: p.actual_end_date,
      access: a,
      viewer_id: u.userId,
      source:
        a === "manage" || a === "sales"
          ? {
              opportunity_id: p.opportunity_id,
              property_id: p.property_id,
              realtor_id: p.realtor_id,
              source_quote_id: p.source_quote_id,
            }
          : null,
      internal_notes: a === "manage" ? p.internal_notes : null,
      cancellation_reason: a === "manage" ? p.cancellation_reason : null,
      can_edit: !p.deleted_at && !closed(p.status),
      team: operational
        ? {
            project_manager_id: p.project_manager_id,
            designer_id: p.designer_id,
            staging_lead_id: p.staging_lead_id,
            additional: await Promise.all(
              (await core.assignments(ctx, id)).map(async (t) => ({
                ...t,
                name: await core.name(ctx, t.user_id),
              })),
            ),
          }
        : null,
      rooms: operational ? await core.rooms(ctx, id) : [],
      checklist: operational ? await core.checks(ctx, id) : [],
      events: operational
        ? (await core.events(ctx, id)).sort((x, y) =>
            x.start_at.localeCompare(y.start_at),
          )
        : [],
      tasks: operational ? await core.tasks(ctx, id) : [],
    };
    return result;
  },
});
export const accessDetails = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const { p, a } = await core.context(ctx, id, ["manage", "crew"]);
    if (a !== "manage" && (p.deleted_at || closed(p.status))) deny();
    return ctx.db
      .query("project_access_details")
      .withIndex("by_project", (q) => q.eq("project_id", id))
      .unique();
  },
});
export const timeline = query({
  args: {
    id: v.id("projects"),
    ...pageArgs,
    kind: v.union(v.literal("notes"), v.literal("audit")),
  },
  handler: async (ctx, a) => {
    const { a: level } = await core.context(ctx, a.id, [
      "manage",
      "design",
      "crew",
    ]);
    const opts = {
      ...a.paginationOpts,
      numItems: pageLimit(a.paginationOpts.numItems),
    };
    if (a.kind === "audit") {
      if (level !== "manage") deny();
      const result = await ctx.db
        .query("audit_logs")
        .withIndex("by_entity", (q) => q.eq("entity_id", a.id))
        .order("desc")
        .paginate(opts);
      return {
        ...result,
        page: result.page.map((n) => ({
          id: n._id,
          body: n.action,
          created_at: n.created_at,
          author_id: n.actor_id,
          can_archive: false,
        })),
      };
    }
    const result = await ctx.db
      .query("project_notes")
      .withIndex("by_project", (q) =>
        q.eq("project_id", a.id).eq("deleted_at", null),
      )
      .order("desc")
      .paginate(opts);
    return {
      ...result,
      page: result.page
        .filter(
          (n) =>
            level === "manage" ||
            n.visibility === (level === "design" ? "design" : "operations"),
        )
        .map((n) => ({
          id: n._id,
          body: n.body,
          created_at: n.created_at,
          author_id: n.author_id,
          can_archive: level === "manage",
        })),
    };
  },
});
export const options = query({
  args: {},
  handler: async (ctx) => {
    await core.admins(ctx);
    const profiles = await ctx.db.query("profiles").take(201);
    if (profiles.length > 200)
      deny(
        "LIMIT",
        "Staff directory exceeds the M3 limit. Add indexed staff search before expanding the team.",
      );
    return {
      staff: profiles
        .filter(
          (p) =>
            !p.deleted_at &&
            p.roles.some((r) =>
              ["owner", "admin", "sales", "designer", "staging_crew"].includes(
                r,
              ),
            ),
        )
        .map((p) => ({ id: p.userId, name: p.display_name, roles: p.roles })),
      settings: await core.settings(ctx),
      templates: await ctx.db
        .query("project_checklist_templates")
        .withIndex("by_active", (q) =>
          q.eq("active", true).eq("deleted_at", null),
        )
        .take(21),
    };
  },
});
export const handoff = query({
  args: { id: v.id("opportunities") },
  handler: async (ctx, { id }) => {
    const u = await core.staff(ctx);
    if (!core.isAdmin(u) && !u.roles.includes("sales")) deny();
    const o = await ctx.db.get(id);
    if (!o || o.deleted_at || o.stage !== "won")
      deny("UNAVAILABLE", "Choose a won opportunity.");
    const r = await ctx.db.get(o.realtor_id);
    if (
      !core.isAdmin(u) &&
      o.assigned_to !== u.userId &&
      r?.assigned_to !== u.userId
    )
      return null;
    const p = await ctx.db.get(o.property_id),
      existing = await ctx.db
        .query("projects")
        .withIndex("by_opportunity", (q) =>
          q.eq("opportunity_id", id).eq("deleted_at", null),
        )
        .first();
    const quotes = await ctx.db
      .query("quotes")
      .withIndex("by_opportunity", (q) =>
        q.eq("opportunity_id", id).eq("deleted_at", null),
      )
      .take(51);
    return {
      id: o._id,
      address: p?.address_line_1,
      city: p?.city,
      realtor: r ? `${r.first_name} ${r.last_name}` : "",
      existing_id: existing?._id ?? null,
      quotes: quotes
        .filter((q) => q.status === "accepted")
        .map((q) => ({ id: q._id, number: q.number })),
      can_create: core.isAdmin(u),
      owner_id: o.assigned_to,
    };
  },
});
async function defaultTemplate(ctx: MutationCtx) {
  let template = await ctx.db
    .query("project_checklist_templates")
    .withIndex("by_default", (q) =>
      q.eq("is_default", true).eq("deleted_at", null),
    )
    .unique();
  if (!template) {
    const id = await ctx.db.insert("project_checklist_templates", {
      name: "Glara Standard Staging Workflow",
      description:
        "Default operational checklist; project copies remain independent.",
      is_default: true,
      active: true,
      version: 1,
      ...core.stamps(),
    });
    for (const [index, item] of defaultItems.entries())
      await ctx.db.insert("project_checklist_template_items", {
        template_id: id,
        ...item,
        sort_order: index,
        active: true,
        ...core.stamps(),
      });
    template = (await ctx.db.get(id))!;
  }
  return template;
}
export const create = mutation({
  args: {
    opportunity_id: v.id("opportunities"),
    source_quote_id: v.union(v.id("quotes"), v.null()),
    project_manager_id: v.id("users"),
    designer_id: v.union(v.id("users"), v.null()),
    staging_lead_id: v.union(v.id("users"), v.null()),
    template_id: v.optional(v.id("project_checklist_templates")),
    input: v.string(),
    rooms: v.array(v.string()),
  },
  handler: async (ctx, a) => {
    const u = await core.admins(ctx),
      o = await ctx.db.get(a.opportunity_id);
    if (!o || o.deleted_at || o.stage !== "won")
      deny("INVALID_INPUT", "Projects must originate from a won opportunity.");
    const [property, realtor] = await Promise.all([
      ctx.db.get(o.property_id),
      ctx.db.get(o.realtor_id),
    ]);
    if (
      !property ||
      property.deleted_at ||
      !realtor ||
      realtor.deleted_at ||
      property.realtor_id !== o.realtor_id
    )
      deny("UNAVAILABLE", "The commercial handoff is unavailable.");
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_opportunity", (q) =>
        q.eq("opportunity_id", o._id).eq("deleted_at", null),
      )
      .first();
    if (existing) return { id: existing._id, existing: true };
    if (a.source_quote_id) {
      const quote = await ctx.db.get(a.source_quote_id);
      if (
        !quote ||
        quote.deleted_at ||
        quote.opportunity_id !== o._id ||
        quote.status !== "accepted"
      )
        deny(
          "INVALID_INPUT",
          "Source quote must be accepted and belong to this opportunity.",
        );
    }
    await core.assignedUser(ctx, a.project_manager_id, [
      "owner",
      "admin",
      "sales",
    ]);
    if (a.designer_id)
      await core.assignedUser(ctx, a.designer_id, [
        "owner",
        "admin",
        "designer",
      ]);
    if (a.staging_lead_id)
      await core.assignedUser(ctx, a.staging_lead_id, [
        "owner",
        "admin",
        "staging_crew",
      ]);
    const input = core.parse(projectInput, a.input);
    return await provisionProject(ctx, u, o, {
      source_quote_id: a.source_quote_id,
      project_manager_id: a.project_manager_id,
      designer_id: a.designer_id,
      staging_lead_id: a.staging_lead_id,
      template_id: a.template_id,
      input,
      rooms: a.rooms,
    });
  },
});
async function provisionProject(
  ctx: MutationCtx,
  u: { userId: Id<"users"> },
  o: Doc<"opportunities">,
  a: {
    source_quote_id: Id<"quotes"> | null;
    project_manager_id: Id<"users">;
    designer_id: Id<"users"> | null;
    staging_lead_id: Id<"users"> | null;
    template_id?: Id<"project_checklist_templates">;
    input: z.infer<typeof projectInput>;
    rooms: string[];
  },
) {
  {
    const input = a.input,
      config = await core.settings(ctx);
    if (!config.package_types.includes(input.package_type))
      deny("INVALID_INPUT", "Select a configured package.");
    if (a.rooms.length > 40) deny("LIMIT", "Maximum 40 rooms per project.");
    const template = a.template_id
      ? await ctx.db.get(a.template_id)
      : await defaultTemplate(ctx);
    if (!template || !template.active || template.deleted_at)
      deny("INVALID_INPUT", "Select an active checklist template.");
    const templateItems = await ctx.db
      .query("project_checklist_template_items")
      .withIndex("by_template", (q) =>
        q.eq("template_id", template._id).eq("deleted_at", null),
      )
      .take(81);
    if (!templateItems.length || templateItems.length > 80)
      deny("LIMIT", "Template must contain 1–80 checklist items.");
    const key = day().slice(0, 4),
      counter = await ctx.db
        .query("project_counters")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique(),
      value = (counter?.value ?? 0) + 1;
    if (value > 9999)
      deny("LIMIT", "Annual project numbering capacity reached.");
    if (counter) await ctx.db.patch(counter._id, { value });
    else await ctx.db.insert("project_counters", { key, value });
    const id = await ctx.db.insert("projects", {
      ...input,
      project_number: `GLS-${key}-${String(value).padStart(4, "0")}`,
      opportunity_id: o._id,
      property_id: o.property_id,
      realtor_id: o.realtor_id,
      source_quote_id: a.source_quote_id,
      project_manager_id: a.project_manager_id,
      designer_id: a.designer_id,
      staging_lead_id: a.staging_lead_id,
      status: "planning",
      actual_end_date: "",
      listing_live_date: "",
      pending_sale_date: "",
      sold_date: "",
      completed_at: null,
      cancelled_at: null,
      cancellation_reason: "",
      cancellation_notes: "",
      version: 1,
      ...core.stamps(),
    });
    for (const t of templateItems) {
      if (!t.active) continue;
      await ctx.db.insert("project_checklist_items", {
        project_id: id,
        source_template_id: template._id,
        source_template_item_id: t._id,
        category: t.category,
        title: t.title,
        description: t.description,
        required: t.required,
        gate_key: t.gate_key,
        default_assignee_role: t.default_assignee_role,
        relative_due_rule: t.relative_due_rule,
        status: "pending",
        assigned_to:
          t.default_assignee_role === "designer"
            ? (a.designer_id ?? a.project_manager_id)
            : t.default_assignee_role === "staging_lead"
              ? (a.staging_lead_id ?? a.project_manager_id)
              : a.project_manager_id,
        due_at: null,
        completed_at: null,
        completed_by: null,
        skipped_at: null,
        skipped_by: null,
        skip_reason: "",
        sort_order: t.sort_order,
        version: 1,
        ...core.stamps(),
      });
    }
    for (const [index, json] of a.rooms.entries())
      await ctx.db.insert("project_rooms", {
        ...core.parse(roomInput, json),
        project_id: id,
        sort_order: index,
        version: 1,
        ...core.stamps(),
      });
    await core.audit(ctx, u.userId, id, "PROJECT_CREATED", null, {
      opportunity_id: o._id,
      source_quote_id: a.source_quote_id,
      template_id: template._id,
      template_version: template.version,
    });
    return { id, existing: false };
  }
}
// One-click conversion: marks an active opportunity won and provisions the
// project with defaults (converter as project manager, first configured
// package, default checklist); rooms and dates are completed on the project.
export const convertOpportunity = mutation({
  args: { opportunity_id: v.id("opportunities") },
  handler: async (ctx, a) => {
    const u = await core.admins(ctx),
      o = await ctx.db.get(a.opportunity_id);
    if (!o || o.deleted_at) deny("UNAVAILABLE");
    if (o.stage === "lost")
      deny("INVALID_INPUT", "Reopen the lost opportunity before converting.");
    const [property, realtor] = await Promise.all([
      ctx.db.get(o.property_id),
      ctx.db.get(o.realtor_id),
    ]);
    if (
      !property ||
      property.deleted_at ||
      !realtor ||
      realtor.deleted_at ||
      property.realtor_id !== o.realtor_id
    )
      deny("UNAVAILABLE", "The commercial handoff is unavailable.");
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_opportunity", (q) =>
        q.eq("opportunity_id", o._id).eq("deleted_at", null),
      )
      .first();
    if (existing) return { id: existing._id, existing: true };
    return await winAndProvision(ctx, u, o);
  },
});
async function winAndProvision(
  ctx: MutationCtx,
  u: { userId: Id<"users"> },
  o: Doc<"opportunities">,
) {
  if (o.stage !== "won") {
    const now = new Date().toISOString();
    await ctx.db.patch(o._id, {
      stage: "won",
      stage_changed_at: now,
      probability: 100,
      won_at: now,
      lost_at: null,
      version: o.version + 1,
      updated_at: now,
    });
    await updateMetrics(ctx, o, (await ctx.db.get(o._id))!);
    await ctx.db.insert("audit_logs", {
      actor_id: u.userId,
      action: "OPPORTUNITY_WON",
      entity: "opportunities",
      entity_id: o._id,
      old_value: { stage: o.stage },
      new_value: { stage: "won", via: "convert_to_project" },
      created_at: now,
    });
  }
  const config = await core.settings(ctx);
  if (!config.package_types.length)
    deny("INVALID_INPUT", "Configure a package type first.");
  return await provisionProject(ctx, u, (await ctx.db.get(o._id))!, {
    source_quote_id: null,
    project_manager_id: u.userId,
    designer_id: null,
    staging_lead_id: null,
    input: {
      package_type: config.package_types[0],
      planned_end_date: "",
      priority: "normal",
      internal_notes: "",
    },
    rooms: [],
  });
}
// Direct property conversion: reuses the property's open opportunity or
// records a minimal one first, then wins it and provisions the project.
export const convertProperty = mutation({
  args: { property_id: v.id("properties") },
  handler: async (ctx, a) => {
    const u = await core.admins(ctx),
      p = await ctx.db.get(a.property_id);
    if (!p || p.deleted_at) deny("UNAVAILABLE");
    const realtor = await ctx.db.get(p.realtor_id);
    if (!realtor || realtor.deleted_at)
      deny("UNAVAILABLE", "Link an active customer to this property first.");
    let o = await ctx.db
      .query("opportunities")
      .withIndex("by_property", (q) =>
        q.eq("property_id", p._id).eq("deleted_at", null),
      )
      .filter((q) => q.neq(q.field("stage"), "lost"))
      .first();
    if (!o) {
      const oid = await ctx.db.insert("opportunities", {
        ...core.stamps(),
        property_id: p._id,
        realtor_id: p.realtor_id,
        assigned_to: u.userId,
        stage: "new",
        stage_changed_at: new Date().toISOString(),
        estimated_value_cents: "0",
        probability: 100,
        expected_close_date: "",
        lead_source_id: null,
        notes: "",
        won_at: null,
        lost_at: null,
        lost_reason: "",
        lost_notes: "",
        version: 1,
      });
      await updateMetrics(ctx, null, (await ctx.db.get(oid))!);
      o = (await ctx.db.get(oid))!;
      await ctx.db.insert("audit_logs", {
        actor_id: u.userId,
        action: "INSERT",
        entity: "opportunities",
        entity_id: oid,
        old_value: null,
        new_value: { property_id: p._id, via: "convert_property_to_project" },
        created_at: new Date().toISOString(),
      });
    }
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_opportunity", (q) =>
        q.eq("opportunity_id", o!._id).eq("deleted_at", null),
      )
      .first();
    if (existing) return { id: existing._id, existing: true };
    return await winAndProvision(ctx, u, o);
  },
});
export const update = mutation({
  args: { id: v.id("projects"), version: v.number(), input: v.string() },
  handler: async (ctx, a) => {
    const { p, u } = await core.context(ctx, a.id, ["manage"], true);
    core.revision(p, a.version);
    const data = core.parse(projectInput, a.input),
      config = await core.settings(ctx);
    await assertEndChange(
      ctx,
      p._id,
      data.planned_end_date,
      p.planned_end_date,
    );
    if (!config.package_types.includes(data.package_type))
      deny("INVALID_INPUT", "Select a configured package.");
    const staging = (await core.events(ctx, p._id)).find(
      (e) => e.event_type === "staging" && e.status !== "cancelled",
    );
    if (
      staging &&
      (!data.planned_end_date || data.planned_end_date < day(staging.start_at))
    )
      deny("INVALID_INPUT", "Package end cannot precede staging.");
    await ctx.db.patch(p._id, {
      ...data,
      version: p.version + 1,
      updated_at: core.now(),
    });
    await core.audit(
      ctx,
      u.userId,
      p._id,
      "PROJECT_UPDATED",
      {
        package_type: p.package_type,
        planned_end_date: p.planned_end_date,
        priority: p.priority,
      },
      {
        package_type: data.package_type,
        planned_end_date: data.planned_end_date,
        priority: data.priority,
        notes_changed: p.internal_notes !== data.internal_notes,
      },
    );
  },
});
export const transition = mutation({
  args: {
    id: v.id("projects"),
    version: v.number(),
    status: projectStatus,
    date: v.optional(v.string()),
    reason: v.optional(v.string()),
    notes: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const {
      p,
      u,
      a: level,
    } = await core.context(
      ctx,
      a.id,
      ["manage", "design", "crew", "sales"],
      true,
    );
    core.revision(p, a.version);
    if (!graph[p.status].includes(a.status))
      deny(
        "INVALID_TRANSITION",
        "This transition is not available from the current stage.",
      );
    if (
      (level === "design" &&
        !["designing", "ready_to_schedule"].includes(a.status)) ||
      (level === "crew" &&
        !["staging", "staged", "destaging", "completed"].includes(a.status)) ||
      (level === "sales" &&
        !["listing_live", "pending_sale", "sold"].includes(a.status))
    )
      deny();
    if (a.status === "scheduled" || a.status === "destaging_scheduled")
      deny(
        "INVALID_TRANSITION",
        "Use the scheduling form to set a date and check conflicts.",
      );
    if (
      a.status === "staged" ||
      a.status === "completed" ||
      a.status === "cancelled"
    )
      if (a.status === "cancelled") await cancelInventory(ctx, p._id, u.userId);
      else await inventoryGate(ctx, p._id, a.status);
    if (a.status === "ready_to_schedule")
      await core.gate(ctx, p, "pre_staging");
    if (a.status === "staging") await core.gate(ctx, p, "pre_staging");
    if (a.status === "staged") await core.gate(ctx, p, "staging");
    if (a.status === "destaging") {
      const items = await core.checks(ctx, p._id);
      if (
        items.some(
          (c) =>
            c.gate_key === "destaging_access_confirmed" &&
            c.status !== "completed",
        )
      )
        deny("CHECKLIST_GATE", "Confirm destaging access before starting.");
    }
    if (a.status === "completed") {
      await core.gate(ctx, p, "destaging");
      if ((await core.tasks(ctx, p._id)).some((t) => t.status === "open"))
        deny(
          "CHECKLIST_GATE",
          "Complete or cancel remaining project tasks first.",
        );
    }
    const updates: Partial<Doc<"projects">> = {
      status: a.status,
      updated_at: core.now(),
      version: p.version + 1,
    };
    if (["listing_live", "pending_sale", "sold"].includes(a.status)) {
      const date = core.parse(dateInput, JSON.stringify(a.date));
      if (date > day())
        deny(
          "INVALID_INPUT",
          "Actual listing and sale dates cannot be in the future.",
        );
      if (a.status === "listing_live") updates.listing_live_date = date;
      if (a.status === "pending_sale") {
        if (p.listing_live_date && date < p.listing_live_date)
          deny("INVALID_INPUT");
        updates.pending_sale_date = date;
      }
      if (a.status === "sold") {
        if (
          (p.listing_live_date && date < p.listing_live_date) ||
          (p.pending_sale_date && date < p.pending_sale_date)
        )
          deny("INVALID_INPUT");
        updates.sold_date = date;
      }
    }
    if (a.status === "cancelled") {
      if (level !== "manage") deny();
      const reason = text(a.reason ?? "", 500);
      if (!reason) deny("INVALID_INPUT", "Cancellation requires a reason.");
      updates.cancelled_at = core.now();
      updates.cancellation_reason = reason;
      updates.cancellation_notes = text(a.notes ?? "");
    }
    if (a.status === "completed") {
      updates.completed_at = core.now();
      updates.actual_end_date = day();
    }
    const ev = await core.events(ctx, p._id);
    if (a.status === "staging" || a.status === "destaging") {
      const event = ev.find(
        (e) =>
          e.event_type === (a.status === "staging" ? "staging" : "destaging") &&
          e.status === "scheduled",
      );
      if (!event) deny("PLANNING_GATE", "Schedule the operation first.");
      if (day(event.start_at) > day())
        deny(
          "INVALID_TRANSITION",
          "Reschedule the operation before starting earlier than planned.",
        );
    }
    if (
      a.status === "staged" ||
      a.status === "completed" ||
      a.status === "cancelled"
    )
      for (const event of ev) {
        if (event.status !== "scheduled") continue;
        const finish =
          (a.status === "staged" && event.event_type === "staging") ||
          (a.status === "completed" && event.event_type === "destaging");
        if (a.status === "staged" && !finish) continue;
        await ctx.db.patch(event._id, {
          status: finish ? "completed" : "cancelled",
          version: event.version + 1,
          updated_at: core.now(),
        });
        await core.audit(
          ctx,
          u.userId,
          p._id,
          "EVENT_STATUS_CHANGED",
          { id: event._id, status: event.status },
          { status: finish ? "completed" : "cancelled" },
        );
      }
    if (a.status === "cancelled")
      for (const task of await core.tasks(ctx, p._id)) {
        if (task.status === "open")
          await ctx.db.patch(task._id, {
            status: "cancelled",
            version: (task.version ?? 1) + 1,
            updated_at: core.now(),
          });
      }
    await ctx.db.patch(p._id, updates);
    await core.audit(
      ctx,
      u.userId,
      p._id,
      "PROJECT_STATUS_CHANGED",
      { status: p.status },
      {
        status: a.status,
        date: a.date ?? null,
        reason: updates.cancellation_reason ?? null,
      },
    );
  },
});
export const saveRoom = mutation({
  args: {
    project_id: v.id("projects"),
    id: v.optional(v.id("project_rooms")),
    version: v.number(),
    input: v.string(),
    archive: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const { p, u } = await core.context(
        ctx,
        a.project_id,
        ["manage", "design"],
        true,
      ),
      data = core.parse(roomInput, a.input),
      old = a.id ? await ctx.db.get(a.id) : null;
    if (a.id && (!old || old.project_id !== p._id || old.deleted_at))
      deny("UNAVAILABLE");
    if (old) core.revision(old, a.version);
    if (!old && (await core.rooms(ctx, p._id)).length >= 40)
      deny("LIMIT", "Maximum 40 active rooms per project.");
    if (
      (a.archive || !old || data.status === "planned") &&
      !["planning", "designing", "ready_to_schedule"].includes(p.status)
    )
      deny("PLANNING_GATE", "Room scope is fixed once staging is scheduled.");
    if (old && (a.archive || data.staging_scope === "no_staging")) {
      const inventory = await ctx.db
        .query("inventory_reservations")
        .withIndex("by_room", (q) =>
          q.eq("project_room_id", old._id).eq("active", true),
        )
        .first();
      if (inventory) deny("DEPENDENCY", "Reconcile room inventory first.");
    }
    if (a.archive && old) {
      const pending = await ctx.db
        .query("activities")
        .withIndex("by_project_room", (q) =>
          q
            .eq("project_room_id", old._id)
            .eq("status", "open")
            .eq("deleted_at", null),
        )
        .first();
      if (pending)
        deny("DEPENDENCY", "Complete or cancel room tasks before archiving.");
    }
    const value = {
      ...data,
      updated_at: core.now(),
      version: (old?.version ?? 0) + 1,
      deleted_at: a.archive ? core.now() : null,
    };
    const id = old
      ? old._id
      : await ctx.db.insert("project_rooms", {
          ...value,
          project_id: p._id,
          created_at: core.now(),
        });
    if (old) await ctx.db.patch(old._id, value);
    await core.touch(ctx, p);
    await core.audit(
      ctx,
      u.userId,
      p._id,
      a.archive ? "ROOM_ARCHIVED" : old ? "ROOM_UPDATED" : "ROOM_CREATED",
      old
        ? { id: old._id, status: old.status, sort_order: old.sort_order }
        : null,
      { id, status: data.status, sort_order: data.sort_order },
    );
    return id;
  },
});
export const checklist = mutation({
  args: {
    id: v.id("project_checklist_items"),
    version: v.number(),
    status: checkStatus,
    skip_reason: v.optional(v.string()),
    assigned_to: v.optional(v.id("users")),
    due_at: v.optional(v.union(v.string(), v.null())),
    required: v.optional(v.boolean()),
    reason: v.optional(v.string()),
    archive: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const old = await ctx.db.get(a.id);
    if (!old || old.deleted_at) deny("UNAVAILABLE");
    const {
      p,
      u,
      a: level,
    } = await core.context(
      ctx,
      old.project_id,
      ["manage", "design", "crew"],
      true,
    );
    core.revision(old, a.version);
    if (level !== "manage" && old.assigned_to !== u.userId) deny();
    if (
      level !== "manage" &&
      (a.required !== undefined ||
        a.assigned_to !== undefined ||
        a.due_at !== undefined ||
        a.archive)
    )
      deny();
    const required = a.required ?? old.required;
    if (
      a.required !== undefined &&
      a.required !== old.required &&
      !text(a.reason ?? "", 500)
    )
      deny("INVALID_INPUT", "Required checklist changes need a reason.");
    if (required && a.status === "skipped")
      deny(
        "CHECKLIST_GATE",
        "Required checklist items cannot be skipped. A manager must explicitly change the requirement with a reason.",
      );
    const rank = Object.keys(graph).indexOf(p.status),
      locked =
        old.required &&
        ((old.category === "pre_staging" && rank >= 3) ||
          (old.category === "staging" && rank >= 5));
    if (
      locked &&
      (a.status !== "completed" || a.required === false || a.archive)
    )
      deny(
        "CHECKLIST_GATE",
        "A completed stage's required checklist is locked.",
      );
    if (a.archive && old.required)
      deny("CHECKLIST_GATE", "Required checklist items cannot be archived.");
    if (a.assigned_to) await core.member(ctx, p, a.assigned_to);
    const due =
      a.due_at === undefined
        ? old.due_at
        : a.due_at === null
          ? null
          : core.parse(instant, JSON.stringify(a.due_at));
    const stateChanged = old.status !== a.status;
    const patch = {
      status: a.status,
      required,
      assigned_to: a.assigned_to ?? old.assigned_to,
      due_at: due,
      completed_at:
        a.status === "completed"
          ? stateChanged
            ? core.now()
            : old.completed_at
          : null,
      completed_by:
        a.status === "completed"
          ? stateChanged
            ? u.userId
            : old.completed_by
          : null,
      skipped_at:
        a.status === "skipped"
          ? stateChanged
            ? core.now()
            : old.skipped_at
          : null,
      skipped_by:
        a.status === "skipped"
          ? stateChanged
            ? u.userId
            : old.skipped_by
          : null,
      skip_reason: a.status === "skipped" ? text(a.skip_reason ?? "", 500) : "",
      deleted_at: a.archive ? core.now() : null,
      version: old.version + 1,
      updated_at: core.now(),
    };
    await ctx.db.patch(old._id, patch);
    await core.touch(ctx, p);
    await core.audit(
      ctx,
      u.userId,
      p._id,
      "CHECKLIST_UPDATED",
      {
        id: old._id,
        status: old.status,
        required: old.required,
        assigned_to: old.assigned_to,
        due_at: old.due_at,
      },
      {
        id: old._id,
        status: patch.status,
        required,
        assigned_to: patch.assigned_to,
        due_at: due,
        reason: a.reason ?? null,
        archived: !!a.archive,
      },
    );
  },
});
export const setTeam = mutation({
  args: {
    id: v.id("projects"),
    version: v.number(),
    project_manager_id: v.id("users"),
    designer_id: v.union(v.id("users"), v.null()),
    staging_lead_id: v.union(v.id("users"), v.null()),
    additional: v.array(v.object({ user_id: v.id("users"), role: teamRole })),
  },
  handler: async (ctx, a) => {
    const u = await core.admins(ctx),
      { p } = await core.context(ctx, a.id, ["manage"], true);
    core.revision(p, a.version);
    if (
      a.additional.length > 30 ||
      new Set(a.additional.map((x) => x.user_id)).size !== a.additional.length
    )
      deny("INVALID_INPUT");
    await core.assignedUser(ctx, a.project_manager_id, [
      "owner",
      "admin",
      "sales",
    ]);
    if (a.designer_id)
      await core.assignedUser(ctx, a.designer_id, [
        "owner",
        "admin",
        "designer",
      ]);
    if (a.staging_lead_id)
      await core.assignedUser(ctx, a.staging_lead_id, [
        "owner",
        "admin",
        "staging_crew",
      ]);
    if (
      !["planning", "designing", "ready_to_schedule"].includes(p.status) &&
      (!a.designer_id || !a.staging_lead_id)
    )
      deny("PLANNING_GATE", "Scheduled projects require their primary team.");
    for (const t of a.additional)
      await core.assignedUser(
        ctx,
        t.user_id,
        t.role === "designer" ? ["designer"] : ["staging_crew"],
      );
    const ids = [
      a.project_manager_id,
      a.designer_id,
      a.staging_lead_id,
      ...a.additional.map((t) => t.user_id),
    ];
    if (
      (await core.events(ctx, p._id)).some(
        (e) => e.status === "scheduled" && !ids.includes(e.assigned_lead_id),
      )
    )
      deny(
        "DEPENDENCY",
        "Reassign scheduled events before removing their lead.",
      );
    if (
      (await core.checks(ctx, p._id)).some(
        (c) =>
          c.status !== "completed" &&
          c.status !== "skipped" &&
          c.assigned_to &&
          !ids.includes(c.assigned_to),
      ) ||
      (await core.tasks(ctx, p._id)).some(
        (t) => t.status === "open" && !ids.includes(t.assigned_to),
      )
    )
      deny(
        "DEPENDENCY",
        "Reassign open checklist items and tasks before removing staff.",
      );
    const old = await core.assignments(ctx, p._id);
    for (const row of old)
      if (
        !a.additional.some(
          (t) => t.user_id === row.user_id && t.role === row.role,
        )
      )
        await ctx.db.patch(row._id, {
          active: false,
          removed_at: core.now(),
          version: row.version + 1,
          updated_at: core.now(),
        });
    for (const item of a.additional)
      if (!old.some((t) => t.user_id === item.user_id && t.role === item.role))
        await ctx.db.insert("project_team_assignments", {
          project_id: p._id,
          ...item,
          active: true,
          assigned_at: core.now(),
          removed_at: null,
          version: 1,
          ...core.stamps(),
        });
    await ctx.db.patch(p._id, {
      project_manager_id: a.project_manager_id,
      designer_id: a.designer_id,
      staging_lead_id: a.staging_lead_id,
      version: p.version + 1,
      updated_at: core.now(),
    });
    await core.audit(
      ctx,
      u.userId,
      p._id,
      "TEAM_CHANGED",
      {
        manager: p.project_manager_id,
        designer: p.designer_id,
        lead: p.staging_lead_id,
        additional: old.map((t) => ({ user_id: t.user_id, role: t.role })),
      },
      {
        manager: a.project_manager_id,
        designer: a.designer_id,
        lead: a.staging_lead_id,
        additional: a.additional,
      },
    );
  },
});
export const saveAccess = mutation({
  args: { id: v.id("projects"), version: v.number(), input: v.string() },
  handler: async (ctx, a) => {
    const { p, u } = await core.context(ctx, a.id, ["manage"], true),
      data = core.parse(accessInput, a.input),
      old = await ctx.db
        .query("project_access_details")
        .withIndex("by_project", (q) => q.eq("project_id", p._id))
        .unique();
    core.revision({ version: old?.version ?? 0 }, a.version);
    if (old)
      await ctx.db.patch(old._id, {
        ...data,
        version: old.version + 1,
        updated_at: core.now(),
      });
    else
      await ctx.db.insert("project_access_details", {
        ...data,
        project_id: p._id,
        version: 1,
        ...core.stamps(),
      });
    await core.audit(ctx, u.userId, p._id, "ACCESS_DETAILS_UPDATED", null, {
      version: (old?.version ?? 0) + 1,
    });
  },
});
export const addNote = mutation({
  args: {
    id: v.id("projects"),
    body: v.string(),
    note_type: noteType,
    visibility: noteVisibility,
  },
  handler: async (ctx, a) => {
    const {
      p,
      u,
      a: level,
    } = await core.context(ctx, a.id, ["manage", "design", "crew"], true);
    if (
      level !== "manage" &&
      a.visibility !== (level === "design" ? "design" : "operations")
    )
      deny();
    if (a.note_type === "access")
      deny(
        "INVALID_INPUT",
        "Use the restricted access instructions form for access information.",
      );
    const body = text(a.body, 4000);
    if (!body) deny("INVALID_INPUT");
    await ctx.db.insert("project_notes", {
      project_id: p._id,
      author_id: u.userId,
      body,
      note_type: a.note_type,
      visibility: a.visibility,
      ...core.stamps(),
    });
    await core.audit(ctx, u.userId, p._id, "NOTE_ADDED", null, {
      note_type: a.note_type,
      visibility: a.visibility,
    });
  },
});
export const archiveNote = mutation({
  args: { id: v.id("project_notes") },
  handler: async (ctx, a) => {
    const note = await ctx.db.get(a.id);
    if (!note || note.deleted_at) deny("UNAVAILABLE");
    const { p, u } = await core.context(ctx, note.project_id, ["manage"], true);
    await ctx.db.patch(note._id, {
      deleted_at: core.now(),
      updated_at: core.now(),
    });
    await core.audit(ctx, u.userId, p._id, "NOTE_ARCHIVED", null, {
      id: note._id,
    });
  },
});
export const saveTask = mutation({
  args: {
    project_id: v.id("projects"),
    id: v.optional(v.id("activities")),
    version: v.number(),
    room_id: v.optional(v.id("project_rooms")),
    title: v.string(),
    description: v.string(),
    due_at: v.string(),
    assigned_to: v.id("users"),
    status: v.union(
      v.literal("open"),
      v.literal("completed"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, a) => {
    const {
        p,
        u,
        a: level,
      } = await core.context(
        ctx,
        a.project_id,
        ["manage", "design", "crew"],
        true,
      ),
      old = a.id ? await ctx.db.get(a.id) : null;
    if (a.id && (!old || old.project_id !== p._id || old.deleted_at))
      deny("UNAVAILABLE");
    if (old) core.revision({ version: old.version ?? 1 }, a.version);
    if (
      level === "crew" &&
      (!old ||
        old.assigned_to !== u.userId ||
        a.status !== "completed" ||
        a.assigned_to !== old.assigned_to ||
        a.title !== old.title ||
        a.description !== old.description ||
        a.due_at !== old.due_at ||
        a.room_id !== old.project_room_id)
    )
      deny();
    if (level === "design" && a.assigned_to !== u.userId) deny();
    await core.member(ctx, p, a.assigned_to);
    if (a.room_id) {
      const room = await ctx.db.get(a.room_id);
      if (!room || room.deleted_at || room.project_id !== p._id)
        deny("INVALID_INPUT");
    }
    if (!old && (await core.tasks(ctx, p._id)).length >= 80)
      deny(
        "LIMIT",
        "Archive closed tasks before adding more; maximum 80 active records per project.",
      );
    const title = text(a.title, 160);
    if (!title) deny("INVALID_INPUT");
    const value = {
      title,
      description: text(a.description),
      due_at: core.parse(instant, JSON.stringify(a.due_at)),
      assigned_to: a.assigned_to,
      status: a.status,
      project_room_id: a.room_id,
      completed_at:
        a.status === "completed"
          ? old?.status === "completed"
            ? old.completed_at
            : core.now()
          : null,
      completed_by:
        a.status === "completed"
          ? old?.status === "completed"
            ? old.completed_by
            : u.userId
          : undefined,
      version: (old?.version ?? 0) + 1,
      updated_at: core.now(),
    };
    const id = old
      ? old._id
      : await ctx.db.insert("activities", {
          ...value,
          project_id: p._id,
          type: "task",
          priority: "normal",
          created_by: u.userId,
          replaces_activity_id: null,
          created_at: core.now(),
          deleted_at: null,
        });
    if (old) await ctx.db.patch(old._id, value);
    await core.touch(ctx, p);
    await core.audit(
      ctx,
      u.userId,
      p._id,
      "TASK_UPDATED",
      old ? { id: old._id, status: old.status } : null,
      { id, status: a.status },
    );
    return id;
  },
});
export const archiveTask = mutation({
  args: { id: v.id("activities"), version: v.number() },
  handler: async (ctx, a) => {
    const t = await ctx.db.get(a.id);
    if (!t?.project_id || t.deleted_at || t.status === "open")
      deny("UNAVAILABLE");
    const { p, u } = await core.context(ctx, t.project_id, ["manage"], true);
    core.revision({ version: t.version ?? 1 }, a.version);
    await ctx.db.patch(t._id, {
      deleted_at: core.now(),
      updated_at: core.now(),
      version: (t.version ?? 1) + 1,
    });
    await core.audit(ctx, u.userId, p._id, "TASK_ARCHIVED", null, {
      id: t._id,
    });
  },
});
export const archive = mutation({
  args: { id: v.id("projects"), version: v.number(), restore: v.boolean() },
  handler: async (ctx, a) => {
    const u = await core.admins(ctx),
      p = await core.project(ctx, a.id);
    core.revision(p, a.version);
    if (!closed(p.status))
      deny(
        "INVALID_INPUT",
        "Only completed or cancelled projects can be archived.",
      );
    if ((await core.events(ctx, p._id)).some((e) => e.status === "scheduled"))
      deny("DEPENDENCY", "Cancel outstanding events first.");
    if (!a.restore) await inventoryGate(ctx, p._id, "archive");
    if (a.restore) {
      const other = await ctx.db
        .query("projects")
        .withIndex("by_opportunity", (q) =>
          q.eq("opportunity_id", p.opportunity_id).eq("deleted_at", null),
        )
        .first();
      if (other && other._id !== p._id)
        deny(
          "DUPLICATE",
          "Another non-archived project already exists for this opportunity.",
        );
    }
    await ctx.db.patch(p._id, {
      deleted_at: a.restore ? null : core.now(),
      updated_at: core.now(),
      version: p.version + 1,
    });
    await core.audit(
      ctx,
      u.userId,
      p._id,
      a.restore ? "PROJECT_RESTORED" : "PROJECT_ARCHIVED",
    );
  },
});
export const template = query({
  args: { id: v.optional(v.id("project_checklist_templates")) },
  handler: async (ctx, a) => {
    await core.admins(ctx);
    const t = a.id
      ? await ctx.db.get(a.id)
      : await ctx.db
          .query("project_checklist_templates")
          .withIndex("by_default", (q) =>
            q.eq("is_default", true).eq("deleted_at", null),
          )
          .unique();
    if (!t)
      return {
        id: null,
        name: "Glara Standard Staging Workflow",
        description: "Default operational checklist",
        version: 0,
        items: defaultItems,
      };
    return {
      id: t._id,
      name: t.name,
      description: t.description,
      version: t.version,
      items: await ctx.db
        .query("project_checklist_template_items")
        .withIndex("by_template", (q) =>
          q.eq("template_id", t._id).eq("deleted_at", null),
        )
        .take(81),
    };
  },
});
export const saveTemplate = mutation({
  args: {
    id: v.optional(v.id("project_checklist_templates")),
    version: v.number(),
    name: v.string(),
    description: v.string(),
    items: v.string(),
  },
  handler: async (ctx, a) => {
    const u = await core.admins(ctx),
      items = core.parse(z.array(templateItemInput).min(1).max(80), a.items);
    if (
      new Set(items.filter((i) => i.gate_key).map((i) => i.gate_key)).size !==
      items.filter((i) => i.gate_key).length
    )
      deny("INVALID_INPUT", "Gate keys must be unique within a template.");
    const old = a.id
      ? await ctx.db.get(a.id)
      : a.version === 0
        ? await ctx.db
            .query("project_checklist_templates")
            .withIndex("by_default", (q) =>
              q.eq("is_default", true).eq("deleted_at", null),
            )
            .unique()
        : null;
    core.revision({ version: old?.version ?? 0 }, a.version);
    const name = text(a.name, 120);
    if (!name) deny("INVALID_INPUT");
    const id = old
      ? old._id
      : await ctx.db.insert("project_checklist_templates", {
          name,
          description: text(a.description),
          is_default: !(await ctx.db
            .query("project_checklist_templates")
            .withIndex("by_default", (q) =>
              q.eq("is_default", true).eq("deleted_at", null),
            )
            .first()),
          active: true,
          version: 1,
          ...core.stamps(),
        });
    if (old) {
      await ctx.db.patch(id, {
        name,
        description: text(a.description),
        version: old.version + 1,
        updated_at: core.now(),
      });
      const prior = await ctx.db
        .query("project_checklist_template_items")
        .withIndex("by_template", (q) =>
          q.eq("template_id", id).eq("deleted_at", null),
        )
        .take(81);
      for (const row of prior)
        await ctx.db.patch(row._id, {
          active: false,
          deleted_at: core.now(),
          updated_at: core.now(),
        });
    }
    for (const [index, item] of items.entries())
      await ctx.db.insert("project_checklist_template_items", {
        template_id: id,
        ...item,
        sort_order: index,
        active: true,
        ...core.stamps(),
      });
    await ctx.db.insert("audit_logs", {
      actor_id: u.userId,
      entity: "project_checklist_template",
      entity_id: id,
      action: "TEMPLATE_UPDATED",
      old_value: { version: old?.version ?? 0 },
      new_value: { version: (old?.version ?? 0) + 1, items },
      created_at: core.now(),
    });
    return id;
  },
});
export const saveSettings = mutation({
  args: { version: v.number(), input: v.string() },
  handler: async (ctx, a) => {
    const u = await core.admins(ctx),
      data = core.parse(
        z
          .object({
            max_stagings_per_day: z.number().int().min(1).max(40),
            max_destagings_per_day: z.number().int().min(1).max(40),
            package_alert_days: z
              .array(z.number().int().min(1).max(90))
              .min(1)
              .max(6),
            package_types: z
              .array(z.string().trim().min(1).max(60))
              .min(1)
              .max(20),
          })
          .strict(),
        a.input,
      ),
      old = await ctx.db
        .query("operations_settings")
        .withIndex("by_key", (q) => q.eq("key", "operations"))
        .unique();
    core.revision({ version: old?.version ?? 0 }, a.version);
    const id = old
      ? old._id
      : await ctx.db.insert("operations_settings", {
          key: "operations",
          ...data,
          version: 1,
          ...core.stamps(),
        });
    if (old)
      await ctx.db.patch(old._id, {
        ...data,
        version: old.version + 1,
        updated_at: core.now(),
      });
    await ctx.db.insert("audit_logs", {
      actor_id: u.userId,
      entity: "operations_settings",
      entity_id: id,
      action: "SETTINGS_UPDATED",
      old_value: old ?? defaultSettings,
      new_value: data,
      created_at: core.now(),
    });
  },
});
export const schedule = mutation({
  args: {
    project_id: v.id("projects"),
    project_version: v.number(),
    id: v.optional(v.id("operations_events")),
    version: v.number(),
    event_type: eventType,
    title: v.string(),
    description: v.string(),
    start_at: v.string(),
    end_at: v.string(),
    assigned_lead_id: v.id("users"),
    location_note: v.string(),
  },
  handler: async (ctx, a) => {
    const { p, u } = await core.context(ctx, a.project_id, ["manage"], true);
    core.revision(p, a.project_version);
    const start = core.parse(instant, JSON.stringify(a.start_at)),
      end = core.parse(instant, JSON.stringify(a.end_at));
    if (
      end <= start ||
      Date.parse(end) - Date.parse(start) > 12 * 3600000 ||
      day(start) !== day(end)
    )
      deny(
        "INVALID_INPUT",
        "Use a single Vancouver day with an end after the start (maximum 12 hours).",
      );
    const old = a.id ? await ctx.db.get(a.id) : null;
    if (
      a.id &&
      (!old ||
        old.project_id !== p._id ||
        old.deleted_at ||
        old.status !== "scheduled" ||
        old.event_type !== a.event_type)
    )
      deny("UNAVAILABLE");
    if (old) core.revision(old, a.version);
    const own = await core.events(ctx, p._id);
    if (!old && own.length >= 80)
      deny("LIMIT", "Maximum 80 calendar records per project.");
    const primary = a.event_type === "staging" || a.event_type === "destaging";
    if (
      primary &&
      own.some(
        (e) =>
          e._id !== old?._id &&
          e.event_type === a.event_type &&
          e.status !== "cancelled",
      )
    )
      deny("DUPLICATE", "Reschedule the existing staging or destaging event.");
    if (a.event_type === "staging") {
      if (!["ready_to_schedule", "scheduled"].includes(p.status))
        deny("PLANNING_GATE", "Complete planning before scheduling staging.");
      await core.gate(ctx, p, "pre_staging");
      if (day(start) > p.planned_end_date)
        deny("INVALID_INPUT", "Staging cannot be after the package end date.");
    }
    if (a.event_type === "destaging") {
      if (!["sold", "destaging_scheduled"].includes(p.status))
        deny(
          "PLANNING_GATE",
          "Mark the project sold before scheduling destaging.",
        );
      if (p.sold_date && day(start) < p.sold_date)
        deny("INVALID_INPUT", "Destaging cannot precede the recorded sale.");
    }
    await core.member(ctx, p, a.assigned_lead_id);
    if (primary)
      await core.assignedUser(ctx, a.assigned_lead_id, [
        "owner",
        "admin",
        "staging_crew",
      ]);
    const sameDay = await ctx.db
      .query("operations_events")
      .withIndex("by_day", (q) =>
        q.eq("local_day", day(start)).eq("deleted_at", null),
      )
      .take(201);
    if (sameDay.length >= 201)
      deny("LIMIT", "This day exceeds the calendar conflict-check limit.");
    const booked = sameDay.filter(
      (e) => e._id !== old?._id && e.status !== "cancelled",
    );
    if (
      booked.some(
        (e) =>
          e.start_at < end &&
          e.end_at > start &&
          (e.project_id === p._id || e.assigned_lead_id === a.assigned_lead_id),
      )
    )
      deny(
        "SCHEDULE_CONFLICT",
        "This project or assigned lead already has an overlapping event.",
      );
    const config = await core.settings(ctx);
    if (
      primary &&
      booked.filter((e) => e.event_type === a.event_type).length >=
        (a.event_type === "staging"
          ? config.max_stagings_per_day
          : config.max_destagings_per_day)
    )
      deny(
        "CAPACITY",
        "The daily capacity for this operation has been reached.",
      );
    const title = text(a.title, 160);
    if (!title) deny("INVALID_INPUT");
    const data = {
      project_id: p._id,
      event_type: a.event_type,
      title,
      description: text(a.description),
      start_at: start,
      end_at: end,
      local_day: day(start),
      assigned_lead_id: a.assigned_lead_id,
      location_note: text(a.location_note),
      version: (old?.version ?? 0) + 1,
      updated_at: core.now(),
    };
    const id = old
      ? old._id
      : await ctx.db.insert("operations_events", {
          ...data,
          status: "scheduled",
          created_by: u.userId,
          created_at: core.now(),
          deleted_at: null,
        });
    if (old) await ctx.db.patch(old._id, data);
    if (primary) {
      const items = await core.checks(ctx, p._id);
      for (const item of items) {
        const relevant =
          a.event_type === "staging"
            ? ["staging_day", "staging_previous_day"].includes(
                item.relative_due_rule,
              )
            : item.relative_due_rule === "destaging_day";
        if (relevant && !["completed", "skipped"].includes(item.status)) {
          const due_at =
            item.relative_due_rule === "staging_previous_day"
              ? vancouverUtc(addDays(day(start), -1) + "T17:00")
              : start;
          await ctx.db.patch(item._id, {
            due_at,
            version: item.version + 1,
            updated_at: core.now(),
          });
        }
      }
      const status =
        a.event_type === "staging" ? "scheduled" : "destaging_scheduled";
      await ctx.db.patch(p._id, {
        status,
        version: p.version + 1,
        updated_at: core.now(),
      });
      if (p.status !== status)
        await core.audit(
          ctx,
          u.userId,
          p._id,
          "PROJECT_STATUS_CHANGED",
          { status: p.status },
          { status },
        );
    } else await core.touch(ctx, p);
    await core.audit(
      ctx,
      u.userId,
      p._id,
      old ? "EVENT_RESCHEDULED" : "EVENT_CREATED",
      old
        ? {
            id: old._id,
            start_at: old.start_at,
            end_at: old.end_at,
            lead: old.assigned_lead_id,
          }
        : null,
      {
        id,
        type: a.event_type,
        start_at: start,
        end_at: end,
        lead: a.assigned_lead_id,
        checklist_due_dates_refreshed: primary,
      },
    );
    return id;
  },
});
export const eventState = mutation({
  args: {
    id: v.id("operations_events"),
    version: v.number(),
    status: eventStatus,
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const event = await ctx.db.get(a.id);
    if (
      !event ||
      event.deleted_at ||
      event.status !== "scheduled" ||
      a.status === "scheduled"
    )
      deny("UNAVAILABLE");
    const { p, u } = await core.context(
      ctx,
      event.project_id,
      ["manage"],
      true,
    );
    core.revision(event, a.version);
    const primary =
      event.event_type === "staging" || event.event_type === "destaging";
    if (primary && a.status === "completed")
      deny(
        "CHECKLIST_GATE",
        "Complete the project's stage through its checklist gates.",
      );
    if (primary && ["staging", "destaging"].includes(p.status))
      deny(
        "INVALID_TRANSITION",
        "An operation in progress cannot be unscheduled.",
      );
    const reason = text(a.reason, 500);
    if (a.status === "cancelled" && !reason)
      deny("INVALID_INPUT", "Provide a cancellation reason.");
    await ctx.db.patch(event._id, {
      status: a.status,
      updated_at: core.now(),
      version: event.version + 1,
    });
    if (primary) {
      const status =
        event.event_type === "staging" ? "ready_to_schedule" : "sold";
      await ctx.db.patch(p._id, {
        status,
        version: p.version + 1,
        updated_at: core.now(),
      });
      await core.audit(
        ctx,
        u.userId,
        p._id,
        "PROJECT_STATUS_CHANGED",
        { status: p.status },
        { status },
      );
    } else await core.touch(ctx, p);
    await core.audit(
      ctx,
      u.userId,
      p._id,
      "EVENT_STATUS_CHANGED",
      { id: event._id, status: event.status },
      { status: a.status, reason },
    );
  },
});
export const agenda = query({
  args: { ...pageArgs, start_day: v.string(), end_day: v.string() },
  handler: async (ctx, a) => {
    const u = await core.staff(ctx);
    if (u.roles.every((r) => r === "marketing")) deny();
    const start = core.parse(dateInput, JSON.stringify(a.start_day)),
      end = core.parse(dateInput, JSON.stringify(a.end_day));
    if (end < start || end > addDays(start, 31)) deny("INVALID_INPUT");
    // UTC envelope includes both Vancouver offsets; exact business-day filtering follows.
    const result = await ctx.db
      .query("operations_events")
      .withIndex("by_start", (q) =>
        q
          .eq("deleted_at", null)
          .gte("start_at", start + "T00:00:00.000Z")
          .lt("start_at", addDays(end, 1) + "T12:00:00.000Z"),
      )
      .paginate({
        ...a.paginationOpts,
        numItems: pageLimit(a.paginationOpts.numItems),
        maximumRowsRead: 256,
      });
    const rows = [];
    for (const e of result.page) {
      if (e.status === "cancelled" || e.local_day < start || e.local_day > end)
        continue;
      const p = await ctx.db.get(e.project_id);
      if (!p || p.deleted_at || p.status === "cancelled") continue;
      const level = await core.access(ctx, p, u);
      if (!level || level === "marketing") continue;
      const prop = await ctx.db.get(p.property_id);
      rows.push({
        id: e._id,
        project_id: p._id,
        project_number: p.project_number,
        address: prop?.address_line_1 ?? "",
        city: prop?.city ?? "",
        event_type: e.event_type,
        start_at: e.start_at,
        end_at: e.end_at,
        status: e.status,
        title: level === "sales" ? e.event_type : e.title,
        lead: await core.name(ctx, e.assigned_lead_id),
      });
    }
    return { ...result, page: rows };
  },
});
export const capacity = query({
  args: { date: v.string() },
  handler: async (ctx, a) => {
    await core.admins(ctx);
    const date = core.parse(dateInput, JSON.stringify(a.date)),
      ev = await ctx.db
        .query("operations_events")
        .withIndex("by_day", (q) =>
          q.eq("local_day", date).eq("deleted_at", null),
        )
        .take(201),
      settings = await core.settings(ctx);
    return {
      stagings: ev.filter(
        (e) => e.event_type === "staging" && e.status !== "cancelled",
      ).length,
      destagings: ev.filter(
        (e) => e.event_type === "destaging" && e.status !== "cancelled",
      ).length,
      max_stagings: settings.max_stagings_per_day,
      max_destagings: settings.max_destagings_per_day,
      truncated: ev.length > 200,
    };
  },
});
export const search = query({
  args: { q: v.string() },
  handler: async (ctx, a) => {
    const u = await core.staff(ctx),
      q = text(a.q, 100);
    if (q.length < 2) return [];
    const [numbers, properties, realtors] = await Promise.all([
      ctx.db
        .query("projects")
        .withSearchIndex("search", (s) =>
          s.search("project_number", q).eq("deleted_at", null),
        )
        .take(12),
      ctx.db
        .query("properties")
        .withSearchIndex("search", (s) =>
          s.search("search_text", q).eq("deleted_at", null),
        )
        .take(6),
      ctx.db
        .query("realtors")
        .withSearchIndex("by_sales_name", (s) =>
          s.search("sales_search_text", q).eq("deleted_at", null),
        )
        .take(6),
    ]);
    const candidates = [...numbers];
    for (const p of properties)
      candidates.push(
        ...(await ctx.db
          .query("projects")
          .withIndex("by_property", (s) =>
            s.eq("property_id", p._id).eq("deleted_at", null),
          )
          .take(6)),
      );
    for (const r of realtors)
      candidates.push(
        ...(await ctx.db
          .query("projects")
          .withIndex("by_realtor", (s) =>
            s.eq("realtor_id", r._id).eq("deleted_at", null),
          )
          .take(6)),
      );
    const result = [];
    for (const p of [...new Map(candidates.map((p) => [p._id, p])).values()]) {
      if (!(await core.access(ctx, p, u))) continue;
      const prop = await ctx.db.get(p.property_id);
      result.push({
        id: p._id,
        name: p.project_number + " · " + (prop?.address_line_1 ?? "Project"),
        type: "Project",
      });
      if (result.length === 12) break;
    }
    return result;
  },
});
export const projectOptions = query({
  args: { id: v.id("projects") },
  handler: async (ctx, { id }) => {
    const { p } = await core.context(ctx, id, ["manage", "design", "crew"]);
    const ids = [
      p.project_manager_id,
      p.designer_id,
      p.staging_lead_id,
      ...(await core.assignments(ctx, id)).map((t) => t.user_id),
    ];
    const staff = [];
    for (const userId of [...new Set(ids)]) {
      if (!userId) continue;
      const row = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (row && !row.deleted_at)
        staff.push({ id: userId, name: row.display_name, roles: row.roles });
    }
    return { staff, package_types: (await core.settings(ctx)).package_types };
  },
});
export const attentionQueue = query({
  args: {},
  handler: async (ctx) => {
    const u = await core.staff(ctx),
      config = await core.settings(ctx),
      today = day(),
      cutoff = addDays(today, Math.max(...config.package_alert_days));
    const [expiring, sold, due, work, soon] = await Promise.all([
      Promise.all(
        statuses
          .filter((s) => !closed(s))
          .map((status) =>
            ctx.db
              .query("projects")
              .withIndex("by_status_end", (q) =>
                q
                  .eq("deleted_at", null)
                  .eq("status", status)
                  .gt("planned_end_date", "")
                  .lte("planned_end_date", cutoff),
              )
              .take(9),
          ),
      ),
      ctx.db
        .query("projects")
        .withIndex("by_status", (q) =>
          q.eq("deleted_at", null).eq("status", "sold"),
        )
        .take(41),
      ctx.db
        .query("project_checklist_items")
        .withIndex("by_due", (q) =>
          q
            .eq("status", "pending")
            .eq("deleted_at", null)
            .gt("due_at", null)
            .lt("due_at", core.now()),
        )
        .take(61),
      ctx.db
        .query("activities")
        .withIndex("by_due", (q) =>
          q
            .eq("status", "open")
            .eq("deleted_at", null)
            .gt("due_at", null)
            .lt("due_at", core.now()),
        )
        .take(61),
      ctx.db
        .query("operations_events")
        .withIndex("by_start", (q) =>
          q
            .eq("deleted_at", null)
            .gte("start_at", today + "T00:00:00.000Z")
            .lte("start_at", addDays(today, 4) + "T00:00:00.000Z"),
        )
        .take(61),
    ]);
    const progress = await ctx.db
      .query("project_checklist_items")
      .withIndex("by_due", (q) =>
        q
          .eq("status", "in_progress")
          .eq("deleted_at", null)
          .gt("due_at", null)
          .lt("due_at", core.now()),
      )
      .take(61);
    const expiryRows = expiring
      .flat()
      .sort((a, b) => a.planned_end_date.localeCompare(b.planned_end_date));
    const ids = new Set([
      ...expiryRows.map((p) => p._id),
      ...sold.map((p) => p._id),
      ...due.filter((c) => c.required).map((c) => c.project_id),
      ...progress.filter((c) => c.required).map((c) => c.project_id),
      ...work.flatMap((t) => (t.project_id ? [t.project_id] : [])),
      ...soon.filter((e) => e.status === "scheduled").map((e) => e.project_id),
    ]);
    const rows = [];
    let considered = 0;
    for (const id of ids) {
      if (considered++ >= 20) break;
      const p = await ctx.db.get(id);
      if (!p || p.deleted_at || closed(p.status)) continue;
      const level = await core.access(ctx, p, u);
      if (!level || level === "marketing") continue;
      const card = await core.card(ctx, p, level);
      if (card.attention_reasons.length) rows.push(card);
      if (rows.length >= 12) break;
    }
    return {
      page: rows.sort(
        (a, b) =>
          (a.attention_level === "red" ? 0 : 1) -
          (b.attention_level === "red" ? 0 : 1),
      ),
      partial:
        expiring.some((rows) => rows.length > 8) ||
        sold.length > 40 ||
        [due, progress, work, soon].some((r) => r.length > 60) ||
        ids.size > 20 ||
        rows.length >= 12,
    };
  },
});
