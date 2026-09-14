import { getAuthUserId } from "@convex-dev/auth/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { bucketChanges, type Fact } from "../src/lib/analytics/model";
import { deny } from "./access";
const signature = (f: Fact | null) =>
  f === null
    ? "null"
    : JSON.stringify([
        f.key,
        f.metric,
        f.scope,
        f.event_at,
        f.precision,
        f.day,
        f.month,
        f.value,
        f.href,
        f.label,
        Object.entries(f.dimensions).sort(([a], [b]) => a.localeCompare(b)),
      ]);
export const factValue = (r: Doc<"analytics_facts">): Fact => ({
  key: r.key,
  metric: r.metric,
  scope: r.scope,
  event_at: r.event_at,
  precision: r.precision,
  day: r.day,
  month: r.month,
  value: r.value,
  dimensions: r.dimensions,
  href: r.href,
  label: r.label,
});
export async function sourceFacts(ctx: QueryCtx, table: string, id: string) {
  const rows = await ctx.db
    .query("analytics_facts")
    .withIndex("by_source", (q) =>
      q.eq("source_table", table).eq("source_id", id),
    )
    .take(301);
  if (rows.length > 300)
    deny("LIMIT", "Analytics source contribution limit reached.");
  return rows;
}
export async function applySource(
  ctx: MutationCtx,
  table: string,
  id: string,
  expected: Fact[],
  version: number,
  metric?: string,
) {
  const rows = (await sourceFacts(ctx, table, id)).filter(
    (r) => !metric || r.metric === metric,
  );
  if (rows.some((r) => r.version > version))
    return { applied: false, reason: "stale_source_version" };
  const desired = expected.filter((r) => !metric || r.metric === metric);
  if (new Set(desired.map((f) => f.key)).size !== desired.length)
    throw Error("Duplicate source fact identity");
  const before = rows.filter((r) => r.active).map(factValue);
  const processed_at = new Date().toISOString();
  for (const c of bucketChanges(before, desired)) {
    const row = await ctx.db
      .query("analytics_buckets")
      .withIndex("by_key", (q) => q.eq("key", c.key))
      .unique();
    const data = {
      ...c,
      value: String(BigInt(row?.value ?? "0") + BigInt(c.value)),
      version: (row?.version ?? 0) + 1,
      processed_at,
    };
    if (data.value === "0") {
      if (row) await ctx.db.delete(row._id);
    } else if (row) await ctx.db.patch(row._id, data);
    else await ctx.db.insert("analytics_buckets", data);
  }
  let changed = false;
  const next = new Map(desired.map((f) => [f.key, f]));
  for (const row of rows) {
    const f = next.get(row.key);
    next.delete(row.key);
    if (f) {
      if (
        !row.active ||
        signature(factValue(row)) !== signature(f) ||
        row.version !== version
      ) {
        await ctx.db.patch(row._id, {
          ...f,
          version,
          active: true,
          processed_at,
        });
        changed = true;
      }
    } else if (row.active) {
      await ctx.db.patch(row._id, { active: false, version, processed_at });
      changed = true;
    }
  }
  for (const f of next.values()) {
    await ctx.db.insert("analytics_facts", {
      ...f,
      source_table: table,
      source_id: id,
      version,
      active: true,
      processed_at,
    });
    changed = true;
  }
  const historyChanges = differences(
    before.filter((f) => f.scope !== "current"),
    desired.filter((f) => f.scope !== "current"),
  );
  if (historyChanges.length && rows.length)
    await ctx.db.insert("analytics_changes", {
      source_table: table,
      source_id: id,
      version,
      actor_id: await getAuthUserId(ctx),
      reason: metric
        ? "Explicit projection repair"
        : "Authoritative source changed",
      created_at: processed_at,
      changes: historyChanges.map((c) => ({
        key: c.key,
        old_day: c.before?.day ?? null,
        new_day: c.expected?.day ?? null,
        old_value: c.before?.value ?? null,
        new_value: c.expected?.value ?? null,
      })),
    });
  return { applied: changed, reason: changed ? "updated" : "unchanged" };
}
export function differences(stored: Fact[], expected: Fact[]) {
  const keys = new Set([
    ...stored.map((x) => x.key),
    ...expected.map((x) => x.key),
  ]);
  return [...keys].flatMap((key) => {
    const before = stored.find((x) => x.key === key) ?? null,
      after = expected.find((x) => x.key === key) ?? null;
    return signature(before) === signature(after)
      ? []
      : [{ key, before, expected: after }];
  });
}
