import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import {
  template,
  due,
  businessDays,
  type SourceTable,
} from "../src/lib/automation/model";
import { day, closed, attention } from "../src/lib/operations/model";
import {
  checks,
  events,
  tasks,
  settings,
  access,
  isAdmin,
} from "./operationsCore";
import {
  invoiceState,
  paymentState,
  sourceInvoices,
  projectInvoices,
  cap,
} from "./commercialCore";
import { available } from "./inventoryCore";
import { defaultTargets } from "../src/lib/analytics/model";
type Ctx = QueryCtx | MutationCtx;
export type Signal = {
  eligible: boolean;
  trigger: string;
  reason: string;
  href: string;
  impact_cents: string;
  owner: Id<"users"> | null;
  project: Id<"projects"> | null;
  realtor: Id<"realtors"> | null;
  opportunity: Id<"opportunities"> | null;
  observed: number;
};
export async function source(ctx: Ctx, table: SourceTable, id: string) {
  const key = ctx.db.normalizeId(table, id);
  return key ? ctx.db.get(key) : null;
}
export async function evaluate(
  ctx: Ctx,
  rule: Pick<Doc<"automation_rules">, "key" | "config" | "enabled_at">,
  id: string,
  now = Date.now(),
  observed = now,
): Promise<Signal> {
  const t = template(rule.key),
    r = await source(ctx, t.table, id),
    c = rule.config;
  const s: Signal = {
    eligible: false,
    trigger: "",
    reason: t.description,
    href: "/notifications",
    impact_cents: "0",
    owner: null,
    project: null,
    realtor: null,
    opportunity: null,
    observed,
  };
  if (
    !r ||
    ("deleted_at" in r && r.deleted_at) ||
    (c.entity_ids?.length && !c.entity_ids.includes(id))
  )
    return s;
  const stamp = (value: string | null | undefined) => {
    s.trigger = value || "";
    return !!value && due(value, c.delay_days, now);
  };
  if (t.table === "opportunities") {
    const o = r as Doc<"opportunities">;
    s.owner = o.assigned_to;
    s.opportunity = o._id;
    s.realtor = o.realtor_id;
    s.href = `/opportunities/${o._id}`;
    s.impact_cents = o.estimated_value_cents;
    const property = await ctx.db.get(o.property_id),
      realtor = await ctx.db.get(o.realtor_id);
    if (!property || property.deleted_at || !realtor || realtor.deleted_at)
      return s;
    if (rule.key === "new_contact")
      s.eligible = o.stage === "new" && stamp(o.created_at);
    if (rule.key === "stale_opportunity") {
      const config = await ctx.db
        .query("analytics_settings")
        .withIndex("by_key", (q) => q.eq("key", "main"))
        .unique();
      s.eligible =
        !["won", "lost"].includes(o.stage) &&
        BigInt(o.estimated_value_cents) >=
          BigInt(
            c.minimum_cents === "0"
              ? (config?.high_value_cents ?? defaultTargets.high_value_cents)
              : c.minimum_cents,
          ) &&
        stamp(o.stage_changed_at);
    }
    if (rule.key === "lost_reactivation") {
      const propertyProjects = cap(
        await ctx.db
          .query("projects")
          .withIndex("by_property", (q) => q.eq("property_id", o.property_id))
          .take(101),
      );
      s.eligible =
        o.stage === "lost" &&
        ["timing", "no_response"].includes(o.lost_reason) &&
        !propertyProjects.some((p) => !!p.sold_date) &&
        stamp(o.lost_at);
    }
    if (rule.key === "won_handoff")
      s.eligible =
        o.stage === "won" &&
        stamp(o.won_at) &&
        !(await ctx.db
          .query("projects")
          .withIndex("by_opportunity", (q) =>
            q.eq("opportunity_id", o._id).eq("deleted_at", null),
          )
          .first());
  }
  if (t.table === "quotes") {
    const q = r as Doc<"quotes">,
      o = await ctx.db.get(q.opportunity_id);
    if (!o || o.deleted_at || ["won", "lost"].includes(o.stage)) return s;
    s.owner = o.assigned_to;
    s.opportunity = o._id;
    s.realtor = o.realtor_id;
    s.href = `/quotes/${q._id}`;
    s.impact_cents = q.total_cents;
    s.eligible = q.status === "sent" && stamp(q.sent_at);
    s.reason = `${q.number}: sent ${c.delay_days}+ days ago and still awaiting a decision.`;
  }
  if (t.table === "realtors") {
    const realtor = r as Doc<"realtors">;
    s.owner = realtor.assigned_to;
    s.realtor = realtor._id;
    s.href = `/realtors/${realtor._id}`;
    const history = cap(
      await ctx.db
        .query("activities")
        .withIndex("by_realtor_completed", (q) =>
          q.eq("realtor_id", realtor._id).gt("completed_at", null),
        )
        .order("desc")
        .take(101),
    );
    const last = history.find(
      (a) =>
        !a.deleted_at &&
        a.status === "completed" &&
        !["task", "note", "follow_up"].includes(a.type),
    );
    s.eligible = stamp(last?.completed_at ?? realtor.created_at);
    s.reason = `No completed communication for ${c.delay_days}+ days.`;
  }
  if (t.table === "activities") {
    const a = r as Doc<"activities">;
    if (a.automation_key) return s;
    s.owner = a.assigned_to;
    s.project = a.project_id ?? null;
    s.realtor = a.realtor_id ?? null;
    s.opportunity = a.opportunity_id ?? null;
    s.href = s.project
      ? `/projects/${s.project}`
      : s.opportunity
        ? `/opportunities/${s.opportunity}`
        : s.realtor
          ? `/realtors/${s.realtor}`
          : "/notifications";
    s.eligible =
      a.status === "open" &&
      (rule.key === "required_task" ? !!a.project_id : !a.project_id) &&
      stamp(a.due_at);
  }
  if (t.table === "projects") {
    const p = r as Doc<"projects">;
    s.project = p._id;
    s.owner = p.project_manager_id;
    s.href = `/projects/${p._id}`;
    if (closed(p.status)) return s;
    const es = cap(await events(ctx, p._id), 80),
      cs = cap(await checks(ctx, p._id), 80),
      ts = cap(await tasks(ctx, p._id), 80),
      staging = es.find(
        (e) => e.event_type === "staging" && e.status === "scheduled",
      ),
      destage = es.some(
        (e) => e.event_type === "destaging" && e.status !== "cancelled",
      );
    const incomplete = cs.filter(
      (x) =>
        x.required &&
        x.status !== "completed" &&
        (x.category === "pre_staging" || x.category === "staging"),
    );
    if (t.family === "preparation") {
      s.trigger = staging?.start_at ?? "";
      s.eligible =
        !!staging &&
        businessDays(day(staging.start_at), now) >= -c.delay_days &&
        incomplete.length > 0;
      s.reason = `Staging ${staging ? day(staging.start_at) : "unscheduled"}: ${incomplete.length} required preparation items incomplete.`;
      if (rule.key === "red_project") {
        const risk = attention(
          p,
          es,
          cs,
          ts,
          (await settings(ctx)).package_alert_days,
          day(new Date(now).toISOString()),
          new Date(now).toISOString(),
        );
        const earliest = [
          ...cs
            .filter((c) => c.required && c.status !== "completed")
            .map((c) => c.due_at),
          ...ts
            .filter((t) => t.status === "open" && !t.automation_key)
            .map((t) => t.due_at),
        ]
          .filter((d): d is string => !!d)
          .sort()[0];
        s.trigger =
          earliest ?? staging?.start_at ?? new Date(observed).toISOString();
        s.eligible =
          risk.attention_level === "red" && due(s.trigger, c.delay_days, now);
        s.reason = risk.attention_reasons.join(" · ");
      }
    }
    if (rule.key === "sold_destage") {
      s.trigger = p.sold_date;
      s.eligible =
        p.status === "sold" &&
        !destage &&
        !!p.sold_date &&
        businessDays(p.sold_date, now) >= c.delay_days;
    }
    if (rule.key === "package_expiry") {
      s.trigger = p.planned_end_date;
      s.eligible =
        !!p.planned_end_date &&
        businessDays(p.planned_end_date, now) >= -c.delay_days;
      s.reason = `Package ends ${p.planned_end_date}; review extension or destaging.`;
    }
  }
  if (t.table === "inventory_assets") {
    const a = r as Doc<"inventory_assets">;
    s.project = a.project_id;
    s.href = `/inventory/products/${a.product_id}`;
    if (rule.key === "missing_asset") {
      const m = await ctx.db
        .query("inventory_movements")
        .withIndex("by_asset_type", (q) =>
          q.eq("asset_id", a._id).eq("movement_type", "missing"),
        )
        .order("desc")
        .first();
      s.eligible =
        a.status === "missing" &&
        stamp(m?.occurred_at ?? new Date(observed).toISOString());
    }
    if (rule.key === "repair_backlog") {
      const i = await ctx.db
        .query("inventory_inspections")
        .withIndex("by_asset", (q) => q.eq("asset_id", a._id))
        .order("desc")
        .first();
      s.eligible =
        a.status === "repair" &&
        stamp(i?.inspected_at ?? new Date(observed).toISOString());
    }
  }
  if (t.table === "inventory_reservations") {
    const a = r as Doc<"inventory_reservations">,
      p = await ctx.db.get(a.project_id);
    s.project = a.project_id;
    s.href = `/projects/${a.project_id}/inventory`;
    if (!p || p.deleted_at || closed(p.status) || !a.active) return s;
    if (rule.key === "inventory_return") {
      s.trigger = a.needed_until;
      s.eligible =
        ["installed", "returning", "picked"].includes(a.state) &&
        businessDays(a.needed_until, now) >= c.delay_days;
    }
    if (rule.key === "inventory_shortage") {
      s.trigger = a.needed_from;
      const product = await ctx.db.get(a.product_id);
      const short =
        ["planned", "reserved"].includes(a.state) &&
        (!product ||
          !product.active ||
          !!product.deleted_at ||
          (await available(
            ctx,
            product,
            a.location_id,
            a.needed_from,
            a.needed_until,
            a.asset_id ?? undefined,
            a._id,
          )) < a.quantity);
      s.eligible =
        businessDays(a.needed_from, now) >= -c.delay_days &&
        (short ||
          (["planned", "reserved"].includes(a.state) &&
            !!a.exception &&
            !a.exception_approved) ||
          a.state === "planned");
      s.reason = `${product?.name ?? "Inventory"}: ${a.quantity} required for ${p.project_number}, room ${a.project_room_id}, ${a.needed_from}; ${short ? "shortage" : "preparation incomplete"}.`;
    }
  }
  if (t.table === "inventory_stock") {
    const a = r as Doc<"inventory_stock">;
    s.trigger = new Date(observed).toISOString();
    s.href = `/inventory/products/${a.product_id}`;
    s.eligible = a.missing > 0;
    s.reason = `${a.missing} missing stock units need review.`;
  }
  if (t.table === "invoices") {
    const i = r as Doc<"invoices">,
      b = await invoiceState(ctx, i);
    s.project = i.project_id;
    s.href = `/invoices/${i._id}`;
    s.trigger = i.due_date;
    s.impact_cents = b.balance_cents;
    const days = businessDays(i.due_date, now);
    s.eligible =
      i.status === "issued" &&
      BigInt(b.balance_cents) > 0n &&
      BigInt(b.balance_cents) >= BigInt(c.minimum_cents) &&
      (rule.key === "invoice_due"
        ? days >= -c.delay_days
        : days >= c.delay_days);
    s.reason = `${i.number}: ${days > 0 ? `${days} days overdue` : days === 0 ? "due today" : `due in ${-days} days`}; an outstanding balance remains.`;
  }
  if (t.table === "agreements") {
    const a = r as Doc<"agreements">;
    s.project = a.project_id;
    s.href = `/agreements/${a._id}`;
    const invoices = (await projectInvoices(ctx, a.project_id)).filter(
      (i) =>
        i.agreement_id === a._id &&
        i.source_type === "deposit" &&
        i.status === "issued",
    );
    let collected = 0n;
    for (const i of invoices) {
      const b = await invoiceState(ctx, i);
      collected += BigInt(i.total_cents) - BigInt(b.balance_cents);
    }
    s.impact_cents = String(
      BigInt(a.deposit_cents) > collected
        ? BigInt(a.deposit_cents) - collected
        : 0n,
    );
    s.eligible =
      a.status === "accepted" &&
      BigInt(s.impact_cents) > 0n &&
      stamp(a.acceptance?.recorded_at);
  }
  if (t.table === "package_extensions") {
    const a = r as Doc<"package_extensions">;
    s.project = a.project_id;
    s.href = `/projects/${a.project_id}/commercial`;
    s.eligible =
      a.status === "accepted" &&
      stamp(a.approval?.recorded_at) &&
      !(await sourceInvoices(ctx, "extension", a._id)).some(
        (i) => i.status !== "void" && !i.deleted_at,
      );
  }
  if (t.table === "damage_charge_assessments") {
    const a = r as Doc<"damage_charge_assessments">;
    s.project = a.project_id;
    s.href = `/projects/${a.project_id}/commercial`;
    s.impact_cents = a.approved_amount_cents;
    s.eligible =
      a.status === "approved" &&
      stamp(a.approved_at) &&
      !(await sourceInvoices(ctx, "assessment", a._id)).some(
        (i) => i.status !== "void" && !i.deleted_at,
      );
  }
  if (t.table === "inventory_damage") {
    const a = r as Doc<"inventory_damage">;
    s.project = a.project_id;
    s.href = a.project_id
      ? `/projects/${a.project_id}/commercial`
      : "/payments";
    s.eligible =
      !!a.project_id &&
      a.status !== "resolved" &&
      stamp(a.discovered_at) &&
      !(await ctx.db
        .query("damage_charge_assessments")
        .withIndex("by_damage", (q) => q.eq("damage_record_id", a._id))
        .first());
  }
  if (t.table === "payments") {
    const p = r as Doc<"payments">,
      b = await paymentState(ctx, p);
    s.project = p.project_id;
    s.href = "/payments";
    s.trigger = p.received_date;
    s.impact_cents = b.unallocated_cents;
    s.eligible =
      BigInt(b.unallocated_cents) > 0n &&
      businessDays(p.received_date, now) >= c.delay_days;
  }
  if (t.table === "commercial_customers") {
    s.trigger = "";
    s.href = "/payments";
    const ps = cap(
      await ctx.db
        .query("payments")
        .withIndex("by_customer", (q) =>
          q.eq("customer_id", r._id as Id<"commercial_customers">),
        )
        .take(101),
    );
    let amount = 0n;
    for (const p of ps) {
      const remaining = BigInt((await paymentState(ctx, p)).unallocated_cents);
      amount += remaining;
      if (remaining > 0n && (!s.trigger || p.received_date < s.trigger))
        s.trigger = p.received_date;
    }
    const invoices = cap(
      await ctx.db
        .query("invoices")
        .withIndex("by_customer", (q) =>
          q.eq("customer_id", r._id as Id<"commercial_customers">),
        )
        .take(101),
    );
    for (const invoice of invoices) {
      const balance = await invoiceState(ctx, invoice);
      const credit = BigInt(balance.credit_balance_cents);
      amount += credit;
      if (credit > 0n) {
        const adjusted =
          balance.credits
            .map((c) => c.created_at)
            .sort()
            .at(-1) ?? invoice.updated_at;
        if (!s.trigger || adjusted < s.trigger) s.trigger = adjusted;
      }
    }
    s.impact_cents = String(amount);
    s.eligible =
      amount > 0n &&
      businessDays(s.trigger.includes("T") ? day(s.trigger) : s.trigger, now) >=
        c.delay_days;
  }
  if (s.project) {
    const p = await ctx.db.get(s.project);
    if (
      !p ||
      p.deleted_at ||
      (["operations", "management"].includes(t.domain) && closed(p.status))
    )
      s.eligible = false;
    if (!s.owner) s.owner = p?.project_manager_id ?? null;
  }
  if (s.opportunity && (t.table === "activities" || t.table === "quotes")) {
    const o = await ctx.db.get(s.opportunity);
    if (!o || o.deleted_at || ["won", "lost"].includes(o.stage))
      s.eligible = false;
  }
  if (s.realtor) {
    const r = await ctx.db.get(s.realtor);
    if (!r || r.deleted_at) s.eligible = false;
  }
  if (c.activation === "future" && r._creationTime < rule.enabled_at)
    s.eligible = false;
  return s;
}
export async function canSee(
  ctx: Ctx,
  u: Doc<"profiles">,
  a: Pick<
    Doc<"automation_actions">,
    "domain" | "table" | "entity_id" | "assigned_to"
  >,
) {
  if (u.deleted_at) return false;
  if (isAdmin(u)) return true;
  if (a.domain === "commercial" || a.domain === "management") return false;
  if (a.assigned_to !== u.userId) return false;
  const r = await source(ctx, a.table, a.entity_id);
  if (!r || ("deleted_at" in r && r.deleted_at)) return false;
  if (a.domain === "sales") {
    if (!u.roles.includes("sales")) return false;
    if ("assigned_to" in r) return r.assigned_to === u.userId;
    if (a.table === "quotes") {
      const o = await ctx.db.get((r as Doc<"quotes">).opportunity_id);
      return !!o && !o.deleted_at && o.assigned_to === u.userId;
    }
    return false;
  }
  if (
    a.table === "opportunities" &&
    u.roles.includes("sales") &&
    "assigned_to" in r
  )
    return r.assigned_to === u.userId;
  const pid =
    a.table === "projects"
      ? (r._id as Id<"projects">)
      : "project_id" in r
        ? r.project_id
        : null;
  if (!pid) return false;
  const p = await ctx.db.get(pid);
  if (!p || p.deleted_at) return false;
  const scope = await access(ctx, p, u);
  return !!scope && scope !== "marketing";
}

export async function actionRelevant(ctx: Ctx, a: Doc<"automation_actions">) {
  if (a.status !== "active") return true;
  const row = await source(ctx, a.table, a.entity_id);
  if (!row || ("deleted_at" in row && row.deleted_at)) return false;
  if (a.table === "invoices") {
    const i = row as Doc<"invoices">;
    return (
      i.status === "issued" &&
      BigInt((await invoiceState(ctx, i)).balance_cents) > 0n
    );
  }
  if (a.table === "quotes") {
    const q = row as Doc<"quotes">,
      o = await ctx.db.get(q.opportunity_id);
    return (
      q.status === "sent" &&
      !!o &&
      !o.deleted_at &&
      !["won", "lost"].includes(o.stage)
    );
  }
  if (a.table === "projects" && ["operations", "management"].includes(a.domain))
    return !closed((row as Doc<"projects">).status);
  if (a.table === "inventory_assets")
    return (
      (row as Doc<"inventory_assets">).status ===
      (a.family === "missing" ? "missing" : "repair")
    );
  return true;
}
