import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { requireRoles, deny } from "./access";
import { parse, revision } from "./operationsCore";
import { roles } from "../src/lib/permissions";
import {
  comparisonRange,
  periodInput,
  resolvePeriod,
  daysBetween,
  type BusinessRange,
} from "../src/lib/analytics/periods";
import {
  defaultTargets,
  targetInput,
  ratio,
  change,
} from "../src/lib/analytics/model";
import { metricAllowed } from "../src/lib/analytics/catalog";
import { day, addDays } from "../src/lib/operations/model";
import {
  sourceTables,
  sourceTableInput,
  sourceProjection,
} from "./analyticsSources";
import {
  applySource,
  sourceFacts,
  factValue,
  differences,
} from "./analyticsLedger";
import { z } from "zod";
const filterInput = z
  .object({
    dimension: z.enum([
      "company",
      "salesperson",
      "realtor",
      "lead_source",
      "city",
      "project",
      "product",
      "category",
      "method",
    ]),
    member: z.string().min(1).max(150),
  })
  .strict();
async function scope(ctx: QueryCtx, input?: string) {
  const user = await requireRoles(ctx, roles);
  let filter = input
    ? parse(filterInput, input)
    : { dimension: "company" as const, member: "all" };
  const manager = user.roles.some((r) => r === "owner" || r === "admin");
  if (!manager) {
    if (user.roles.includes("sales")) {
      if (
        input &&
        (filter.dimension !== "salesperson" || filter.member !== user.userId)
      )
        deny();
      filter = { dimension: "salesperson", member: user.userId };
    } else if (user.roles.includes("marketing")) {
      if (!["company", "lead_source"].includes(filter.dimension)) deny();
    } else deny();
  }
  if (filter.dimension === "company" && filter.member !== "all")
    deny("INVALID_INPUT");
  return { user, filter, manager };
}
async function state(ctx: QueryCtx) {
  return ctx.db
    .query("analytics_state")
    .withIndex("by_key", (q) => q.eq("key", "main"))
    .unique();
}
async function configuration(ctx: QueryCtx) {
  return (
    (await ctx.db
      .query("analytics_settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique()) ?? { ...defaultTargets, version: 0 }
  );
}
function slices(from: string, until: string) {
  const result: { grain: string; period: string }[] = [];
  let date = from;
  while (date <= until) {
    const next = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nextMonth = next.toISOString().slice(0, 10),
      last = addDays(nextMonth, -1);
    if (date.endsWith("-01") && last <= until) {
      result.push({ grain: "month", period: date.slice(0, 7) });
      date = nextMonth;
    } else {
      result.push({ grain: "day", period: date });
      date = addDays(date, 1);
    }
  }
  return result;
}
async function totals(
  ctx: QueryCtx,
  range: Pick<BusinessRange, "from" | "until">,
  filter: z.infer<typeof filterInput>,
  allowed: (metric: string) => boolean,
  current = false,
) {
  const result: Record<string, string> = {};
  const periods = current
    ? [{ grain: "current", period: "current" }]
    : slices(range.from, range.until);
  for (const p of periods) {
    const rows = await ctx.db
      .query("analytics_buckets")
      .withIndex("by_period", (q) =>
        q
          .eq("grain", p.grain)
          .eq("period", p.period)
          .eq("dimension", filter.dimension)
          .eq("member", filter.member),
      )
      .take(401);
    if (rows.length > 400) deny("LIMIT", "Reporting metric limit reached.");
    for (const r of rows)
      if (allowed(r.metric))
        result[r.metric] = String(
          BigInt(result[r.metric] ?? "0") + BigInt(r.value),
        );
  }
  return result;
}
export const summary = query({
  args: {
    period: v.string(),
    filter: v.optional(v.string()),
    refresh_bucket: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user, filter, manager } = await scope(ctx, args.filter),
      clock = new Date().toISOString();
    let range: BusinessRange;
    try {
      range = resolvePeriod(parse(periodInput, args.period), clock);
    } catch {
      return deny(
        "INVALID_INPUT",
        "Choose a reporting period ending no later than today.",
      );
    }
    const allowed = (metric: string) => metricAllowed(user.roles, metric);
    const previousRange = comparisonRange(
      parse(periodInput, args.period),
      range,
    );
    const previousFrom = previousRange.from,
      previousUntil = previousRange.until;
    const [ledger, settings, flows, current, previous] = await Promise.all([
      state(ctx),
      configuration(ctx),
      totals(ctx, range, filter, allowed),
      totals(ctx, range, filter, allowed, true),
      totals(
        ctx,
        { from: previousFrom, until: previousUntil },
        filter,
        allowed,
      ),
    ]);
    const value = (metric: string) => flows[metric] ?? "0",
      cv = (metric: string) => current[metric] ?? "0";
    const financial = user.roles.some((r) => r === "owner" || r === "admin");
    return {
      ready: ledger?.ready ?? false,
      source_through: ledger?.source_through ?? null,
      revision: ledger?.revision ?? 0,
      as_of: clock,
      range,
      previous_range: { from: previousFrom, until: previousUntil },
      filter,
      flows,
      current,
      previous,
      comparisons: Object.fromEntries(
        [...new Set([...Object.keys(flows), ...Object.keys(previous)])].map(
          (k) => [k, change(value(k), previous[k] ?? "0")],
        ),
      ),
      derived: {
        win_rate_basis_points: allowed("opportunities_won")
          ? ratio(
              value("opportunities_won"),
              String(
                BigInt(value("opportunities_won")) +
                  BigInt(value("opportunities_lost")),
              ),
            )
          : null,
        net_cash_cents: financial
          ? String(
              BigInt(value("cash_received_cents")) -
                BigInt(value("cash_reversed_cents")),
            )
          : null,
        net_invoiced_cents: financial
          ? String(
              BigInt(value("invoiced_cents")) -
                BigInt(value("credits_cents")) -
                BigInt(value("voided_cents")),
            )
          : null,
        inventory_utilization_basis_points: manager
          ? ratio(cv("assets_eligible_staged"), cv("assets_eligible"))
          : null,
        average_project_value_cents:
          financial && cv("invoiced_projects") !== "0"
            ? String(
                BigInt(cv("collectible_cents")) /
                  BigInt(cv("invoiced_projects")),
              )
            : null,
      },
      targets: manager
        ? {
            minimum: settings.minimum,
            target: settings.target,
            stretch: settings.stretch,
          }
        : null,
      historical_ar: {
        status: "paginated_reconstruction" as const,
        reason:
          "Use the historical receivables report to reconstruct balances at a past date. The KPI above is current AR.",
      },
      refunds: {
        status: "unsupported" as const,
        reason: "M5 has no refund ledger. Customer credit is not a refund.",
      },
      can_configure: user.roles.includes("owner"),
    };
  },
});
export const settings = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner"]);
    return configuration(ctx);
  },
});
export const saveSettings = mutation({
  args: { version: v.number(), input: v.string() },
  handler: async (ctx, args) => {
    const user = await requireRoles(ctx, ["owner"]),
      value = parse(targetInput, args.input),
      old = await ctx.db
        .query("analytics_settings")
        .withIndex("by_key", (q) => q.eq("key", "main"))
        .unique();
    revision(old ?? { version: 0 }, args.version);
    const next = {
      ...value,
      key: "main",
      version: args.version + 1,
      updated_at: new Date().toISOString(),
    };
    const id = old ? old._id : await ctx.db.insert("analytics_settings", next);
    if (old) await ctx.db.patch(id, next);
    await ctx.db.insert("audit_logs", {
      actor_id: user.userId,
      action: "ANALYTICS_SETTINGS_CHANGED",
      entity: "analytics_settings",
      entity_id: id,
      old_value: old,
      new_value: next,
      created_at: next.updated_at,
    });
    return id;
  },
});
export const drill = query({
  args: {
    metric: v.string(),
    period: v.string(),
    filter: v.optional(v.string()),
    pagination: paginationOptsValidator,
  },
  handler: async (ctx, args) => {
    const { user, filter } = await scope(ctx, args.filter);
    if (
      !metricAllowed(user.roles, args.metric) ||
      !user.roles.some((r) => r === "owner" || r === "admin" || r === "sales")
    )
      return deny();
    const range = resolvePeriod(
      parse(periodInput, args.period),
      new Date().toISOString(),
    );
    if (args.pagination.numItems > 50) deny("INVALID_INPUT");
    const current =
      /^(stage_|next_action_|relationship_|project_status_|reserved_quantity_)/.test(
        args.metric,
      ) ||
      [
        "pipeline_cents",
        "weighted_pipeline_cents",
        "open_opportunities",
        "active_projects",
        "outstanding_ar_cents",
        "customer_credit_cents",
        "unallocated_cents",
        "current_valid_collected_cents",
        "collectible_cents",
        "invoiced_projects",
        "realtors_active",
        "unresolved_incidents",
        "followups_open",
        "asset_use_count",
      ].includes(args.metric) ||
      args.metric.startsWith("assets_") ||
      args.metric.startsWith("quantity_");
    const from = current ? "current" : range.from,
      until = current ? "current" : range.until;
    const q =
      filter.dimension === "salesperson"
        ? ctx.db
            .query("analytics_facts")
            .withIndex("by_salesperson", (q) =>
              q
                .eq("dimensions.salesperson", filter.member)
                .eq("metric", args.metric)
                .eq("active", true)
                .gte("day", from)
                .lte("day", until),
            )
        : ctx.db
            .query("analytics_facts")
            .withIndex("by_metric_day", (q) =>
              q
                .eq("metric", args.metric)
                .eq("active", true)
                .gte("day", from)
                .lte("day", until),
            );
    if (!["company", "salesperson"].includes(filter.dimension))
      deny("INVALID_INPUT", "Use the company or assigned-sales drill-down.");
    const page = await q.paginate(args.pagination);
    return {
      ...page,
      page: page.page.map((r) => ({
        id: r._id,
        label: r.label,
        href: r.href,
        value: r.value,
        event_at: r.event_at,
        precision: r.precision,
        scope: r.scope,
        attribution:
          !r.dimensions.salesperson || r.dimensions.salesperson === "unknown"
            ? "insufficient_history"
            : "recorded",
      })),
    };
  },
});
export const aging = query({
  args: { refresh_bucket: v.optional(v.number()) },
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner", "admin"]);
    const rows = await ctx.db
      .query("analytics_buckets")
      .withIndex("by_members", (q) =>
        q
          .eq("grain", "current")
          .eq("period", "current")
          .eq("metric", "outstanding_ar_cents")
          .eq("dimension", "due_date"),
      )
      .take(2001);
    if (rows.length > 2000)
      deny("LIMIT", "Receivables aging requires a narrower reporting range.");
    const buckets = {
      not_due: 0n,
      days_1_30: 0n,
      days_31_60: 0n,
      days_61_90: 0n,
      days_91_plus: 0n,
      unknown: 0n,
    };
    for (const r of rows) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(r.member)) {
        buckets.unknown += BigInt(r.value);
        continue;
      }
      const age = daysBetween(r.member, day());
      buckets[
        age <= 0
          ? "not_due"
          : age <= 30
            ? "days_1_30"
            : age <= 60
              ? "days_31_60"
              : age <= 90
                ? "days_61_90"
                : "days_91_plus"
      ] += BigInt(r.value);
    }
    return {
      as_of: day(),
      timezone: "America/Vancouver",
      buckets: Object.fromEntries(
        Object.entries(buckets).map(([k, v]) => [k, String(v)]),
      ),
    };
  },
});
export const compareSource = query({
  args: { table: v.string(), id: v.string() },
  handler: async (ctx, args) => {
    await requireRoles(ctx, ["owner"]);
    const table = sourceTableInput.parse(args.table),
      expected = await sourceProjection(ctx, table, args.id),
      stored = await sourceFacts(ctx, table, args.id);
    return {
      source_version: expected.version,
      revision: (await state(ctx))?.revision ?? 0,
      drift: differences(
        stored.filter((r) => r.active).map(factValue),
        expected.facts,
      ),
      source_facts: expected.facts.length,
    };
  },
});
export const repairSource = mutation({
  args: {
    table: v.string(),
    id: v.string(),
    metric: v.string(),
    source_version: v.number(),
    revision: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const actor = await requireRoles(ctx, ["owner"]);
    if (args.reason.trim().length < 10 || args.reason.length > 1000)
      deny("INVALID_INPUT");
    const table = sourceTableInput.parse(args.table),
      p = await sourceProjection(ctx, table, args.id),
      status = await state(ctx);
    if (
      p.version !== args.source_version ||
      (status?.revision ?? 0) !== args.revision
    )
      deny("CONFLICT", "Source or projection changed. Reconcile again.");
    const drift = differences(
      (await sourceFacts(ctx, table, args.id))
        .filter((r) => r.active && r.metric === args.metric)
        .map(factValue),
      p.facts.filter((f) => f.metric === args.metric),
    );
    const result = await applySource(
      ctx,
      table,
      args.id,
      p.facts,
      p.version,
      args.metric,
    );
    if (result.applied) {
      if (status)
        await ctx.db.patch(status._id, { revision: status.revision + 1 });
      await ctx.db.insert("audit_logs", {
        actor_id: actor.userId,
        action: "ANALYTICS_SOURCE_REPAIRED",
        entity: table,
        entity_id: args.id,
        old_value: { drift, reason: args.reason },
        new_value: { metric: args.metric, source_version: p.version },
        created_at: new Date().toISOString(),
      });
    }
    return { ...result, drift_count: drift.length };
  },
});
export const startBackfill = internalMutation({
  args: {},
  handler: async (ctx) => {
    const old = await state(ctx),
      next = {
        key: "main",
        ready: false,
        revision: (old?.revision ?? 0) + 1,
        source_through: new Date().toISOString(),
        backfill_complete: false,
        backfill_table: sourceTables[0],
        backfill_cursor: null,
      };
    if (old) await ctx.db.patch(old._id, next);
    else await ctx.db.insert("analytics_state", next);
    return { table: sourceTables[0], cursor: null };
  },
});
export const backfillPage = internalMutation({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args) => {
    const table = sourceTableInput.parse(args.table),
      old = await state(ctx);
    if (
      !old ||
      old.backfill_complete ||
      old.backfill_table !== table ||
      old.backfill_cursor !== args.cursor
    )
      deny("CONFLICT", "Resume the current backfill cursor.");
    const page = await ctx.db
      .query(table)
      .paginate({ cursor: args.cursor, numItems: 5 });
    for (const row of page.page) {
      const p = await sourceProjection(ctx, table, row._id);
      await applySource(ctx, table, row._id, p.facts, p.version);
    }
    const index = sourceTables.indexOf(table),
      complete = page.isDone && index === sourceTables.length - 1,
      nextTable = page.isDone ? (sourceTables[index + 1] ?? table) : table,
      cursor = page.isDone ? null : page.continueCursor;
    await ctx.db.patch(old._id, {
      ready: false,
      backfill_complete: complete,
      revision: old.revision + 1,
      source_through: new Date().toISOString(),
      backfill_table: nextTable,
      backfill_cursor: cursor,
    });
    return { complete, table: nextTable, cursor, processed: page.page.length };
  },
});
export const trends = query({
  args: {
    filter: v.optional(v.string()),
    refresh_bucket: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { user, filter } = await scope(ctx, args.filter),
      today = day(),
      rows = [];
    for (let offset = 5; offset >= 0; offset--) {
      const start = new Date(`${today.slice(0, 7)}-01T12:00:00Z`);
      start.setUTCMonth(start.getUTCMonth() - offset);
      const from = start.toISOString().slice(0, 10);
      start.setUTCMonth(start.getUTCMonth() + 1);
      const until =
        offset === 0 ? today : addDays(start.toISOString().slice(0, 10), -1);
      const metrics = await totals(ctx, { from, until }, filter, (m) =>
        metricAllowed(user.roles, m),
      );
      rows.push({ month: from.slice(0, 7), through: until, metrics });
    }
    return rows;
  },
});
export const breakdown = query({
  args: { metric: v.string(), dimension: v.string(), period: v.string() },
  handler: async (ctx, args) => {
    const user = await requireRoles(ctx, ["owner", "admin", "marketing"]);
    if (!metricAllowed(user.roles, args.metric)) deny();
    const dimension = z
      .enum([
        "realtor",
        "salesperson",
        "lead_source",
        "city",
        "product",
        "method",
      ])
      .parse(args.dimension);
    if (
      !user.roles.some((r) => r === "owner" || r === "admin") &&
      dimension !== "lead_source"
    )
      deny();
    const range = resolvePeriod(
        parse(periodInput, args.period),
        new Date().toISOString(),
      ),
      members = new Map<string, bigint>();
    let read = 0;
    for (const p of slices(range.from, range.until)) {
      const rows = await ctx.db
        .query("analytics_buckets")
        .withIndex("by_members", (q) =>
          q
            .eq("grain", p.grain)
            .eq("period", p.period)
            .eq("metric", args.metric)
            .eq("dimension", dimension),
        )
        .take(501);
      read += rows.length;
      if (rows.length > 500 || read > 5000)
        deny("LIMIT", "Narrow the comparison period.");
      for (const r of rows)
        members.set(r.member, (members.get(r.member) ?? 0n) + BigInt(r.value));
    }
    const ordered = [...members].sort(([a, av], [b, bv]) =>
        av === bv ? a.localeCompare(b) : av > bv ? -1 : 1,
      ),
      rows = [];
    for (const [id, value] of ordered.slice(0, 20)) {
      let label = id,
        href: string | null = null;
      if (id === "unknown") label = "Unknown · insufficient history";
      else if (dimension === "realtor") {
        const key = ctx.db.normalizeId("realtors", id),
          r = key ? await ctx.db.get(key) : null;
        label = r
          ? `${r.first_name} ${r.last_name}${r.deleted_at ? " (archived)" : ""}`
          : "Former realtor";
        href = r ? `/realtors/${r._id}` : null;
      } else if (dimension === "salesperson") {
        const key = ctx.db.normalizeId("users", id),
          r = key
            ? await ctx.db
                .query("profiles")
                .withIndex("by_user", (q) => q.eq("userId", key))
                .unique()
            : null;
        label = r?.display_name ?? "Former staff member";
      } else if (dimension === "lead_source") {
        const key = ctx.db.normalizeId("lead_sources", id),
          r = key ? await ctx.db.get(key) : null;
        label = r?.name ?? "Former lead source";
      } else if (dimension === "product") {
        const key = ctx.db.normalizeId("products", id),
          r = key ? await ctx.db.get(key) : null;
        label = r?.name ?? "Former product";
        href = r ? `/inventory/products/${r._id}` : null;
      }
      rows.push({ id, label, value: String(value), href });
    }
    return {
      rows,
      total: String([...members.values()].reduce((n, v) => n + v, 0n)),
      other: String(ordered.slice(20).reduce((n, [, v]) => n + v, 0n)),
      member_count: members.size,
      unknown: String(members.get("unknown") ?? 0n),
    };
  },
});
export const changes = query({
  args: { pagination: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireRoles(ctx, ["owner"]);
    if (args.pagination.numItems > 50) deny("INVALID_INPUT");
    return ctx.db
      .query("analytics_changes")
      .withIndex("by_created")
      .order("desc")
      .paginate(args.pagination);
  },
});
export const pipelineDetails = query({
  args: { refresh_bucket: v.optional(v.number()) },
  handler: async (ctx) => {
    const { user, filter } = await scope(ctx);
    if (
      !user.roles.some((r) => r === "owner" || r === "admin" || r === "sales")
    )
      deny();
    const current = await totals(
        ctx,
        { from: day(), until: day() },
        filter,
        (m) => metricAllowed(user.roles, m),
        true,
      ),
      rows = [];
    const now = Date.now();
    for (const stage of [
      "new",
      "contacted",
      "interested",
      "consultation",
      "quote_sent",
      "negotiation",
    ]) {
      const metric = "next_action_" + stage;
      const due =
        filter.dimension === "salesperson"
          ? await ctx.db
              .query("analytics_facts")
              .withIndex("by_salesperson", (q) =>
                q
                  .eq("dimensions.salesperson", filter.member)
                  .eq("metric", metric)
                  .eq("active", true)
                  .eq("day", "current"),
              )
              .take(501)
          : await ctx.db
              .query("analytics_facts")
              .withIndex("by_metric_day", (q) =>
                q.eq("metric", metric).eq("active", true).eq("day", "current"),
              )
              .take(501);
      const count = BigInt(current["stage_" + stage] ?? "0"),
        sum = BigInt(current["stage_" + stage + "_entry_ms"] ?? "0");
      rows.push({
        stage,
        count: String(count),
        value_cents: current["stage_" + stage + "_cents"] ?? "0",
        average_days: count
          ? String((BigInt(now) * count - sum) / (count * 86400000n))
          : null,
        overdue: due
          .slice(0, 500)
          .filter(
            (f) =>
              f.dimensions.due_date && Date.parse(f.dimensions.due_date) < now,
          ).length,
        partial: due.length > 500,
      });
    }
    return rows;
  },
});
export const realtorProfile = query({
  args: { id: v.id("realtors") },
  handler: async (ctx, args) => {
    await requireRoles(ctx, ["owner", "admin"]);
    const r = await ctx.db.get(args.id);
    if (!r) deny("UNAVAILABLE");
    const config = await configuration(ctx),
      current = await totals(
        ctx,
        { from: day(), until: day() },
        { dimension: "realtor", member: r._id },
        () => true,
        true,
      );
    const latest = await ctx.db
      .query("activities")
      .withIndex("by_realtor_completed", (q) =>
        q.eq("realtor_id", r._id).gt("completed_at", null),
      )
      .order("desc")
      .first();
    const countRows = await ctx.db
      .query("analytics_buckets")
      .withIndex("by_metric", (q) =>
        q
          .eq("grain", "month")
          .eq("metric", "projects_created")
          .eq("dimension", "realtor")
          .eq("member", r._id),
      )
      .take(601);
    if (countRows.length > 600) deny("LIMIT");
    const projects = countRows.reduce((n, x) => n + BigInt(x.value), 0n),
      value = BigInt(current.collectible_cents ?? "0"),
      last = latest?.completed_at ?? null,
      since = last ?? r.created_at,
      inactive = daysBetween(day(since), day()) >= config.dormant_days;
    const segment =
      projects >= BigInt(config.vip_projects) &&
      value >= BigInt(config.vip_value_cents)
        ? "VIP"
        : inactive
          ? "Dormant"
          : BigInt(current.pipeline_cents ?? "0") > 0n
            ? "Growth"
            : "Developing";
    return {
      id: r._id,
      name: r.first_name + " " + r.last_name,
      relationship_status: r.relationship_status,
      archived: !!r.deleted_at,
      last_completed_activity: last,
      segment,
      definition:
        segment === "VIP"
          ? `At least ${config.vip_projects} projects and configured collectible value threshold.`
          : segment === "Dormant"
            ? `No recorded completed activity for ${config.dormant_days} days; creation date is used when no activity exists.`
            : segment === "Growth"
              ? "Recent relationship activity with an active pipeline."
              : "Relationship exists with limited conversion evidence.",
      projects: String(projects),
      collectible_cents: String(value),
    };
  },
});
