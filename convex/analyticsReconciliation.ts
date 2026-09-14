import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { query, mutation } from "./_generated/server";
import { requireRoles, deny } from "./access";
import { sourceTables, sourceProjection } from "./analyticsSources";
import { differences, sourceFacts, factValue } from "./analyticsLedger";
import { bucketChanges } from "../src/lib/analytics/model";
async function state(ctx: import("./_generated/server").QueryCtx) {
  return ctx.db
    .query("analytics_state")
    .withIndex("by_key", (q) => q.eq("key", "main"))
    .unique();
}
export const start = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireRoles(ctx, ["owner"]),
      s = await state(ctx);
    return ctx.db.insert("analytics_reconciliations", {
      actor_id: actor.userId,
      status: "running",
      phase: "sources",
      table_index: 0,
      cursor: null,
      revision: s?.revision ?? 0,
      scanned: 0,
      source_drift: 0,
      bucket_drift: 0,
      created_at: new Date().toISOString(),
      completed_at: null,
    });
  },
});
export const advance = mutation({
  args: { id: v.id("analytics_reconciliations") },
  handler: async (ctx, args) => {
    await requireRoles(ctx, ["owner"]);
    const run = await ctx.db.get(args.id);
    if (!run) deny("UNAVAILABLE");
    if (run.status !== "running") return run;
    const s = await state(ctx);
    if ((s?.revision ?? 0) !== run.revision) {
      await ctx.db.patch(run._id, { status: "stale" });
      return { ...run, status: "stale" };
    }
    let { phase, table_index, cursor, scanned, source_drift, bucket_drift } =
      run;
    let status = "running";
    if (phase === "sources") {
      const table = sourceTables[table_index],
        page = await ctx.db.query(table).paginate({ cursor, numItems: 3 });
      for (const row of page.page) {
        const projection = await sourceProjection(ctx, table, row._id),
          stored = await sourceFacts(ctx, table, row._id);
        source_drift += differences(
          stored.filter((r) => r.active).map(factValue),
          projection.facts,
        ).length;
        scanned++;
        for (const c of bucketChanges([], projection.facts)) {
          const old = await ctx.db
            .query("analytics_expected")
            .withIndex("by_run_key", (q) =>
              q.eq("run_id", run._id).eq("key", c.key),
            )
            .unique();
          if (old)
            await ctx.db.patch(old._id, {
              value: String(BigInt(old.value) + BigInt(c.value)),
            });
          else
            await ctx.db.insert("analytics_expected", {
              ...c,
              run_id: run._id,
              checked: false,
            });
        }
      }
      cursor = page.continueCursor;
      if (page.isDone) {
        table_index++;
        cursor = null;
        if (table_index === sourceTables.length) phase = "actual";
      }
    } else if (phase === "actual") {
      const page = await ctx.db
        .query("analytics_buckets")
        .paginate({ cursor, numItems: 50 });
      for (const row of page.page) {
        const expected = await ctx.db
          .query("analytics_expected")
          .withIndex("by_run_key", (q) =>
            q.eq("run_id", run._id).eq("key", row.key),
          )
          .unique();
        if ((expected?.value ?? "0") !== row.value) bucket_drift++;
        if (expected)
          await ctx.db.patch(expected._id, {
            actual: row.value,
            checked: true,
          });
        else
          await ctx.db.insert("analytics_expected", {
            run_id: run._id,
            key: row.key,
            grain: row.grain,
            period: row.period,
            metric: row.metric,
            dimension: row.dimension,
            member: row.member,
            value: "0",
            actual: row.value,
            checked: true,
          });
      }
      cursor = page.continueCursor;
      if (page.isDone) {
        phase = "missing";
        cursor = null;
      }
    } else {
      const page = await ctx.db
        .query("analytics_expected")
        .withIndex("by_run_checked", (q) =>
          q.eq("run_id", run._id).eq("checked", false),
        )
        .take(50);
      for (const row of page) {
        if (row.value !== "0") bucket_drift++;
        await ctx.db.patch(row._id, { actual: "0", checked: true });
      }
      if (page.length < 50) status = "complete";
    }
    const update = {
      phase,
      table_index,
      cursor,
      scanned,
      source_drift,
      bucket_drift,
      status,
      completed_at: status === "complete" ? new Date().toISOString() : null,
    };
    await ctx.db.patch(run._id, update);
    return { ...run, ...update };
  },
});
export const result = query({
  args: {
    id: v.id("analytics_reconciliations"),
    pagination: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    await requireRoles(ctx, ["owner"]);
    if (args.pagination.numItems > 50) deny("INVALID_INPUT");
    const run = await ctx.db.get(args.id);
    if (!run) deny("UNAVAILABLE");
    const page = await ctx.db
      .query("analytics_expected")
      .withIndex("by_run_key", (q) => q.eq("run_id", run._id))
      .paginate(args.pagination);
    return {
      run,
      ...page,
      page: page.page.filter((r) => r.checked && r.value !== r.actual),
    };
  },
});
export const repairBucket = mutation({
  args: { id: v.id("analytics_expected"), reason: v.string() },
  handler: async (ctx, args) => {
    const actor = await requireRoles(ctx, ["owner"]);
    if (args.reason.trim().length < 10 || args.reason.length > 1000)
      deny("INVALID_INPUT");
    const expected = await ctx.db.get(args.id);
    if (!expected) deny("UNAVAILABLE");
    const run = await ctx.db.get(expected.run_id),
      s = await state(ctx);
    if (
      !run ||
      run.status !== "complete" ||
      run.source_drift !== 0 ||
      run.revision !== (s?.revision ?? 0)
    )
      deny(
        "CONFLICT",
        "Run a fresh source-clean reconciliation before repairing this period.",
      );
    const old = await ctx.db
      .query("analytics_buckets")
      .withIndex("by_key", (q) => q.eq("key", expected.key))
      .unique();
    if ((old?.value ?? "0") !== expected.actual) deny("CONFLICT");
    if (expected.actual === expected.value) return { changed: false };
    const next = {
      key: expected.key,
      grain: expected.grain,
      period: expected.period,
      metric: expected.metric,
      dimension: expected.dimension,
      member: expected.member,
      value: expected.value,
      version: (old?.version ?? 0) + 1,
      processed_at: new Date().toISOString(),
    };
    if (next.value === "0") {
      if (old) await ctx.db.delete(old._id);
    } else if (old) await ctx.db.patch(old._id, next);
    else await ctx.db.insert("analytics_buckets", next);
    if (s) await ctx.db.patch(s._id, { revision: s.revision + 1 });
    await ctx.db.insert("audit_logs", {
      actor_id: actor.userId,
      action: "ANALYTICS_BUCKET_REPAIRED",
      entity: "analytics_buckets",
      entity_id: expected.key,
      old_value: { value: expected.actual, run_id: run._id },
      new_value: { ...next, reason: args.reason },
      created_at: next.processed_at,
    });
    return { changed: true };
  },
});

export const activate = mutation({
  args: { id: v.id("analytics_reconciliations") },
  handler: async (ctx, args) => {
    const actor = await requireRoles(ctx, ["owner"]),
      run = await ctx.db.get(args.id),
      s = await state(ctx);
    if (
      !s?.backfill_complete ||
      !run ||
      run.status !== "complete" ||
      run.source_drift ||
      run.bucket_drift ||
      run.revision !== s.revision
    )
      deny(
        "CONFLICT",
        "Complete backfill and a fresh zero-drift reconciliation before activating reporting.",
      );
    await ctx.db.patch(s._id, { ready: true });
    await ctx.db.insert("audit_logs", {
      actor_id: actor.userId,
      entity: "analytics",
      entity_id: s._id,
      action: "ANALYTICS_ACTIVATED",
      old_value: null,
      new_value: { reconciliation_id: run._id, revision: s.revision },
      created_at: new Date().toISOString(),
    });
    return { ready: true };
  },
});
