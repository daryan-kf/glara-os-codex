import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { deny, requireRoles } from "./access";
import { type Ctx, access, isAdmin, now } from "./operationsCore";
import { day } from "../src/lib/operations/model";
import { balances } from "../src/lib/commercial/model";
export { deny, now };
export const manager = (ctx: Ctx) => requireRoles(ctx, ["owner", "admin"]);
export async function scope(ctx: Ctx, id: Id<"projects">, write = false) {
  const u = await requireRoles(
    ctx,
    write ? ["owner", "admin"] : ["owner", "admin", "sales"],
  );
  const p = await ctx.db.get(id);
  if (!p) deny("UNAVAILABLE");
  if (
    !isAdmin(u) &&
    !["sales", "manage"].includes((await access(ctx, p, u)) ?? "")
  )
    deny();
  if (write && p.deleted_at) deny("UNAVAILABLE");
  return { u, p, manage: isAdmin(u) };
}
export function cap<T>(rows: T[], limit = 100) {
  if (rows.length > limit)
    deny("LIMIT", "Commercial record limit reached; narrow the query.");
  return rows;
}
export async function audit(
  ctx: MutationCtx,
  actor: Id<"users">,
  entity: string,
  id: string,
  action: string,
  before: unknown = null,
  after: unknown = null,
) {
  await ctx.db.insert("audit_logs", {
    actor_id: actor,
    entity,
    entity_id: id,
    action,
    old_value: before,
    new_value: after,
    created_at: now(),
  });
}
export async function number(
  ctx: MutationCtx,
  kind: "agreement" | "invoice" | "payment" | "credit",
) {
  const year = day().slice(0, 4),
    key = `${kind}:${year}`;
  const old = await ctx.db
    .query("commercial_counters")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const value = (old?.value ?? 0) + 1;
  if (value > 999999) deny("LIMIT");
  if (old) await ctx.db.patch(old._id, { value });
  else await ctx.db.insert("commercial_counters", { key, value });
  return `GLA-${{ agreement: "AGR", invoice: "INV", payment: "PAY", credit: "CRN" }[kind]}-${year}-${String(value).padStart(4, "0")}`;
}
export async function identity(ctx: Ctx, p: Doc<"projects">) {
  const prop = await ctx.db.get(p.property_id),
    r = await ctx.db.get(p.realtor_id);
  return {
    project_number: p.project_number,
    property_address: prop
      ? `${prop.address_line_1}, ${prop.city}, ${prop.province}`
      : "Property",
    realtor_name: r ? `${r.first_name} ${r.last_name}` : "Realtor",
  };
}
export async function customer(ctx: Ctx, id: Id<"commercial_customers">) {
  const c = await ctx.db.get(id);
  if (!c || c.deleted_at) deny("UNAVAILABLE");
  return c;
}
export async function settings(ctx: Ctx) {
  return (
    (await ctx.db
      .query("commercial_settings")
      .withIndex("by_key", (q) => q.eq("key", "default"))
      .unique()) ?? {
      taxes: [],
      payment_terms: "",
      extension_terms: "",
      deposit_type: "percentage",
      deposit_value: "50",
      version: 0,
    }
  );
}
export async function reversal(ctx: Ctx, id: Id<"payments">) {
  return ctx.db
    .query("payment_reversals")
    .withIndex("by_payment", (q) => q.eq("payment_id", id))
    .unique();
}
export async function paymentState(ctx: Ctx, p: Doc<"payments">) {
  const allocations = cap(
    await ctx.db
      .query("payment_allocations")
      .withIndex("by_payment", (q) => q.eq("payment_id", p._id))
      .take(101),
  );
  const reversed = await reversal(ctx, p._id);
  const allocated = allocations.reduce(
    (n, a) => n + BigInt(a.amount_cents),
    0n,
  );
  return {
    ...p,
    allocations,
    reversal: reversed,
    status: reversed ? "reversed" : "received",
    allocated_cents: reversed ? "0" : String(allocated),
    unallocated_cents: reversed
      ? "0"
      : String(BigInt(p.amount_cents) - allocated),
  };
}
export async function invoiceState(ctx: Ctx, i: Doc<"invoices">) {
  const allocations = cap(
      await ctx.db
        .query("payment_allocations")
        .withIndex("by_invoice", (q) => q.eq("invoice_id", i._id))
        .take(101),
    ),
    credits = cap(
      await ctx.db
        .query("credit_notes")
        .withIndex("by_invoice", (q) => q.eq("invoice_id", i._id))
        .take(101),
    );
  let paid = 0n;
  for (const a of allocations)
    if (!(await reversal(ctx, a.payment_id))) paid += BigInt(a.amount_cents);
  const credited = credits.reduce((n, c) => n + BigInt(c.amount_cents), 0n);
  return {
    ...i,
    ...balances(i.total_cents, paid, credited, i.status, i.due_date, day()),
    allocations,
    credits,
  };
}
export async function sourceInvoices(
  ctx: Ctx,
  type: Doc<"invoices">["source_type"],
  id: string,
) {
  return cap(
    await ctx.db
      .query("invoices")
      .withIndex("by_source", (q) =>
        q.eq("source_type", type).eq("source_id", id),
      )
      .take(101),
  );
}
export async function agreements(ctx: Ctx, id: Id<"projects">) {
  return cap(
    await ctx.db
      .query("agreements")
      .withIndex("by_project", (q) => q.eq("project_id", id))
      .take(101),
  );
}
export async function projectInvoices(ctx: Ctx, id: Id<"projects">) {
  return cap(
    await ctx.db
      .query("invoices")
      .withIndex("by_project", (q) => q.eq("project_id", id))
      .take(101),
  );
}
export async function checkInvoiceCapacity(ctx: Ctx, id: Id<"projects">) {
  if ((await projectInvoices(ctx, id)).length >= 100) deny("LIMIT");
}
export async function assertEndChange(
  ctx: Ctx,
  id: Id<"projects">,
  end: string,
  current: string,
) {
  if (end === current) return;
  const locked = (await agreements(ctx, id)).some(
    (a) => a.status === "accepted",
  );
  if (locked)
    deny(
      "DEPENDENCY",
      "Use a commercial extension to change an accepted package end date.",
    );
}
export async function assessmentView(
  ctx: Ctx,
  a: Doc<"damage_charge_assessments">,
) {
  const incident = await ctx.db.get(a.damage_record_id),
    line = incident?.reservation_id
      ? await ctx.db.get(incident.reservation_id)
      : null;
  let recovered = false;
  if (a.assessment_type === "missing" && line && incident) {
    const found = cap(
      await ctx.db
        .query("inventory_movements")
        .withIndex("by_project_type", (q) =>
          q.eq("project_id", a.project_id).eq("movement_type", "found"),
        )
        .take(101),
    );
    for (const m of found) {
      if (m.created_at < incident.created_at || !m.reservation_id) continue;
      const r = await ctx.db.get(m.reservation_id);
      if (
        r &&
        (r._id === line._id ||
          (r.parent_id ?? r._id) === (line.parent_id ?? line._id))
      )
        recovered = true;
    }
  }
  const invoice = (await sourceInvoices(ctx, "assessment", a._id)).find(
    (i) => i.status !== "void",
  );
  const financial = invoice ? await invoiceState(ctx, invoice) : null;
  return {
    ...a,
    incident: incident
      ? {
          type: incident.damage_type,
          severity: incident.severity,
          status: incident.status,
          discovered_at: incident.discovered_at,
        }
      : null,
    invoice_id: invoice?._id ?? null,
    effective_status:
      financial?.effective_status === "paid"
        ? "paid"
        : invoice
          ? "invoiced"
          : a.status,
    recovered_conflict:
      recovered &&
      a.status === "approved" &&
      (!financial ||
        BigInt(financial.total_cents) > BigInt(financial.credit_cents) ||
        BigInt(financial.credit_balance_cents) > 0n),
    balance_cents: financial?.balance_cents ?? "0",
    credit_balance_cents: financial?.credit_balance_cents ?? "0",
  };
}
