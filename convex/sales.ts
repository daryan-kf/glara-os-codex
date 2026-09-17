import {
  query,
  mutation,
  internalMutation,
  type QueryCtx,
  type MutationCtx,
} from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { z } from "zod";
import { requireRoles, operational, assignee, deny } from "./access";
import {
  propertyInput,
  opportunityInput,
  consultationInput,
  quoteInput,
  actionInput,
  stageInput,
  quoteMath,
  cents,
  active,
  stages,
  transitions,
  type Stage,
} from "../src/lib/sales/model";
type Ctx = QueryCtx | MutationCtx;
const manager = (u: Doc<"profiles">) =>
  u.roles.some((r) => r === "owner" || r === "admin");
const assigned = (u: Doc<"profiles">, row: { assigned_to: Id<"users"> }) =>
  manager(u) || row.assigned_to === u.userId;
async function propertyVisible(
  ctx: Ctx,
  u: Doc<"profiles">,
  p: Doc<"properties">,
) {
  if (manager(u) || !u.roles.includes("sales")) return true;
  const realtor = await ctx.db.get(p.realtor_id);
  return (
    realtor?.assigned_to === u.userId ||
    !!(await ctx.db
      .query("opportunities")
      .withIndex("by_property", (q) =>
        q.eq("property_id", p._id).eq("deleted_at", null),
      )
      .filter((q) => q.eq(q.field("assigned_to"), u.userId))
      .first())
  );
}
async function visibleProperties(
  ctx: Ctx,
  u: Doc<"profiles">,
  rows: Doc<"properties">[],
) {
  const allowed = await Promise.all(
    rows.map((p) => propertyVisible(ctx, u, p)),
  );
  return rows.filter((_, i) => allowed[i]);
}

const stageValue = v.union(
  v.literal("new"),
  v.literal("contacted"),
  v.literal("interested"),
  v.literal("consultation"),
  v.literal("quote_sent"),
  v.literal("negotiation"),
  v.literal("won"),
  v.literal("lost"),
);
const now = () => new Date().toISOString();
const stamps = () => ({
  created_at: now(),
  updated_at: now(),
  deleted_at: null,
});
const normalize = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");
function parse<T>(schema: z.ZodType<T>, input: string): T {
  try {
    if (input.length > 60000) throw Error();
    return schema.parse(JSON.parse(input));
  } catch {
    return deny("INVALID_INPUT");
  }
}
function version(row: { version: number }, expected: number) {
  if (row.version !== expected) deny("CONFLICT");
}
async function audit(
  ctx: MutationCtx,
  actor: Id<"users">,
  entity: string,
  id: string,
  old: unknown,
  value: unknown,
  action = "UPDATE",
) {
  await ctx.db.insert("audit_logs", {
    actor_id: actor,
    entity,
    entity_id: id,
    action,
    old_value: old ?? null,
    new_value: value ?? null,
    created_at: now(),
  });
}
async function property(ctx: Ctx, id: Id<"properties">) {
  const p = await ctx.db.get(id);
  if (!p || p.deleted_at) return deny("UNAVAILABLE");
  const r = await ctx.db.get(p.realtor_id);
  if (!r || r.deleted_at) return deny("UNAVAILABLE");
  const u = await requireRoles(ctx, operational);
  if (!(await propertyVisible(ctx, u, p))) deny("UNAVAILABLE");
  return p;
}
async function opportunity(ctx: Ctx, id: Id<"opportunities">) {
  const o = await ctx.db.get(id);
  if (!o || o.deleted_at) return deny("UNAVAILABLE");
  const u = await requireRoles(ctx, operational);
  if (!assigned(u, o)) deny("UNAVAILABLE");
  await property(ctx, o.property_id);
  return o;
}
async function nextAction(ctx: Ctx, id: Id<"opportunities">) {
  return ctx.db
    .query("activities")
    .withIndex("by_opportunity", (q) =>
      q.eq("opportunity_id", id).eq("status", "open").eq("deleted_at", null),
    )
    .first();
}
async function invariant(ctx: Ctx, o: Doc<"opportunities">) {
  if (active(o.stage as Stage) && !(await nextAction(ctx, o._id)))
    deny("NEXT_ACTION_REQUIRED");
}
async function metric(
  ctx: MutationCtx,
  key: string,
  count: number,
  value: bigint,
) {
  const row = await ctx.db
    .query("sales_metrics")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const data = {
    key,
    count: (row?.count ?? 0) + count,
    cents: String(BigInt(row?.cents ?? "0") + value),
  };
  if (row) await ctx.db.patch(row._id, data);
  else await ctx.db.insert("sales_metrics", data);
}
const month = (date: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
  })
    .format(new Date(date))
    .slice(0, 7);
async function realtorCount(
  ctx: MutationCtx,
  id: Id<"realtors">,
  delta: number,
) {
  const row = await ctx.db
    .query("sales_realtor_counts")
    .withIndex("by_realtor", (q) => q.eq("realtor_id", id))
    .unique();
  if (row) await ctx.db.patch(row._id, { count: row.count + delta });
  else
    await ctx.db.insert("sales_realtor_counts", {
      realtor_id: id,
      count: delta,
    });
}
export async function updateMetrics(
  ctx: MutationCtx,
  old: Doc<"opportunities"> | null,
  next: Doc<"opportunities">,
) {
  if (old?.ranking_counted && !old.deleted_at)
    await realtorCount(ctx, old.realtor_id, -1);
  if (!next.deleted_at) await realtorCount(ctx, next.realtor_id, 1);
  if (!next.ranking_counted)
    await ctx.db.patch(next._id, { ranking_counted: true });
  for (const [r, sign] of [
    [old, -1],
    [next, 1],
  ] as const) {
    if (!r || r.deleted_at) continue;
    await metric(
      ctx,
      "stage:" + r.stage,
      sign,
      BigInt(r.estimated_value_cents) * BigInt(sign),
    );
    const date = r.won_at ?? r.lost_at;
    if (date) await metric(ctx, r.stage + ":" + month(date), sign, 0n);
  }
}
async function addAction(
  ctx: MutationCtx,
  actor: Id<"users">,
  parent: {
    opportunity_id?: Id<"opportunities">;
    property_id?: Id<"properties">;
  },
  title: string,
  due: string,
  owner: Id<"users">,
  description = "",
  replaces: Id<"activities"> | null = null,
) {
  if (!title || !due) deny("NEXT_ACTION_REQUIRED");
  await assignee(ctx, owner);
  const id = await ctx.db.insert("activities", {
    ...parent,
    type: "follow_up",
    title,
    description,
    due_at: new Date(due).toISOString(),
    completed_at: null,
    status: "open",
    priority: "normal",
    assigned_to: owner,
    created_by: actor,
    replaces_activity_id: replaces,
    ...stamps(),
  });
  await audit(
    ctx,
    actor,
    "activities",
    id,
    null,
    await ctx.db.get(id),
    "INSERT",
  );
  return id;
}
async function cards(ctx: Ctx, rows: Doc<"opportunities">[]) {
  const user = await requireRoles(ctx, operational);
  rows = rows.filter((r) => assigned(user, r));
  const properties = new Map<string, Doc<"properties"> | null>(),
    realtors = new Map<string, Doc<"realtors"> | null>(),
    names = new Map<string, string>();
  for (const id of new Set(rows.map((r) => r.property_id)))
    properties.set(id, await ctx.db.get(id));
  for (const id of new Set(rows.map((r) => r.realtor_id)))
    realtors.set(id, await ctx.db.get(id));
  for (const id of new Set(rows.map((r) => r.assigned_to))) {
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", id))
      .unique();
    names.set(id, p?.display_name ?? "Unavailable");
  }
  return Promise.all(
    rows.map(async (o) => {
      const p = properties.get(o.property_id),
        r = realtors.get(o.realtor_id),
        a = await nextAction(ctx, o._id);
      return {
        ...o,
        address: p?.address_line_1 ?? "Archived property",
        city: p?.city ?? "",
        realtor_name: r ? `${r.first_name} ${r.last_name}` : "Unavailable",
        owner_name: names.get(o.assigned_to) ?? "Unavailable",
        next_action: a ? { id: a._id, title: a.title, due_at: a.due_at } : null,
      };
    }),
  );
}
const bounded = (opts: { numItems: number; cursor: string | null }) => {
  if (opts.numItems < 1 || opts.numItems > 30) deny("INVALID_INPUT");
  return { ...opts, maximumRowsRead: 256, maximumBytesRead: 1000000 };
};
export const listProperties = query({
  args: {
    paginationOpts: paginationOptsValidator,
    q: v.optional(v.string()),
    city: v.optional(v.string()),
    realtor_id: v.optional(v.id("realtors")),
    property_type: v.optional(v.string()),
    occupancy: v.optional(v.string()),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, [
      ...operational,
      "marketing",
      "designer",
    ]);
    const privateAccess = user.roles.some((r) => operational.includes(r));
    if (a.archived && !user.roles.some((r) => r === "owner" || r === "admin"))
      deny();
    const term = (a.q ?? "").trim().slice(0, 100);
    let query = term
      ? ctx.db
          .query("properties")
          .withSearchIndex("search", (q) =>
            q.search("search_text", term).eq("deleted_at", null),
          )
      : a.realtor_id
        ? ctx.db
            .query("properties")
            .withIndex("by_realtor", (q) => q.eq("realtor_id", a.realtor_id!))
        : a.city
          ? ctx.db
              .query("properties")
              .withIndex("by_city", (q) => q.eq("city", a.city!))
          : ctx.db.query("properties").withIndex("by_archived");
    query = query.filter((q) =>
      q.and(
        a.archived
          ? q.neq(q.field("deleted_at"), null)
          : q.eq(q.field("deleted_at"), null),
        a.city ? q.eq(q.field("city"), a.city) : true,
        a.realtor_id ? q.eq(q.field("realtor_id"), a.realtor_id) : true,
        a.property_type
          ? q.eq(q.field("property_type"), a.property_type)
          : true,
        a.occupancy ? q.eq(q.field("occupancy_status"), a.occupancy) : true,
      ),
    );
    const result = await query.paginate(bounded(a.paginationOpts));
    return {
      ...result,
      page: (await visibleProperties(ctx, user, result.page)).map((p) =>
        privateAccess
          ? p
          : {
              _id: p._id,
              address_line_1: p.address_line_1,
              city: p.city,
              property_type: p.property_type,
              occupancy_status: p.occupancy_status,
              bedrooms: p.bedrooms,
              bathrooms: p.bathrooms,
              square_feet: p.square_feet,
            },
      ),
    };
  },
});
export const listOpportunities = query({
  args: {
    paginationOpts: paginationOptsValidator,
    stage: v.optional(stageValue),
    realtor_id: v.optional(v.id("realtors")),
    property_id: v.optional(v.id("properties")),
    assigned_to: v.optional(v.id("users")),
    source: v.optional(v.id("lead_sources")),
    q: v.optional(v.string()),
    city: v.optional(v.string()),
    overdue: v.optional(v.boolean()),
    sort: v.optional(v.union(v.literal("newest"), v.literal("oldest"))),
    archived: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, operational);
    if (!manager(user)) a.assigned_to = user.userId;
    if (a.archived && !user.roles.some((r) => r === "owner" || r === "admin"))
      deny();
    let base =
      a.stage && !a.archived
        ? ctx.db
            .query("opportunities")
            .withIndex("by_stage", (q) =>
              q.eq("deleted_at", null).eq("stage", a.stage!),
            )
        : a.property_id
          ? ctx.db
              .query("opportunities")
              .withIndex("by_property", (q) =>
                q.eq("property_id", a.property_id!),
              )
          : a.realtor_id
            ? ctx.db
                .query("opportunities")
                .withIndex("by_realtor", (q) =>
                  q.eq("realtor_id", a.realtor_id!),
                )
            : a.assigned_to
              ? ctx.db
                  .query("opportunities")
                  .withIndex("by_assigned", (q) =>
                    q.eq("assigned_to", a.assigned_to!),
                  )
              : ctx.db.query("opportunities").withIndex("by_archived");
    base = base.filter((q) =>
      q.and(
        a.archived
          ? q.neq(q.field("deleted_at"), null)
          : q.eq(q.field("deleted_at"), null),
        a.realtor_id ? q.eq(q.field("realtor_id"), a.realtor_id) : true,
        a.property_id ? q.eq(q.field("property_id"), a.property_id) : true,
        a.stage ? q.eq(q.field("stage"), a.stage) : true,
        a.assigned_to ? q.eq(q.field("assigned_to"), a.assigned_to) : true,
        a.source ? q.eq(q.field("lead_source_id"), a.source) : true,
      ),
    );
    const result = await base
      .order(a.sort === "oldest" ? "asc" : "desc")
      .paginate(bounded(a.paginationOpts));
    const joined = await cards(ctx, result.page);
    return {
      ...result,
      page: joined.filter(
        (o) =>
          (!a.q ||
            (o.address + " " + o.realtor_name)
              .toLowerCase()
              .includes(a.q.toLowerCase().slice(0, 100))) &&
          (!a.city || o.city.toLowerCase().includes(a.city.toLowerCase())) &&
          (!a.overdue ||
            (active(o.stage as Stage) &&
              o.next_action?.due_at &&
              o.next_action.due_at < now())),
      ),
    };
  },
});
export const pipeline = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRoles(ctx, operational);
    return Promise.all(
      stages.map(async (stage) => ({
        stage,
        rows: await cards(
          ctx,
          await ctx.db
            .query("opportunities")
            .withIndex("by_stage", (q) =>
              q.eq("deleted_at", null).eq("stage", stage),
            )
            .order("desc")
            .take(6),
        ),
        totals: !manager(user)
          ? null
          : await ctx.db
              .query("sales_metrics")
              .withIndex("by_key", (q) => q.eq("key", "stage:" + stage))
              .unique(),
      })),
    );
  },
});
export const summary = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRoles(ctx, operational);
    if (!manager(user)) {
      const rows = await ctx.db
        .query("opportunities")
        .withIndex("by_assigned", (q) =>
          q.eq("assigned_to", user.userId).eq("deleted_at", null),
        )
        .take(501);
      if (rows.length > 500)
        deny("LIMIT", "Personal pipeline requires paginated review.");
      let awaiting = 0,
        overdue = 0;
      for (const o of rows) {
        const next = await nextAction(ctx, o._id);
        if (active(o.stage as Stage) && next?.due_at && next.due_at < now())
          overdue++;
        const quotes = await ctx.db
          .query("quotes")
          .withIndex("by_opportunity", (q) =>
            q.eq("opportunity_id", o._id).eq("deleted_at", null),
          )
          .filter((q) =>
            q.and(
              q.eq(q.field("status"), "sent"),
              q.gte(q.field("valid_until"), now().slice(0, 10)),
            ),
          )
          .take(501);
        awaiting += quotes.length;
      }
      const open = rows.filter((o) => active(o.stage as Stage));
      return {
        open_count: open.length,
        open_value_cents: String(
          open.reduce((n, o) => n + BigInt(o.estimated_value_cents), 0n),
        ),
        won: rows.filter((o) => o.won_at && month(o.won_at) === month(now()))
          .length,
        lost: rows.filter((o) => o.lost_at && month(o.lost_at) === month(now()))
          .length,
        awaiting: Math.min(awaiting, 500),
        awaiting_limited: awaiting > 500,
        overdue,
        overdue_limited: false,
      };
    }
    const stats = await Promise.all(
      stages.map((stage) =>
        ctx.db
          .query("sales_metrics")
          .withIndex("by_key", (q) => q.eq("key", "stage:" + stage))
          .unique(),
      ),
    );
    const monthKey = month(now());
    const won = await ctx.db
        .query("sales_metrics")
        .withIndex("by_key", (q) => q.eq("key", "won:" + monthKey))
        .unique(),
      lost = await ctx.db
        .query("sales_metrics")
        .withIndex("by_key", (q) => q.eq("key", "lost:" + monthKey))
        .unique();
    const waiting = await ctx.db
      .query("quotes")
      .withIndex("by_status", (q) =>
        q
          .eq("deleted_at", null)
          .eq("status", "sent")
          .gte("valid_until", now().slice(0, 10)),
      )
      .take(501);
    const due = await ctx.db
      .query("activities")
      .withIndex("by_due", (q) =>
        q.eq("status", "open").eq("deleted_at", null).lt("due_at", now()),
      )
      .take(501);
    const overdue = new Set<string>();
    for (const a of due) {
      if (a.opportunity_id) {
        const o = await ctx.db.get(a.opportunity_id);
        if (o && !o.deleted_at && active(o.stage as Stage)) overdue.add(o._id);
      }
    }
    return {
      open_count: stats.slice(0, 6).reduce((s, r) => s + (r?.count ?? 0), 0),
      open_value_cents: String(
        stats.slice(0, 6).reduce((s, r) => s + BigInt(r?.cents ?? "0"), 0n),
      ),
      won: won?.count ?? 0,
      lost: lost?.count ?? 0,
      awaiting: Math.min(waiting.length, 500),
      awaiting_limited: waiting.length > 500,
      overdue: overdue.size,
      overdue_limited: due.length > 500,
    };
  },
});
export const getProperty = query({
  args: { id: v.id("properties") },
  handler: async (ctx, { id }) => {
    const user = await requireRoles(ctx, [
      ...operational,
      "marketing",
      "designer",
    ]);
    const p = await ctx.db.get(id);
    if (!p || !(await propertyVisible(ctx, user, p))) return null;
    const full = user.roles.some((r) => operational.includes(r));
    if (p.deleted_at && !user.roles.some((r) => r === "owner" || r === "admin"))
      return null;
    const r = await ctx.db.get(p.realtor_id);
    const safe = {
      _id: p._id,
      address_line_1: p.address_line_1,
      address_line_2: p.address_line_2,
      city: p.city,
      province: p.province,
      postal_code: p.postal_code,
      property_type: p.property_type,
      occupancy_status: p.occupancy_status,
      bedrooms: p.bedrooms,
      bathrooms: p.bathrooms,
      square_feet: p.square_feet,
      realtor_name: r ? `${r.first_name} ${r.last_name}` : "Unavailable",
    };
    if (!full) return { property: safe, commercial: false as const };
    const opportunities = (
      await ctx.db
        .query("opportunities")
        .withIndex("by_property", (q) =>
          q.eq("property_id", id).eq("deleted_at", null),
        )
        .take(21)
    ).filter((o) => assigned(user, o));
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_property", (q) =>
        q.eq("property_id", id).eq("deleted_at", null),
      )
      .order("desc")
      .take(30);
    return {
      property: { ...p, ...safe },
      commercial: true as const,
      opportunities: await cards(ctx, opportunities.slice(0, 20)),
      hasMore: opportunities.length > 20,
      activities: activities.filter(
        (a) => manager(user) || a.assigned_to === user.userId,
      ),
      consultations: (
        await Promise.all(
          opportunities.slice(0, 20).map((o) =>
            ctx.db
              .query("consultations")
              .withIndex("by_opportunity", (q) =>
                q.eq("opportunity_id", o._id).eq("deleted_at", null),
              )
              .order("desc")
              .take(3),
          ),
        )
      ).flat(),
      quotes: (
        await Promise.all(
          opportunities.slice(0, 20).map((o) =>
            ctx.db
              .query("quotes")
              .withIndex("by_opportunity", (q) =>
                q.eq("opportunity_id", o._id).eq("deleted_at", null),
              )
              .order("desc")
              .take(3),
          ),
        )
      ).flat(),
    };
  },
});
export const getOpportunity = query({
  args: { id: v.id("opportunities") },
  handler: async (ctx, { id }) => {
    const user = await requireRoles(ctx, operational);
    const o = await ctx.db.get(id);
    if (
      !o ||
      !assigned(user, o) ||
      (o.deleted_at && !user.roles.some((r) => r === "owner" || r === "admin"))
    )
      return null;
    const p = await ctx.db.get(o.property_id);
    const consultations = await ctx.db
      .query("consultations")
      .withIndex("by_opportunity", (q) =>
        q.eq("opportunity_id", id).eq("deleted_at", null),
      )
      .order("desc")
      .take(30);
    const quotes = await ctx.db
      .query("quotes")
      .withIndex("by_opportunity", (q) =>
        q.eq("opportunity_id", id).eq("deleted_at", null),
      )
      .order("desc")
      .take(30);
    const activities = await ctx.db
      .query("activities")
      .withIndex("by_opportunity", (q) => q.eq("opportunity_id", id))
      .order("desc")
      .take(50);
    const history = await ctx.db
      .query("audit_logs")
      .withIndex("by_entity", (q) => q.eq("entity_id", id))
      .order("desc")
      .take(30);
    return {
      opportunity: (await cards(ctx, [o]))[0],
      property: p,
      consultations,
      quotes,
      activities,
      history: history.map((a) => ({
        _id: a._id,
        action: a.action,
        created_at: a.created_at,
      })),
      source: o.lead_source_id
        ? (await ctx.db.get(o.lead_source_id))?.name
        : null,
    };
  },
});
export const options = query({
  args: {
    kind: v.union(
      v.literal("realtors"),
      v.literal("properties"),
      v.literal("opportunities"),
    ),
    q: v.string(),
  },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, operational);
    const q = a.q.trim().slice(0, 100);
    if (a.kind === "realtors") {
      const rows = q
        ? await ctx.db
            .query("realtors")
            .withSearchIndex("by_sales_name", (s) =>
              s.search("sales_search_text", q).eq("deleted_at", null),
            )
            .take(20)
        : await ctx.db
            .query("realtors")
            .withIndex("by_archived", (s) => s.eq("deleted_at", null))
            .order("desc")
            .take(20);
      return rows
        .filter((r) => assigned(user, r))
        .map((r) => ({
          id: r._id,
          name: r.first_name + " " + r.last_name,
        }));
    }
    if (a.kind === "properties") {
      const rows = q
        ? await ctx.db
            .query("properties")
            .withSearchIndex("search", (s) =>
              s.search("search_text", q).eq("deleted_at", null),
            )
            .take(20)
        : await ctx.db
            .query("properties")
            .withIndex("by_archived", (q) => q.eq("deleted_at", null))
            .order("desc")
            .take(20);
      return (await visibleProperties(ctx, user, rows)).map((p) => ({
        id: p._id,
        name: p.address_line_1 + " Â· " + p.city,
      }));
    }
    const properties = q
      ? await ctx.db
          .query("properties")
          .withSearchIndex("search", (s) =>
            s.search("search_text", q).eq("deleted_at", null),
          )
          .take(5)
      : [];
    const rows = q
      ? (
          await Promise.all(
            properties.map((p) =>
              ctx.db
                .query("opportunities")
                .withIndex("by_property", (s) =>
                  s.eq("property_id", p._id).eq("deleted_at", null),
                )
                .take(4),
            ),
          )
        ).flat()
      : await ctx.db
          .query("opportunities")
          .withIndex("by_archived", (s) => s.eq("deleted_at", null))
          .order("desc")
          .take(20);
    return (await cards(ctx, rows)).map((o) => ({
      id: o._id,
      name: o.address + " â€” " + o.stage,
    }));
  },
});
export const saveProperty = mutation({
  args: {
    id: v.optional(v.id("properties")),
    version: v.number(),
    input: v.string(),
  },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, operational),
      d = parse(propertyInput, a.input);
    const rid = ctx.db.normalizeId("realtors", d.realtor_id);
    if (!rid) return deny("INVALID_INPUT");
    const r = await ctx.db.get(rid);
    if (!r || r.deleted_at || !assigned(user, r)) return deny("UNAVAILABLE");
    const old = a.id ? await property(ctx, a.id) : null;
    if (old) version(old, a.version);
    if (
      old &&
      old.realtor_id !== rid &&
      (await ctx.db
        .query("opportunities")
        .withIndex("by_property", (q) => q.eq("property_id", old._id))
        .first())
    )
      deny(
        "INVALID_INPUT",
        "Primary Realtor cannot change after opportunities exist.",
      );
    const address_key = normalize(
        [d.address_line_1, d.address_line_2, d.city, d.province].join(" "),
      ),
      mls_key = normalize(d.mls_number);
    for (const row of await ctx.db
      .query("properties")
      .withIndex("by_address", (q) =>
        q.eq("address_key", address_key).eq("deleted_at", null),
      )
      .take(50))
      if (!row.deleted_at && row._id !== old?._id) deny("DUPLICATE");
    if (mls_key)
      for (const row of await ctx.db
        .query("properties")
        .withIndex("by_mls", (q) =>
          q.eq("mls_key", mls_key).eq("deleted_at", null),
        )
        .take(50))
        if (!row.deleted_at && row._id !== old?._id) deny("DUPLICATE");
    const { listing_price, ...fields } = d;
    const value = {
      ...fields,
      realtor_id: rid,
      bedrooms: d.bedrooms === "" ? null : Number(d.bedrooms),
      bathrooms: d.bathrooms === "" ? null : Number(d.bathrooms),
      square_feet: d.square_feet === "" ? null : Number(d.square_feet),
      listing_price_cents: listing_price ? String(cents(listing_price)) : null,
      address_key,
      mls_key,
      search_text: [
        d.address_line_1,
        d.address_line_2,
        d.city,
        d.mls_number,
      ].join(" "),
      version: (old?.version ?? 0) + 1,
      updated_at: now(),
    };
    const id = old
      ? old._id
      : await ctx.db.insert("properties", { ...stamps(), ...value });
    if (old) await ctx.db.patch(id, value);
    await audit(
      ctx,
      user.userId,
      "properties",
      id,
      old,
      await ctx.db.get(id),
      old ? "UPDATE" : "INSERT",
    );
    return id;
  },
});
export const saveOpportunity = mutation({
  args: {
    id: v.optional(v.id("opportunities")),
    version: v.number(),
    input: v.string(),
  },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, operational),
      d = parse(opportunityInput, a.input);
    const pid = ctx.db.normalizeId("properties", d.property_id),
      owner = ctx.db.normalizeId("users", d.assigned_to);
    if (!pid || !owner) return deny("INVALID_INPUT");
    if (!manager(user) && owner !== user.userId) deny("FORBIDDEN");
    const p = await property(ctx, pid);
    await assignee(ctx, owner);
    const old = a.id ? await opportunity(ctx, a.id) : null;
    if (old) {
      version(old, a.version);
      if (old.property_id !== pid) deny("INVALID_INPUT");
    } else {
      const others = await ctx.db
        .query("opportunities")
        .withIndex("by_property", (q) =>
          q.eq("property_id", pid).eq("deleted_at", null),
        )
        .filter((q) =>
          q.and(
            q.neq(q.field("stage"), "won"),
            q.neq(q.field("stage"), "lost"),
          ),
        )
        .first();
      if (others) deny("DUPLICATE");
    }
    const source = d.lead_source_id
      ? ctx.db.normalizeId("lead_sources", d.lead_source_id)
      : null;
    if (d.lead_source_id && !source) deny("INVALID_INPUT");
    if (source) {
      const s = await ctx.db.get(source);
      if (!s || s.deleted_at) deny("UNAVAILABLE");
    }
    const value = {
      property_id: pid,
      realtor_id: p.realtor_id,
      assigned_to: owner,
      estimated_value_cents: String(cents(d.estimated_value)),
      probability: d.probability,
      expected_close_date: d.expected_close_date,
      lead_source_id: source,
      notes: d.notes,
      version: (old?.version ?? 0) + 1,
      updated_at: now(),
    };
    const id = old
      ? old._id
      : await ctx.db.insert("opportunities", {
          ...stamps(),
          ...value,
          stage: "new",
          stage_changed_at: now(),
          won_at: null,
          lost_at: null,
          lost_reason: "",
          lost_notes: "",
        });
    if (old) await ctx.db.patch(id, value);
    if (d.next_action_title)
      await addAction(
        ctx,
        user.userId,
        { opportunity_id: id },
        d.next_action_title,
        d.next_action_date,
        owner,
      );
    const next = (await ctx.db.get(id))!;
    await invariant(ctx, next);
    await updateMetrics(ctx, old, next);
    await audit(
      ctx,
      user.userId,
      "opportunities",
      id,
      old,
      next,
      old ? "UPDATE" : "INSERT",
    );
    return id;
  },
});
export const transition = mutation({
  args: { id: v.id("opportunities"), version: v.number(), input: v.string() },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, operational),
      old = await opportunity(ctx, a.id),
      d = parse(stageInput, a.input);
    version(old, a.version);
    if (
      old.stage === "won" &&
      (await ctx.db
        .query("projects")
        .withIndex("by_opportunity", (q) => q.eq("opportunity_id", old._id))
        .first())
    )
      deny(
        "INVALID_INPUT",
        "A project preserves this won commercial handoff. Cancel the project through operations instead.",
      );
    if (!transitions(old.stage as Stage).includes(d.stage))
      deny("INVALID_INPUT", "Stage transition not allowed.");
    if (!active(old.stage as Stage) && active(d.stage)) {
      const other = await ctx.db
        .query("opportunities")
        .withIndex("by_property", (q) =>
          q.eq("property_id", old.property_id).eq("deleted_at", null),
        )
        .filter((q) =>
          q.and(
            q.neq(q.field("_id"), old._id),
            q.neq(q.field("stage"), "won"),
            q.neq(q.field("stage"), "lost"),
          ),
        )
        .first();
      if (other) deny("DUPLICATE");
    }
    if (d.stage === "quote_sent") {
      const quote = await ctx.db
        .query("quotes")
        .withIndex("by_opportunity", (q) =>
          q.eq("opportunity_id", old._id).eq("deleted_at", null),
        )
        .filter((q) =>
          q.or(
            q.eq(q.field("status"), "sent"),
            q.eq(q.field("status"), "accepted"),
          ),
        )
        .first();
      if (!quote) deny("INVALID_INPUT", "Record a sent quote first.");
    }
    if (d.next_action_title)
      await addAction(
        ctx,
        user.userId,
        { opportunity_id: old._id },
        d.next_action_title,
        d.next_action_date,
        old.assigned_to,
      );
    await ctx.db.patch(old._id, {
      stage: d.stage,
      stage_changed_at: now(),
      probability:
        d.stage === "won" ? 100 : d.stage === "lost" ? 0 : old.probability,
      won_at: d.stage === "won" ? now() : null,
      lost_at: d.stage === "lost" ? now() : null,
      lost_reason: d.stage === "lost" ? d.lost_reason : "",
      lost_notes: d.stage === "lost" ? d.lost_notes : "",
      version: old.version + 1,
      updated_at: now(),
    });
    const next = (await ctx.db.get(old._id))!;
    await invariant(ctx, next);
    await updateMetrics(ctx, old, next);
    await audit(
      ctx,
      user.userId,
      "opportunities",
      old._id,
      old,
      next,
      "STAGE_CHANGED",
    );
    return old._id;
  },
});
export const saveAction = mutation({
  args: { input: v.string() },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, operational),
      d = parse(actionInput, a.input),
      owner = ctx.db.normalizeId("users", d.assigned_to);
    if (!owner) return deny("INVALID_INPUT");
    if (d.opportunity_id) {
      const id = ctx.db.normalizeId("opportunities", d.opportunity_id);
      if (!id) return deny("INVALID_INPUT");
      await opportunity(ctx, id);
      return addAction(
        ctx,
        user.userId,
        { opportunity_id: id },
        d.title,
        d.due_at,
        owner,
        d.description,
      );
    }
    const id = ctx.db.normalizeId("properties", d.property_id);
    if (!id) return deny("INVALID_INPUT");
    await property(ctx, id);
    return addAction(
      ctx,
      user.userId,
      { property_id: id },
      d.title,
      d.due_at,
      owner,
      d.description,
    );
  },
});
export const finishAction = mutation({
  args: {
    id: v.id("activities"),
    status: v.union(v.literal("completed"), v.literal("cancelled")),
    replacement_title: v.optional(v.string()),
    replacement_due: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, operational),
      old = await ctx.db.get(a.id);
    if (
      !old ||
      old.deleted_at ||
      old.status !== "open" ||
      old.realtor_id ||
      (!old.opportunity_id && !old.property_id)
    )
      return deny("UNAVAILABLE");
    const o = old.opportunity_id
      ? await opportunity(ctx, old.opportunity_id)
      : null;
    if (old.property_id) await property(ctx, old.property_id);
    if (!!a.replacement_title !== !!a.replacement_due) deny("INVALID_INPUT");
    if (a.replacement_title) {
      const d = parse(
        z.object({
          title: z.string().trim().min(1).max(200),
          due: z.iso.datetime({ offset: true }),
        }),
        JSON.stringify({ title: a.replacement_title, due: a.replacement_due }),
      );
      await addAction(
        ctx,
        user.userId,
        old.opportunity_id
          ? { opportunity_id: old.opportunity_id }
          : { property_id: old.property_id! },
        d.title,
        d.due,
        old.assigned_to,
        old.description ?? "",
        old._id,
      );
    }
    await ctx.db.patch(old._id, {
      status: a.status,
      completed_at: a.status === "completed" ? now() : null,
      updated_at: now(),
    });
    if (o) await invariant(ctx, o);
    await audit(
      ctx,
      user.userId,
      "activities",
      old._id,
      old,
      await ctx.db.get(old._id),
      a.status.toUpperCase(),
    );
    return old._id;
  },
});
export const saveConsultation = mutation({
  args: {
    id: v.optional(v.id("consultations")),
    version: v.number(),
    input: v.string(),
  },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, operational),
      d = parse(consultationInput, a.input),
      oid = ctx.db.normalizeId("opportunities", d.opportunity_id),
      owner = ctx.db.normalizeId("users", d.assigned_to);
    if (!oid || !owner) return deny("INVALID_INPUT");
    await opportunity(ctx, oid);
    await assignee(ctx, owner);
    const old = a.id ? await ctx.db.get(a.id) : null;
    if (a.id && (!old || old.deleted_at)) deny("UNAVAILABLE");
    if (old) {
      version(old, a.version);
      if (old.status !== "scheduled" || old.opportunity_id !== oid)
        deny("INVALID_INPUT");
    }
    const value = {
      opportunity_id: oid,
      scheduled_at: new Date(d.scheduled_at).toISOString(),
      assigned_to: owner,
      consultation_type: d.consultation_type,
      notes: d.notes,
      version: (old?.version ?? 0) + 1,
      updated_at: now(),
    };
    const id = old
      ? old._id
      : await ctx.db.insert("consultations", {
          ...stamps(),
          ...value,
          status: "scheduled",
          completed_at: null,
        });
    if (old) await ctx.db.patch(id, value);
    await audit(
      ctx,
      user.userId,
      "consultations",
      id,
      old,
      await ctx.db.get(id),
      old ? "RESCHEDULED" : "SCHEDULED",
    );
    return id;
  },
});
export const consultationStatus = mutation({
  args: {
    id: v.id("consultations"),
    version: v.number(),
    status: v.union(
      v.literal("completed"),
      v.literal("cancelled"),
      v.literal("no_show"),
    ),
  },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, operational),
      old = await ctx.db.get(a.id);
    if (!old || old.deleted_at) return deny("UNAVAILABLE");
    await opportunity(ctx, old.opportunity_id);
    version(old, a.version);
    if (old.status !== "scheduled") deny("INVALID_INPUT");
    await ctx.db.patch(old._id, {
      status: a.status,
      completed_at: a.status === "completed" ? now() : null,
      version: old.version + 1,
      updated_at: now(),
    });
    await audit(
      ctx,
      user.userId,
      "consultations",
      old._id,
      old,
      await ctx.db.get(old._id),
      a.status.toUpperCase(),
    );
    return old._id;
  },
});
async function nextNumber(ctx: MutationCtx) {
  const key = "quote:" + new Date().getUTCFullYear();
  const counter = await ctx.db
    .query("sales_counters")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const value = (counter?.value ?? 0) + 1;
  if (counter) await ctx.db.patch(counter._id, { value });
  else await ctx.db.insert("sales_counters", { key, value });
  return "GLQ-" + key.slice(6) + "-" + String(value).padStart(4, "0");
}
async function discountCheck(
  ctx: Ctx,
  roles: readonly string[],
  subtotal: string,
  discount: string,
) {
  if (roles.includes("owner")) return;
  const settings = await ctx.db
    .query("sales_settings")
    .withIndex("by_key", (q) => q.eq("key", "discounts"))
    .unique();
  const limit = Math.max(
    roles.includes("sales") ? (settings?.sales_discount_bps ?? 0) : 0,
    roles.includes("admin") ? (settings?.admin_discount_bps ?? 0) : 0,
  );
  if (BigInt(discount) * 10000n > BigInt(subtotal) * BigInt(limit))
    deny("FORBIDDEN", "Discount exceeds your configured authority.");
}
export const saveQuote = mutation({
  args: {
    id: v.optional(v.id("quotes")),
    version: v.number(),
    input: v.string(),
  },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, operational),
      d = parse(quoteInput, a.input),
      oid = ctx.db.normalizeId("opportunities", d.opportunity_id);
    if (!oid) return deny("INVALID_INPUT");
    const o = await opportunity(ctx, oid),
      p = await property(ctx, o.property_id);
    if (!active(o.stage as Stage)) deny("INVALID_INPUT");
    const old = a.id ? await ctx.db.get(a.id) : null;
    if (a.id && (!old || old.deleted_at)) deny("UNAVAILABLE");
    if (old) {
      version(old, a.version);
      if (old.status !== "draft" || old.opportunity_id !== oid)
        deny("INVALID_INPUT", "Revise sent terms instead.");
    }
    let totals: ReturnType<typeof quoteMath>;
    try {
      totals = quoteMath(d);
    } catch {
      return deny("INVALID_INPUT");
    }
    await discountCheck(
      ctx,
      user.roles,
      totals.subtotal_cents,
      totals.discount_cents,
    );
    const products = await Promise.all(
      d.items.map(async (item) => {
        if (!item.product_id) return undefined;
        const pid = ctx.db.normalizeId("products", item.product_id);
        const linked = pid ? await ctx.db.get(pid) : null;
        if (!linked || linked.deleted_at)
          return deny("INVALID_INPUT", "Linked product unavailable.");
        return linked._id;
      }),
    );
    const { lines, ...money } = totals;
    const value = {
      ...money,
      quote_type: d.quote_type,
      rental_months: d.rental_months,
      valid_until: d.valid_until,
      version: (old?.version ?? 0) + 1,
      updated_at: now(),
    };
    const r = await ctx.db.get(o.realtor_id);
    const id = old
      ? old._id
      : await ctx.db.insert("quotes", {
          ...stamps(),
          ...value,
          number: await nextNumber(ctx),
          opportunity_id: oid,
          status: "draft",
          sent_at: null,
          accepted_at: null,
          declined_at: null,
          revision_of: null,
          customer_snapshot: JSON.stringify({
            address: p.address_line_1,
            city: p.city,
            realtor: r ? `${r.first_name} ${r.last_name}` : "",
            seller: p.seller_name,
          }),
          created_by: user.userId,
        });
    const oldItems = old
      ? await ctx.db
          .query("quote_items")
          .withIndex("by_quote", (q) => q.eq("quote_id", id))
          .collect()
      : [];
    if (old) await ctx.db.patch(id, value);
    for (const item of oldItems) await ctx.db.delete(item._id);
    for (const [i, item] of d.items.entries())
      await ctx.db.insert("quote_items", {
        quote_id: id,
        description: item.description,
        quantity: item.quantity,
        unit_price_cents: String(cents(item.unit_price)),
        total_cents: lines[i],
        sort_order: i,
        kind: item.kind,
        product_id: products[i],
      });
    await audit(
      ctx,
      user.userId,
      "quotes",
      id,
      old ? { quote: old, items: oldItems } : null,
      {
        quote: await ctx.db.get(id),
        items: await ctx.db
          .query("quote_items")
          .withIndex("by_quote", (q) => q.eq("quote_id", id))
          .collect(),
      },
      old ? "TERMS_UPDATED" : "CREATED",
    );
    return id;
  },
});
export const quoteStatus = mutation({
  args: {
    id: v.id("quotes"),
    version: v.number(),
    status: v.union(
      v.literal("sent"),
      v.literal("accepted"),
      v.literal("declined"),
      v.literal("expired"),
    ),
  },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, operational),
      old = await ctx.db.get(a.id);
    if (!old || old.deleted_at) return deny("UNAVAILABLE");
    await opportunity(ctx, old.opportunity_id);
    version(old, a.version);
    if (!(
      (old.status === "draft" && a.status === "sent") ||
      (old.status === "sent" &&
        ["accepted", "declined", "expired"].includes(a.status))
    ))
      deny("INVALID_INPUT");
    if (
      ["sent", "accepted"].includes(a.status) &&
      old.valid_until < now().slice(0, 10)
    )
      deny("INVALID_INPUT", "Quote validity has expired.");
    if (a.status === "expired" && old.valid_until >= now().slice(0, 10))
      deny("INVALID_INPUT");
    if (a.status === "sent")
      await discountCheck(
        ctx,
        user.roles,
        old.subtotal_cents,
        old.discount_cents,
      );
    await ctx.db.patch(old._id, {
      status: a.status,
      sent_at: a.status === "sent" ? now() : old.sent_at,
      accepted_at: a.status === "accepted" ? now() : old.accepted_at,
      declined_at: a.status === "declined" ? now() : old.declined_at,
      version: old.version + 1,
      updated_at: now(),
    });
    await audit(
      ctx,
      user.userId,
      "quotes",
      old._id,
      old,
      await ctx.db.get(old._id),
      "QUOTE_" + a.status.toUpperCase(),
    );
    return old._id;
  },
});
export const reviseQuote = mutation({
  args: { id: v.id("quotes"), version: v.number() },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, operational),
      old = await ctx.db.get(a.id);
    if (!old || old.deleted_at) return deny("UNAVAILABLE");
    const o = await opportunity(ctx, old.opportunity_id);
    version(old, a.version);
    if (
      !active(o.stage as Stage) ||
      !["sent", "declined", "expired"].includes(old.status)
    )
      deny("INVALID_INPUT", "Only unaccepted issued quotes can be revised.");
    const { _id, _creationTime, ...copy } = old;
    void _id;
    void _creationTime;
    const id = await ctx.db.insert("quotes", {
      ...copy,
      ...stamps(),
      number: await nextNumber(ctx),
      status: "draft",
      sent_at: null,
      accepted_at: null,
      declined_at: null,
      revision_of: old._id,
      version: 1,
      created_by: user.userId,
    });
    for (const item of await ctx.db
      .query("quote_items")
      .withIndex("by_quote", (q) => q.eq("quote_id", old._id))
      .collect())
      await ctx.db.insert("quote_items", {
        quote_id: id,
        description: item.description,
        quantity: item.quantity,
        unit_price_cents: item.unit_price_cents,
        total_cents: item.total_cents,
        sort_order: item.sort_order,
        kind: item.kind,
        product_id: item.product_id,
      });
    await ctx.db.patch(old._id, {
      status: "superseded",
      version: old.version + 1,
      updated_at: now(),
    });
    await audit(
      ctx,
      user.userId,
      "quotes",
      old._id,
      old,
      await ctx.db.get(old._id),
      "SUPERSEDED",
    );
    await audit(
      ctx,
      user.userId,
      "quotes",
      id,
      null,
      await ctx.db.get(id),
      "REVISION_CREATED",
    );
    return id;
  },
});
export const getQuote = query({
  args: { id: v.id("quotes") },
  handler: async (ctx, { id }) => {
    const user = await requireRoles(ctx, operational),
      quote = await ctx.db.get(id);
    if (
      !quote ||
      (quote.deleted_at &&
        !user.roles.some((r) => r === "owner" || r === "admin"))
    )
      return null;
    const parent = await ctx.db.get(quote.opportunity_id);
    if (!parent || !assigned(user, parent)) return null;
    return {
      quote,
      items: await ctx.db
        .query("quote_items")
        .withIndex("by_quote", (q) => q.eq("quote_id", id))
        .collect(),
      opportunity: await ctx.db.get(quote.opportunity_id),
    };
  },
});
export const listQuotes = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, operational);
    const result = await ctx.db
      .query("quotes")
      .withIndex("by_status", (q) =>
        a.status
          ? q.eq("deleted_at", null).eq("status", a.status)
          : q.eq("deleted_at", null),
      )
      .order("desc")
      .paginate(bounded(a.paginationOpts));
    const allowed = await Promise.all(
      result.page.map(async (q) => {
        const o = await ctx.db.get(q.opportunity_id);
        return !!o && assigned(user, o);
      }),
    );
    return { ...result, page: result.page.filter((_, i) => allowed[i]) };
  },
});
// Deliberate quoting projection: the sales team sees only the price relevant
// to the quote type (rental or sale), never acquisition costs.
export const quoteProducts = query({
  args: {
    search: v.string(),
    pricing: v.union(v.literal("rental"), v.literal("sale")),
  },
  handler: async (ctx, a) => {
    await requireRoles(ctx, operational);
    const term = a.search.trim().slice(0, 100);
    const rows = term
      ? await ctx.db
          .query("products")
          .withSearchIndex("search", (q) =>
            q.search("search_text", term).eq("deleted_at", null),
          )
          .take(20)
      : await ctx.db
          .query("products")
          .withIndex("by_active", (q) =>
            q.eq("deleted_at", null).eq("active", true),
          )
          .take(20);
    return rows
      .filter((p) => p.active)
      .map((p) => ({
        id: p._id,
        name: p.name,
        sku: p.sku,
        price_cents:
          (a.pricing === "rental"
            ? p.rental_price_cents
            : p.sale_price_cents) ?? null,
      }));
  },
});
export const archive = mutation({
  args: {
    kind: v.union(
      v.literal("properties"),
      v.literal("opportunities"),
      v.literal("consultations"),
      v.literal("quotes"),
    ),
    id: v.string(),
    version: v.number(),
    restore: v.boolean(),
  },
  handler: async (ctx, a) => {
    const user = await requireRoles(
      ctx,
      a.restore ? ["owner", "admin"] : operational,
    );
    const id = ctx.db.normalizeId(a.kind, a.id);
    if (!id) return deny("INVALID_INPUT");
    const old = await ctx.db.get(id);
    if (!old) return deny("UNAVAILABLE");
    if (!manager(user)) {
      if (a.kind === "properties")
        await property(ctx, ctx.db.normalizeId("properties", a.id)!);
      else if (a.kind === "opportunities")
        await opportunity(ctx, ctx.db.normalizeId("opportunities", a.id)!);
      else if ("opportunity_id" in old)
        await opportunity(ctx, old.opportunity_id);
      else deny("UNAVAILABLE");
    }
    version(old, a.version);
    if (!a.restore) {
      const linked =
        a.kind === "opportunities"
          ? await ctx.db
              .query("projects")
              .withIndex("by_opportunity", (q) =>
                q.eq(
                  "opportunity_id",
                  ctx.db.normalizeId("opportunities", a.id)!,
                ),
              )
              .first()
          : a.kind === "properties"
            ? await ctx.db
                .query("projects")
                .withIndex("by_property", (q) =>
                  q.eq("property_id", ctx.db.normalizeId("properties", a.id)!),
                )
                .first()
            : a.kind === "quotes"
              ? await ctx.db
                  .query("projects")
                  .withIndex("by_source_quote", (q) =>
                    q.eq(
                      "source_quote_id",
                      ctx.db.normalizeId("quotes", a.id)!,
                    ),
                  )
                  .first()
              : null;
      if (linked)
        deny(
          "INVALID_INPUT",
          "This record is retained by project history and cannot be archived.",
        );
    }
    if (a.kind === "properties") {
      const pid = ctx.db.normalizeId("properties", a.id)!;
      if (
        await ctx.db
          .query("opportunities")
          .withIndex("by_property", (q) =>
            q.eq("property_id", pid).eq("deleted_at", null),
          )
          .first()
      )
        deny("INVALID_INPUT", "Archive linked opportunities first.");
      if (a.restore)
        deny(
          "INVALID_INPUT",
          "Property restoration requires duplicate review; contact Owner.",
        );
    }
    if (a.restore && a.kind !== "opportunities") deny("INVALID_INPUT");
    if (a.kind === "opportunities") {
      const o = old as Doc<"opportunities">;
      await property(ctx, o.property_id);
      if (a.restore) {
        await assignee(ctx, o.assigned_to);
        if (active(o.stage as Stage)) {
          const other = await ctx.db
            .query("opportunities")
            .withIndex("by_property", (q) =>
              q.eq("property_id", o.property_id).eq("deleted_at", null),
            )
            .filter((q) =>
              q.and(
                q.neq(q.field("stage"), "won"),
                q.neq(q.field("stage"), "lost"),
              ),
            )
            .first();
          if (other) deny("DUPLICATE");
          await invariant(ctx, o);
        }
      }
    }
    const value = {
      deleted_at: a.restore ? null : now(),
      version: old.version + 1,
      updated_at: now(),
    };
    await ctx.db.patch(id, value);
    const next = (await ctx.db.get(id))!;
    if (a.kind === "opportunities")
      await updateMetrics(
        ctx,
        old as Doc<"opportunities">,
        next as Doc<"opportunities">,
      );
    await audit(
      ctx,
      user.userId,
      a.kind,
      a.id,
      old,
      next,
      a.restore ? "RESTORED" : "ARCHIVED",
    );
    return a.id;
  },
});
export const discountSettings = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, operational);
    return await ctx.db
      .query("sales_settings")
      .withIndex("by_key", (q) => q.eq("key", "discounts"))
      .unique();
  },
});
export const setDiscountSettings = mutation({
  args: { sales_bps: v.number(), admin_bps: v.number(), version: v.number() },
  handler: async (ctx, a) => {
    const user = await requireRoles(ctx, ["owner"]);
    if (
      ![a.sales_bps, a.admin_bps].every(
        (n) => Number.isInteger(n) && n >= 0 && n <= 10000,
      )
    )
      deny("INVALID_INPUT");
    const old = await ctx.db
      .query("sales_settings")
      .withIndex("by_key", (q) => q.eq("key", "discounts"))
      .unique();
    if ((old?.version ?? 0) !== a.version) deny("CONFLICT");
    const value = {
      key: "discounts",
      sales_discount_bps: a.sales_bps,
      admin_discount_bps: a.admin_bps,
      version: a.version + 1,
    };
    const id = old ? old._id : await ctx.db.insert("sales_settings", value);
    if (old) await ctx.db.patch(id, value);
    await audit(ctx, user.userId, "sales_settings", id, old, value);
    return id;
  },
});
export const globalSearch = query({
  args: { q: v.string() },
  handler: async (ctx, { q }) => {
    const user = await requireRoles(ctx, [
      ...operational,
      "marketing",
      "designer",
    ]);
    const term = q.trim().slice(0, 100);
    if (term.length < 2) return [];
    const properties = await visibleProperties(
      ctx,
      user,
      await ctx.db
        .query("properties")
        .withSearchIndex("search", (s) =>
          s.search("search_text", term).eq("deleted_at", null),
        )
        .take(8),
    );
    const results = properties.map((p) => ({
      type: "Property",
      id: p._id as string,
      title: p.address_line_1 + " Â· " + p.city,
      href: "/properties/" + p._id,
    }));
    if (user.roles.some((r) => operational.includes(r)))
      for (const p of properties.slice(0, 4)) {
        for (const o of await ctx.db
          .query("opportunities")
          .withIndex("by_property", (s) =>
            s.eq("property_id", p._id).eq("deleted_at", null),
          )
          .take(2))
          if (assigned(user, o))
            results.push({
              type: "Opportunity",
              id: o._id,
              title: p.address_line_1 + " â€” " + o.stage,
              href: "/opportunities/" + o._id,
            });
      }
    return results;
  },
});

export const topRealtors = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireRoles(ctx, operational);
    if (!manager(user)) {
      const rows = await ctx.db
        .query("opportunities")
        .withIndex("by_assigned", (q) =>
          q.eq("assigned_to", user.userId).eq("deleted_at", null),
        )
        .take(501);
      if (rows.length > 500) deny("LIMIT");
      const counts = new Map<Id<"realtors">, number>();
      for (const o of rows)
        counts.set(o.realtor_id, (counts.get(o.realtor_id) ?? 0) + 1);
      return Promise.all(
        [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(async ([id, count]) => {
            const r = await ctx.db.get(id);
            return {
              id,
              count,
              name: r
                ? r.first_name + " " + r.last_name
                : "Realtor unavailable",
            };
          }),
      );
    }
    const rows = await ctx.db
      .query("sales_realtor_counts")
      .withIndex("by_count", (q) => q.gt("count", 0))
      .order("desc")
      .take(5);
    return Promise.all(
      rows.map(async (row) => {
        const r = await ctx.db.get(row.realtor_id);
        return {
          id: row.realtor_id,
          count: row.count,
          name: r ? r.first_name + " " + r.last_name : "Realtor unavailable",
        };
      }),
    );
  },
});
// Per-record marker makes this additive backfill restartable alongside live mutations.
export const backfillRealtorCounts = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("opportunities")
      .paginate({ numItems: 100, cursor });
    for (const o of page.page) {
      if (o.ranking_counted) continue;
      if (!o.deleted_at) await realtorCount(ctx, o.realtor_id, 1);
      await ctx.db.patch(o._id, { ranking_counted: true });
    }
    return { cursor: page.continueCursor, done: page.isDone };
  },
});
