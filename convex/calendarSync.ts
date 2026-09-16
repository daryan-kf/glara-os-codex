import { mutation, query, internalMutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { paginationOptsValidator } from "convex/server";
import { calendarSource } from "./calendarSchema";
import { requireRoles, deny } from "./access";
import { v } from "convex/values";
import { version, audit } from "./communicationCore";
async function snapshot(
  ctx: QueryCtx | MutationCtx,
  source: Doc<"calendar_projections">["source"],
) {
  if (source.type === "operations_event") {
    const e = await ctx.db.get(source.id);
    if (!e) return deny("UNAVAILABLE");
    const p = await ctx.db.get(e.project_id);
    if (!p) return deny("UNAVAILABLE");
    const property = await ctx.db.get(p.property_id);
    return {
      title: `${p.project_number} · ${e.event_type}`,
      location: property?.address_line_1 ?? "",
      start: e.start_at,
      end: e.end_at,
      cancelled:
        !!e.deleted_at ||
        !!p.deleted_at ||
        e.status === "cancelled" ||
        p.status === "cancelled",
      revision: e.version,
    };
  }
  const e = await ctx.db.get(source.id);
  if (!e) return deny("UNAVAILABLE");
  const o = await ctx.db.get(e.opportunity_id);
  if (!o) return deny("UNAVAILABLE");
  const p = await ctx.db.get(o.property_id);
  return {
    title: "Glara consultation",
    location: p?.address_line_1 ?? "",
    start: e.scheduled_at,
    end: new Date(Date.parse(e.scheduled_at) + 3600000).toISOString(),
    cancelled: !!e.deleted_at || !!o.deleted_at || e.status === "cancelled",
    revision: e.version,
  };
}
export const configure = mutation({
  args: { enabled: v.boolean(), version: v.number() },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, ["owner", "admin"]),
      calendar_id = process.env.M9_GOOGLE_CALENDAR_ID;
    if (!calendar_id || calendar_id === "primary")
      deny(
        "CONFIGURATION_REQUIRED",
        "A dedicated development calendar must be configured.",
      );
    const old = await ctx.db
      .query("calendar_connections")
      .withIndex("by_key", (q) => q.eq("key", "development"))
      .unique();
    if (old) version(old, a.version);
    else if (a.version !== 0) deny("CONFLICT");
    if (old && old.calendar_id !== calendar_id)
      deny(
        "CONFLICT",
        "Review the existing calendar connection before changing its destination.",
      );
    const data = {
      key: "development" as const,
      provider: "google" as const,
      calendar_id: calendar_id!,
      enabled: a.enabled,
      version: a.version + 1,
      updated_at: Date.now(),
    };
    const id =
      old?._id ??
      (await ctx.db.insert("calendar_connections", {
        ...data,
        created_by: p.userId,
        created_at: Date.now(),
      }));
    if (old) await ctx.db.patch(id, data);
    await audit(ctx, p.userId, "calendar_configured", id);
  },
});
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner", "admin"]);
    return {
      connection: await ctx.db
        .query("calendar_connections")
        .withIndex("by_key", (q) => q.eq("key", "development"))
        .unique(),
      projections: await ctx.db
        .query("calendar_projections")
        .order("desc")
        .take(100),
    };
  },
});
export const prepare = mutation({
  args: { source: calendarSource },
  handler: async (ctx, a) => {
    const actor = await requireRoles(ctx, ["owner", "admin"]),
      source = await snapshot(ctx, a.source);
    const connection = await ctx.db
      .query("calendar_connections")
      .withIndex("by_key", (q) => q.eq("key", "development"))
      .unique();
    if (
      !connection?.enabled ||
      process.env.M9_CALENDAR_ENABLED !== "true" ||
      connection.calendar_id !== process.env.M9_GOOGLE_CALENDAR_ID
    )
      return deny(
        "CONFIGURATION_REQUIRED",
        "Development calendar sync is disabled.",
      );
    const source_key = `${a.source.type}:${a.source.id}`,
      old = await ctx.db
        .query("calendar_projections")
        .withIndex("by_source", (q) =>
          q.eq("source_key", source_key).eq("connection_id", connection._id),
        )
        .unique();
    if (
      old &&
      (old.status === "conflict" ||
        old.status === "ignored" ||
        (old.status === "syncing" && (old.lease_until ?? 0) > Date.now()))
    )
      deny("CONFLICT", "Review this calendar projection before syncing again.");
    const id =
      old?._id ??
      (await ctx.db.insert("calendar_projections", {
        source: a.source,
        source_key,
        connection_id: connection._id,
        external_id: "",
        snapshot: source,
        status: "pending",
        version: 0,
        created_at: Date.now(),
        updated_at: Date.now(),
      }));
    await ctx.db.patch(id, {
      snapshot: source,
      status: "syncing",
      lease_until: Date.now() + 120000,
      version: (old?.version ?? 0) + 1,
      updated_at: Date.now(),
    });
    await ctx.db.insert("calendar_sync_events", {
      projection_id: id,
      actor_id: actor.userId,
      action: "sync_requested",
      result: "pending",
      source_revision: source.revision,
      created_at: Date.now(),
    });
    return {
      id,
      source,
      actor_id: actor.userId,
      calendar_id: connection.calendar_id,
      etag: old?.provider_etag,
      external_id: old?.external_id ?? "",
      revision: (old?.version ?? 0) + 1,
    };
  },
});
export const finish = internalMutation({
  args: {
    id: v.id("calendar_projections"),
    version: v.number(),
    actor_id: v.id("users"),
    external_id: v.string(),
    status: v.union(
      v.literal("synced"),
      v.literal("cancelled"),
      v.literal("unknown"),
      v.literal("failed"),
      v.literal("conflict"),
    ),
    etag: v.optional(v.string()),
    code: v.string(),
    observed: v.optional(
      v.object({
        start: v.string(),
        end: v.string(),
        has_attendees: v.boolean(),
        missing: v.boolean(),
      }),
    ),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.id);
    if (!row || row.version !== a.version) return;
    const current = await snapshot(ctx, row.source),
      stale = !sameSnapshot(current, row.snapshot);
    await ctx.db.patch(row._id, {
      external_id: a.external_id,
      status: stale && a.status === "synced" ? "pending" : a.status,
      provider_etag: a.etag ?? row.provider_etag,
      lease_until: undefined,
      last_code: a.code,
      observed: a.observed,
      last_sync_at: Date.now(),
      version: row.version + 1,
      updated_at: Date.now(),
    });
    if (a.status === "conflict")
      await ctx.db.insert("calendar_conflicts", {
        projection_id: row._id,
        observed_etag: a.etag ?? "missing",
        reason: a.code,
        created_at: Date.now(),
      });
    await ctx.db.insert("calendar_sync_events", {
      projection_id: row._id,
      actor_id: a.actor_id,
      action: "provider_result",
      result: a.status,
      source_revision: row.snapshot.revision,
      created_at: Date.now(),
    });
    await audit(ctx, a.actor_id, "calendar_sync_result", row._id, {
      result: a.status,
    });
  },
});
export const resolve = mutation({
  args: {
    id: v.id("calendar_projections"),
    version: v.number(),
    resolution: v.union(v.literal("keep_glara"), v.literal("ignore")),
  },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, ["owner", "admin"]),
      row = await ctx.db.get(a.id);
    if (!row) return deny("UNAVAILABLE");
    version(row, a.version);
    if (row.status !== "conflict") deny("CONFLICT");
    const conflicts = await ctx.db
      .query("calendar_conflicts")
      .withIndex("by_projection", (q) => q.eq("projection_id", row._id))
      .order("desc")
      .take(100);
    for (const conflict of conflicts)
      if (!conflict.resolved_at)
        await ctx.db.patch(conflict._id, {
          resolved_at: Date.now(),
          resolved_by: p.userId,
          resolution: a.resolution,
        });
    await ctx.db.patch(row._id, {
      status: a.resolution === "ignore" ? "ignored" : "pending",
      provider_etag: conflicts[0]?.observed_etag,
      version: row.version + 1,
      updated_at: Date.now(),
    });
    await audit(ctx, p.userId, "calendar_conflict_resolved", row._id, {
      resolution: a.resolution,
    });
  },
});
export const candidates = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner", "admin"]);
    const rows: {
      source: Doc<"calendar_projections">["source"];
      label: string;
      start: string;
    }[] = [];
    const events = await ctx.db
      .query("operations_events")
      .withIndex("by_start", (q) => q.eq("deleted_at", null))
      .order("desc")
      .take(50);
    for (const e of events) {
      const p = await ctx.db.get(e.project_id);
      if (p && !p.deleted_at)
        rows.push({
          source: { type: "operations_event", id: e._id },
          label: `${p.project_number} · ${e.event_type}`,
          start: e.start_at,
        });
    }
    const consultations = await ctx.db
      .query("consultations")
      .order("desc")
      .take(50);
    for (const c of consultations)
      if (!c.deleted_at)
        rows.push({
          source: { type: "consultation", id: c._id },
          label: "Consultation",
          start: c.scheduled_at,
        });
    return rows;
  },
});
export const projectStatus = query({
  args: { id: v.id("projects") },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin"]);
    const p = await ctx.db.get(a.id);
    if (!p || p.deleted_at) return [];
    const connection = await ctx.db
        .query("calendar_connections")
        .withIndex("by_key", (q) => q.eq("key", "development"))
        .unique(),
      events = await ctx.db
        .query("operations_events")
        .withIndex("by_project", (q) =>
          q.eq("project_id", a.id).eq("deleted_at", null),
        )
        .take(100);
    return Promise.all(
      events.map(async (e) => {
        const projection = connection
          ? await ctx.db
              .query("calendar_projections")
              .withIndex("by_source", (q) =>
                q
                  .eq("source_key", `operations_event:${e._id}`)
                  .eq("connection_id", connection._id),
              )
              .unique()
          : null;
        return {
          id: e._id,
          type: e.event_type,
          status: projection?.status ?? "not_synced",
          last_sync_at: projection?.last_sync_at ?? null,
        };
      }),
    );
  },
});
export const verifyDispatch = query({
  args: { id: v.id("calendar_projections"), version: v.number() },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin"]);
    const row = await ctx.db.get(a.id);
    if (!row) return deny("UNAVAILABLE");
    const connection = await ctx.db.get(row.connection_id);
    if (
      !connection?.enabled ||
      process.env.M9_CALENDAR_ENABLED !== "true" ||
      connection.calendar_id !== process.env.M9_GOOGLE_CALENDAR_ID
    )
      deny("CONFIGURATION_REQUIRED");
    version(row, a.version);
    if (
      row.status !== "syncing" ||
      (row.lease_until ?? 0) < Date.now() ||
      !sameSnapshot(await snapshot(ctx, row.source), row.snapshot)
    )
      deny("CONFLICT");
    return true;
  },
});
export const reconcilePage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin"]);
    if (a.paginationOpts.numItems < 1 || a.paginationOpts.numItems > 25)
      deny("INVALID_INPUT");
    const page = await ctx.db
      .query("calendar_projections")
      .paginate(a.paginationOpts);
    const rows = [];
    for (const row of page.page) {
      const issues: string[] = [];
      const same = await ctx.db
        .query("calendar_projections")
        .withIndex("by_source", (q) =>
          q
            .eq("source_key", row.source_key)
            .eq("connection_id", row.connection_id),
        )
        .take(2);
      if (same.length > 1) issues.push("duplicate_source_projection");
      if (row.external_id) {
        const external = await ctx.db
          .query("calendar_projections")
          .withIndex("by_external", (q) => q.eq("external_id", row.external_id))
          .take(2);
        if (external.length > 1) issues.push("duplicate_external_identity");
      }
      if (["unknown", "conflict", "failed"].includes(row.status))
        issues.push("provider_review_required");
      if (row.observed?.has_attendees) issues.push("unexpected_attendees");
      try {
        if (
          row.status === "synced" &&
          !sameSnapshot(await snapshot(ctx, row.source), row.snapshot)
        )
          issues.push("stale_projection");
      } catch {
        issues.push("source_unavailable");
      }
      rows.push({ id: row._id, issues });
    }
    return { ...page, page: rows };
  },
});
export const sourceStatus = query({
  args: { source: calendarSource },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin"]);
    await snapshot(ctx, a.source);
    return ctx.db
      .query("calendar_projections")
      .withIndex("by_source", (q) =>
        q.eq("source_key", `${a.source.type}:${a.source.id}`),
      )
      .first();
  },
});

function sameSnapshot(
  a: Doc<"calendar_projections">["snapshot"],
  b: Doc<"calendar_projections">["snapshot"],
) {
  return (
    a.title === b.title &&
    a.location === b.location &&
    a.start === b.start &&
    a.end === b.end &&
    a.cancelled === b.cancelled &&
    a.revision === b.revision
  );
}
