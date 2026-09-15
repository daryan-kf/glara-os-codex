/** Development-only acceptance adapter. Temporarily copy into convex; never retain in a deployment. */
import { internalMutation } from "../../convex/functions";
import type { Doc } from "../../convex/_generated/dataModel";
import { day } from "../../src/lib/operations/model";
import { v } from "convex/values";
import { sourceTable } from "../../convex/automationSchema";
import { processSource, closeAction } from "../../convex/automationCore";
import { template } from "../../src/lib/automation/model";
import { source } from "../../convex/automationSources";
export const control = internalMutation({
  args: {
    table: sourceTable,
    entity_id: v.string(),
    days: v.optional(v.number()),
    user_id: v.optional(v.id("users")),
    role: v.optional(
      v.union(
        v.literal("sales"),
        v.literal("designer"),
        v.literal("staging_crew"),
        v.literal("marketing"),
      ),
    ),
    op: v.union(
      v.literal("archive_user"),
      v.literal("restore_user"),
      v.literal("revoke_user"),
      v.literal("clock"),
      v.literal("snapshot"),
      v.literal("expire_snooze"),
      v.literal("duplicate"),
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
    if ("notes" in row) marker += String(row.notes);
    if ("name" in row) marker += String(row.name);
    if ("description" in row) marker += String(row.description);
    if ("first_name" in row) marker += String(row.first_name);
    if ("opportunity_id" in row && row.opportunity_id)
      marker += (await ctx.db.get(row.opportunity_id))?.notes ?? "";
    if ("customer_snapshot" in row) marker += String(row.customer_snapshot);
    if ("internal_notes" in row) marker += String(row.internal_notes);
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
    if (["archive_user", "restore_user", "revoke_user"].includes(a.op)) {
      if (!a.user_id) throw Error("Fictional assignee required");
      const user = await ctx.db.get(a.user_id),
        profile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", a.user_id!))
          .unique();
      if (
        !user?.email?.endsWith("@accounts.example.test") ||
        !profile ||
        profile.roles.some((r) => ["owner", "admin"].includes(r))
      )
        throw Error("Only fictional non-manager profiles");
      if (!("assigned_to" in row) || row.assigned_to !== a.user_id)
        throw Error("Source assignee must match");
      const actions = await ctx.db
        .query("automation_actions")
        .withIndex("by_assigned", (q) =>
          q.eq("assigned_to", a.user_id!).eq("status", "active"),
        )
        .take(101);
      if (a.op === "restore_user") {
        if (!a.role) throw Error("Original role required");
        await ctx.db.patch(profile._id, { deleted_at: null, roles: [a.role] });
      } else
        await ctx.db.patch(
          profile._id,
          a.op === "archive_user"
            ? { deleted_at: new Date().toISOString() }
            : { roles: ["marketing"] },
        );
      return {
        previous_roles: profile.roles,
        assigned_actions: actions.length,
      };
    }
    if (a.op === "clock") {
      if (!Number.isInteger(a.days) || Math.abs(a.days ?? 999) > 365)
        throw Error("Bounded fixture clock required");
      const stamp = new Date(Date.now() - a.days! * 86400000).toISOString();
      if (a.table === "quotes")
        await ctx.db.patch((row as Doc<"quotes">)._id, { sent_at: stamp });
      else if (a.table === "invoices")
        await ctx.db.patch((row as Doc<"invoices">)._id, {
          due_date: day(stamp),
        });
      else if (a.table === "opportunities") {
        const o = row as Doc<"opportunities">;
        await ctx.db.patch(o._id, {
          created_at: stamp,
          stage_changed_at: stamp,
          ...(o.stage === "lost" ? { lost_at: stamp } : {}),
          ...(o.stage === "won" ? { won_at: stamp } : {}),
        });
      } else if (a.table === "realtors")
        await ctx.db.patch((row as Doc<"realtors">)._id, { created_at: stamp });
      else if (a.table === "activities")
        await ctx.db.patch((row as Doc<"activities">)._id, { due_at: stamp });
      else if (a.table === "projects")
        await ctx.db.patch((row as Doc<"projects">)._id, {
          planned_end_date: day(stamp),
        });
      else throw Error("Unsupported fixture source clock");
      return { changed: 1 };
    }
    if (a.op === "snapshot") {
      const actions = await ctx.db
        .query("automation_actions")
        .withIndex("by_source", (q) =>
          q.eq("table", a.table).eq("entity_id", a.entity_id),
        )
        .take(30);
      const tasks = await Promise.all(
        actions.map((x) => ctx.db.get(x.activity_id)),
      );
      const notifications = (
        await Promise.all(
          actions.map((x) =>
            ctx.db
              .query("notifications")
              .withIndex("by_action", (q) => q.eq("action_id", x._id))
              .take(10),
          ),
        )
      ).flat();
      const executions = await ctx.db
        .query("automation_executions")
        .withIndex("by_source", (q) =>
          q.eq("table", a.table).eq("entity_id", a.entity_id),
        )
        .take(100);
      return { source: row, actions, tasks, notifications, executions };
    }
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
      if (a.op === "expire_snooze")
        await ctx.db.patch(action._id, { snoozed_until: Date.now() - 1 });
      else if (a.op === "duplicate") {
        const { _id, _creationTime, ...copy } = action;
        void _id;
        void _creationTime;
        await ctx.db.insert("automation_actions", copy);
      } else if (a.op === "age")
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
        const t = template(r.key);
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

/** Close only marked fictional reminder work; never erase source or financial history. */
export const cleanup = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, a) => {
    if (
      process.env.CONVEX_CLOUD_URL !==
      "https://woozy-jaguar-392.eu-west-1.convex.cloud"
    )
      throw Error("Development only");
    const rules = await ctx.db.query("automation_rules").take(50);
    if (rules.some((r) => r.config.enabled))
      throw Error("Disable scoped test rules before cleanup");
    const page = await ctx.db
      .query("automation_actions")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .paginate({ numItems: 20, cursor: a.cursor });
    let closed = 0,
      skipped = 0;
    for (const action of page.page) {
      const rule = rules.find((r) => r._id === action.rule_id),
        author = rule ? await ctx.db.get(rule.created_by) : null;
      const row = await source(ctx, action.table, action.entity_id);
      let marker = JSON.stringify(row);
      if (row && "product_id" in row)
        marker += JSON.stringify(await ctx.db.get(row.product_id));
      if (
        !author?.email?.endsWith("@accounts.example.test") ||
        !/Fictional ?M7/.test(marker)
      ) {
        skipped++;
        continue;
      }
      await closeAction(
        ctx,
        action,
        "Fictional M7 acceptance completed; reminder history retained",
      );
      closed++;
    }
    return { closed, skipped, cursor: page.continueCursor, done: page.isDone };
  },
});
