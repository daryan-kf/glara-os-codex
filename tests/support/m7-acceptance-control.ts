/** Development-only acceptance adapter. Temporarily copy into convex; never retain in a deployment. */
import { internalMutation } from "../../convex/functions";
import { v } from "convex/values";
import { sourceTable } from "../../convex/automationSchema";
import { processSource } from "../../convex/automationCore";
import { source } from "../../convex/automationSources";
export const control = internalMutation({
  args: {
    table: sourceTable,
    entity_id: v.string(),
    op: v.union(
      v.literal("age"),
      v.literal("expire_suppression"),
      v.literal("fail"),
      v.literal("state"),
    ),
  },
  handler: async (ctx, a) => {
    if (
      process.env.CONVEX_CLOUD_URL !==
      "https://woozy-jaguar-392.eu-west-1.convex.cloud"
    )
      throw Error("Development only");
    const row = await source(ctx, a.table, a.entity_id);
    if (!row) throw Error("Fixture unavailable");
    let marker = "";
    if ("notes" in row) marker = String(row.notes);
    if ("customer_snapshot" in row) marker = String(row.customer_snapshot);
    if ("internal_notes" in row) marker = String(row.internal_notes);
    const scoped = (await ctx.db.query("automation_rules").take(50)).filter(
      (r) => r.config.entity_ids?.includes(a.entity_id),
    );
    if (!scoped.length) throw Error("Scoped acceptance rule required");
    for (const r of scoped) {
      const actor = await ctx.db.get(r.created_by);
      if (!actor?.email?.endsWith("@accounts.example.test"))
        throw Error("Fictional rule owner required");
    }
    if (!marker.includes("Fictional M7"))
      throw Error("Only named fictional acceptance sources allowed");
    if (a.op === "state") {
      const queue = await ctx.db
        .query("automation_queue")
        .withIndex("by_source", (q) =>
          q.eq("table", a.table).eq("entity_id", a.entity_id),
        )
        .unique();
      if (queue)
        await ctx.db.patch(queue._id, { due_at: Date.now() + 3600000 });
      return { queue };
    }
    if (a.op === "fail") {
      await processSource(ctx, a.table, a.entity_id);
      throw Error("CONTROLLED_ACCEPTANCE_FAILURE");
    }
    const actions = await ctx.db
      .query("automation_actions")
      .withIndex("by_source", (q) =>
        q
          .eq("table", a.table)
          .eq("entity_id", a.entity_id)
          .eq("status", "active"),
      )
      .take(10);
    for (const action of actions) {
      if (a.op === "age")
        await ctx.db.patch(action._id, {
          created_at: Date.now() - 15 * 86400000,
          next_cycle_at: Date.now() - 1,
        });
      else
        for (const suppression of await ctx.db
          .query("automation_suppressions")
          .withIndex("by_key", (q) => q.eq("key", action.key))
          .take(10))
          await ctx.db.patch(suppression._id, { until: Date.now() - 1 });
    }
    if (a.op === "expire_suppression" && !actions.length) {
      for (const r of scoped) {
        const t = (await import("../../src/lib/automation/model")).template(
          r.key,
        );
        const key = `${a.table}:${a.entity_id}:${t.family}`;
        for (const suppression of await ctx.db
          .query("automation_suppressions")
          .withIndex("by_key", (q) => q.eq("key", key))
          .take(10))
          await ctx.db.patch(suppression._id, { until: Date.now() - 1 });
      }
    }
    return { changed: actions.length };
  },
});
