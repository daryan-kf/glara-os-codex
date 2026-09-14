import { canSee, actionRelevant } from "./automationSources";
import { v } from "convex/values";
import {
  makeFunctionReference,
  type FunctionReturnType,
  type ApiFromModules,
} from "convex/server";
import { query } from "./_generated/server";
import { requireRoles, deny } from "./access";
import { roles } from "../src/lib/permissions";
import { day, addDays } from "../src/lib/operations/model";
import { daysBetween } from "../src/lib/analytics/periods";
import { invoiceState, assessmentView, sourceInvoices } from "./commercialCore";
import { defaultTargets } from "../src/lib/analytics/model";
type Action = {
  id: string;
  domain: string;
  severity: "red" | "amber";
  label: string;
  reason: string;
  href: string;
  impact_cents: string;
  due: string;
};
export const actionCenter = query({
  args: { refresh_bucket: v.optional(v.number()) },
  handler: async (ctx) => {
    const user = await requireRoles(ctx, roles),
      manager = user.roles.some((r) => r === "owner" || r === "admin"),
      sales = user.roles.includes("sales"),
      designer = user.roles.includes("designer"),
      crew = user.roles.includes("staging_crew");
    if (!manager && !sales && !designer && !crew) deny();
    const actions: Action[] = [],
      now = new Date().toISOString();
    let partial = false;
    if (manager || sales || designer || crew) {
      const ops = await ctx.runQuery(
        makeFunctionReference<
          "query",
          Record<string, never>,
          FunctionReturnType<
            ApiFromModules<{
              operations: typeof import("./operations");
            }>["operations"]["attentionQueue"]
          >
        >("operations:attentionQueue"),
        {},
      );
      partial ||= ops.partial;
      for (const p of ops.page)
        actions.push({
          id: p.id,
          domain: "operations",
          severity: p.attention_level === "red" ? "red" : "amber",
          label: p.project_number,
          reason: p.attention_reasons.join(" · "),
          href: `/projects/${p.id}`,
          impact_cents: "0",
          due: p.planned_end_date || "9999-12-31",
        });
    }
    if (manager || designer) {
      const inventory = await ctx.runQuery(
        makeFunctionReference<
          "query",
          Record<string, never>,
          FunctionReturnType<
            ApiFromModules<{
              inventory: typeof import("./inventory");
            }>["inventory"]["exceptions"]
          >
        >("inventory:exceptions"),
        {},
      );
      // M4's exception feed is bounded; never present this queue as a complete count.
      partial = true;
      for (const r of inventory)
        actions.push({
          id: r.id,
          domain: "inventory",
          severity: ["missing", "shortage"].includes(r.state) ? "red" : "amber",
          label: r.product_name,
          reason: `${r.quantity} · ${r.state.replaceAll("_", " ")} · ${r.project_number}`,
          href: r.project_id
            ? `/projects/${r.project_id}/inventory`
            : `/inventory/products/${r.product_id}`,
          impact_cents: "0",
          due: "9999-12-31",
        });
    }
    if (manager || sales) {
      const due = await ctx.db
        .query("activities")
        .withIndex("by_due", (q) =>
          q
            .eq("status", "open")
            .eq("deleted_at", null)
            .gt("due_at", null)
            .lt("due_at", now),
        )
        .take(101);
      partial ||= due.length > 100;
      for (const task of due.slice(0, 100))
        if (
          (manager || task.assigned_to === user.userId) &&
          !task.automation_key
        )
          actions.push({
            id: task._id,
            domain: "sales",
            severity: "amber",
            label: "Follow-up overdue",
            reason: task.type,
            href: task.realtor_id
              ? `/realtors/${task.realtor_id}`
              : "/opportunities",
            impact_cents: "0",
            due: task.due_at ?? now,
          });
      const config =
        (await ctx.db
          .query("analytics_settings")
          .withIndex("by_key", (q) => q.eq("key", "main"))
          .unique()) ?? defaultTargets;
      for (const stage of [
        "new",
        "contacted",
        "interested",
        "consultation",
        "quote_sent",
        "negotiation",
      ]) {
        const opportunities = manager
          ? await ctx.db
              .query("opportunities")
              .withIndex("by_stage", (q) =>
                q.eq("deleted_at", null).eq("stage", stage),
              )
              .take(51)
          : await ctx.db
              .query("opportunities")
              .withIndex("by_assigned", (q) =>
                q.eq("assigned_to", user.userId).eq("deleted_at", null),
              )
              .filter((q) => q.eq(q.field("stage"), stage))
              .take(51);
        partial ||= opportunities.length > 50;
        for (const o of opportunities.slice(0, 50))
          if (
            BigInt(o.estimated_value_cents) >=
              BigInt(config.high_value_cents) &&
            daysBetween(o.stage_changed_at.slice(0, 10), day()) >=
              config.stale_sales_days
          )
            actions.push({
              id: o._id,
              domain: "sales",
              severity: "amber",
              label: "High-value opportunity stalled",
              reason: `${stage.replaceAll("_", " ")} · ${config.stale_sales_days}+ days without a stage change`,
              href: `/opportunities/${o._id}`,
              impact_cents: o.estimated_value_cents,
              due: o.expected_close_date || "9999-12-31",
            });
      }
    }
    if (manager) {
      const invoices = await ctx.db
        .query("invoices")
        .withIndex("by_status_due", (q) =>
          q.eq("status", "issued").lt("due_date", day()),
        )
        .take(51);
      partial ||= invoices.length > 50;
      for (const i of invoices.slice(0, 50)) {
        const b = await invoiceState(ctx, i);
        if (BigInt(b.balance_cents) > 0n)
          actions.push({
            id: i._id,
            domain: "commercial",
            severity: daysBetween(i.due_date, day()) > 30 ? "red" : "amber",
            label: i.number,
            reason: "Invoice overdue",
            href: `/invoices/${i._id}`,
            impact_cents: b.balance_cents,
            due: i.due_date,
          });
      }
      const unallocated = await ctx.db
        .query("analytics_facts")
        .withIndex("by_metric_day", (q) =>
          q
            .eq("metric", "unallocated_cents")
            .eq("active", true)
            .eq("day", "current"),
        )
        .take(51);
      partial ||= unallocated.length > 50;
      for (const p of unallocated.slice(0, 50))
        if (BigInt(p.value) > 0n)
          actions.push({
            id: p.source_id,
            domain: "commercial",
            severity: "amber",
            label: p.label,
            reason: "Payment has unallocated cash",
            href: p.href,
            impact_cents: p.value,
            due: p.event_at,
          });
      const agreements = await ctx.db
        .query("agreements")
        .withIndex("by_status", (q) => q.eq("status", "accepted"))
        .take(31);
      partial ||= agreements.length > 30;
      for (const a of agreements.slice(0, 30)) {
        const invoices = await sourceInvoices(ctx, "deposit", a._id);
        let paid = 0n;
        for (const i of invoices)
          if (i.status === "issued")
            paid += BigInt((await invoiceState(ctx, i)).paid_cents);
        const due = BigInt(a.deposit_cents) - paid;
        if (due > 0n)
          actions.push({
            id: a._id,
            domain: "commercial",
            severity: "amber",
            label: a.number,
            reason: "Accepted agreement is awaiting its deposit",
            href: `/agreements/${a._id}`,
            impact_cents: String(due),
            due: a.terms.staging_start_date,
          });
      }
      const assessments = await ctx.db
        .query("damage_charge_assessments")
        .withIndex("by_status", (q) => q.eq("status", "approved"))
        .take(21);
      partial ||= assessments.length > 20;
      for (const a of assessments.slice(0, 20)) {
        const view = await assessmentView(ctx, a);
        if (!view.invoice_id || view.recovered_conflict)
          actions.push({
            id: a._id,
            domain: "commercial",
            severity: view.recovered_conflict ? "red" : "amber",
            label: "Damage charge review",
            reason: view.recovered_conflict
              ? "Recovered item requires commercial review"
              : "Approved damage charge not invoiced",
            href: `/assessments/${a._id}`,
            impact_cents: a.approved_amount_cents,
            due: a.approved_at ?? a.created_at,
          });
      }
      const extensions = await ctx.db
        .query("package_extensions")
        .withIndex("by_status", (q) => q.eq("status", "accepted"))
        .take(21);
      partial ||= extensions.length > 20;
      for (const e of extensions.slice(0, 20)) {
        const invoices = await sourceInvoices(ctx, "extension", e._id);
        if (!invoices.some((i) => i.status !== "void"))
          actions.push({
            id: e._id,
            domain: "commercial",
            severity: "amber",
            label: "Package extension",
            reason: "Accepted extension not invoiced",
            href: `/extensions/${e._id}`,
            impact_cents: e.total_cents,
            due: e.new_end_date,
          });
      }
    }
    const automated = manager
      ? await ctx.db
          .query("automation_actions")
          .withIndex("by_status", (q) => q.eq("status", "active"))
          .take(51)
      : await ctx.db
          .query("automation_actions")
          .withIndex("by_assigned", (q) =>
            q.eq("assigned_to", user.userId).eq("status", "active"),
          )
          .take(51);
    partial ||= automated.length > 50;
    for (const item of automated.slice(0, 50))
      if (
        (await canSee(ctx, user, item)) &&
        (await actionRelevant(ctx, item))
      ) {
        for (let i = actions.length - 1; i >= 0; i--)
          if (
            actions[i].id === item.entity_id ||
            actions[i].id === item.activity_id
          )
            actions.splice(i, 1);
        if (item.snoozed_until <= Date.now() && !item.task_completed_at)
          actions.push({
            id: item._id,
            domain: item.domain,
            severity: item.priority === "urgent" ? "red" : "amber",
            label: "Automated next action",
            reason: item.reason,
            href: "/notifications",
            impact_cents: manager || sales ? item.impact_cents : "0",
            due: new Date(item.created_at).toISOString(),
          });
      }
    if (manager) {
      const failed = await ctx.db
        .query("automation_queue")
        .withIndex("by_due", (q) => q.eq("status", "failed"))
        .first();
      if (failed)
        actions.push({
          id: failed._id,
          domain: "management",
          severity: "red",
          label: "Automation needs attention",
          reason:
            "A rule evaluation failed. Review its safe retry in Automation Center.",
          href: "/automation",
          impact_cents: "0",
          due: new Date(failed.last_attempt ?? Date.now()).toISOString(),
        });
      const limited = await ctx.db
        .query("automation_limits")
        .withIndex("by_day_paused", (q) =>
          q.eq("day", day()).eq("paused", true),
        )
        .first();
      if (limited)
        actions.push({
          id: limited._id,
          domain: "management",
          severity: "red",
          label: "Automation volume limit reached",
          reason: "Review the current rule backlog and action limit.",
          href: "/automation",
          impact_cents: "0",
          due: day(),
        });
    }
    actions.sort((a, b) =>
      a.severity !== b.severity
        ? a.severity === "red"
          ? -1
          : 1
        : BigInt(a.impact_cents) !== BigInt(b.impact_cents)
          ? BigInt(a.impact_cents) > BigInt(b.impact_cents)
            ? -1
            : 1
          : a.due.localeCompare(b.due) || a.id.localeCompare(b.id),
    );
    return {
      as_of: now,
      partial: partial || actions.length > 30,
      actions: actions.slice(0, 30),
      ranking: "Severity, financial impact, due date",
    };
  },
});
export const forecast = query({
  args: { days: v.number(), refresh_bucket: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireRoles(ctx, ["owner", "admin"]);
    if (![7, 14, 30].includes(args.days)) deny("INVALID_INPUT");
    const rows = [];
    for (let n = 0; n < args.days; n++) {
      const date = addDays(day(), n);
      const c = await ctx.runQuery(
        makeFunctionReference<
          "query",
          { date: string },
          FunctionReturnType<
            ApiFromModules<{
              operations: typeof import("./operations");
            }>["operations"]["capacity"]
          >
        >("operations:capacity"),
        { date },
      );
      rows.push({ date, ...c });
    }
    return {
      rows,
      partial: rows.some((r) => r.truncated),
      definition:
        "Scheduled staging and destaging events against configured daily capacity. This is workload, not completed staging volume.",
    };
  },
});
