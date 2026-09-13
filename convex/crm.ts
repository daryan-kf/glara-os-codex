import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import type { Doc, Id, TableNames } from "./_generated/dataModel";
import { v } from "convex/values";
import { z } from "zod";
import { requireRoles, operational, assignee, deny } from "./access";
import {
  realtorInput,
  activityInput,
  brokerageInput,
  sourceInput,
  completionInput,
  rescheduleInput,
  queryInput,
} from "../src/lib/crm/model";
const envelope = z.object({
  op: z.string().max(40),
  id: z.string().optional(),
  version: z.number().int().optional(),
  data: z.unknown().optional(),
});
type Ctx = QueryCtx | MutationCtx;
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) return deny("INVALID_INPUT", "Invalid input.");
  return result.data;
}
function docId<T extends TableNames>(
  ctx: Ctx,
  table: T,
  value: string | undefined,
): Id<T> {
  const id = ctx.db.normalizeId(table, value ?? "");
  if (!id) return deny("INVALID_INPUT", "Invalid record.");
  return id;
}
const stamp = () => {
  const now = new Date().toISOString();
  return { created_at: now, updated_at: now, deleted_at: null };
};
const nullable = (value: string) => value || null;
function clean<T extends { _id: string; _creationTime?: number }>(row: T) {
  const { _id, _creationTime, ...rest } = row;
  void _creationTime;
  return { id: _id, ...rest };
}
async function audited<
  T extends
    | "realtors"
    | "realtor_private"
    | "activities"
    | "brokerages"
    | "lead_sources",
>(
  ctx: MutationCtx,
  table: T,
  id: Id<T>,
  actor: Id<"users">,
  old: Doc<T> | null,
) {
  const next = await ctx.db.get(id);
  await ctx.db.insert("audit_logs", {
    actor_id: actor,
    action: old ? "UPDATE" : "INSERT",
    entity: table,
    entity_id:
      table === "realtor_private" && next && "realtor_id" in next
        ? String(next.realtor_id)
        : id,
    old_value: old ? clean(old) : null,
    new_value: next ? clean(next) : null,
    created_at: new Date().toISOString(),
  });
}
async function activities(ctx: Ctx, id: Id<"realtors">) {
  return (
    await ctx.db
      .query("activities")
      .withIndex("by_realtor", (q) => q.eq("realtor_id", id))
      .collect()
  ).filter((a) => !a.deleted_at);
}
async function invariant(ctx: MutationCtx, id: Id<"realtors">) {
  const row = await ctx.db.get(id);
  if (
    row &&
    !row.deleted_at &&
    row.relationship_status === "prospect" &&
    !(await activities(ctx, id)).some((a) => a.status === "open" && a.due_at)
  )
    deny("NEXT_ACTION_REQUIRED", "A prospect needs a next action.");
}
async function directory(
  ctx: Ctx,
  row: Doc<"realtors">,
  includePrivate = false,
) {
  const { phone_key, ...safe } = clean(row);
  void phone_key;
  const office = row.brokerage_id ? await ctx.db.get(row.brokerage_id) : null;
  const source = row.lead_source_id
    ? await ctx.db.get(row.lead_source_id)
    : null;
  const owner = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", row.assigned_to))
    .unique();
  const history = await activities(ctx, row._id);
  const next = history
    .filter((a) => a.status === "open" && a.due_at)
    .sort((a, b) => a.due_at!.localeCompare(b.due_at!))[0];
  const contacts = history
    .filter(
      (a) =>
        a.status === "completed" &&
        a.completed_at &&
        !["note", "task", "follow_up"].includes(a.type),
    )
    .map((a) => a.completed_at!)
    .sort();
  const result = {
    ...safe,
    brokerage_name: office?.name ?? null,
    lead_source_name: source?.name ?? null,
    owner_name: owner && !owner.deleted_at ? owner.display_name : null,
    first_contact_date: contacts[0] ?? null,
    last_contact_date: contacts.at(-1) ?? null,
    next_followup_date: row.deleted_at ? null : (next?.due_at ?? null),
    next_action: row.deleted_at ? null : (next?.title ?? null),
  };
  if (!includePrivate) return result;
  const privateRow = await ctx.db
    .query("realtor_private")
    .withIndex("by_realtor", (q) => q.eq("realtor_id", row._id))
    .unique();
  return {
    ...result,
    notes: privateRow?.notes ?? null,
    estimated_listings_per_year:
      privateRow?.estimated_listings_per_year ?? null,
    average_listing_price: privateRow?.average_listing_price ?? null,
    relationship_score: privateRow?.relationship_score ?? null,
    lead_score: privateRow?.lead_score ?? null,
  };
}
async function uniqueContacts(
  ctx: MutationCtx,
  email: string | null,
  phone: string | null,
  exclude?: Id<"realtors">,
) {
  for (const row of email
    ? await ctx.db
        .query("realtors")
        .withIndex("by_email", (q) => q.eq("email", email))
        .collect()
    : [])
    if (!row.deleted_at && row._id !== exclude) deny("DUPLICATE");
  for (const row of phone
    ? await ctx.db
        .query("realtors")
        .withIndex("by_phone", (q) => q.eq("phone_key", phone))
        .collect()
    : [])
    if (!row.deleted_at && row._id !== exclude) deny("DUPLICATE");
}
async function addActivity(
  ctx: MutationCtx,
  actor: Id<"users">,
  data: z.infer<typeof activityInput>,
  replaces: Id<"activities"> | null = null,
) {
  const rid = docId(ctx, "realtors", data.realtor_id),
    assigned = docId(ctx, "users", data.assigned_to);
  const realtor = await ctx.db.get(rid);
  if (!realtor || realtor.deleted_at)
    deny("UNAVAILABLE", "Realtor unavailable");
  await assignee(ctx, assigned);
  const id = await ctx.db.insert("activities", {
    ...data,
    realtor_id: rid,
    assigned_to: assigned,
    description: nullable(data.description),
    due_at: data.due_at ? new Date(data.due_at).toISOString() : null,
    completed_at:
      data.status === "completed"
        ? data.completed_at
          ? new Date(data.completed_at).toISOString()
          : new Date().toISOString()
        : null,
    created_by: actor,
    replaces_activity_id: replaces,
    ...stamp(),
  });
  await audited(ctx, "activities", id, actor, null);
  return id;
}
export const read = query({
  args: { input: v.string() },
  handler: async (ctx, { input }) => {
    const profile = await requireRoles(ctx, [...operational, "marketing"]);
    if (input.length > 10000) return deny("INVALID_INPUT");
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(input);
    } catch {
      return deny("INVALID_INPUT");
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return deny("INVALID_INPUT");
    const op = raw.op,
      write = profile.roles.some((r) => operational.includes(r)),
      manage = profile.roles.some((r) => ["owner", "admin"].includes(r));
    const page = parse(
      z.coerce.number().int().min(1).max(800).default(1),
      raw.page,
    );
    if (op === "list" || op === "search") {
      const filters = parse(queryInput, {
        ...raw,
        archived: String(raw.archived ?? false),
      });
      if (filters.archived === "true" && !manage) return { rows: [], total: 0 };
      const all = await ctx.db.query("realtors").take(10001);
      if (all.length > 10000)
        return deny(
          "CONFIGURATION",
          "CRM list capacity requires indexed pagination.",
        );
      const q = filters.q.toLowerCase(),
        digits = q.replace(/\D/g, "");
      const matches = all.filter(
        (r) =>
          Boolean(r.deleted_at) === (filters.archived === "true") &&
          (!q ||
            q
              .split(/\s+/)
              .every((term) =>
                (r.first_name + " " + r.last_name + " " + (r.email ?? ""))
                  .toLowerCase()
                  .includes(term),
              ) ||
            (/^[+0-9 ()-]+$/.test(q) &&
              digits.length >= 3 &&
              r.phone_key?.includes(digits))) &&
          (!filters.status || r.relationship_status === filters.status) &&
          (!filters.brokerage_id || r.brokerage_id === filters.brokerage_id) &&
          (!filters.assigned_to || r.assigned_to === filters.assigned_to) &&
          (!filters.lead_source_id ||
            r.lead_source_id === filters.lead_source_id) &&
          (!filters.area ||
            (r.primary_city + " " + r.primary_area)
              .toLowerCase()
              .includes(filters.area.toLowerCase())),
      );
      let rows = await Promise.all(matches.map((r) => directory(ctx, r)));
      const day = (s: string) =>
          new Date(s).toLocaleDateString("en-CA", {
            timeZone: "America/Vancouver",
          }),
        today = day(new Date().toISOString());
      if (filters.followup)
        rows = rows.filter((r) =>
          filters.followup === "missing"
            ? !r.next_followup_date && r.relationship_status !== "dormant"
            : Boolean(r.next_followup_date) &&
              (filters.followup === "today"
                ? day(r.next_followup_date!) === today
                : day(r.next_followup_date!) < today),
        );
      rows.sort((a, b) =>
        filters.sort === "newest"
          ? b.created_at.localeCompare(a.created_at)
          : filters.sort === "followup"
            ? (a.next_followup_date ?? "z").localeCompare(
                b.next_followup_date ?? "z",
              )
            : (a.last_name + a.first_name + a.id)
                .toLowerCase()
                .localeCompare(
                  (b.last_name + b.first_name + b.id).toLowerCase(),
                ),
      );
      return {
        rows: rows.slice(
          op === "search" ? 0 : (page - 1) * 25,
          op === "search" ? 8 : page * 25,
        ),
        total: rows.length,
      };
    }
    if (op === "detail") {
      const r = await ctx.db.get(docId(ctx, "realtors", String(raw.id ?? "")));
      if (!r || (r.deleted_at && !manage)) return null;
      return await directory(ctx, r, write);
    }
    if (op === "choices" || op === "sources") {
      if (op === "choices" && !write) return deny();
      const sources = (await ctx.db.query("lead_sources").collect())
        .filter((s) => !s.deleted_at)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => ({ id: s._id, name: s.name }));
      const owners =
        op === "choices"
          ? (await ctx.db.query("profiles").collect())
              .filter(
                (p) =>
                  !p.deleted_at && p.roles.some((r) => operational.includes(r)),
              )
              .map((p) => ({ id: p.userId, name: p.display_name }))
          : [];
      return { owners, sources };
    }
    if (!write && op !== "brokerage_options") return deny();
    if (op === "activities") {
      const rid = docId(ctx, "realtors", String(raw.id ?? "")),
        r = await ctx.db.get(rid);
      if (!r || (r.deleted_at && !manage)) return { rows: [] };
      const rows = (await activities(ctx, rid))
        .filter((a) => !raw.status || a.status === raw.status)
        .sort((a, b) =>
          raw.status === "open"
            ? (a.due_at ?? "z").localeCompare(b.due_at ?? "z")
            : (b.completed_at ?? b.created_at).localeCompare(
                a.completed_at ?? a.created_at,
              ),
        );
      return { rows: rows.slice((page - 1) * 30, page * 30).map(clean) };
    }
    if (op === "followups") {
      const rows = [];
      for (const a of await ctx.db
        .query("activities")
        .withIndex("by_status", (q) =>
          q.eq("status", "open").eq("deleted_at", null),
        )
        .collect()) {
        const r = await ctx.db.get(a.realtor_id);
        if (
          r &&
          !r.deleted_at &&
          (!raw.assigned_to || a.assigned_to === raw.assigned_to)
        )
          rows.push({
            ...clean(a),
            first_name: r.first_name,
            last_name: r.last_name,
          });
      }
      rows.sort((a, b) => (a.due_at ?? "z").localeCompare(b.due_at ?? "z"));
      return { rows: rows.slice((page - 1) * 30, page * 30) };
    }
    if (op === "brokerage") {
      const b = await ctx.db.get(
        docId(ctx, "brokerages", String(raw.id ?? "")),
      );
      return b && !b.deleted_at ? clean(b) : null;
    }
    if (op === "brokerages" || op === "brokerage_options") {
      const q = parse(z.string().max(100).default(""), raw.q).toLowerCase();
      const rows = (await ctx.db.query("brokerages").collect())
        .filter(
          (b) =>
            !b.deleted_at &&
            (!q || (b.name + " " + b.office_name).toLowerCase().includes(q)),
        )
        .sort((a, b) => a.name.localeCompare(b.name));
      return op === "brokerage_options"
        ? rows.slice(0, 20).map((b) => ({
            id: b._id,
            name: b.name + (b.office_name ? " · " + b.office_name : ""),
          }))
        : { rows: rows.slice((page - 1) * 25, page * 25).map(clean) };
    }
    return deny("INVALID_INPUT", "Unsupported query.");
  },
});
export const write = mutation({
  args: { input: v.string() },
  handler: async (
    ctx,
    { input },
  ): Promise<{ id: string; realtor_id?: string }> => {
    const profile = await requireRoles(ctx, operational),
      actor = profile.userId;
    if (input.length > 60000) return deny("INVALID_INPUT");
    let raw: unknown;
    try {
      raw = JSON.parse(input);
    } catch {
      return deny("INVALID_INPUT");
    }
    const { op, id, version, data } = parse(envelope, raw);
    if (op === "realtor_create" || op === "realtor_update") {
      const d = parse(realtorInput, data),
        owner = docId(ctx, "users", d.assigned_to);
      await assignee(ctx, owner);
      const brokerage = d.brokerage_id
          ? docId(ctx, "brokerages", d.brokerage_id)
          : null,
        source = d.lead_source_id
          ? docId(ctx, "lead_sources", d.lead_source_id)
          : null;
      if (brokerage) {
        const b = await ctx.db.get(brokerage);
        if (!b || b.deleted_at)
          deny("INVALID_INPUT", "Select an active brokerage.");
      }
      if (source) {
        const s = await ctx.db.get(source);
        if (!s || s.deleted_at)
          deny("INVALID_INPUT", "Select an active lead source.");
      }
      const old =
        op === "realtor_update"
          ? await ctx.db.get(docId(ctx, "realtors", id))
          : null;
      if (op === "realtor_update" && (!old || old.deleted_at))
        return deny("UNAVAILABLE", "Realtor is archived or unavailable.");
      if (old && old.version !== version) return deny("CONFLICT");
      const email = d.email.trim().toLowerCase() || null,
        phone = d.phone.replace(/\D/g, "") || null;
      await uniqueContacts(ctx, email, phone, old?._id);
      const safe = {
        first_name: d.first_name,
        last_name: d.last_name,
        email,
        phone: nullable(d.phone),
        phone_key: phone,
        instagram: nullable(d.instagram),
        website: nullable(d.website),
        brokerage_id: brokerage,
        primary_city: nullable(d.primary_city),
        primary_area: nullable(d.primary_area),
        secondary_areas: d.secondary_areas,
        luxury_agent: d.luxury_agent,
        relationship_status: d.relationship_status,
        lead_source_id: source,
        assigned_to: owner,
        version: (old?.version ?? 0) + 1,
        updated_at: new Date().toISOString(),
      };
      const rid = old
        ? old._id
        : await ctx.db.insert("realtors", { ...stamp(), ...safe });
      if (old) await ctx.db.patch(rid, safe);
      await audited(ctx, "realtors", rid, actor, old);
      const oldPrivate = await ctx.db
        .query("realtor_private")
        .withIndex("by_realtor", (q) => q.eq("realtor_id", rid))
        .unique();
      const privateData = {
        notes: nullable(d.notes),
        estimated_listings_per_year: d.estimated_listings_per_year
          ? Number(d.estimated_listings_per_year)
          : null,
        average_listing_price: nullable(d.average_listing_price),
        relationship_score: d.relationship_score
          ? Number(d.relationship_score)
          : null,
        lead_score: d.lead_score ? Number(d.lead_score) : null,
        updated_at: new Date().toISOString(),
      };
      const pid = oldPrivate
        ? oldPrivate._id
        : await ctx.db.insert("realtor_private", {
            ...stamp(),
            ...privateData,
            realtor_id: rid,
          });
      if (oldPrivate) await ctx.db.patch(pid, privateData);
      await audited(ctx, "realtor_private", pid, actor, oldPrivate);
      if (d.next_title)
        await addActivity(ctx, actor, {
          realtor_id: rid,
          assigned_to: owner,
          type: "follow_up",
          title: d.next_title,
          due_at: d.next_due_at,
          description: "",
          completed_at: "",
          status: "open",
          priority: "normal",
        });
      await invariant(ctx, rid);
      return { id: rid };
    }
    if (op === "realtor_archive" || op === "realtor_restore") {
      if (op === "realtor_restore") await requireRoles(ctx, ["owner", "admin"]);
      const rid = docId(ctx, "realtors", id),
        old = await ctx.db.get(rid);
      if (!old) return deny();
      if (old.version !== version) return deny("CONFLICT");
      if (op === "realtor_restore") {
        await assignee(ctx, old.assigned_to);
        await uniqueContacts(ctx, old.email, old.phone_key, rid);
      }
      await ctx.db.patch(rid, {
        deleted_at: op === "realtor_archive" ? new Date().toISOString() : null,
        version: old.version + 1,
        updated_at: new Date().toISOString(),
      });
      await invariant(ctx, rid);
      await audited(ctx, "realtors", rid, actor, old);
      return { id: rid };
    }
    if (op === "activity_create") {
      const d = parse(activityInput, data),
        aid = await addActivity(ctx, actor, d);
      await invariant(ctx, docId(ctx, "realtors", d.realtor_id));
      return { id: aid, realtor_id: d.realtor_id };
    }
    if (
      ["activity_complete", "activity_cancel", "activity_reschedule"].includes(
        op,
      )
    ) {
      const d = parse(
          op === "activity_reschedule" ? rescheduleInput : completionInput,
          data ?? {},
        ),
        aid = docId(ctx, "activities", id),
        old = await ctx.db.get(aid);
      if (!old || old.deleted_at || old.status !== "open")
        return deny("UNAVAILABLE", "This activity is no longer open.");
      const r = await ctx.db.get(old.realtor_id);
      if (!r || r.deleted_at) return deny("UNAVAILABLE", "Realtor unavailable");
      await ctx.db.patch(aid, {
        status: op === "activity_complete" ? "completed" : "cancelled",
        completed_at:
          op === "activity_complete" ? new Date().toISOString() : null,
        updated_at: new Date().toISOString(),
      });
      await audited(ctx, "activities", aid, actor, old);
      if (d.next_title)
        await addActivity(
          ctx,
          actor,
          {
            realtor_id: old.realtor_id,
            assigned_to: old.assigned_to,
            type: op === "activity_reschedule" ? old.type : "follow_up",
            title: d.next_title,
            description:
              op === "activity_reschedule" ? (old.description ?? "") : "",
            due_at: d.next_due_at,
            completed_at: "",
            status: "open",
            priority: old.priority,
          },
          op === "activity_reschedule" ? aid : null,
        );
      await invariant(ctx, old.realtor_id);
      return { id: aid, realtor_id: old.realtor_id };
    }
    if (op === "brokerage_save") {
      const d = parse(brokerageInput, data),
        old = id ? await ctx.db.get(docId(ctx, "brokerages", id)) : null;
      if (id && (!old || old.deleted_at)) return deny();
      if (old && old.version !== version) return deny("CONFLICT");
      const value = {
        ...d,
        office_name: nullable(d.office_name),
        website: nullable(d.website),
        phone: nullable(d.phone),
        address: nullable(d.address),
        city: nullable(d.city),
        postal_code: nullable(d.postal_code),
        notes: nullable(d.notes),
        version: (old?.version ?? 0) + 1,
        updated_at: new Date().toISOString(),
      };
      const bid = old
        ? old._id
        : await ctx.db.insert("brokerages", { ...stamp(), ...value });
      if (old) await ctx.db.patch(bid, value);
      await audited(ctx, "brokerages", bid, actor, old);
      return { id: bid };
    }
    if (op === "source_save") {
      await requireRoles(ctx, ["owner", "admin"]);
      const d = parse(sourceInput, data),
        old = id ? await ctx.db.get(docId(ctx, "lead_sources", id)) : null;
      if (id && !old) return deny();
      const duplicates = await ctx.db.query("lead_sources").collect();
      if (
        duplicates.some(
          (s) =>
            !s.deleted_at &&
            s._id !== old?._id &&
            s.name.toLowerCase() === d.name.toLowerCase(),
        )
      )
        return deny("DUPLICATE");
      const sid = old
        ? old._id
        : await ctx.db.insert("lead_sources", { ...stamp(), name: d.name });
      if (old)
        await ctx.db.patch(sid, {
          name: d.name,
          updated_at: new Date().toISOString(),
        });
      await audited(ctx, "lead_sources", sid, actor, old);
      return { id: sid };
    }
    return deny("INVALID_INPUT", "Unsupported mutation.");
  },
});
