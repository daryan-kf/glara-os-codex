import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { z } from "zod";
import { requireRoles, deny } from "./access";
import { roles, type Role } from "../src/lib/permissions";
import {
  closed,
  marketingStatuses,
  attention,
  defaultSettings,
} from "../src/lib/operations/model";
export type Ctx = QueryCtx | MutationCtx;
export const now = () => new Date().toISOString();
export const stamps = () => ({
  created_at: now(),
  updated_at: now(),
  deleted_at: null,
});
export const revision = (row: { version: number }, expected: number) => {
  if (!Number.isSafeInteger(expected) || row.version !== expected)
    deny("CONFLICT", "This record changed. Reload before saving.");
};
export function parse<T>(schema: z.ZodType<T>, input: string): T {
  try {
    if (input.length > 40000) throw Error();
    return schema.parse(JSON.parse(input));
  } catch {
    return deny("INVALID_INPUT", "Review the fields and try again.");
  }
}
export const staff = async (ctx: Ctx) => requireRoles(ctx, roles);
export const admins = async (ctx: Ctx) => requireRoles(ctx, ["owner", "admin"]);
export const isAdmin = (p: Doc<"profiles">) =>
  p.roles.some((r) => r === "owner" || r === "admin");
export async function project(ctx: Ctx, id: Id<"projects">) {
  const p = await ctx.db.get(id);
  if (!p) return deny("UNAVAILABLE", "Project unavailable.");
  return p;
}
export async function assignments(ctx: Ctx, id: Id<"projects">) {
  return ctx.db
    .query("project_team_assignments")
    .withIndex("by_project", (q) => q.eq("project_id", id).eq("active", true))
    .take(31);
}
export type Access = "manage" | "design" | "crew" | "sales" | "marketing";
export async function access(
  ctx: Ctx,
  p: Doc<"projects">,
  u: Doc<"profiles">,
): Promise<Access | null> {
  if (isAdmin(u)) return "manage";
  if (p.project_manager_id === u.userId && u.roles.includes("sales"))
    return "manage";
  const team = await assignments(ctx, p._id);
  if (
    u.roles.includes("designer") &&
    (p.designer_id === u.userId ||
      team.some((t) => t.user_id === u.userId && t.role === "designer"))
  )
    return "design";
  if (
    u.roles.includes("staging_crew") &&
    (p.staging_lead_id === u.userId ||
      team.some((t) => t.user_id === u.userId && t.role === "crew"))
  )
    return "crew";
  if (u.roles.includes("sales")) {
    const [o, r] = await Promise.all([
      ctx.db.get(p.opportunity_id),
      ctx.db.get(p.realtor_id),
    ]);
    if (o?.assigned_to === u.userId || r?.assigned_to === u.userId)
      return "sales";
  }
  if (
    u.roles.includes("marketing") &&
    !p.deleted_at &&
    marketingStatuses.includes(p.status)
  )
    return "marketing";
  return null;
}
export async function context(
  ctx: Ctx,
  id: Id<"projects">,
  allowed?: readonly Access[],
  edit = false,
) {
  const u = await staff(ctx),
    p = await project(ctx, id),
    a = await access(ctx, p, u);
  if (!a || (allowed && !allowed.includes(a))) return deny();
  if (edit && (p.deleted_at || closed(p.status)))
    return deny(
      "UNAVAILABLE",
      "Completed, cancelled or archived projects cannot be edited.",
    );
  return { u, p, a };
}
export async function assignedUser(
  ctx: Ctx,
  id: Id<"users">,
  allowed: readonly Role[],
) {
  const u = await ctx.db.get(id),
    p = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", id))
      .unique();
  if (!u || !p || p.deleted_at || !p.roles.some((r) => allowed.includes(r)))
    deny(
      "INVALID_INPUT",
      "Select an active staff member with the appropriate role.",
    );
  return p!;
}
export async function member(ctx: Ctx, p: Doc<"projects">, id: Id<"users">) {
  await assignedUser(ctx, id, [
    "owner",
    "admin",
    "sales",
    "designer",
    "staging_crew",
  ]);
  if ([p.project_manager_id, p.designer_id, p.staging_lead_id].includes(id))
    return;
  const team = await assignments(ctx, p._id);
  if (!team.some((t) => t.user_id === id))
    deny("INVALID_INPUT", "Assign this staff member to the project first.");
}
export async function checks(ctx: Ctx, id: Id<"projects">) {
  return ctx.db
    .query("project_checklist_items")
    .withIndex("by_project", (q) =>
      q.eq("project_id", id).eq("deleted_at", null),
    )
    .take(81);
}
export async function events(ctx: Ctx, id: Id<"projects">) {
  return ctx.db
    .query("operations_events")
    .withIndex("by_project", (q) =>
      q.eq("project_id", id).eq("deleted_at", null),
    )
    .take(81);
}
export async function tasks(ctx: Ctx, id: Id<"projects">) {
  return ctx.db
    .query("activities")
    .withIndex("by_project", (q) =>
      q.eq("project_id", id).eq("deleted_at", null),
    )
    .take(81);
}
export async function rooms(ctx: Ctx, id: Id<"projects">) {
  return ctx.db
    .query("project_rooms")
    .withIndex("by_project_sort", (q) =>
      q.eq("project_id", id).eq("deleted_at", null),
    )
    .take(41);
}
export async function settings(ctx: Ctx) {
  return (
    (await ctx.db
      .query("operations_settings")
      .withIndex("by_key", (q) => q.eq("key", "operations"))
      .unique()) ?? { ...defaultSettings, version: 0 }
  );
}
export async function audit(
  ctx: MutationCtx,
  actor: Id<"users">,
  id: Id<"projects">,
  action: string,
  old: unknown = null,
  value: unknown = null,
) {
  await ctx.db.insert("audit_logs", {
    actor_id: actor,
    entity: "project",
    entity_id: id,
    action,
    old_value: old,
    new_value: value,
    created_at: now(),
  });
}
export async function touch(ctx: MutationCtx, p: Doc<"projects">) {
  await ctx.db.patch(p._id, { version: p.version + 1, updated_at: now() });
}
export async function gate(
  ctx: Ctx,
  p: Doc<"projects">,
  category: "pre_staging" | "staging" | "destaging",
) {
  const items = await checks(ctx, p._id);
  if (
    items.some(
      (c) => c.category === category && c.required && c.status !== "completed",
    )
  )
    deny(
      "CHECKLIST_GATE",
      "Complete the required checklist for this stage first.",
    );
  if (category === "pre_staging") {
    if (
      !p.project_manager_id ||
      !p.designer_id ||
      !p.staging_lead_id ||
      !p.planned_end_date
    )
      deny(
        "PLANNING_GATE",
        "Assign the manager, designer and staging lead, and set the package end date first.",
      );
    await assignedUser(ctx, p.project_manager_id, ["owner", "admin", "sales"]);
    await assignedUser(ctx, p.designer_id, ["owner", "admin", "designer"]);
    await assignedUser(ctx, p.staging_lead_id, [
      "owner",
      "admin",
      "staging_crew",
    ]);
    const list = await rooms(ctx, p._id);
    if (!list.length || list.some((r) => r.status === "planned"))
      deny(
        "PLANNING_GATE",
        "Confirm the room plan and mark every room design ready.",
      );
  }
}
export async function name(ctx: Ctx, id: Id<"users"> | null) {
  if (!id) return "Unassigned";
  const row = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", id))
    .unique();
  return row?.display_name ?? "Former team member";
}
export async function card(ctx: Ctx, p: Doc<"projects">, a: Access) {
  const [prop, r, ev] = await Promise.all([
    ctx.db.get(p.property_id),
    ctx.db.get(p.realtor_id),
    events(ctx, p._id),
  ]);
  const dates = {
    staging_date:
      ev.find((e) => e.event_type === "staging" && e.status !== "cancelled")
        ?.start_at ?? null,
    destaging_date:
      ev.find((e) => e.event_type === "destaging" && e.status !== "cancelled")
        ?.start_at ?? null,
  };
  const base = {
    id: p._id,
    project_number: p.project_number,
    property_address: prop
      ? [prop.address_line_1, prop.address_line_2].filter(Boolean).join(", ")
      : "Archived property",
    city: prop?.city ?? "",
    realtor_name: r ? `${r.first_name} ${r.last_name}` : "Former Realtor",
    status: p.status,
    priority: p.priority,
    ...dates,
    planned_end_date: p.planned_end_date,
    listing_live_date: p.listing_live_date,
    pending_sale_date: p.pending_sale_date,
    sold_date: p.sold_date,
    completed_at: p.completed_at,
    deleted_at: p.deleted_at,
  };
  if (a === "marketing")
    return {
      ...base,
      project_manager_name: null,
      designer_name: null,
      staging_lead_name: null,
      required_open_count: 0,
      overdue_count: 0,
      attention_level: "green",
      attention_reasons: [] as string[],
    };
  const [manager, designer, lead, items, work, config] = await Promise.all([
    name(ctx, p.project_manager_id),
    name(ctx, p.designer_id),
    name(ctx, p.staging_lead_id),
    checks(ctx, p._id),
    tasks(ctx, p._id),
    settings(ctx),
  ]);
  return {
    ...base,
    project_manager_name: manager,
    designer_name: designer,
    staging_lead_name: lead,
    ...attention(p, ev, items, work, config.package_alert_days),
  };
}
