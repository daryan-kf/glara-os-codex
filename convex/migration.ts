import { internalMutation, internalQuery } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v, ConvexError, type Value } from "convex/values";
import { requireRoles } from "./access";
import {
  canonical,
  validatePackage,
  resolveReferences,
} from "../src/lib/security/migration";
async function digest(value: unknown) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(canonical(value)),
      ),
    ),
  )
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
function isolatedOnly() {
  if (
    process.env.GLARA_ENVIRONMENT !== "development" ||
    process.env.GLARA_MIGRATION_ENABLED !== "true" ||
    !/^http:\/\/(127\.0\.0\.1|localhost):\d+$/.test(
      process.env.CONVEX_SITE_URL ?? "",
    )
  )
    throw Error("ISOLATED_MIGRATION_ONLY");
}
export const apply = internalMutation({
  args: { input: v.string(), dry_run: v.boolean(), through: v.number() },
  handler: async (
    ctx,
    args,
  ): Promise<{ applied: number; skipped: number; complete: boolean }> => {
    isolatedOnly();
    const actor = await requireRoles(ctx, ["owner"]);
    const data = validatePackage(args.input);
    if (
      !Number.isInteger(args.through) ||
      args.through < 1 ||
      args.through > data.rows.length
    )
      throw Error("INVALID_CHECKPOINT");
    // Fingerprint and every committed stable-ID payload are checked independently on resume.
    const fingerprint = await digest(data);
    const existing = await ctx.db
      .query("migration_runs")
      .withIndex("by_key", (q) => q.eq("key", data.key))
      .unique();
    if (existing && existing.fingerprint !== fingerprint)
      throw Error("MIGRATION_SOURCE_CHANGED");
    const run =
      existing?._id ??
      (await ctx.db.insert("migration_runs", {
        key: data.key,
        fingerprint,
        source_sha: data.source_sha,
        source_type: data.source_type,
        transform_version: data.transform_version,
        operator_id: actor.userId,
        started_at: Date.now(),
        completed_at: null,
        expected: data.rows.length,
        applied: 0,
      }));
    const known = new Map<string, unknown>();
    for (const [key, id] of Object.entries(data.staff)) {
      const userId = ctx.db.normalizeId("users", id);
      if (!userId) throw Error("INVALID_STAFF_MAPPING");
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .unique();
      if (!profile || profile.deleted_at || !profile.roles.length)
        throw Error("INVALID_STAFF_MAPPING");
      known.set(key, id);
    }
    let applied = 0,
      skipped = 0;
    for (const row of data.rows.slice(0, args.through)) {
      const old = await ctx.db
        .query("migration_records")
        .withIndex("by_run_stable", (q) =>
          q.eq("run_id", run).eq("stable_id", row.stable_id),
        )
        .unique();
      const payload = await digest(row);
      if (old) {
        if (old.payload !== payload) throw Error("MIGRATION_SOURCE_CHANGED");
        known.set(row.stable_id, JSON.parse(old.result));
        skipped++;
        continue;
      }
      const resolved = resolveReferences(row.args, known) as Record<
        string,
        Value
      >;
      // Legacy package uses structured inputs; the existing M1-M9 APIs retain their validators and audit actor.
      for (const key of ["input", "rooms"])
        if (resolved[key] && typeof resolved[key] === "object")
          resolved[key] =
            key === "rooms" && Array.isArray(resolved[key])
              ? resolved[key].map((x) =>
                  typeof x === "string" ? x : JSON.stringify(x),
                )
              : JSON.stringify(resolved[key]);
      let result: unknown;
      try {
        result = await ctx.runMutation(
          makeFunctionReference<"mutation", Record<string, Value>, Value>(
            row.operation,
          ),
          resolved,
        );
      } catch {
        throw new ConvexError({
          code: "MIGRATION_ROW_INVALID",
          stable_id: row.stable_id,
        });
      }
      await ctx.db.insert("migration_records", {
        run_id: run,
        stable_id: row.stable_id,
        operation: row.operation,
        payload,
        result: JSON.stringify(result ?? null),
        committed_at: Date.now(),
      });
      known.set(row.stable_id, result);
      applied++;
    }
    const committed = Math.max(existing?.applied ?? 0, args.through);
    const complete = committed === data.rows.length;
    // Replays must preserve the original checkpoint/completion evidence exactly.
    if (!existing || applied > 0 || committed !== existing.applied)
      await ctx.db.patch(run, {
        applied: committed,
        completed_at: complete ? (existing?.completed_at ?? Date.now()) : null,
      });
    if (args.dry_run)
      throw new ConvexError({
        code: "MIGRATION_DRY_RUN_VALID",
        validated: args.through,
      });
    return { applied, skipped, complete };
  },
});
export const status = internalQuery({
  args: { key: v.string() },
  handler: async (ctx, { key }) => {
    isolatedOnly();
    await requireRoles(ctx, ["owner"]);
    const run = await ctx.db
      .query("migration_runs")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (!run) return null;
    return {
      expected: run.expected,
      applied: run.applied,
      complete: run.completed_at !== null,
      operator_id: run.operator_id,
      source_sha: run.source_sha,
    };
  },
});
