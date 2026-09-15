import { z } from "zod";
import { daysBetween, eventDay } from "../src/lib/analytics/periods";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import {
  fact,
  exactWeighted,
  type Fact,
  type Dimensions,
} from "../src/lib/analytics/model";
import { invoiceState, paymentState } from "./commercialCore";
import { deny } from "./access";
export const sourceTables = [
  "realtors",
  "properties",
  "products",
  "activities",
  "opportunities",
  "consultations",
  "quotes",
  "projects",
  "agreements",
  "invoices",
  "payments",
  "payment_allocations",
  "payment_reversals",
  "credit_notes",
  "package_extensions",
  "damage_charge_assessments",
  "inventory_assets",
  "inventory_stock",
  "inventory_reservations",
  "inventory_movements",
  "inventory_damage",
  "inventory_inspections",
] as const;
export type SourceTable = (typeof sourceTables)[number];
export const sourceTableInput = z.enum(sourceTables);
type Row = Record<string, unknown>;
const record = (x: unknown): Row =>
  x && typeof x === "object" && !Array.isArray(x) ? (x as Row) : {};
export const str = (r: Row, k: string) =>
  typeof r[k] === "string" ? (r[k] as string) : "";
const num = (r: Row, k: string) =>
  typeof r[k] === "number" ? (r[k] as number) : 0;
export async function sourceRow(
  ctx: QueryCtx,
  table: SourceTable,
  id: string,
): Promise<Row | null> {
  const key = ctx.db.normalizeId(table, id);
  return key ? ((await ctx.db.get(key)) as Row | null) : null;
}
export async function sourceProjection(
  ctx: QueryCtx,
  table: SourceTable,
  id: string,
) {
  const row = await sourceRow(ctx, table, id);
  if (!row)
    return {
      facts: [] as Fact[],
      version: 0,
      contexts: {} as Record<
        string,
        { event_at: string; dimensions: Dimensions }
      >,
    };
  const created =
    str(row, "created_at") ||
    str(row, "occurred_at") ||
    str(row, "inspected_at");
  // M1 activities use timestamps; operations/automation may later add a counter.
  // Keep their projection watermark monotonic across that representation change.
  const activityVersion =
    table === "activities"
      ? Math.max(
          num(row, "version"),
          Date.parse(str(row, "updated_at") || created) || 0,
        )
      : 0;
  const version =
    activityVersion ||
    num(row, "version") ||
    Date.parse(str(row, "updated_at") || created) ||
    num(row, "_creationTime");
  const contexts = record(row.event_contexts) as Record<
    string,
    { event_at: string; dimensions: Dimensions }
  >;
  const facts: Fact[] = [];
  const projectId = str(row, "project_id") || (table === "projects" ? id : "");
  const project = projectId
    ? await sourceRow(ctx, "projects", projectId)
    : null;
  const opportunityId =
    str(row, "opportunity_id") || str(project ?? {}, "opportunity_id");
  const opportunity = opportunityId
    ? await sourceRow(ctx, "opportunities", opportunityId)
    : null;
  const realtorId =
    str(row, "realtor_id") ||
    str(project ?? {}, "realtor_id") ||
    str(opportunity ?? {}, "realtor_id") ||
    (table === "realtors" ? id : "");
  const productId = str(row, "product_id");
  const propId =
    str(row, "property_id") ||
    str(project ?? {}, "property_id") ||
    str(opportunity ?? {}, "property_id");
  const prop = propId ? await ctx.db.get(propId as Id<"properties">) : null;
  const product = productId
    ? await ctx.db.get(productId as Id<"products">)
    : null;
  const current: Dimensions = {
    salesperson:
      str(row, "assigned_to") ||
      str(opportunity ?? {}, "assigned_to") ||
      "unknown",
    realtor: realtorId || "unknown",
    lead_source:
      str(row, "lead_source_id") ||
      str(opportunity ?? {}, "lead_source_id") ||
      "unknown",
    city: prop?.city || str(row, "primary_city") || "unknown",
    project: projectId || "unknown",
    product: productId || "unknown",
    category: product?.category_id || "unknown",
    method: str(row, "method") || "unknown",
  };
  // Legacy records use only relationships intrinsic to the source; mutable dimensions remain unknown.
  const legacy: Dimensions = {
    realtor: realtorId || "unknown",
    project: projectId || "unknown",
    product: productId || "unknown",
    method: str(row, "method") || "unknown",
  };
  const audit = async () => {
    const rows = await ctx.db
      .query("audit_logs")
      .withIndex("by_entity", (q) => q.eq("entity_id", id))
      .take(501);
    if (rows.length > 500)
      deny("LIMIT", "Source history requires paginated reconciliation.");
    return rows;
  };
  const url =
    table === "realtors"
      ? `/realtors/${id}`
      : table === "opportunities"
        ? `/opportunities/${id}`
        : table === "quotes"
          ? `/quotes/${id}`
          : table === "projects"
            ? `/projects/${id}`
            : table === "agreements"
              ? `/agreements/${id}`
              : table === "invoices"
                ? `/invoices/${id}`
                : table === "payments"
                  ? `/payments/${id}`
                  : table === "damage_charge_assessments"
                    ? `/assessments/${id}`
                    : table === "inventory_assets"
                      ? `/inventory/assets/${id}`
                      : projectId
                        ? `/projects/${projectId}/inventory`
                        : productId
                          ? `/inventory/products/${productId}`
                          : "/dashboard";
  const label =
    str(row, "number") ||
    str(row, "project_number") ||
    str(row, "asset_number") ||
    [str(row, "first_name"), str(row, "last_name")].filter(Boolean).join(" ") ||
    table.replaceAll("_", " ");
  function emit(
    metric: string,
    at: string,
    value: string | number = "1",
    scope: Fact["scope"] = "flow",
    event = metric,
    dimensions?: Dimensions,
  ) {
    if (!at) return;
    const snapshot = contexts[event];
    const dims =
      dimensions ??
      (scope === "current" ? current : (snapshot?.dimensions ?? legacy));
    facts.push(
      fact({
        key: event + ":" + metric,
        metric,
        scope,
        event_at: at,
        precision: at.length === 10 ? "business_date" : "instant",
        value: String(value),
        dimensions: dims,
        href: url,
        label,
      }),
    );
  }
  const originEvent: Partial<Record<SourceTable, string>> = {
    projects: "projects_created",
    agreements: "agreements_created",
    invoices: "invoiced_cents",
    payments: "cash_received_cents",
    package_extensions: "extensions_created",
    damage_charge_assessments: "damage_reviews_started",
  };
  const stateDimensions = originEvent[table]
    ? (contexts[originEvent[table]!]?.dimensions ?? legacy)
    : current;
  const state = (
    metric: string,
    value: string | number = "1",
    dimensions?: Dimensions,
  ) =>
    emit(
      metric,
      str(row, "updated_at") ||
        created ||
        new Date(num(row, "_creationTime")).toISOString(),
      value,
      "current",
      metric,
      dimensions ?? stateDimensions,
    );
  if (table === "realtors") {
    emit("realtors_created", created);
    if (!row.deleted_at) {
      state("realtors_active");
      state("relationship_" + str(row, "relationship_status"));
    }
  } else if (table === "opportunities") {
    emit("opportunities_created", created);
    const origin = contexts.opportunities_created?.dimensions ?? legacy;
    emit("cohort_opportunities", created, "1", "flow", "cohort", origin);
    const opportunityHistory = await audit();
    const transitions = opportunityHistory
      .filter((a) => a.action === "STAGE_CHANGED")
      .sort((a, b) => a.created_at.localeCompare(b.created_at));
    for (const reached of [
      "contacted",
      "interested",
      "consultation",
      "quote_sent",
      "negotiation",
      "won",
      "lost",
    ]) {
      const first = transitions.find(
        (a) => str(record(a.new_value), "stage") === reached,
      );
      if (first) {
        emit(
          "cohort_reached_" + reached,
          created,
          "1",
          "flow",
          "cohort_reached_" + reached,
          origin,
        );
        const snapshot = record(first.new_value);
        emit(
          "reached_" + reached,
          first.created_at,
          "1",
          "flow",
          "reached_" + reached,
          {
            ...legacy,
            salesperson: str(snapshot, "assigned_to") || "unknown",
            lead_source: str(snapshot, "lead_source_id") || "unknown",
          },
        );
      }
    }
    const stage = str(row, "stage"),
      closed = stage === "won" || stage === "lost";
    if (!closed && !row.deleted_at) {
      state("open_opportunities");
      state("pipeline_cents", str(row, "estimated_value_cents"));
      state(
        "weighted_pipeline_cents",
        exactWeighted(
          str(row, "estimated_value_cents"),
          num(row, "probability"),
        ),
      );
      state("stage_" + stage);
      state(
        "stage_" + stage + "_entry_ms",
        String(Date.parse(str(row, "stage_changed_at"))),
      );
      const action = await ctx.db
        .query("activities")
        .withIndex("by_opportunity", (q) =>
          q
            .eq("opportunity_id", id as Id<"opportunities">)
            .eq("status", "open")
            .eq("deleted_at", null),
        )
        .first();
      if (action?.due_at)
        state("next_action_" + stage, "1", {
          ...current,
          due_date: action.due_at,
        });
      state("stage_" + stage + "_cents", str(row, "estimated_value_cents"));
    }
    if (closed) {
      const at = str(row, stage + "_at");
      if (stage === "won")
        emit("cohort_won", created, "1", "outcome", "cohort_won", origin);
      let dims = contexts[stage]?.dimensions;
      if (!dims) {
        const found = opportunityHistory.find(
          (a) =>
            a.action === "STAGE_CHANGED" &&
            str(record(a.new_value), stage + "_at") === at,
        );
        if (found) {
          const value = record(found.new_value);
          dims = {
            ...legacy,
            salesperson: str(value, "assigned_to") || "unknown",
            lead_source: str(value, "lead_source_id") || "unknown",
          };
        }
      }
      emit("opportunities_" + stage, at, "1", "outcome", stage, dims);
      emit(
        stage + "_value_cents",
        at,
        str(row, "estimated_value_cents"),
        "outcome",
        stage,
        dims,
      );
      if (stage === "lost")
        emit(
          "lost_reason_" + str(row, "lost_reason"),
          at,
          "1",
          "outcome",
          stage,
          dims,
        );
      if (stage === "won" && at && created) {
        emit(
          "opportunity_won_days",
          at,
          String(
            daysBetween(
              eventDay({ kind: "instant", value: created }),
              eventDay({ kind: "instant", value: at }),
            ),
          ),
          "outcome",
          stage,
          dims,
        );
        emit("opportunity_won_samples", at, "1", "outcome", stage, dims);
        const quotes = await ctx.db
          .query("quotes")
          .withIndex("by_opportunity", (q) =>
            q.eq("opportunity_id", id as Id<"opportunities">),
          )
          .take(101);
        if (quotes.length > 100) deny("LIMIT");
        const sent = quotes
          .flatMap((q) => (q.sent_at && q.sent_at <= at ? [q.sent_at] : []))
          .sort()[0];
        if (sent) {
          emit(
            "quote_won_days",
            at,
            String(
              daysBetween(
                eventDay({ kind: "instant", value: sent }),
                eventDay({ kind: "instant", value: at }),
              ),
            ),
            "outcome",
            stage,
            dims,
          );
          emit("quote_won_samples", at, "1", "outcome", stage, dims);
        }
      }
      if (at && created) {
        emit(
          "sales_cycle_ms",
          at,
          String(Date.parse(at) - Date.parse(created)),
          "outcome",
          stage,
          dims,
        );
        emit("sales_cycle_samples", at, "1", "outcome", stage, dims);
      }
    }
  } else if (table === "activities") {
    emit("activities_created", created);
    if (str(row, "completed_at"))
      emit("activities_completed", str(row, "completed_at"));
    if (!row.deleted_at && str(row, "status") === "open" && str(row, "due_at"))
      state("followups_open", "1", {
        ...current,
        due_date: str(row, "due_at"),
      });
  } else if (table === "consultations") {
    if (str(row, "status") !== "cancelled")
      emit("consultations_scheduled", str(row, "scheduled_at"));
    emit("consultations_completed", str(row, "completed_at"));
  } else if (table === "quotes") {
    emit("quotes_created", created);
    emit("quotes_sent", str(row, "sent_at"));
    emit("quotes_accepted", str(row, "accepted_at"));
    if (str(row, "sent_at"))
      emit(
        "quote_discounts_cents",
        str(row, "sent_at"),
        str(row, "discount_cents"),
      );
  } else if (table === "projects") {
    emit("projects_created", created);
    emit("projects_completed", str(row, "completed_at"));
    emit("projects_cancelled", str(row, "cancelled_at"));
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_project", (q) => q.eq("project_id", id as Id<"projects">))
      .take(101);
    if (invoices.length > 100) deny("LIMIT", "Project invoice limit reached.");
    if (invoices.some((i) => i.issued_at && !i.voided_at))
      state("invoiced_projects");
    const history = await audit();
    const staged = history
      .filter(
        (a) =>
          a.action === "PROJECT_STATUS_CHANGED" &&
          str(record(a.new_value), "status") === "staged",
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
    if (staged)
      emit("projects_staged", staged.created_at, "1", "flow", "staged_first");
    const destaging = history
      .filter(
        (a) =>
          a.action === "PROJECT_STATUS_CHANGED" &&
          str(record(a.new_value), "status") === "destaging",
      )
      .sort((a, b) => a.created_at.localeCompare(b.created_at))[0]?.created_at;
    const cycles = [
      ["won_project", str(opportunity ?? {}, "won_at"), created],
      ["created_staged", created, staged?.created_at],
      ["staged_listing", staged?.created_at, str(row, "listing_live_date")],
      ["listing_sold", str(row, "listing_live_date"), str(row, "sold_date")],
      ["sold_destaging", str(row, "sold_date"), destaging],
      ["destaging_complete", destaging, str(row, "completed_at")],
    ];
    for (const [metric, start, end] of cycles)
      if (metric && start && end) {
        const d = (value: string) =>
          eventDay({
            kind: value.length === 10 ? "business_date" : "instant",
            value,
          });
        const duration = daysBetween(d(start), d(end));
        if (duration >= 0) {
          emit(metric + "_days", end, String(duration));
          emit(metric + "_samples", end);
        }
      }
    for (const status of ["listing_live", "pending_sale", "sold"])
      emit("projects_" + status, str(row, status + "_date"));
    if (!row.deleted_at) {
      state("project_status_" + str(row, "status"));
      if (!["completed", "cancelled"].includes(str(row, "status")))
        state("active_projects");
    }
    if (str(row, "completed_at")) {
      emit(
        "project_duration_ms",
        str(row, "completed_at"),
        String(Date.parse(str(row, "completed_at")) - Date.parse(created)),
      );
      emit("project_duration_samples", str(row, "completed_at"));
    }
  } else if (table === "agreements") {
    emit("agreements_created", created);
    emit("agreements_sent", str(row, "issued_at"));
    const at = str(record(row.acceptance), "recorded_at");
    emit("agreements_accepted", at);
    emit("accepted_contract_cents", at, str(row, "total_cents"));
  } else if (table === "invoices") {
    emit("invoices_created", created);
    const issued = str(row, "issued_at"),
      voided = str(row, "voided_at");
    if (issued) {
      emit("invoices_issued", issued);
      emit("invoiced_cents", issued, str(row, "total_cents"));
      emit("invoice_discounts_cents", issued, str(row, "discount_cents"));
      emit(
        "invoiced_" + str(row, "source_type") + "_cents",
        issued,
        str(row, "total_cents"),
      );
    }
    if (issued && voided) emit("voided_cents", voided, str(row, "total_cents"));
    const invoice = await ctx.db.get(id as Id<"invoices">);
    if (invoice) {
      const balance = await invoiceState(ctx, invoice);
      state("outstanding_ar_cents", balance.balance_cents, {
        ...stateDimensions,
        due_date: invoice.due_date,
      });
      state("customer_credit_cents", balance.credit_balance_cents);
      if (issued && !voided) {
        state(
          "collectible_cents",
          String(BigInt(invoice.total_cents) - BigInt(balance.credit_cents)),
        );
      }
    }
  } else if (table === "payments") {
    const at = str(row, "received_date"),
      amount = str(row, "amount_cents");
    emit("payments_recorded", created);
    emit("payments_received", at);
    emit("cash_received_cents", at, amount);
    const payment = await ctx.db.get(id as Id<"payments">);
    if (payment) {
      const p = await paymentState(ctx, payment);
      state("unallocated_cents", p.unallocated_cents);
      if (!p.reversal) state("current_valid_collected_cents", amount);
    }
  } else if (table === "payment_reversals") {
    const payment = await ctx.db.get(str(row, "payment_id") as Id<"payments">);
    if (payment)
      emit(
        "cash_reversed_cents",
        created,
        payment.amount_cents,
        "flow",
        "reversed",
        {
          ...(payment.event_contexts?.cash_received_cents?.dimensions ??
            legacy),
          method: payment.method,
          project: payment.project_id,
        },
      );
  } else if (table === "payment_allocations") {
    const invoice = await ctx.db.get(str(row, "invoice_id") as Id<"invoices">),
      payment = await ctx.db.get(str(row, "payment_id") as Id<"payments">);
    if (invoice && payment) {
      const dims = invoice.event_contexts?.invoiced_cents?.dimensions ?? {
        project: invoice.project_id,
        realtor: invoice.realtor_id,
        method: payment.method,
      };
      emit(
        "cash_allocated_" + invoice.source_type + "_cents",
        payment.received_date,
        str(row, "amount_cents"),
        "flow",
        "allocated_category",
        dims,
      );
      const reversal = await ctx.db
        .query("payment_reversals")
        .withIndex("by_payment", (q) => q.eq("payment_id", payment._id))
        .unique();
      if (reversal)
        emit(
          "cash_allocated_reversed_" + invoice.source_type + "_cents",
          reversal.created_at,
          str(row, "amount_cents"),
          "flow",
          "category_reversed",
          dims,
        );
      emit(
        "allocations_cents",
        created,
        str(row, "amount_cents"),
        "flow",
        "allocated",
        dims,
      );
    }
  } else if (table === "credit_notes") {
    const invoice = await ctx.db.get(str(row, "invoice_id") as Id<"invoices">);
    emit(
      "credits_cents",
      created,
      str(row, "amount_cents"),
      "flow",
      "credit",
      invoice?.event_contexts?.invoiced_cents?.dimensions ?? {
        project: invoice?.project_id ?? "unknown",
        realtor: invoice?.realtor_id ?? "unknown",
      },
    );
  } else if (table === "package_extensions") {
    emit("extensions_created", created);
    const at = str(record(row.approval), "recorded_at");
    emit("extensions_accepted", at);
    emit("accepted_extension_cents", at, str(row, "total_cents"));
    if (at) {
      emit(
        "extension_days",
        at,
        String(
          (Date.parse(str(row, "new_end_date")) -
            Date.parse(str(row, "original_end_date"))) /
            86400000,
        ),
      );
    }
  } else if (table === "damage_charge_assessments") {
    emit("damage_reviews_started", created);
    emit("damage_charges_approved", str(row, "approved_at"));
    emit(
      "approved_damage_cents",
      str(row, "approved_at"),
      str(row, "approved_amount_cents"),
    );
    if (["waived", "no_charge"].includes(str(row, "status")))
      emit("damage_" + str(row, "status"), str(row, "decided_at"));
  } else if (table === "inventory_assets") {
    if (!row.deleted_at) {
      state("assets_" + str(row, "status"));
      state("assets_total");
      if (
        row.staging_eligible &&
        product?.staging_eligible &&
        product.active &&
        !product.deleted_at &&
        !["sold", "retired"].includes(str(row, "status"))
      ) {
        state("assets_eligible");
        if (str(row, "status") === "staged") state("assets_eligible_staged");
      }
    }
    state("asset_use_count", num(row, "staging_use_count"));
  } else if (table === "inventory_stock") {
    if (product?.track_mode === "quantity")
      for (const bucket of [
        "available",
        "inspection",
        "cleaning",
        "repair",
        "damaged",
        "missing",
        "sold",
        "retired",
      ])
        state("quantity_" + bucket, num(row, bucket));
  } else if (table === "inventory_reservations") {
    if (row.active) {
      state("reserved_quantity_" + str(row, "state"), num(row, "quantity"));
      if (product?.track_mode === "quantity")
        state("quantity_project_" + str(row, "state"), num(row, "quantity"));
    }
  } else if (table === "inventory_movements") {
    const kind = str(row, "movement_type"),
      at = str(row, "occurred_at");
    emit("inventory_" + kind, at, num(row, "quantity"));
    if (kind === "installed") {
      emit("installations", at);
      emit("installed_units", at, num(row, "quantity"));
    }
  } else if (table === "inventory_damage") {
    emit("incidents_" + str(row, "damage_type"), str(row, "discovered_at"));
    if (!["resolved", "written_off"].includes(str(row, "status")))
      state("unresolved_incidents");
  } else if (table === "inventory_inspections")
    emit("inspections", str(row, "inspected_at"));
  return {
    facts,
    version,
    contexts,
    current,
    opportunityId: table === "opportunities" ? id : opportunityId,
    propertyId: propId,
  };
}
export async function captureContexts(
  ctx: MutationCtx,
  table: SourceTable,
  id: string,
  previous: Fact[],
) {
  const projection = await sourceProjection(ctx, table, id);
  if (!projection.current) return;
  const row = await sourceRow(ctx, table, id);
  if (!row) return;
  const supported = [
    "activities",
    "realtors",
    "opportunities",
    "consultations",
    "quotes",
    "projects",
    "agreements",
    "invoices",
    "payments",
    "package_extensions",
    "damage_charge_assessments",
    "inventory_movements",
    "inventory_damage",
    "inventory_inspections",
    "inventory_assets",
  ];
  if (!supported.includes(table)) return;
  const contexts = { ...projection.contexts };
  let changed = false;
  for (const f of projection.facts.filter((f) => f.scope !== "current")) {
    const event = f.key.slice(0, f.key.indexOf(":"));
    const old = contexts[event];
    const fresh = !previous.some(
      (p) => p.key === f.key && p.event_at === f.event_at,
    );
    if (
      (!old && fresh) ||
      (table === "opportunities" &&
        (event === "won" || event === "lost") &&
        old?.event_at !== f.event_at &&
        fresh)
    ) {
      let dimensions = projection.current;
      if (
        eventDay({ kind: f.precision, value: f.event_at }) <
        eventDay({ kind: "instant", value: new Date().toISOString() })
      ) {
        dimensions = {
          realtor: projection.current.realtor,
          project: projection.current.project,
          product: projection.current.product,
          method: projection.current.method,
        };
        const at = eventDay({ kind: f.precision, value: f.event_at });
        for (const [entity, kind] of [
          [projection.opportunityId, "opportunity"],
          [projection.propertyId, "property"],
        ] as const) {
          if (!entity) continue;
          const logs = await ctx.db
            .query("audit_logs")
            .withIndex("by_entity", (q) => q.eq("entity_id", entity))
            .take(501);
          if (logs.length > 500)
            deny(
              "LIMIT",
              "Historical attribution requires a bounded source audit.",
            );
          const candidates = logs
            .filter(
              (a) => eventDay({ kind: "instant", value: a.created_at }) <= at,
            )
            .sort((a, b) => b.created_at.localeCompare(a.created_at));
          const snapshot = candidates
            .map((a) => record(a.new_value))
            .find((value) =>
              kind === "opportunity"
                ? !!str(value, "assigned_to")
                : !!str(value, "city"),
            );
          if (snapshot) {
            if (kind === "opportunity") {
              dimensions.salesperson = str(snapshot, "assigned_to");
              dimensions.lead_source =
                str(snapshot, "lead_source_id") || "unknown";
            } else dimensions.city = str(snapshot, "city");
          }
        }
      }
      contexts[event] = { event_at: f.event_at, dimensions };
      changed = true;
    }
  }
  if (changed) {
    const key = ctx.db.normalizeId(table, id);
    if (key) await ctx.db.patch(key, { event_contexts: contexts });
  }
}
