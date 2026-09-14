import { makeFunctionReference } from "convex/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  sourceTables,
  template,
  conditionKey,
  executionKey,
  escalationLevel,
  businessDays,
  type SourceTable,
} from "../src/lib/automation/model";
import { evaluate, canSee, type Signal } from "./automationSources";
import { day } from "../src/lib/operations/model";
export async function enqueue(
  ctx: MutationCtx,
  table: SourceTable,
  id: string,
) {
  const q = await ctx.db
    .query("automation_queue")
    .withIndex("by_source", (q) => q.eq("table", table).eq("entity_id", id))
    .unique();
  if (q) {
    await ctx.db.patch(q._id, {
      ...(q.status === "failed"
        ? { status: "pending" as const, attempts: 0, last_code: null }
        : {}),
      due_at: Math.min(q.due_at, Date.now()),
      generation: q.generation + 1,
    });
  } else
    await ctx.db.insert("automation_queue", {
      table,
      entity_id: id,
      due_at: Date.now(),
      generation: 1,
      attempts: 0,
      status: "pending",
      last_code: null,
      last_attempt: null,
      observed_at: Date.now(),
    });
}
export async function touched(ctx: MutationCtx, table: string, id: string) {
  if (sourceTables.includes(table as SourceTable))
    await enqueue(ctx, table as SourceTable, id);
  const key = ctx.db.normalizeId(
    table as import("./_generated/dataModel").TableNames,
    id,
  );
  const row = key ? await ctx.db.get(key) : null;
  if (!row) return;
  if (table === "profiles" && "userId" in row)
    await ctx.scheduler.runAfter(
      0,
      makeFunctionReference<"mutation">("automation:reassignProfile"),
      { user_id: row.userId, cursor: null },
    );
  if ("project_id" in row && row.project_id)
    await enqueue(ctx, "projects", row.project_id);
  if ("opportunity_id" in row && row.opportunity_id)
    await enqueue(ctx, "opportunities", row.opportunity_id);
  if ("realtor_id" in row && row.realtor_id)
    await enqueue(ctx, "realtors", row.realtor_id);
  if ("invoice_id" in row) await enqueue(ctx, "invoices", row.invoice_id);
  if ("payment_id" in row) {
    await enqueue(ctx, "payments", row.payment_id);
    const links = await ctx.db
      .query("payment_allocations")
      .withIndex("by_payment", (q) => q.eq("payment_id", row.payment_id))
      .take(101);
    if (links.length > 100) throw Error("AUTOMATION_RELATION_LIMIT");
    for (const l of links) {
      await enqueue(ctx, "invoices", l.invoice_id);
      const invoice = await ctx.db.get(l.invoice_id);
      if (invoice?.agreement_id)
        await enqueue(ctx, "agreements", invoice.agreement_id);
    }
    const payment = await ctx.db.get(row.payment_id);
    if (payment)
      await enqueue(ctx, "commercial_customers", payment.customer_id);
  }
  if (table === "opportunities") {
    const oid = ctx.db.normalizeId("opportunities", id)!;
    for (const q of await ctx.db
      .query("quotes")
      .withIndex("by_opportunity", (q) =>
        q.eq("opportunity_id", oid).eq("deleted_at", null),
      )
      .take(101))
      await enqueue(ctx, "quotes", q._id);
  }
  if (table === "invoices") {
    const invoice = row as Doc<"invoices">;
    if (invoice.agreement_id)
      await enqueue(ctx, "agreements", invoice.agreement_id);
    if (invoice.source_id && invoice.source_type === "extension")
      await enqueue(ctx, "package_extensions", invoice.source_id);
    if (invoice.source_id && invoice.source_type === "assessment")
      await enqueue(ctx, "damage_charge_assessments", invoice.source_id);
  }
  if ("customer_id" in row)
    await enqueue(ctx, "commercial_customers", row.customer_id);
  if ("asset_id" in row && row.asset_id)
    await enqueue(ctx, "inventory_assets", row.asset_id);
  if ("reservation_id" in row && row.reservation_id)
    await enqueue(ctx, "inventory_reservations", row.reservation_id);
  if (table === "activities") {
    const links = await ctx.db
      .query("automation_actions")
      .withIndex("by_activity", (q) =>
        q.eq("activity_id", id as Id<"activities">),
      )
      .take(2);
    for (const a of links) await enqueue(ctx, a.table, a.entity_id);
  }
}
export async function audit(
  ctx: MutationCtx,
  action: string,
  id: string,
  actor: Id<"users"> | null,
  value: unknown,
) {
  await ctx.db.insert("audit_logs", {
    actor_id: actor,
    action: `AUTOMATION_${action}`,
    entity: "automation",
    entity_id: id,
    old_value: null,
    new_value: value,
    created_at: new Date().toISOString(),
  });
}
export async function record(
  ctx: MutationCtx,
  r: Doc<"automation_rules">,
  table: SourceTable,
  id: string,
  a: Doc<"automation_actions"> | null,
  status: string,
  s: Signal,
  actor: Id<"users"> | null,
  event: string,
) {
  const key = executionKey(
    conditionKey(table, id, template(r.key).family),
    a?.cycle ?? 0,
    r.version,
    event + ":" + s.reason + ":" + s.impact_cents,
  );
  const old = await ctx.db
    .query("automation_executions")
    .withIndex("by_dedupe", (q) => q.eq("dedupe_key", key))
    .unique();
  if (old) return old._id;
  const result = await ctx.db.insert("automation_executions", {
    dedupe_key: key,
    rule_id: r._id,
    rule_version: r.version,
    config: r.config,
    table,
    entity_id: id,
    action_id: a?._id ?? null,
    actor_id: actor,
    actor_kind: actor ? "user" : "system",
    status,
    trigger: s.trigger,
    reason: s.reason,
    evaluated_at: Date.now(),
  });
  await audit(ctx, status, a?._id ?? id, actor, {
    execution_id: result,
    rule: r.key,
    version: r.version,
  });
  return result;
}
async function recipient(
  ctx: QueryCtx | MutationCtx,
  r: Doc<"automation_rules">,
  s: Signal,
  table: SourceTable,
  id: string,
  level: number,
) {
  const t = template(r.key);
  const wanted =
    level >= 2 ? "owner" : level === 1 ? "admin" : r.config.assignment;
  const candidate =
    wanted === "specific_user"
      ? ctx.db.normalizeId("users", r.config.user_id ?? "")
      : wanted === "entity_owner" || wanted === "project_manager"
        ? s.owner
        : null;
  const valid = async (u: Doc<"profiles"> | null) =>
    !!u &&
    !u.deleted_at &&
    (await canSee(ctx, u, {
      domain: t.domain,
      table,
      entity_id: id,
      assigned_to: u.userId,
    }));
  if (candidate) {
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", candidate))
      .unique();
    if (await valid(p)) return candidate;
  }
  const people = await ctx.db.query("profiles").take(201);
  if (people.length > 200) throw Error("TEAM_LIMIT");
  for (const role of wanted === "owner"
    ? ["owner", "admin"]
    : ["admin", "owner"]) {
    const p = people.find(
      (p) => !p.deleted_at && p.roles.includes(role as "owner" | "admin"),
    );
    if (p && (await valid(p))) return p.userId;
  }
  throw Error("NO_VALID_ASSIGNEE");
}
async function projectTaskLink(
  ctx: QueryCtx | MutationCtx,
  project: Id<"projects"> | null,
  user: Id<"users">,
) {
  if (!project) return undefined;
  const p = await ctx.db.get(project);
  if (!p) return undefined;
  if ([p.project_manager_id, p.designer_id, p.staging_lead_id].includes(user))
    return project;
  const team = await ctx.db
    .query("project_team_assignments")
    .withIndex("by_project", (q) =>
      q.eq("project_id", project).eq("active", true),
    )
    .take(31);
  return team.some((t) => t.user_id === user) ? project : undefined;
}
export async function notify(ctx: MutationCtx, a: Doc<"automation_actions">) {
  const all = await ctx.db
    .query("notifications")
    .withIndex("by_action", (q) => q.eq("action_id", a._id))
    .take(10);
  for (const n of all)
    if (n.recipient_id !== a.assigned_to && !n.resolved_at)
      await ctx.db.patch(n._id, { resolved_at: Date.now() });
  const n = all.find((n) => n.recipient_id === a.assigned_to);
  if (!n)
    await ctx.db.insert("notifications", {
      action_id: a._id,
      recipient_id: a.assigned_to,
      created_at: Date.now(),
      read_at: null,
      resolved_at: null,
    });
}
async function invariantNeeded(
  ctx: QueryCtx | MutationCtx,
  task: Doc<"activities">,
) {
  if (task.opportunity_id) {
    const o = await ctx.db.get(task.opportunity_id);
    if (o && !o.deleted_at && !["won", "lost"].includes(o.stage)) {
      const others = await ctx.db
        .query("activities")
        .withIndex("by_opportunity", (q) =>
          q
            .eq("opportunity_id", o._id)
            .eq("status", "open")
            .eq("deleted_at", null),
        )
        .take(101);
      if (!others.some((a) => a._id !== task._id && a.due_at)) return true;
    }
  }
  if (task.realtor_id) {
    const r = await ctx.db.get(task.realtor_id);
    if (r && !r.deleted_at && r.relationship_status === "prospect") {
      const others = await ctx.db
        .query("activities")
        .withIndex("by_realtor", (q) => q.eq("realtor_id", r._id))
        .take(201);
      if (others.length > 200) throw Error("ACTIVITY_LIMIT");
      if (
        !others.some(
          (a) =>
            a._id !== task._id &&
            !a.deleted_at &&
            a.status === "open" &&
            a.due_at,
        )
      )
        return true;
    }
  }
  return false;
}
export async function closeAction(
  ctx: MutationCtx,
  a: Doc<"automation_actions">,
  reason: string,
) {
  const task = await ctx.db.get(a.activity_id);
  if (task && task.automation_key === a.key && task.status === "open") {
    // Preserve the existing M1/M2 next-action invariant with an explicit neutral handoff.
    if (await invariantNeeded(ctx, task)) {
      await ctx.db.insert("activities", {
        type: "follow_up",
        title: "Plan the next relationship action",
        description:
          "The prior automated condition resolved. Choose the next business action.",
        due_at: new Date(Date.now() + 86400000).toISOString(),
        completed_at: null,
        status: "open",
        priority: "normal",
        assigned_to: task.assigned_to,
        created_by: task.created_by,
        replaces_activity_id: task._id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
        ...(task.realtor_id ? { realtor_id: task.realtor_id } : {}),
        ...(task.opportunity_id ? { opportunity_id: task.opportunity_id } : {}),
      });
    }
    await ctx.db.patch(task._id, {
      status: "cancelled",
      updated_at: new Date().toISOString(),
      version: (task.version ?? 1) + 1,
    });
  }
  await ctx.db.patch(a._id, {
    status: "resolved",
    resolved_at: Date.now(),
    resolution: reason,
    updated_at: Date.now(),
  });
  for (const n of await ctx.db
    .query("notifications")
    .withIndex("by_action", (q) => q.eq("action_id", a._id))
    .take(10))
    if (!n.resolved_at) await ctx.db.patch(n._id, { resolved_at: Date.now() });
}
export async function assess(
  ctx: QueryCtx | MutationCtx,
  table: SourceTable,
  id: string,
  observed = Date.now(),
  preview = true,
) {
  const rules = await ctx.db
    .query("automation_rules")
    .withIndex("by_key")
    .take(50);
  const groups = new Map<
    string,
    { rule: Doc<"automation_rules">; signal: Signal }[]
  >();
  for (const r of rules) {
    const t = template(r.key);
    if (t.table !== table || r.deleted_at || (!preview && !r.config.enabled))
      continue;
    const s = await evaluate(ctx, r, id, Date.now(), observed);
    const arr = groups.get(t.family) ?? [];
    arr.push({ rule: r, signal: s });
    groups.set(t.family, arr);
  }
  return groups;
}
export async function processSource(
  ctx: MutationCtx,
  table: SourceTable,
  id: string,
  actor: Id<"users"> | null = null,
  repair = false,
) {
  const queue = await ctx.db
    .query("automation_queue")
    .withIndex("by_source", (q) => q.eq("table", table).eq("entity_id", id))
    .unique();
  const groups = await assess(ctx, table, id, queue?.observed_at, repair);
  let created = 0;
  for (const [family, options] of groups) {
    const key = conditionKey(table, id, family),
      live = await ctx.db
        .query("automation_actions")
        .withIndex("by_key", (q) => q.eq("key", key).eq("status", "active"))
        .unique();
    const eligible = options
      .filter((o) => o.rule.config.enabled && o.signal.eligible)
      .sort(
        (a, b) =>
          ({ urgent: 3, high: 2, normal: 1 })[b.rule.config.priority] -
            { urgent: 3, high: 2, normal: 1 }[a.rule.config.priority] ||
          b.rule.config.delay_days - a.rule.config.delay_days ||
          a.rule.key.localeCompare(b.rule.key),
      );
    const selected = eligible[0];
    if (!selected) {
      if (
        live &&
        (repair || options.some((o) => o.rule.config.enabled)) &&
        !options.some((o) => o.signal.eligible)
      ) {
        const original =
          options.find((o) => o.rule._id === live.rule_id) ?? options[0];
        await closeAction(ctx, live, "Source condition resolved");
        await record(
          ctx,
          original.rule,
          table,
          id,
          live,
          "resolved",
          original.signal,
          actor,
          `resolved:${live.cycle}`,
        );
      }
      continue;
    }
    const { rule: r, signal: s } = selected;
    const suppression = await ctx.db
      .query("automation_suppressions")
      .withIndex("by_key", (q) => q.eq("key", key))
      .order("desc")
      .first();
    if (
      (suppression && suppression.until > Date.now()) ||
      (live && live.snoozed_until > Date.now())
    ) {
      await record(
        ctx,
        r,
        table,
        id,
        live,
        "suppressed",
        s,
        actor,
        `suppression:${suppression?._id ?? live?.snoozed_until}`,
      );
      continue;
    }
    let active = live;
    if (active) {
      const task = await ctx.db.get(active.activity_id);
      if (task && task.status !== "open") {
        if (!active.task_completed_at) {
          const completed = task.completed_at
            ? Date.parse(task.completed_at)
            : Date.now();
          await ctx.db.patch(active._id, {
            task_completed_at: completed,
            next_cycle_at: completed + r.config.cooldown_days * 86400000,
          });
          await record(
            ctx,
            r,
            table,
            id,
            active,
            "task_completed_condition_open",
            s,
            actor,
            `completed:${active.cycle}`,
          );
          continue;
        }
        if (Date.now() < active.next_cycle_at) continue;
        await closeAction(
          ctx,
          active,
          "Task completed; condition persists after cooldown",
        );
        active = null;
      }
    }
    if (active) {
      const level = escalationLevel(
          table === "invoices"
            ? Date.now() - businessDays(s.trigger, Date.now()) * 86400000
            : active.created_at,
          Date.now(),
          r.config.escalation_days,
        ),
        assigned = await recipient(ctx, r, s, table, id, level);
      const priority = level > 0 ? "urgent" : r.config.priority;
      if (
        level !== active.level ||
        assigned !== active.assigned_to ||
        s.reason !== active.reason ||
        s.trigger !== active.trigger ||
        s.impact_cents !== active.impact_cents ||
        active.rule_version !== r.version ||
        active.rule_id !== r._id
      ) {
        const patch = {
          level,
          assigned_to: assigned,
          priority,
          reason: s.reason,
          trigger: s.trigger,
          impact_cents: s.impact_cents,
          impact_key: s.impact_cents.padStart(16, "0"),
          priority_rank:
            priority === "urgent" ? 3 : priority === "high" ? 2 : 1,
          rule_id: r._id,
          rule_version: r.version,
          updated_at: Date.now(),
        };
        await ctx.db.patch(active._id, patch);
        const task = await ctx.db.get(active.activity_id);
        const projectLink = ["operations", "inventory"].includes(
          template(r.key).domain,
        )
          ? await projectTaskLink(ctx, s.project, assigned)
          : undefined;
        if (task?.automation_key === key)
          await ctx.db.patch(task._id, {
            assigned_to: assigned,
            project_id: projectLink,
            title: template(r.key).name,
            description: s.reason,
            priority: priority === "normal" ? "normal" : "high",
            updated_at: new Date().toISOString(),
            version: (task.version ?? 1) + 1,
          });
        if (level > active.level) {
          await ctx.db.insert("automation_escalations", {
            action_id: active._id,
            cycle: active.cycle,
            level,
            from_user: active.assigned_to,
            to_user: assigned,
            created_at: Date.now(),
          });
        }
        await record(
          ctx,
          r,
          table,
          id,
          active,
          level > active.level ? "escalated" : "action_updated",
          s,
          actor,
          `update:${level}:${r._id}:${r.version}:${s.trigger}:${assigned}`,
        );
        await notify(ctx, { ...active, ...patch });
      }
      continue;
    }
    const limitKey = `${r._id}:${day()}`,
      limit = await ctx.db
        .query("automation_limits")
        .withIndex("by_key", (q) => q.eq("key", limitKey))
        .unique();
    if ((limit?.count ?? 0) >= r.config.daily_limit) {
      if (limit && !limit.paused)
        await ctx.db.patch(limit._id, { paused: true });
      await record(
        ctx,
        r,
        table,
        id,
        null,
        "circuit_limited",
        s,
        actor,
        `limit:${day()}`,
      );
      continue;
    }
    const previous = await ctx.db
      .query("automation_actions")
      .withIndex("by_key", (q) => q.eq("key", key))
      .order("desc")
      .take(10);
    const cycle = Math.max(0, ...previous.map((p) => p.cycle)) + 1;
    if (previous.filter((p) => day(p.created_at) === day()).length >= 3) {
      await record(
        ctx,
        r,
        table,
        id,
        null,
        "entity_limited",
        s,
        actor,
        `limit:${day()}`,
      );
      continue;
    }
    const assigned = await recipient(ctx, r, s, table, id, 0),
      t = template(r.key),
      stamp = new Date().toISOString();
    const projectLink = await projectTaskLink(ctx, s.project, assigned);
    const links =
      t.domain === "sales"
        ? {
            ...(!s.opportunity && s.realtor ? { realtor_id: s.realtor } : {}),
            ...(s.opportunity ? { opportunity_id: s.opportunity } : {}),
          }
        : (t.domain === "operations" || t.domain === "inventory") && projectLink
          ? { project_id: projectLink }
          : {};
    if ("project_id" in links) {
      const count = await ctx.db
        .query("activities")
        .withIndex("by_project", (q) =>
          q.eq("project_id", links.project_id!).eq("deleted_at", null),
        )
        .take(81);
      if (count.length >= 80) throw Error("PROJECT_TASK_LIMIT");
    }
    const taskId =
      table === "activities"
        ? ctx.db.normalizeId("activities", id)!
        : await ctx.db.insert("activities", {
            ...links,
            type: "task",
            title: t.name,
            description: s.reason,
            due_at: stamp,
            completed_at: null,
            status: "open",
            priority: r.config.priority === "normal" ? "normal" : "high",
            assigned_to: assigned,
            created_by: r.created_by,
            replaces_activity_id: null,
            created_at: stamp,
            updated_at: stamp,
            deleted_at: null,
            version: 1,
            automation_key: key,
            automation_domain: t.domain,
            automation_rule_id: r._id,
            actor_kind: "system",
          });
    const aid = await ctx.db.insert("automation_actions", {
      key,
      table,
      entity_id: id,
      family,
      domain: t.domain,
      rule_id: r._id,
      rule_version: r.version,
      cycle,
      trigger: s.trigger,
      reason: s.reason,
      href: s.href,
      impact_cents: s.impact_cents,
      impact_key: s.impact_cents.padStart(16, "0"),
      priority_rank:
        r.config.priority === "urgent"
          ? 3
          : r.config.priority === "high"
            ? 2
            : 1,
      order_at: -Date.now(),
      priority: r.config.priority,
      status: "active",
      activity_id: taskId,
      assigned_to: assigned,
      level: 0,
      snoozed_until: 0,
      created_at: Date.now(),
      updated_at: Date.now(),
      resolved_at: null,
      resolution: null,
      execution_id: null,
      task_completed_at: null,
      next_cycle_at: 0,
    });
    const a = (await ctx.db.get(aid))!;
    const eid = await record(
      ctx,
      r,
      table,
      id,
      a,
      "action_created",
      s,
      actor,
      `created:${cycle}`,
    );
    await ctx.db.patch(aid, { execution_id: eid });
    await notify(ctx, a);
    if (limit) await ctx.db.patch(limit._id, { count: limit.count + 1 });
    else
      await ctx.db.insert("automation_limits", {
        key: limitKey,
        day: day(),
        count: 1,
        paused: false,
      });
    created++;
  }
  if (queue)
    await ctx.db.patch(queue._id, {
      due_at:
        Date.now() +
        (Array.from(groups.values()).some((group) =>
          group.some((o) => o.rule.config.enabled && o.signal.eligible),
        )
          ? 3600000
          : 86400000),
      attempts: 0,
      last_code: null,
      last_attempt: Date.now(),
      status: "pending",
    });
  return { created };
}
export { invariantNeeded };
