import { metricDefinitions } from "../src/lib/analytics/catalog";
import { api } from "./_generated/api";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id, Doc } from "./_generated/dataModel";
import { requireRoles, deny } from "./access";
import { roles, modules, canAccess, type Module } from "../src/lib/permissions";
import * as ops from "./operationsCore";
import { catalogUser } from "./inventoryCore";
import { scope as commercialScope } from "./commercialCore";
import { canSee, actionRelevant } from "./automationSources";
import {
  scopeSchema,
  sanitizeText,
  fingerprint,
  type Scope,
  type Context,
  type Evidence,
} from "../src/lib/ai/model";

type Ctx = QueryCtx | MutationCtx;
export const profileStamp = (u: Doc<"profiles">) =>
  JSON.stringify({
    id: u.userId,
    roles: [...u.roles].sort(),
    updated: u.updated_at,
  });
export function normalize<
  T extends
    | "realtors"
    | "opportunities"
    | "projects"
    | "products"
    | "invoices"
    | "automation_actions"
    | "inventory_locations",
>(ctx: Ctx, table: T, id: string): Id<T> {
  const value = ctx.db.normalizeId(table, id);
  if (!value) deny("FORBIDDEN");
  return value;
}
export async function authorize(ctx: Ctx, raw: Scope) {
  const scope = scopeSchema.parse(raw),
    u = await requireRoles(ctx, roles),
    manager = ops.isAdmin(u),
    f = scope.feature;
  if (f === "executive" && !manager) deny();
  if (
    f === "commercial" &&
    !manager &&
    !(scope.entity_id && u.roles.includes("sales"))
  )
    deny();
  if (
    ["realtor", "opportunity"].includes(f) &&
    !manager &&
    !u.roles.includes("sales")
  )
    deny();
  if (f === "inventory") await catalogUser(ctx);
  if (f === "marketing" && !manager && !u.roles.includes("marketing")) deny();
  if (scope.entity_id) {
    if (f === "realtor") {
      const r = await ctx.db.get(normalize(ctx, "realtors", scope.entity_id));
      if (!r || r.deleted_at || (!manager && r.assigned_to !== u.userId))
        deny();
    } else if (f === "opportunity") {
      const o = await ctx.db.get(
        normalize(ctx, "opportunities", scope.entity_id),
      );
      if (!o || o.deleted_at || (!manager && o.assigned_to !== u.userId))
        deny();
    } else if (f === "project" || f === "marketing") {
      const p = await ctx.db.get(normalize(ctx, "projects", scope.entity_id));
      if (!p || p.deleted_at) deny();
      const a = await ops.access(ctx, p, u);
      if (!a) deny();
      if (f === "project" && a === "marketing") deny();
    } else if (f === "inventory") {
      const p = await ctx.db.get(normalize(ctx, "products", scope.entity_id));
      if (!p || p.deleted_at) deny();
    } else if (f === "commercial") {
      const i = await ctx.db.get(normalize(ctx, "invoices", scope.entity_id));
      if (!i) deny();
      await commercialScope(ctx, i.project_id);
    } else if (f === "automation") {
      const a = await ctx.db.get(
        normalize(ctx, "automation_actions", scope.entity_id),
      );
      if (!a || !(await canSee(ctx, u, a)) || !(await actionRelevant(ctx, a)))
        deny();
    } else deny("INVALID_INPUT");
  }
  return { scope, u, manager };
}
function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function select(value: unknown, keys: string[]) {
  const r = record(value);
  return Object.fromEntries(
    keys
      .filter((k) => r[k] !== undefined)
      .map((k) => [
        k,
        typeof r[k] === "string" ? sanitizeText(r[k] as string, 500) : r[k],
      ]),
  );
}
const taskFields = [
  "title",
  "type",
  "status",
  "due_at",
  "completed_at",
  "priority",
];
export async function buildContext(ctx: Ctx, raw: Scope): Promise<Context> {
  const { scope, u, manager } = await authorize(ctx, raw),
    evidence: Evidence[] = [],
    limitations: string[] = [],
    existing: string[] = [];
  let canPropose = false;
  const add = (
    entity_type: string,
    entity_id: string,
    label: string,
    route: string,
    data: unknown,
    version: unknown = "",
    kind: Evidence["kind"] = "recorded_fact",
  ) => {
    if (evidence.length >= 20) {
      limitations.push(
        "Only the first 20 relevant evidence records are included.",
      );
      return;
    }
    const encoded = JSON.stringify(data);
    if (encoded.length > 6000)
      deny("INSUFFICIENT_EVIDENCE", "Narrow the selected scope.");
    evidence.push({
      key: `e${evidence.length + 1}`,
      entity_type,
      entity_id,
      label: sanitizeText(label, 100),
      module: scope.feature,
      route,
      data: encoded,
      kind,
      version: String(version),
    });
  };
  const task = (x: Doc<"activities">, route: string) => {
    if (x.status === "open") existing.push(x._id);
    add(
      "activities",
      x._id,
      x.title,
      route,
      select(x, taskFields),
      x.updated_at,
    );
  };
  if (scope.feature === "realtor" && scope.entity_id) {
    const r = (await ctx.db.get(normalize(ctx, "realtors", scope.entity_id)))!;
    add(
      "realtors",
      r._id,
      `${r.first_name} ${r.last_name}`,
      `/realtors/${r._id}`,
      select(r, [
        "first_name",
        "last_name",
        "relationship_status",
        "primary_city",
        "primary_area",
        "luxury_agent",
      ]),
      r.version,
    );
    const work = await ctx.db
      .query("activities")
      .withIndex("by_realtor", (q) => q.eq("realtor_id", r._id))
      .order("desc")
      .take(11);
    for (const x of work.slice(0, 10))
      if (!x.deleted_at) task(x, `/realtors/${r._id}`);
    if (work.length > 10)
      limitations.push(
        "Recent activity is limited to ten records; absence does not prove no older interaction.",
      );
    const opportunities = await ctx.db
      .query("opportunities")
      .withIndex("by_realtor", (q) => q.eq("realtor_id", r._id))
      .order("desc")
      .take(9);
    for (const o of opportunities.slice(0, 8))
      if (!o.deleted_at && (manager || o.assigned_to === u.userId)) {
        const open = await ctx.db
          .query("activities")
          .withIndex("by_opportunity", (q) =>
            q
              .eq("opportunity_id", o._id)
              .eq("status", "open")
              .eq("deleted_at", null),
          )
          .take(1);
        for (const action of open) {
          existing.push(action._id);
          task(action, `/opportunities/${o._id}`);
        }
        add(
          "opportunities",
          o._id,
          "Related opportunity",
          `/opportunities/${o._id}`,
          select(o, [
            "stage",
            "stage_changed_at",
            "estimated_value_cents",
            "lost_reason",
            "won_at",
            "lost_at",
          ]),
          o.version,
        );
      }
    if (manager) {
      const brief = await ctx.runQuery(api.analytics.realtorProfile, {
        id: r._id,
      });
      add(
        "realtor_metrics",
        r._id,
        "Realtor relationship metrics",
        `/realtors/${r._id}`,
        select(brief, [
          "projects",
          "last_completed_activity",
          "segment",
          "definition",
          "collectible_cents",
        ]),
        r.version,
        "derived_metric",
      );
    }
    canPropose = work.length <= 10 && opportunities.length <= 8;
  } else if (scope.feature === "opportunity" && scope.entity_id) {
    const id = normalize(ctx, "opportunities", scope.entity_id),
      d = await ctx.runQuery(api.sales.getOpportunity, { id });
    if (!d) deny();
    const row = (await ctx.db.get(id))!;
    add(
      "opportunities",
      id,
      "Opportunity",
      `/opportunities/${id}`,
      select(d.opportunity, [
        "stage",
        "stage_changed_at",
        "estimated_value_cents",
        "probability",
        "lost_reason",
      ]),
      row.version,
    );
    for (const x of d.activities.slice(0, 8))
      if (!x.deleted_at) task(x, `/opportunities/${id}`);
    for (const q of d.quotes.slice(0, 4))
      add(
        "quotes",
        q._id,
        "Quote",
        `/quotes/${q._id}`,
        select(q, [
          "number",
          "status",
          "total_cents",
          "sent_at",
          "accepted_at",
          "valid_until",
        ]),
        q.version,
      );
    for (const c of d.consultations.slice(0, 3))
      add(
        "consultations",
        c._id,
        "Consultation",
        `/opportunities/${id}`,
        select(c, ["status", "scheduled_at", "completed_at"]),
        c.updated_at,
      );
    canPropose =
      d.activities.length <= 8 && !["won", "lost"].includes(row.stage);
  } else if (
    ["project", "marketing"].includes(scope.feature) &&
    scope.entity_id
  ) {
    const id = normalize(ctx, "projects", scope.entity_id),
      d = await ctx.runQuery(api.operations.get, { id });
    const marketing = scope.feature === "marketing";
    add(
      "projects",
      id,
      d.project_number,
      `/projects/${id}`,
      select(
        d,
        marketing
          ? ["project_number", "city", "status"]
          : [
              "project_number",
              "city",
              "status",
              "staging_date",
              "destaging_date",
              "planned_end_date",
              "required_open_count",
              "overdue_count",
              "attention_level",
              "attention_reasons",
              "project_manager_name",
              "designer_name",
              "staging_lead_name",
            ],
      ),
      d.version,
    );
    if (marketing)
      limitations.push(
        "Only approved operational status and city are included; no seller, exact address, sale-price or above-asking claims are authorized.",
      );
    else {
      add(
        "project_readiness",
        id,
        "Checklist and rooms",
        `/projects/${id}`,
        {
          checklist: d.checklist
            .slice(0, 15)
            .map((x) => select(x, ["title", "required", "status", "category"])),
          rooms: d.rooms
            .slice(0, 8)
            .map((x) =>
              select(x, [
                "room_name",
                "room_type",
                "status",
                "style_direction",
              ]),
            ),
        },
        d.version,
      );
      for (const x of d.tasks.slice(0, 8))
        if (!x.deleted_at) task(x, `/projects/${id}`);
      if (["manage", "design", "crew"].includes(d.access)) {
        const inventory = await ctx.runQuery(api.inventory.projectInventory, {
          project_id: id,
        });
        add(
          "project_inventory",
          id,
          "Inventory readiness",
          `/projects/${id}/inventory`,
          {
            readiness: inventory.readiness,
            lines: inventory.lines
              .slice(0, 12)
              .map((x) =>
                select(x, [
                  "product_name",
                  "room_name",
                  "quantity",
                  "state",
                  "shortage",
                  "needed_from",
                  "needed_until",
                ]),
              ),
          },
          d.version,
        );
      }
      canPropose =
        d.tasks.length <= 8 &&
        d.can_edit &&
        ["manage", "design"].includes(d.access);
    }
  } else if (scope.feature === "inventory" && scope.entity_id) {
    const id = normalize(ctx, "products", scope.entity_id),
      p = await ctx.runQuery(api.inventory.product, { id });
    add(
      "products",
      id,
      p.name,
      `/inventory/products/${id}`,
      select(p, [
        "name",
        "track_mode",
        "category_name",
        "description",
        "color",
        "material",
        "dimensions",
        "staging_use_count",
        "upcoming_quantity",
        "installed_quantity",
        "partial",
      ]),
      p.version,
    );
    if (scope.location_id && scope.from && scope.until) {
      const a = await ctx.runQuery(api.inventory.availability, {
        product_id: id,
        location_id: normalize(ctx, "inventory_locations", scope.location_id),
        needed_from: scope.from,
        needed_until: scope.until,
      });
      add(
        "availability",
        id,
        "Availability for selected window",
        `/inventory/products/${id}`,
        {
          window: { from: scope.from, until: scope.until },
          ...select(a, ["available", "track_mode"]),
        },
      );
    } else
      limitations.push(
        "Select a location and date window for authoritative availability. Current status or use count alone does not determine availability.",
      );
    const alternatives = await ctx.db
      .query("products")
      .withIndex("by_category", (q) =>
        q.eq("category_id", p.category_id).eq("deleted_at", null),
      )
      .take(6);
    for (const candidate of alternatives
      .filter((x) => x._id !== id && x.active && x.staging_eligible)
      .slice(0, 3)) {
      const available =
        scope.location_id && scope.from && scope.until
          ? await ctx.runQuery(api.inventory.availability, {
              product_id: candidate._id,
              location_id: normalize(
                ctx,
                "inventory_locations",
                scope.location_id,
              ),
              needed_from: scope.from,
              needed_until: scope.until,
            })
          : null;
      add(
        "products",
        candidate._id,
        candidate.name,
        "/inventory/products/" + candidate._id,
        {
          ...select(candidate, [
            "name",
            "color",
            "material",
            "description",
            "width",
            "height",
            "depth",
            "track_mode",
          ]),
          role: "same-category alternative for human review",
          window: { from: scope.from, until: scope.until },
          available: available?.available ?? null,
        },
        candidate.version,
      );
    }
    limitations.push(
      "Alternatives are a bounded same-category sample; style and suitability require designer review. No inventory is reserved.",
    );
    limitations.push(
      "Acquisition cost and attributed rental profit are not recorded; profitability cannot be determined.",
    );
  } else if (scope.feature === "commercial" && scope.entity_id) {
    const id = normalize(ctx, "invoices", scope.entity_id),
      i = await ctx.runQuery(api.commercial.invoice, { id });
    add(
      "invoices",
      id,
      "Invoice",
      `/invoices/${id}`,
      select(i, [
        "number",
        "status",
        "effective_status",
        "due_date",
        "issued_at",
        "total_cents",
        "paid_cents",
        "balance_cents",
        "outstanding_cents",
        "credit_balance_cents",
      ]),
      i.version,
    );
  } else if (scope.feature === "automation" && scope.entity_id) {
    const id = normalize(ctx, "automation_actions", scope.entity_id),
      a = (await ctx.db.get(id))!;
    add(
      "automation_actions",
      id,
      "Automation explanation",
      a.href,
      select(a, [
        "reason",
        "family",
        "priority",
        "status",
        "cycle",
        "rule_version",
        "level",
        "created_at",
        "snoozed_until",
      ]),
      a.updated_at,
    );
    existing.push(a.activity_id);
  } else if (scope.feature === "executive" || scope.feature === "commercial") {
    const period =
      scope.period === "custom"
        ? { period: "custom", from: scope.from, until: scope.until }
        : { period: scope.period };
    const d = await ctx.runQuery(api.analytics.summary, {
      period: JSON.stringify(period),
    });
    if (!d.ready) deny("INSUFFICIENT_EVIDENCE");
    add(
      "analytics",
      "company",
      "Period metrics",
      "/dashboard",
      {
        range: select(d.range, ["from", "until", "timezone"]),
        previous_range: d.previous_range,
        flows: d.flows,
        previous: d.previous,
        derived: d.derived,
      },
      d.revision,
      "derived_metric",
    );
    add(
      "analytics",
      "current",
      "Current balances and capacity",
      "/dashboard",
      {
        current: d.current,
        comparisons: d.comparisons,
        historical_ar: d.historical_ar,
        refunds: d.refunds,
      },
      d.revision,
      "derived_metric",
    );
    add(
      "metric_definitions",
      "catalog",
      "M6 metric definitions",
      "/reports",
      metricDefinitions,
      "M6",
      "derived_metric",
    );
    if (scope.feature === "commercial") {
      const invoices = await ctx.runQuery(api.commercial.receivables, {
        paginationOpts: { numItems: 12, cursor: null },
        status: "unpaid",
        from: "",
        until: "",
      });
      for (const i of invoices.page)
        add(
          "invoices",
          i._id,
          i.number,
          `/invoices/${i._id}`,
          select(i, [
            "number",
            "due_date",
            "effective_status",
            "total_cents",
            "paid_cents",
            "balance_cents",
          ]),
          i.version,
        );
      if (!invoices.isDone)
        limitations.push(
          "The invoice list is a bounded page, not an exhaustive company ranking. Open Payments for the complete queue.",
        );
    } else {
      const breakdown = await ctx.runQuery(api.analytics.breakdown, {
        metric: "opportunities_won",
        dimension: "realtor",
        period: JSON.stringify(period),
      });
      add(
        "analytics",
        "growth",
        "Won opportunities by Realtor",
        "/reports",
        {
          rows: breakdown.rows
            .slice(0, 8)
            .map((x) => select(x, ["label", "value"])),
          other: breakdown.other,
          member_count: breakdown.member_count,
        },
        d.revision,
        "derived_metric",
      );
    }
    limitations.push(
      "Period figures follow M6 definitions. Associations do not establish causality. All money is exact CAD cents; basis-point ratios require division by 100 for display as a percentage.",
    );
  } else if (scope.feature === "general") {
    if (u.roles.every((x) => x === "marketing")) {
      limitations.push("Select a content-ready project for marketing context.");
    } else {
      const d = await ctx.runQuery(api.analyticsOperations.actionCenter, {});
      add(
        "priorities",
        "current",
        "Your authorized action center",
        "/dashboard",
        {
          ...select(d, ["partial"]),
          actions: d.actions
            .slice(0, 10)
            .map((x) =>
              select(x, ["domain", "severity", "label", "reason", "due"]),
            ),
        },
        "",
        "derived_metric",
      );
    }
  } else if (scope.feature === "navigation") {
    add("help", "navigation", "Glara OS navigation", "/dashboard", {
      metric_definitions: metricDefinitions,
      modules: (Object.keys(modules) as Module[])
        .filter((m) => canAccess(u.roles, m))
        .map((m) => modules[m].title),
    });
  } else
    limitations.push(
      "Select an authorized record. A name alone may be ambiguous; no record is chosen automatically.",
    );
  if (
    scope.entity_id &&
    ["realtor", "opportunity", "project"].includes(scope.feature)
  ) {
    const table =
      scope.feature === "realtor"
        ? "realtors"
        : scope.feature === "opportunity"
          ? "opportunities"
          : "projects";
    const actions = await ctx.db
      .query("automation_actions")
      .withIndex("by_source", (q) =>
        q
          .eq("table", table)
          .eq("entity_id", scope.entity_id)
          .eq("status", "active"),
      )
      .take(11);
    for (const a of actions.slice(0, 10))
      if ((await canSee(ctx, u, a)) && (await actionRelevant(ctx, a))) {
        existing.push(a.activity_id);
        add(
          "automation_actions",
          a._id,
          "Existing automation task",
          a.href,
          select(a, ["reason", "family", "cycle", "rule_version", "status"]),
          a.updated_at,
        );
      }
    if (actions.length > 10)
      limitations.push(
        "Additional active automation tasks exist; review the full source queue.",
      );
  }
  if (evidence.length === 0)
    limitations.push(
      "Glara OS does not currently have enough recorded data to determine that reliably.",
    );
  const proof = {
    scope,
    role_stamp: profileStamp(u),
    evidence,
    existing_task_ids: existing,
  };
  if (new TextEncoder().encode(JSON.stringify(proof)).length > 24000)
    deny("INSUFFICIENT_EVIDENCE", "Narrow this request.");
  return {
    ...proof,
    retrieved_at: new Date().toISOString(),
    revision: await fingerprint(proof),
    limitations: [...new Set(limitations)],
    can_propose: canPropose && existing.length === 0,
    assignee_id: u.userId,
  };
}
export async function evidenceAllowed(
  ctx: Ctx,
  e: Pick<Evidence, "entity_type" | "entity_id">,
  parent: Scope,
) {
  const map: Record<string, Scope["feature"]> = {
    realtors: "realtor",
    opportunities: "opportunity",
    projects: "project",
    products: "inventory",
    invoices: "commercial",
    automation_actions: "automation",
  };
  const f = map[e.entity_type];
  if (f)
    await authorize(ctx, {
      ...parent,
      feature:
        f === "project" && parent.feature === "marketing" ? "marketing" : f,
      entity_id: e.entity_id,
    });
  else await authorize(ctx, parent);
}
