import { v } from "convex/values";
import { paginationOptsValidator, makeFunctionReference } from "convex/server";
import { query, internalQuery, internalAction } from "./_generated/server";
import { mutation, internalMutation } from "./functions";
import { requireRoles, deny } from "./access";
import { roles } from "../src/lib/permissions";
import {
  templates,
  template,
  configSchema,
  conditionKey,
  sourceTables,
} from "../src/lib/automation/model";
import { sourceTable, config } from "./automationSchema";
import {
  processSource,
  assess,
  audit,
  enqueue,
  closeAction,
  record,
  invariantNeeded,
} from "./automationCore";
import { canSee, actionRelevant } from "./automationSources";
import { isAdmin, revision } from "./operationsCore";
export const initialize = mutation({
  args: {},
  handler: async (ctx) => {
    const u = await requireRoles(ctx, ["owner", "admin"]);
    let inserted = 0;
    for (const t of templates) {
      if (
        await ctx.db
          .query("automation_rules")
          .withIndex("by_key", (q) => q.eq("key", t.key))
          .unique()
      )
        continue;
      const id = await ctx.db.insert("automation_rules", {
        key: t.key,
        config: t.config,
        version: 1,
        enabled_at: 0,
        created_by: u.userId,
        updated_by: u.userId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      });
      await ctx.db.insert("automation_rule_versions", {
        rule_id: id,
        version: 1,
        config: t.config,
        actor_id: u.userId,
        created_at: new Date().toISOString(),
      });
      inserted++;
    }
    await audit(ctx, "INITIALIZED", "rules", u.userId, { inserted });
    return { inserted };
  },
});
export const rules = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner", "admin"]);
    const existing = await ctx.db.query("automation_rules").take(50);
    return templates.map((t) => ({
      ...t,
      record: existing.find((r) => r.key === t.key) ?? null,
    }));
  },
});
export const saveRule = mutation({
  args: { id: v.id("automation_rules"), version: v.number(), config },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, ["owner", "admin"]),
      r = await ctx.db.get(a.id);
    if (!r) deny();
    revision(r, a.version);
    const parsed = configSchema.safeParse(a.config);
    if (!parsed.success)
      deny(
        "INVALID_INPUT",
        "Review delays, escalation, assignment and action limits.",
      );
    for (const id of a.config.entity_ids ?? [])
      if (!ctx.db.normalizeId(template(r.key).table, id))
        deny("INVALID_INPUT", "Scoped records must match the rule source.");
    if (a.config.user_id) {
      const id = ctx.db.normalizeId("users", a.config.user_id),
        p = id
          ? await ctx.db
              .query("profiles")
              .withIndex("by_user", (q) => q.eq("userId", id))
              .unique()
          : null;
      if (
        !p ||
        p.deleted_at ||
        !p.roles.some((r) =>
          ["owner", "admin", "sales", "designer", "staging_crew"].includes(r),
        )
      )
        deny("INVALID_INPUT", "Choose an active operational team member.");
      if (
        ["commercial", "management"].includes(template(r.key).domain) &&
        !isAdmin(p)
      )
        deny(
          "INVALID_INPUT",
          "Financial and management rules require Owner or Admin.",
        );
    }
    const version = r.version + 1;
    await ctx.db.patch(r._id, {
      config: a.config,
      version,
      enabled_at:
        !r.config.enabled && a.config.enabled ? Date.now() : r.enabled_at,
      updated_by: u.userId,
      updated_at: new Date().toISOString(),
    });
    await ctx.db.insert("automation_rule_versions", {
      rule_id: r._id,
      version,
      config: a.config,
      actor_id: u.userId,
      created_at: new Date().toISOString(),
    });
    await audit(ctx, "RULE_CHANGED", r._id, u.userId, {
      old: r.config,
      next: a.config,
      version,
    });
    return version;
  },
});
export const preview = query({
  args: { table: sourceTable, entity_id: v.string() },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin"]);
    const q = await ctx.db
      .query("automation_queue")
      .withIndex("by_source", (q) =>
        q.eq("table", a.table).eq("entity_id", a.entity_id),
      )
      .unique();
    const groups = await assess(ctx, a.table, a.entity_id, q?.observed_at);
    const result = [];
    for (const [family, options] of groups) {
      const key = conditionKey(a.table, a.entity_id, family),
        active = await ctx.db
          .query("automation_actions")
          .withIndex("by_key", (q) => q.eq("key", key).eq("status", "active"))
          .take(3),
        suppression = await ctx.db
          .query("automation_suppressions")
          .withIndex("by_key", (q) => q.eq("key", key))
          .order("desc")
          .first();
      const eligible = options.some(
          (o) => o.rule.config.enabled && o.signal.eligible,
        ),
        suppressed = !!suppression && suppression.until > Date.now();
      result.push({
        key,
        family,
        rules: options.map((o) => ({
          key: o.rule.key,
          version: o.rule.version,
          enabled: o.rule.config.enabled,
          ...o.signal,
        })),
        active,
        suppressed,
        drift:
          active.length > 1
            ? "duplicate"
            : eligible && !suppressed && !active.length
              ? "missing"
              : !options.some((o) => o.signal.eligible) && active.length
                ? "stale"
                : "none",
      });
    }
    return result;
  },
});
export const execute = mutation({
  args: { table: sourceTable, entity_id: v.string() },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, ["owner", "admin"]);
    await enqueue(ctx, a.table, a.entity_id);
    return processSource(ctx, a.table, a.entity_id, u.userId);
  },
});
export const suppress = mutation({
  args: {
    table: sourceTable,
    entity_id: v.string(),
    family: v.string(),
    days: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, ["owner", "admin"]);
    if (
      !Number.isInteger(a.days) ||
      a.days < 1 ||
      a.days > 90 ||
      a.reason.trim().length < 5 ||
      a.reason.length > 500 ||
      !templates.some((t) => t.table === a.table && t.family === a.family)
    )
      deny("INVALID_INPUT");
    const key = conditionKey(a.table, a.entity_id, a.family);
    await ctx.db.insert("automation_suppressions", {
      key,
      until: Date.now() + a.days * 86400000,
      reason: a.reason.trim(),
      actor_id: u.userId,
      created_at: Date.now(),
    });
    for (const active of await ctx.db
      .query("automation_actions")
      .withIndex("by_key", (q) => q.eq("key", key).eq("status", "active"))
      .take(10)) {
      await closeAction(
        ctx,
        active,
        "Condition suppressed: " + a.reason.trim(),
      );
    }
    await audit(ctx, "SUPPRESSED", key, u.userId, {
      days: a.days,
      reason: a.reason,
    });
  },
});
export const actions = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.union(v.literal("active"), v.literal("resolved")),
  },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, roles);
    const rows = await (
      isAdmin(u)
        ? ctx.db
            .query("automation_actions")
            .withIndex("by_status", (q) => q.eq("status", a.status))
        : ctx.db
            .query("automation_actions")
            .withIndex("by_assigned", (q) =>
              q.eq("assigned_to", u.userId).eq("status", a.status),
            )
    )
      .order("desc")
      .paginate({
        ...a.paginationOpts,
        numItems: Math.min(a.paginationOpts.numItems, 30),
      });
    const page = [];
    for (const item of rows.page)
      if ((await canSee(ctx, u, item)) && (await actionRelevant(ctx, item)))
        page.push({ ...item, task: await ctx.db.get(item.activity_id) });
    return { ...rows, page };
  },
});
export const changeAction = mutation({
  args: {
    id: v.id("automation_actions"),
    updated_at: v.number(),
    op: v.union(
      v.literal("snooze"),
      v.literal("complete"),
      v.literal("resolve"),
    ),
    days: v.optional(v.number()),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, roles),
      item = await ctx.db.get(a.id);
    if (!item || item.status !== "active" || !(await canSee(ctx, u, item)))
      deny();
    if (item.updated_at !== a.updated_at) deny("CONFLICT");
    if (a.reason.trim().length < 5 || a.reason.length > 500)
      deny("INVALID_INPUT");
    if (a.op === "resolve") {
      if (!isAdmin(u)) deny();
      await closeAction(ctx, item, a.reason);
      await ctx.db.insert("automation_suppressions", {
        key: item.key,
        until: Date.now() + 86400000,
        reason: a.reason,
        actor_id: u.userId,
        created_at: Date.now(),
      });
    } else if (a.op === "snooze") {
      if (!a.days || !Number.isInteger(a.days) || a.days < 1 || a.days > 30)
        deny("INVALID_INPUT");
      await ctx.db.patch(item._id, {
        snoozed_until: Date.now() + a.days * 86400000,
        updated_at: Date.now(),
      });
    } else {
      const task = await ctx.db.get(item.activity_id);
      if (!task || task.status !== "open") deny("CONFLICT");
      if (await invariantNeeded(ctx, task))
        deny(
          "NEXT_ACTION_REQUIRED",
          "Add the next relationship action before completing this task.",
        );
      await ctx.db.patch(task._id, {
        status: "completed",
        completed_at: new Date().toISOString(),
        completed_by: u.userId,
        version: (task.version ?? 1) + 1,
        updated_at: new Date().toISOString(),
      });
      await enqueue(ctx, item.table, item.entity_id);
    }
    await audit(ctx, a.op.toUpperCase(), item._id, u.userId, {
      reason: a.reason,
      days: a.days ?? null,
    });
  },
});
export const notifications = query({
  args: { paginationOpts: paginationOptsValidator, resolved: v.boolean() },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, roles);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_recipient", (q) =>
        a.resolved
          ? q.eq("recipient_id", u.userId).gt("resolved_at", null)
          : q.eq("recipient_id", u.userId).eq("resolved_at", null),
      )
      .order("desc")
      .paginate({
        ...a.paginationOpts,
        numItems: Math.min(a.paginationOpts.numItems, 30),
      });
    const page = [];
    for (const n of rows.page) {
      const item = await ctx.db.get(n.action_id);
      if (
        !!n.resolved_at === a.resolved &&
        (a.resolved || !item || item.snoozed_until <= Date.now()) &&
        item &&
        (await canSee(ctx, u, item)) &&
        (await actionRelevant(ctx, item))
      )
        page.push({
          ...n,
          title: template((await ctx.db.get(item.rule_id))!.key).name,
          message: item.reason,
          href: item.href,
          priority: item.priority,
          snoozed_until: item.snoozed_until,
          action: item,
        });
    }
    return { ...rows, page };
  },
});
export const readNotification = mutation({
  args: { id: v.id("notifications") },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, roles),
      n = await ctx.db.get(a.id),
      item = n ? await ctx.db.get(n.action_id) : null;
    if (
      !n ||
      n.recipient_id !== u.userId ||
      !item ||
      !(await canSee(ctx, u, item))
    )
      deny();
    if (!n.read_at) await ctx.db.patch(n._id, { read_at: Date.now() });
  },
});
export const history = query({
  args: {
    paginationOpts: paginationOptsValidator,
    rule_id: v.optional(v.id("automation_rules")),
  },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin"]);
    return (
      a.rule_id
        ? ctx.db
            .query("automation_executions")
            .withIndex("by_rule", (q) => q.eq("rule_id", a.rule_id!))
        : ctx.db.query("automation_executions")
    )
      .order("desc")
      .paginate({
        ...a.paginationOpts,
        numItems: Math.min(a.paginationOpts.numItems, 30),
      });
  },
});
export const health = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner", "admin"]);
    const due = await ctx.db
        .query("automation_queue")
        .withIndex("by_due", (q) =>
          q.eq("status", "pending").lte("due_at", Date.now()),
        )
        .take(101),
      failed = await ctx.db
        .query("automation_queue")
        .withIndex("by_due", (q) => q.eq("status", "failed"))
        .take(31),
      limits = await ctx.db.query("automation_limits").order("desc").take(50),
      scan = await ctx.db
        .query("automation_scan")
        .withIndex("by_key", (q) => q.eq("key", "bootstrap"))
        .unique();
    return {
      due: Math.min(due.length, 100),
      more: due.length > 100,
      lag_ms: due.length ? Date.now() - due[0].due_at : 0,
      failed: failed.slice(0, 30),
      failed_more: failed.length > 30,
      limited: limits.filter((l) => l.paused),
      scan,
    };
  },
});
export const retry = mutation({
  args: { id: v.id("automation_queue") },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, ["owner", "admin"]),
      q = await ctx.db.get(a.id);
    if (!q || q.status !== "failed") deny("CONFLICT");
    await ctx.db.patch(q._id, {
      status: "pending",
      due_at: Date.now(),
      attempts: 0,
      last_code: null,
    });
    await audit(ctx, "RETRY", q._id, u.userId, {});
  },
});
export const scanBatch = mutation({
  args: { restart: v.optional(v.boolean()) },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, ["owner", "admin"]);
    let state = await ctx.db
      .query("automation_scan")
      .withIndex("by_key", (q) => q.eq("key", "bootstrap"))
      .unique();
    if (!state) {
      const id = await ctx.db.insert("automation_scan", {
        key: "bootstrap",
        table_index: 0,
        cursor: null,
        finished: false,
        updated_at: Date.now(),
      });
      state = (await ctx.db.get(id))!;
    }
    if (a.restart) {
      await ctx.db.patch(state._id, {
        table_index: 0,
        cursor: null,
        finished: false,
      });
      state = { ...state, table_index: 0, cursor: null, finished: false };
    }
    if (state.finished) return { done: true, count: 0 };
    const table = sourceTables[state.table_index];
    const page = await ctx.db
      .query(table)
      .withIndex("by_creation_time")
      .paginate({ cursor: state.cursor, numItems: 20 });
    for (const row of page.page) await enqueue(ctx, table, row._id);
    const index = state.table_index + (page.isDone ? 1 : 0),
      done = index >= sourceTables.length;
    await ctx.db.patch(state._id, {
      table_index: index,
      cursor: page.isDone ? null : page.continueCursor,
      finished: done,
      updated_at: Date.now(),
    });
    await audit(ctx, "SCAN_BATCH", state._id, u.userId, {
      table,
      count: page.page.length,
      done,
    });
    return { done, count: page.page.length, table };
  },
});
export const work = internalMutation({
  args: { table: sourceTable, entity_id: v.string() },
  handler: (ctx, a) => processSource(ctx, a.table, a.entity_id),
});
export const pending = internalQuery({
  args: {},
  handler: (ctx) =>
    ctx.db
      .query("automation_queue")
      .withIndex("by_due", (q) =>
        q.eq("status", "pending").lte("due_at", Date.now()),
      )
      .take(25),
});
export const failed = internalMutation({
  args: { id: v.id("automation_queue"), generation: v.number() },
  handler: async (ctx, a) => {
    const q = await ctx.db.get(a.id);
    if (!q || q.generation !== a.generation) return;
    const attempts = q.attempts + 1;
    await ctx.db.patch(q._id, {
      attempts,
      last_attempt: Date.now(),
      last_code: "EVALUATION_FAILED",
      status: attempts >= 3 ? "failed" : "pending",
      due_at: Date.now() + attempts * 300000,
    });
    for (const rule of await ctx.db.query("automation_rules").take(50))
      if (rule.config.enabled && template(rule.key).table === q.table)
        await record(
          ctx,
          rule,
          q.table,
          q.entity_id,
          null,
          "failed",
          {
            eligible: false,
            trigger: "",
            reason: `Evaluation failed safely; attempt ${attempts}.`,
            href: "/automation",
            impact_cents: "0",
            owner: null,
            project: null,
            realtor: null,
            opportunity: null,
            observed: q.observed_at,
          },
          null,
          `failure:${q.generation}:${attempts}`,
        );
    await audit(ctx, "EVALUATION_FAILED", q._id, null, {
      attempts,
      code: "EVALUATION_FAILED",
    });
  },
});
export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    let evaluated = 0;
    for (let batchNumber = 0; batchNumber < 4; batchNumber++) {
      const batch: import("./_generated/dataModel").Doc<"automation_queue">[] =
        await ctx.runQuery(
          makeFunctionReference<"query">("automation:pending"),
          {},
        );
      for (const q of batch) {
        try {
          await ctx.runMutation(
            makeFunctionReference<"mutation">("automation:work"),
            { table: q.table, entity_id: q.entity_id },
          );
        } catch {
          await ctx.runMutation(
            makeFunctionReference<"mutation">("automation:failed"),
            { id: q._id, generation: q.generation },
          );
        }
      }
      evaluated += batch.length;
      if (batch.length < 25) break;
    }
    return { evaluated };
  },
});
export const team = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner", "admin"]);
    const rows = await ctx.db.query("profiles").take(201);
    if (rows.length > 200) deny("LIMIT");
    return rows
      .filter(
        (r) => !r.deleted_at && r.roles.some((role) => role !== "marketing"),
      )
      .map((r) => ({ id: r.userId, name: r.display_name, roles: r.roles }));
  },
});
export const notificationBadge = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireRoles(ctx, roles);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_recipient", (q) =>
        q.eq("recipient_id", u.userId).eq("resolved_at", null),
      )
      .order("desc")
      .take(101);
    let count = 0;
    for (const n of rows.slice(0, 100)) {
      if (n.read_at) continue;
      const a = await ctx.db.get(n.action_id);
      if (
        a &&
        a.snoozed_until <= Date.now() &&
        (await canSee(ctx, u, a)) &&
        (await actionRelevant(ctx, a))
      )
        count++;
    }
    return { count, partial: rows.length > 100 };
  },
});
export const effectiveness = query({
  args: { rule_id: v.id("automation_rules") },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin"]);
    const rows = await ctx.db
      .query("automation_executions")
      .withIndex("by_rule", (q) => q.eq("rule_id", a.rule_id))
      .order("desc")
      .take(501);
    const sample = rows.slice(0, 500);
    const count = (status: string) =>
      sample.filter((r) => r.status === status).length;
    const actions = await ctx.db
      .query("automation_actions")
      .withIndex("by_rule", (q) => q.eq("rule_id", a.rule_id))
      .order("desc")
      .take(101);
    let completedTasks = 0,
      totalResponseMs = 0;
    for (const action of actions.slice(0, 100)) {
      const task = await ctx.db.get(action.activity_id);
      if (task?.completed_at) {
        completedTasks++;
        totalResponseMs += Math.max(
          0,
          Date.parse(task.completed_at) - action.created_at,
        );
      }
    }
    return {
      unresolved: actions.slice(0, 100).filter((a) => a.status === "active")
        .length,
      completed_tasks: completedTasks,
      average_response_hours: completedTasks
        ? totalResponseMs / completedTasks / 3600000
        : null,
      actions_partial: actions.length > 100,
      scope: "Latest 500 execution records and 100 actions for this rule",
      partial: rows.length > 500,
      created: count("action_created"),
      completed: count("task_completed_condition_open"),
      escalated: count("escalated"),
      suppressed: count("suppressed"),
      resolved: count("resolved"),
      failed: count("failed"),
    };
  },
});
export const repair = mutation({
  args: { table: sourceTable, entity_id: v.string() },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, ["owner", "admin"]);
    const rows = await ctx.db
      .query("automation_actions")
      .withIndex("by_source", (q) =>
        q
          .eq("table", a.table)
          .eq("entity_id", a.entity_id)
          .eq("status", "active"),
      )
      .take(31);
    if (rows.length > 30) deny("LIMIT");
    const keep = new Map<string, (typeof rows)[number]>();
    let duplicates = 0;
    for (const row of rows) {
      const first = keep.get(row.family);
      if (!first) {
        keep.set(row.family, row);
        if (!row.execution_id) {
          const evidence = await ctx.db
            .query("automation_executions")
            .withIndex("by_source", (q) =>
              q.eq("table", a.table).eq("entity_id", a.entity_id),
            )
            .order("desc")
            .take(100);
          const linked = evidence.find((e) => e.action_id === row._id);
          if (linked)
            await ctx.db.patch(row._id, {
              execution_id: linked._id,
              updated_at: Date.now(),
            });
        }
        continue;
      }
      if (first.activity_id === row.activity_id)
        await ctx.db.patch(row._id, {
          status: "resolved",
          resolution: "Duplicate linkage repaired",
          resolved_at: Date.now(),
          updated_at: Date.now(),
        });
      else await closeAction(ctx, row, "Duplicate action explicitly repaired");
      duplicates++;
    }
    const result = await processSource(
      ctx,
      a.table,
      a.entity_id,
      u.userId,
      true,
    );
    await audit(ctx, "EXPLICIT_REPAIR", a.entity_id, u.userId, {
      duplicates,
      ...result,
    });
    return { duplicates, ...result };
  },
});

export const reassignProfile = internalMutation({
  args: { user_id: v.id("users"), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, a) => {
    const page = await ctx.db
      .query("automation_actions")
      .withIndex("by_assigned", (q) =>
        q.eq("assigned_to", a.user_id).eq("status", "active"),
      )
      .paginate({ cursor: a.cursor, numItems: 25 });
    for (const row of page.page) await enqueue(ctx, row.table, row.entity_id);
    if (!page.isDone)
      await ctx.scheduler.runAfter(
        0,
        makeFunctionReference<"mutation">("automation:reassignProfile"),
        { user_id: a.user_id, cursor: page.continueCursor },
      );
    return { enqueued: page.page.length, done: page.isDone };
  },
});
