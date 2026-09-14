import { query, mutation } from "./functions";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { z } from "zod";
import { requireRoles } from "./access";
import { parse, revision, stamps, events } from "./operationsCore";
import * as core from "./commercialCore";
import {
  apportion,
  billTo,
  agreementInput,
  agreementMath,
  evidenceInput,
  invoiceInput,
  itemMath,
  sumItems,
  totals,
  settingsInput,
  extensionInput,
  assessmentInput,
  safeReference,
  paymentMethods,
  cents,
} from "../src/lib/commercial/model";
import { money } from "../src/lib/sales/model";
import { day } from "../src/lib/operations/model";
const positive = money.refine((x) => cents(x) > 0n);
const reasonInput = z.string().trim().min(3).max(2000);
const reason = (x: string) => parse(reasonInput, JSON.stringify(x));
function calculate<T>(fn: () => T): T {
  try {
    return fn();
  } catch {
    return core.deny(
      "INVALID_INPUT",
      "Review amounts, discounts and tax rates.",
    );
  }
}
export const configuration = query({
  args: {},
  handler: async (ctx) => {
    await core.manager(ctx);
    return {
      settings: await core.settings(ctx),
      customers: core.cap(
        await ctx.db
          .query("commercial_customers")
          .withIndex("by_active", (q) => q.eq("deleted_at", null))
          .take(101),
      ),
    };
  },
});
export const saveCustomer = mutation({
  args: {
    id: v.optional(v.id("commercial_customers")),
    version: v.number(),
    input: v.string(),
  },
  handler: async (ctx, a) => {
    const u = await core.manager(ctx),
      data = parse(billTo, a.input);
    let id = a.id;
    if (id) {
      const old = await core.customer(ctx, id);
      revision(old, a.version);
      await ctx.db.patch(id, {
        bill_to: data,
        version: old.version + 1,
        updated_at: core.now(),
      });
    } else
      id = await ctx.db.insert("commercial_customers", {
        bill_to: data,
        version: 1,
        ...stamps(),
      });
    await core.audit(ctx, u.userId, "customer", id, "CUSTOMER_SAVED");
    return id;
  },
});
export const saveSettings = mutation({
  args: { version: v.number(), input: v.string() },
  handler: async (ctx, a) => {
    const u = await core.manager(ctx),
      data = parse(settingsInput, a.input),
      old = await core.settings(ctx);
    revision(old, a.version);
    if (
      data.deposit_type === "percentage" &&
      cents(data.deposit_value) > 10000n
    )
      core.deny("INVALID_INPUT");
    if ("_id" in old)
      await ctx.db.patch(old._id, { ...data, version: old.version + 1 });
    else
      await ctx.db.insert("commercial_settings", {
        key: "default",
        ...data,
        version: 1,
      });
    await core.audit(
      ctx,
      u.userId,
      "commercial_settings",
      "default",
      "COMMERCIAL_SETTINGS_CHANGED",
      old,
      data,
    );
  },
});
export const prepareAgreement = query({
  args: { project_id: v.id("projects") },
  handler: async (ctx, a) => {
    const { p } = await core.scope(ctx, a.project_id, true);
    const quote = p.source_quote_id
      ? await ctx.db.get(p.source_quote_id)
      : null;
    return {
      quote: quote
        ? {
            id: quote._id,
            number: quote.number,
            status: quote.status,
            subtotal_cents: quote.subtotal_cents,
            discount_cents: quote.discount_cents,
            total_cents: quote.total_cents,
            tax_basis_points: quote.tax_basis_points,
          }
        : null,
      identity: await core.identity(ctx, p),
      end: p.planned_end_date,
      settings: await core.settings(ctx),
    };
  },
});
export const saveAgreement = mutation({
  args: {
    id: v.optional(v.id("agreements")),
    project_id: v.id("projects"),
    customer_id: v.id("commercial_customers"),
    source_quote_id: v.optional(v.id("quotes")),
    replaces_id: v.optional(v.id("agreements")),
    version: v.number(),
    input: v.string(),
  },
  handler: async (ctx, a) => {
    const { u, p } = await core.scope(ctx, a.project_id, true);
    if (["cancelled", "completed"].includes(p.status)) core.deny("UNAVAILABLE");
    const data = parse(agreementInput, a.input),
      math = calculate(() => agreementMath(data)),
      customer = await core.customer(ctx, a.customer_id);
    const previous = a.id ? await ctx.db.get(a.id) : null;
    if (a.id && (!previous || previous.project_id !== p._id))
      core.deny("UNAVAILABLE");
    if (previous) {
      revision(previous, a.version);
      if (
        previous.status !== "draft" ||
        previous.replaces_id !== (a.replaces_id ?? null)
      )
        core.deny("INVALID_TRANSITION");
    }
    const quote = a.source_quote_id
      ? await ctx.db.get(a.source_quote_id)
      : null;
    if (
      a.source_quote_id &&
      (!quote ||
        quote.opportunity_id !== p.opportunity_id ||
        quote.status !== "accepted" ||
        quote.deleted_at)
    )
      core.deny("INVALID_INPUT");
    if (
      quote &&
      ["subtotal_cents", "discount_cents", "tax_cents", "total_cents"].some(
        (k) => quote[k as "total_cents"] !== math[k as "total_cents"],
      ) &&
      data.override_reason.trim().length < 3
    )
      core.deny(
        "INVALID_INPUT",
        "Explain the commercial change from the accepted quote.",
      );
    const existing = await core.agreements(ctx, p._id);
    if (!previous && existing.length >= 100) core.deny("LIMIT");
    if (
      existing.some(
        (x) =>
          x._id !== a.id &&
          x._id !== a.replaces_id &&
          ["draft", "sent", "accepted"].includes(x.status),
      )
    )
      core.deny("DUPLICATE", "Resolve the active agreement first.");
    if (a.replaces_id) {
      const replaced = await ctx.db.get(a.replaces_id);
      if (
        !replaced ||
        replaced.project_id !== p._id ||
        !["sent", "accepted", "declined"].includes(replaced.status)
      )
        core.deny("INVALID_INPUT");
    }
    const { subtotal, discount, taxes, ...terms } = data;
    void subtotal;
    void discount;
    void taxes;
    const fields = {
      customer_id: customer._id,
      bill_to: customer.bill_to,
      source_quote_id: quote?._id ?? null,
      identity: await core.identity(ctx, p),
      terms,
      ...math,
    };
    let id = a.id;
    if (previous && id)
      await ctx.db.patch(id, {
        ...fields,
        version: previous.version + 1,
        updated_at: core.now(),
      });
    else
      id = await ctx.db.insert("agreements", {
        ...fields,
        number: await core.number(ctx, "agreement"),
        project_id: p._id,
        opportunity_id: p.opportunity_id,
        status: "draft",
        replaces_id: a.replaces_id ?? null,
        acceptance: null,
        issued_at: null,
        created_by: u.userId,
        version: 1,
        ...stamps(),
      });
    await core.audit(
      ctx,
      u.userId,
      "agreement",
      id!,
      "AGREEMENT_SAVED",
      previous
        ? {
            version: previous.version,
            terms: previous.terms,
            subtotal_cents: previous.subtotal_cents,
            discount_cents: previous.discount_cents,
            tax_lines: previous.tax_lines,
            total_cents: previous.total_cents,
            bill_to: previous.bill_to,
          }
        : null,
      fields,
    );
    return id!;
  },
});
export const agreementAction = mutation({
  args: {
    id: v.id("agreements"),
    version: v.number(),
    action: v.union(
      v.literal("send"),
      v.literal("accept"),
      v.literal("decline"),
      v.literal("cancel"),
    ),
    evidence: v.optional(v.string()),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    await core.manager(ctx);
    const row = await ctx.db.get(a.id);
    if (!row) core.deny("UNAVAILABLE");
    const { u, p } = await core.scope(ctx, row.project_id, true);
    revision(row, a.version);
    const why = reason(a.reason);
    let status: Doc<"agreements">["status"];
    let acceptance = row.acceptance;
    if (a.action === "send") {
      if (row.status !== "draft") core.deny("INVALID_TRANSITION");
      status = "sent";
    } else if (a.action === "accept") {
      if (row.status !== "sent" || !a.evidence) core.deny("INVALID_TRANSITION");
      if (["completed", "cancelled"].includes(p.status))
        core.deny("UNAVAILABLE");
      const staging = (await events(ctx, p._id)).find(
        (e) => e.event_type === "staging" && e.status !== "cancelled",
      );
      if (staging && row.terms.package_end_date < day(staging.start_at))
        core.deny("INVALID_INPUT");
      const evidence = parse(evidenceInput, a.evidence);
      status = "accepted";
      acceptance = {
        ...evidence,
        recorded_by: u.userId,
        recorded_at: core.now(),
      };
      if (row.replaces_id) {
        const old = await ctx.db.get(row.replaces_id);
        if (!old || !["sent", "accepted", "declined"].includes(old.status))
          core.deny("CONFLICT");
        const linked = core.cap(
          await ctx.db
            .query("invoices")
            .withIndex("by_agreement", (q) => q.eq("agreement_id", old._id))
            .take(101),
        );
        if (linked.some((i) => i.status !== "void"))
          core.deny(
            "DEPENDENCY",
            "Void prior agreement invoices before replacing its commercial value.",
          );
        await ctx.db.patch(old._id, {
          status: "superseded",
          version: old.version + 1,
          updated_at: core.now(),
        });
        await core.audit(
          ctx,
          u.userId,
          "agreement",
          old._id,
          "AGREEMENT_SUPERSEDED",
          null,
          { replacement: row._id },
        );
      }
      if (
        (await core.agreements(ctx, p._id)).some(
          (x) =>
            x._id !== row._id &&
            x._id !== row.replaces_id &&
            x.status === "accepted",
        )
      )
        core.deny("DUPLICATE");
      await ctx.db.patch(p._id, {
        planned_end_date: row.terms.package_end_date,
        version: p.version + 1,
        updated_at: core.now(),
      });
    } else {
      if (!["draft", "sent"].includes(row.status))
        core.deny("INVALID_TRANSITION");
      status = a.action === "decline" ? "declined" : "cancelled";
    }
    await ctx.db.patch(row._id, {
      status,
      acceptance,
      issued_at: a.action === "send" ? core.now() : row.issued_at,
      version: row.version + 1,
      updated_at: core.now(),
    });
    await core.audit(
      ctx,
      u.userId,
      "agreement",
      row._id,
      "AGREEMENT_" + a.action.toUpperCase(),
      { status: row.status },
      { status, reason: why },
    );
  },
});
export const saveInvoice = mutation({
  args: {
    id: v.optional(v.id("invoices")),
    project_id: v.id("projects"),
    customer_id: v.id("commercial_customers"),
    version: v.number(),
    input: v.string(),
  },
  handler: async (ctx, a) => {
    const { p, u } = await core.scope(ctx, a.project_id, true),
      customer = await core.customer(ctx, a.customer_id),
      data = parse(invoiceInput, a.input);
    const items = calculate(() => data.items.map(itemMath)),
      math = calculate(() => sumItems(items));
    if (BigInt(math.total_cents) <= 0n) core.deny("INVALID_INPUT");
    const old = a.id ? await ctx.db.get(a.id) : null;
    if (a.id && (!old || old.project_id !== p._id)) core.deny("UNAVAILABLE");
    if (old) {
      revision(old, a.version);
      if (old.status !== "draft" || old.source_type !== "manual")
        core.deny("INVALID_TRANSITION");
    }
    const fields = {
      customer_id: customer._id,
      bill_to: customer.bill_to,
      identity: await core.identity(ctx, p),
      issue_date: data.issue_date,
      due_date: data.due_date,
      notes: data.notes,
      ...math,
    };
    let id = a.id;
    if (old && id) {
      await ctx.db.patch(id, {
        ...fields,
        version: old.version + 1,
        updated_at: core.now(),
      });
      for (const item of await ctx.db
        .query("invoice_items")
        .withIndex("by_invoice", (q) => q.eq("invoice_id", old._id))
        .take(51))
        await ctx.db.delete(item._id);
    } else {
      await core.checkInvoiceCapacity(ctx, p._id);
      id = await ctx.db.insert("invoices", {
        ...fields,
        number: await core.number(ctx, "invoice"),
        project_id: p._id,
        realtor_id: p.realtor_id,
        agreement_id: null,
        source_type: "manual",
        source_id: null,
        status: "draft",
        currency: "CAD",
        issued_at: null,
        voided_at: null,
        voided_by: null,
        void_reason: "",
        created_by: u.userId,
        version: 1,
        ...stamps(),
      });
    }
    for (const [sort_order, item] of items.entries())
      await ctx.db.insert("invoice_items", {
        ...item,
        invoice_id: id!,
        sort_order,
        source_type: "manual",
        source_id: null,
      });
    await core.audit(
      ctx,
      u.userId,
      "invoice",
      id!,
      "INVOICE_SAVED",
      old
        ? {
            version: old.version,
            subtotal_cents: old.subtotal_cents,
            discount_cents: old.discount_cents,
            tax_lines: old.tax_lines,
            total_cents: old.total_cents,
            bill_to: old.bill_to,
          }
        : null,
      { ...fields, items },
    );
    return id!;
  },
});
export const sourceInvoice = mutation({
  args: {
    project_id: v.id("projects"),
    customer_id: v.id("commercial_customers"),
    source_type: v.union(
      v.literal("deposit"),
      v.literal("balance"),
      v.literal("extension"),
      v.literal("assessment"),
    ),
    agreement_id: v.optional(v.id("agreements")),
    extension_id: v.optional(v.id("package_extensions")),
    assessment_id: v.optional(v.id("damage_charge_assessments")),
    issue_date: v.string(),
    due_date: v.string(),
  },
  handler: async (ctx, a) => {
    const { p, u } = await core.scope(ctx, a.project_id, true);
    await core.checkInvoiceCapacity(ctx, p._id);
    const customer = await core.customer(ctx, a.customer_id);
    parse(
      z
        .object({ issue: z.iso.date(), due: z.iso.date() })
        .refine((x) => x.due >= x.issue),
      JSON.stringify({ issue: a.issue_date, due: a.due_date }),
    );
    let agreement: Doc<"agreements"> | null = null,
      sourceId: string,
      description: string,
      math: ReturnType<typeof totals>;
    if (a.source_type === "deposit" || a.source_type === "balance") {
      if (!a.agreement_id || a.extension_id || a.assessment_id)
        core.deny("INVALID_INPUT");
      agreement = await ctx.db.get(a.agreement_id);
      if (
        !agreement ||
        agreement.project_id !== p._id ||
        agreement.status !== "accepted" ||
        agreement.customer_id !== customer._id
      )
        core.deny("INVALID_INPUT");
      sourceId = agreement._id;
      description =
        a.source_type === "deposit"
          ? "Staging package deposit"
          : "Staging package remaining balance";
      const linked = core
        .cap(
          await ctx.db
            .query("invoices")
            .withIndex("by_agreement", (q) =>
              q.eq("agreement_id", agreement!._id),
            )
            .take(101),
        )
        .filter(
          (i) =>
            i.status !== "void" &&
            ["deposit", "balance"].includes(i.source_type),
        );
      const used = linked.reduce((n, i) => n + BigInt(i.total_cents), 0n),
        remaining = BigInt(agreement.total_cents) - used,
        amount =
          a.source_type === "deposit"
            ? BigInt(agreement.deposit_cents)
            : remaining;
      if (
        amount <= 0n ||
        amount > remaining ||
        linked.some((i) => i.source_type === a.source_type)
      )
        core.deny(
          "DUPLICATE",
          "Agreement value is already invoiced or reserved in a draft.",
        );
      const part = (key: "subtotal_cents" | "discount_cents" | "tax_cents") =>
        a.source_type === "balance"
          ? BigInt(agreement![key]) -
            linked.reduce((n, i) => n + BigInt(i[key]), 0n)
          : (BigInt(agreement![key]) * amount +
              BigInt(agreement!.total_cents) / 2n) /
            BigInt(agreement!.total_cents);
      const split = apportion(amount, [
        BigInt(agreement.subtotal_cents) - BigInt(agreement.discount_cents),
        ...agreement.tax_lines.map((t) => BigInt(t.amount_cents)),
      ]);
      const discount = part("discount_cents"),
        tax_lines = agreement.tax_lines.map((t, index) => ({
          ...t,
          amount_cents: String(
            a.source_type === "balance"
              ? BigInt(t.amount_cents) -
                  linked.reduce(
                    (n, i) =>
                      n +
                      BigInt(
                        i.tax_lines.find(
                          (x) =>
                            x.name === t.name &&
                            x.basis_points === t.basis_points,
                        )?.amount_cents ?? "0",
                      ),
                    0n,
                  )
              : split[index + 1],
          ),
        }));
      const tax = tax_lines.reduce((n, t) => n + BigInt(t.amount_cents), 0n);
      math = {
        subtotal_cents: String(amount + discount - tax),
        discount_cents: String(discount),
        tax_lines,
        tax_cents: String(tax),
        total_cents: String(amount),
      };
    } else if (a.source_type === "extension") {
      if (!a.extension_id || a.assessment_id || a.agreement_id)
        core.deny("INVALID_INPUT");
      const x = await ctx.db.get(a.extension_id);
      if (!x || x.project_id !== p._id || x.status !== "accepted")
        core.deny("INVALID_INPUT");
      agreement = await ctx.db.get(x.agreement_id);
      if (!agreement || agreement.customer_id !== customer._id)
        core.deny("INVALID_INPUT");
      sourceId = x._id;
      description = `Package extension through ${x.new_end_date}`;
      math = {
        subtotal_cents: x.subtotal_cents,
        discount_cents: x.discount_cents,
        tax_lines: x.tax_lines,
        tax_cents: x.tax_cents,
        total_cents: x.total_cents,
      };
    } else {
      if (!a.assessment_id || a.extension_id || a.agreement_id)
        core.deny("INVALID_INPUT");
      const x = await ctx.db.get(a.assessment_id);
      if (!x || x.project_id !== p._id || x.status !== "approved")
        core.deny("INVALID_INPUT");
      agreement = x.agreement_id ? await ctx.db.get(x.agreement_id) : null;
      if (agreement && agreement.customer_id !== customer._id)
        core.deny("INVALID_INPUT");
      sourceId = x._id;
      description = x.description;
      math = calculate(() =>
        totals(BigInt(x.approved_amount_cents), 0n, x.taxes),
      );
    }
    if (
      (await core.sourceInvoices(ctx, a.source_type, sourceId)).some(
        (i) => i.status !== "void",
      )
    )
      core.deny("DUPLICATE", "This source already has an active invoice.");
    if (BigInt(math.total_cents) <= 0n) core.deny("INVALID_INPUT");
    const id = await ctx.db.insert("invoices", {
      ...math,
      number: await core.number(ctx, "invoice"),
      project_id: p._id,
      realtor_id: p.realtor_id,
      agreement_id: agreement?._id ?? null,
      customer_id: customer._id,
      bill_to: agreement?.bill_to ?? customer.bill_to,
      identity: agreement?.identity ?? (await core.identity(ctx, p)),
      source_type: a.source_type,
      source_id: sourceId,
      status: "draft",
      issue_date: a.issue_date,
      due_date: a.due_date,
      currency: "CAD",
      notes: "",
      issued_at: null,
      voided_at: null,
      voided_by: null,
      void_reason: "",
      created_by: u.userId,
      version: 1,
      ...stamps(),
    });
    await ctx.db.insert("invoice_items", {
      ...math,
      invoice_id: id,
      description,
      quantity: 1,
      unit_amount_cents: math.subtotal_cents,
      source_type: a.source_type,
      source_id: sourceId,
      sort_order: 0,
    });
    await core.audit(
      ctx,
      u.userId,
      "invoice",
      id,
      "SOURCE_INVOICE_CREATED",
      null,
      {
        source_type: a.source_type,
        source_id: sourceId,
        total_cents: math.total_cents,
      },
    );
    if (a.assessment_id)
      await core.audit(
        ctx,
        u.userId,
        "damage_charge_assessment",
        a.assessment_id,
        "ASSESSMENT_INVOICE_LINKED",
        null,
        { invoice_id: id },
      );
    return id;
  },
});
export const invoiceAction = mutation({
  args: {
    id: v.id("invoices"),
    version: v.number(),
    action: v.union(v.literal("issue"), v.literal("void")),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    await core.manager(ctx);
    const i = await ctx.db.get(a.id);
    if (!i) core.deny("UNAVAILABLE");
    const { u } = await core.scope(ctx, i.project_id, true);
    revision(i, a.version);
    const why = reason(a.reason);
    if (a.action === "issue") {
      if (i.status !== "draft" || i.issue_date > day())
        core.deny("INVALID_TRANSITION");
      await ctx.db.patch(i._id, {
        status: "issued",
        issued_at: core.now(),
        version: i.version + 1,
        updated_at: core.now(),
      });
    } else {
      if (i.status === "void") core.deny("INVALID_TRANSITION");
      const state = await core.invoiceState(ctx, i);
      if (BigInt(state.paid_cents) > 0n || BigInt(state.credit_cents) > 0n)
        core.deny(
          "DEPENDENCY",
          "Resolve payments first; credited invoices retain their issued history.",
        );
      await ctx.db.patch(i._id, {
        status: "void",
        voided_at: core.now(),
        voided_by: u.userId,
        void_reason: why,
        version: i.version + 1,
        updated_at: core.now(),
      });
    }
    await core.audit(
      ctx,
      u.userId,
      "invoice",
      i._id,
      "INVOICE_" + a.action.toUpperCase(),
      { status: i.status },
      { reason: why },
    );
  },
});
const allocationValue = v.object({
  invoice_id: v.id("invoices"),
  amount: v.string(),
});
async function allocate(
  ctx: import("./_generated/server").MutationCtx,
  p: Doc<"payments">,
  allocations: { invoice_id: Id<"invoices">; amount: string }[],
  actor: Id<"users">,
) {
  if (
    allocations.length > 30 ||
    new Set(allocations.map((x) => x.invoice_id)).size !== allocations.length
  )
    core.deny("INVALID_INPUT");
  const state = await core.paymentState(ctx, p);
  if (state.reversal) core.deny("INVALID_TRANSITION");
  if (state.allocations.length + allocations.length > 100) core.deny("LIMIT");
  let remaining = BigInt(state.unallocated_cents);
  for (const a of allocations) {
    const amount = cents(parse(positive, JSON.stringify(a.amount)));
    if (amount > remaining)
      core.deny("INVALID_INPUT", "Allocations exceed unallocated payment.");
    const invoice = await ctx.db.get(a.invoice_id);
    if (
      !invoice ||
      invoice.project_id !== p.project_id ||
      invoice.customer_id !== p.customer_id ||
      invoice.status !== "issued"
    )
      core.deny("INVALID_INPUT");
    const current = await core.invoiceState(ctx, invoice);
    if (
      current.allocations.length >= 100 ||
      amount > BigInt(current.balance_cents)
    )
      core.deny("CONFLICT", "Invoice remaining balance changed.");
    await ctx.db.insert("payment_allocations", {
      payment_id: p._id,
      invoice_id: invoice._id,
      amount_cents: String(amount),
      created_by: actor,
      created_at: core.now(),
    });
    await core.audit(
      ctx,
      actor,
      "invoice",
      invoice._id,
      "PAYMENT_ALLOCATED",
      null,
      { payment_id: p._id, amount_cents: String(amount) },
    );
    remaining -= amount;
  }
}
export const recordPayment = mutation({
  args: {
    project_id: v.id("projects"),
    customer_id: v.id("commercial_customers"),
    amount: v.string(),
    method: v.union(...paymentMethods.map((x) => v.literal(x))),
    received_date: v.string(),
    external_reference: v.string(),
    notes: v.string(),
    request_key: v.string(),
    allocations: v.array(allocationValue),
  },
  handler: async (ctx, a) => {
    const { p, u } = await core.scope(ctx, a.project_id, true);
    const customer = await core.customer(ctx, a.customer_id),
      amount = cents(parse(positive, JSON.stringify(a.amount)));
    parse(
      z.iso.date().refine((d) => d <= day()),
      JSON.stringify(a.received_date),
    );
    const external_reference = parse(
        safeReference,
        JSON.stringify(a.external_reference),
      ),
      notes = parse(safeReference, JSON.stringify(a.notes));
    parse(z.uuid(), JSON.stringify(a.request_key));
    const duplicate = await ctx.db
      .query("payments")
      .withIndex("by_request", (q) => q.eq("request_key", a.request_key))
      .unique();
    if (duplicate)
      core.deny("DUPLICATE", "This payment request was already recorded.");
    if (
      (
        await ctx.db
          .query("payments")
          .withIndex("by_project", (q) => q.eq("project_id", p._id))
          .take(100)
      ).length >= 100
    )
      core.deny("LIMIT");
    const id = await ctx.db.insert("payments", {
      project_id: p._id,
      customer_id: customer._id,
      payer: customer.bill_to,
      amount_cents: String(amount),
      currency: "CAD",
      method: a.method,
      received_date: a.received_date,
      external_reference,
      notes,
      request_key: a.request_key,
      number: await core.number(ctx, "payment"),
      recorded_by: u.userId,
      created_at: core.now(),
    });
    await allocate(ctx, (await ctx.db.get(id))!, a.allocations, u.userId);
    await core.audit(ctx, u.userId, "payment", id, "PAYMENT_RECORDED", null, {
      amount_cents: String(amount),
      project_id: p._id,
    });
    return id;
  },
});
export const allocatePayment = mutation({
  args: { id: v.id("payments"), allocations: v.array(allocationValue) },
  handler: async (ctx, a) => {
    await core.manager(ctx);
    const p = await ctx.db.get(a.id);
    if (!p) core.deny("UNAVAILABLE");
    const { u } = await core.scope(ctx, p.project_id, true);
    if (!a.allocations.length) core.deny("INVALID_INPUT");
    await allocate(ctx, p, a.allocations, u.userId);
  },
});
export const reversePayment = mutation({
  args: { id: v.id("payments"), reason: v.string() },
  handler: async (ctx, a) => {
    await core.manager(ctx);
    const p = await ctx.db.get(a.id);
    if (!p) core.deny("UNAVAILABLE");
    const { u } = await core.scope(ctx, p.project_id, true);
    if (await core.reversal(ctx, p._id)) core.deny("DUPLICATE");
    const why = reason(a.reason);
    await ctx.db.insert("payment_reversals", {
      payment_id: p._id,
      reason: why,
      created_by: u.userId,
      created_at: core.now(),
    });
    await core.audit(
      ctx,
      u.userId,
      "payment",
      p._id,
      "PAYMENT_REVERSED",
      null,
      { reason: why },
    );
  },
});
export const creditInvoice = mutation({
  args: {
    invoice_id: v.id("invoices"),
    amount: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    await core.manager(ctx);
    const i = await ctx.db.get(a.invoice_id);
    if (!i) core.deny("UNAVAILABLE");
    const { u } = await core.scope(ctx, i.project_id, true);
    if (i.status !== "issued") core.deny("INVALID_TRANSITION");
    const state = await core.invoiceState(ctx, i),
      amount = cents(parse(positive, JSON.stringify(a.amount))),
      why = reason(a.reason);
    if (
      state.credits.length >= 100 ||
      amount > BigInt(i.total_cents) - BigInt(state.credit_cents)
    )
      core.deny("CONFLICT", "Credit exceeds remaining invoice value.");
    const id = await ctx.db.insert("credit_notes", {
      number: await core.number(ctx, "credit"),
      invoice_id: i._id,
      amount_cents: String(amount),
      reason: why,
      created_by: u.userId,
      created_at: core.now(),
    });
    await core.audit(ctx, u.userId, "invoice", i._id, "CREDIT_ISSUED", null, {
      credit_id: id,
      amount_cents: String(amount),
      reason: why,
    });
    return id;
  },
});
export const createExtension = mutation({
  args: {
    agreement_id: v.id("agreements"),
    project_version: v.number(),
    input: v.string(),
  },
  handler: async (ctx, a) => {
    await core.manager(ctx);
    const agreement = await ctx.db.get(a.agreement_id);
    if (!agreement || agreement.status !== "accepted") core.deny("UNAVAILABLE");
    const { p, u } = await core.scope(ctx, agreement.project_id, true);
    revision(p, a.project_version);
    if (
      [
        "cancelled",
        "completed",
        "sold",
        "destaging_scheduled",
        "destaging",
      ].includes(p.status)
    )
      core.deny("INVALID_TRANSITION");
    const data = parse(extensionInput, a.input);
    if (!p.planned_end_date || data.new_end_date <= p.planned_end_date)
      core.deny("INVALID_INPUT");
    const existing = core.cap(
      await ctx.db
        .query("package_extensions")
        .withIndex("by_period", (q) =>
          q.eq("project_id", p._id).eq("original_end_date", p.planned_end_date),
        )
        .take(101),
    );
    if (existing.some((x) => x.status !== "cancelled")) core.deny("DUPLICATE");
    const math = calculate(() =>
      totals(cents(data.rate) * BigInt(data.quantity), 0n, data.taxes),
    );
    const id = await ctx.db.insert("package_extensions", {
      project_id: p._id,
      agreement_id: agreement._id,
      original_end_date: p.planned_end_date,
      new_end_date: data.new_end_date,
      type: data.type,
      rate_cents: String(cents(data.rate)),
      quantity: data.quantity,
      reason: data.reason,
      ...math,
      status: "pending",
      approval: null,
      created_by: u.userId,
      version: 1,
      ...stamps(),
    });
    await core.audit(
      ctx,
      u.userId,
      "extension",
      id,
      "EXTENSION_CREATED",
      null,
      {
        original_end_date: p.planned_end_date,
        new_end_date: data.new_end_date,
      },
    );
    return id;
  },
});
export const extensionAction = mutation({
  args: {
    id: v.id("package_extensions"),
    version: v.number(),
    accept: v.boolean(),
    evidence: v.string(),
  },
  handler: async (ctx, a) => {
    await core.manager(ctx);
    const x = await ctx.db.get(a.id);
    if (!x) core.deny("UNAVAILABLE");
    const { p, u } = await core.scope(ctx, x.project_id, true);
    revision(x, a.version);
    if (x.status !== "pending") core.deny("INVALID_TRANSITION");
    let approval = x.approval;
    if (a.accept) {
      if (
        p.planned_end_date !== x.original_end_date ||
        [
          "completed",
          "cancelled",
          "sold",
          "destaging",
          "destaging_scheduled",
        ].includes(p.status)
      )
        core.deny("CONFLICT");
      const agreement = await ctx.db.get(x.agreement_id);
      if (agreement?.status !== "accepted") core.deny("CONFLICT");
      approval = {
        ...parse(evidenceInput, a.evidence),
        recorded_by: u.userId,
        recorded_at: core.now(),
      };
      await ctx.db.patch(p._id, {
        planned_end_date: x.new_end_date,
        version: p.version + 1,
        updated_at: core.now(),
      });
    } else reason(a.evidence);
    await ctx.db.patch(x._id, {
      status: a.accept ? "accepted" : "cancelled",
      approval,
      version: x.version + 1,
      updated_at: core.now(),
    });
    await core.audit(
      ctx,
      u.userId,
      "extension",
      x._id,
      a.accept ? "EXTENSION_ACCEPTED" : "EXTENSION_CANCELLED",
      null,
      {
        new_end_date: x.new_end_date,
        reason: a.accept ? "Acceptance recorded" : a.evidence,
      },
    );
  },
});
export const createAssessment = mutation({
  args: {
    project_id: v.id("projects"),
    damage_record_id: v.id("inventory_damage"),
    agreement_id: v.optional(v.id("agreements")),
  },
  handler: async (ctx, a) => {
    const { p, u } = await core.scope(ctx, a.project_id, true),
      d = await ctx.db.get(a.damage_record_id);
    if (!d || d.project_id !== p._id || !d.reservation_id)
      core.deny("INVALID_INPUT");
    const r = await ctx.db.get(d.reservation_id);
    if (
      !r ||
      r.project_id !== p._id ||
      r.asset_id !== d.asset_id ||
      r.product_id !== d.product_id ||
      r.project_room_id !== d.project_room_id
    )
      core.deny("INVALID_INPUT");
    if (
      await ctx.db
        .query("damage_charge_assessments")
        .withIndex("by_damage", (q) => q.eq("damage_record_id", d._id))
        .first()
    )
      core.deny("DUPLICATE");
    let agreement = null;
    if (a.agreement_id) {
      agreement = await ctx.db.get(a.agreement_id);
      if (
        !agreement ||
        agreement.project_id !== p._id ||
        agreement.status !== "accepted"
      )
        core.deny("INVALID_INPUT");
    }
    const product = await ctx.db.get(d.product_id),
      asset = d.asset_id ? await ctx.db.get(d.asset_id) : null,
      room = d.project_room_id ? await ctx.db.get(d.project_room_id) : null;
    const id = await ctx.db.insert("damage_charge_assessments", {
      project_id: p._id,
      agreement_id: agreement?._id ?? null,
      damage_record_id: d._id,
      product_id: d.product_id,
      asset_id: d.asset_id,
      room_id: d.project_room_id,
      assessment_type:
        d.damage_type === "missing"
          ? "missing"
          : d.damage_type === "damage"
            ? "damage"
            : "other_inventory_loss",
      status: "review_required",
      customer_responsible: null,
      liability_basis: "unknown",
      valuation_basis: "other",
      liability_terms: agreement?.terms.liability_terms ?? "",
      notes: "",
      description: `Inventory charge — ${product?.name ?? "item"}`,
      proposed_amount_cents: "0",
      approved_amount_cents: "0",
      taxes: [],
      evidence: {
        product_name: product?.name ?? "Product",
        asset_number: asset?.asset_number ?? "",
        room: room?.room_name ?? "",
        incident_date: d.discovered_at,
      },
      approved_by: null,
      approved_at: null,
      decision_reason: "",
      decided_by: null,
      decided_at: null,
      created_by: u.userId,
      version: 1,
      ...stamps(),
    });
    await core.audit(
      ctx,
      u.userId,
      "damage_charge_assessment",
      id,
      "ASSESSMENT_CREATED",
      null,
      { damage_record_id: d._id },
    );
    return id;
  },
});
export const reviewAssessment = mutation({
  args: {
    id: v.id("damage_charge_assessments"),
    version: v.number(),
    input: v.string(),
  },
  handler: async (ctx, a) => {
    await core.manager(ctx);
    const x = await ctx.db.get(a.id);
    if (!x) core.deny("UNAVAILABLE");
    const { u } = await core.scope(ctx, x.project_id, true);
    revision(x, a.version);
    if (!["review_required", "under_review"].includes(x.status))
      core.deny("INVALID_TRANSITION");
    const d = parse(assessmentInput, a.input);
    await ctx.db.patch(x._id, {
      liability_basis: d.liability_basis,
      valuation_basis: d.valuation_basis,
      notes: d.notes,
      description: d.description,
      proposed_amount_cents: String(cents(d.proposed_amount)),
      taxes: d.taxes,
      status: "under_review",
      version: x.version + 1,
      updated_at: core.now(),
    });
    await core.audit(
      ctx,
      u.userId,
      "damage_charge_assessment",
      x._id,
      "ASSESSMENT_REVIEWED",
      { proposed_amount_cents: x.proposed_amount_cents },
      {
        proposed_amount_cents: String(cents(d.proposed_amount)),
        liability_basis: d.liability_basis,
      },
    );
  },
});
export const decideAssessment = mutation({
  args: {
    id: v.id("damage_charge_assessments"),
    version: v.number(),
    decision: v.union(
      v.literal("approve"),
      v.literal("no_charge"),
      v.literal("waive"),
      v.literal("cancel"),
    ),
    approved_amount: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    await core.manager(ctx);
    const x = await ctx.db.get(a.id);
    if (!x) core.deny("UNAVAILABLE");
    const { u } = await core.scope(ctx, x.project_id, true);
    revision(x, a.version);
    if (!["review_required", "under_review", "approved"].includes(x.status))
      core.deny("INVALID_TRANSITION");
    if (
      (await core.sourceInvoices(ctx, "assessment", x._id)).some(
        (i) => i.status !== "void",
      )
    )
      core.deny(
        "DEPENDENCY",
        "Correct the invoice with a credit or controlled void first.",
      );
    const why = reason(a.reason);
    let amount = x.approved_amount_cents;
    if (a.decision === "approve") {
      if (x.status !== "under_review" || x.liability_basis === "unknown")
        core.deny("INVALID_TRANSITION");
      amount = String(
        cents(parse(positive, JSON.stringify(a.approved_amount))),
      );
    } else if (a.approved_amount !== "0") core.deny("INVALID_INPUT");
    const status =
      a.decision === "approve"
        ? "approved"
        : a.decision === "no_charge"
          ? "no_charge"
          : a.decision === "waive"
            ? "waived"
            : "cancelled";
    await ctx.db.patch(x._id, {
      status,
      approved_amount_cents: amount,
      customer_responsible:
        a.decision === "approve"
          ? true
          : a.decision === "no_charge"
            ? false
            : x.customer_responsible,
      approved_by: a.decision === "approve" ? u.userId : x.approved_by,
      approved_at: a.decision === "approve" ? core.now() : x.approved_at,
      decision_reason: why,
      decided_by: u.userId,
      decided_at: core.now(),
      version: x.version + 1,
      updated_at: core.now(),
    });
    await core.audit(
      ctx,
      u.userId,
      "damage_charge_assessment",
      x._id,
      "ASSESSMENT_" + a.decision.toUpperCase(),
      { status: x.status, approved_amount_cents: x.approved_amount_cents },
      { status, approved_amount_cents: amount, reason: why },
    );
  },
});
export const agreement = query({
  args: { id: v.id("agreements") },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin", "sales"]);
    const row = await ctx.db.get(a.id);
    if (!row) core.deny("UNAVAILABLE");
    const { manage } = await core.scope(ctx, row.project_id);
    return { ...row, manage };
  },
});
export const invoice = query({
  args: { id: v.id("invoices") },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin", "sales"]);
    const row = await ctx.db.get(a.id);
    if (!row) core.deny("UNAVAILABLE");
    const { manage } = await core.scope(ctx, row.project_id);
    return {
      ...(await core.invoiceState(ctx, row)),
      items: await ctx.db
        .query("invoice_items")
        .withIndex("by_invoice", (q) => q.eq("invoice_id", row._id))
        .take(51),
      manage,
    };
  },
});
export const assessment = query({
  args: { id: v.id("damage_charge_assessments") },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin", "sales"]);
    const row = await ctx.db.get(a.id);
    if (!row) core.deny("UNAVAILABLE");
    const { manage } = await core.scope(ctx, row.project_id);
    return { ...(await core.assessmentView(ctx, row)), manage };
  },
});
export const payment = query({
  args: { id: v.id("payments") },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin", "sales"]);
    const row = await ctx.db.get(a.id);
    if (!row) core.deny("UNAVAILABLE");
    const { manage } = await core.scope(ctx, row.project_id);
    return { ...(await core.paymentState(ctx, row)), manage };
  },
});
export const project = query({
  args: { project_id: v.id("projects") },
  handler: async (ctx, a) => {
    const { p, manage } = await core.scope(ctx, a.project_id),
      agreements = await core.agreements(ctx, p._id),
      invoices = await Promise.all(
        (await core.projectInvoices(ctx, p._id)).map((i) =>
          core.invoiceState(ctx, i),
        ),
      ),
      payments = await Promise.all(
        core
          .cap(
            await ctx.db
              .query("payments")
              .withIndex("by_project", (q) => q.eq("project_id", p._id))
              .take(101),
          )
          .map((x) => core.paymentState(ctx, x)),
      ),
      extensions = core.cap(
        await ctx.db
          .query("package_extensions")
          .withIndex("by_project", (q) => q.eq("project_id", p._id))
          .take(101),
      ),
      assessments = await Promise.all(
        core
          .cap(
            await ctx.db
              .query("damage_charge_assessments")
              .withIndex("by_project", (q) => q.eq("project_id", p._id))
              .take(101),
          )
          .map((x) => core.assessmentView(ctx, x)),
      );
    const incidents = core.cap(
      await ctx.db
        .query("inventory_damage")
        .withIndex("by_project", (q) => q.eq("project_id", p._id))
        .take(101),
    );
    const review = incidents.filter(
      (d) => !assessments.some((a) => a.damage_record_id === d._id),
    );
    const outstanding = invoices.reduce(
        (n, i) => n + BigInt(i.balance_cents),
        0n,
      ),
      agreement = agreements.find((a) => a.status === "accepted"),
      deposit = invoices.filter(
        (i) => i.source_type === "deposit" && i.status === "issued",
      );
    const depositPaid = deposit.reduce((n, i) => n + BigInt(i.paid_cents), 0n);
    const alerts: string[] = [];
    if (p.status === "completed" && outstanding > 0n)
      alerts.push("COMMERCIAL BALANCE OUTSTANDING");
    if (agreement && depositPaid < BigInt(agreement.deposit_cents))
      alerts.push("Deposit awaiting payment");
    if (invoices.some((i) => i.effective_status === "overdue"))
      alerts.push("Overdue invoice requires follow-up");
    if (invoices.some((i) => BigInt(i.credit_balance_cents) > 0n))
      alerts.push("Customer credit balance — refund review required");
    const days = p.planned_end_date
      ? Math.ceil(
          (Date.parse(p.planned_end_date) - Date.parse(day())) / 86400000,
        )
      : null;
    if (
      agreement &&
      days !== null &&
      days <= 30 &&
      ![
        "completed",
        "cancelled",
        "sold",
        "destaging",
        "destaging_scheduled",
      ].includes(p.status)
    )
      alerts.push(
        days < 0
          ? "Package expired; active property needs commercial extension review"
          : `Commercial extension review: ${days <= 7 ? "7" : days <= 14 ? "14" : "30"}-day window`,
      );
    for (const x of extensions) {
      const invoice = invoices.find(
        (i) =>
          i.source_type === "extension" &&
          i.source_id === x._id &&
          i.status !== "void",
      );
      if (x.status === "pending") alerts.push("Extension pending approval");
      else if (x.status === "accepted" && !invoice)
        alerts.push("Accepted extension awaiting invoice");
      else if (invoice && BigInt(invoice.balance_cents) > 0n)
        alerts.push("Extension invoice unpaid");
    }
    if (review.length)
      alerts.push(
        `${review.length} inventory incidents require commercial review`,
      );
    for (const x of assessments) {
      if (["review_required", "under_review"].includes(x.status))
        alerts.push("Inventory charge assessment requires review");
      if (x.status === "approved" && !x.invoice_id)
        alerts.push("Approved inventory charge awaiting invoice");
      if (BigInt(x.balance_cents) > 0n)
        alerts.push("Inventory charge invoice unpaid");
      if (x.recovered_conflict)
        alerts.push(
          "Recovered missing item has an existing charge — review credit/cancellation",
        );
    }
    return {
      id: p._id,
      project_number: p.project_number,
      project_status: p.status,
      project_version: p.version,
      package_end: p.planned_end_date,
      manage,
      agreements,
      invoices,
      payments,
      extensions,
      assessments,
      unassessed_incidents: await Promise.all(
        review.map(async (d) => ({
          id: d._id,
          type: d.damage_type,
          severity: d.severity,
          status: d.status,
          product_name: (await ctx.db.get(d.product_id))?.name ?? "Product",
          asset_number: d.asset_id
            ? ((await ctx.db.get(d.asset_id))?.asset_number ?? "")
            : "",
        })),
      ),
      outstanding_cents: String(outstanding),
      contract_total_cents: agreement?.total_cents ?? "0",
      deposit_required_cents: agreement?.deposit_cents ?? "0",
      deposit_paid_cents: String(depositPaid),
      alerts: [...new Set(alerts)],
    };
  },
});
export const receivables = query({
  args: {
    paginationOpts: paginationOptsValidator,
    status: v.string(),
    project_id: v.optional(v.id("projects")),
    customer_id: v.optional(v.id("commercial_customers")),
    realtor_id: v.optional(v.id("realtors")),
    from: v.string(),
    until: v.string(),
  },
  handler: async (ctx, a) => {
    await core.manager(ctx);
    if (a.from) parse(z.iso.date(), JSON.stringify(a.from));
    if (a.until) parse(z.iso.date(), JSON.stringify(a.until));
    if (a.from && a.until && a.from > a.until) core.deny("INVALID_INPUT");
    const source = a.project_id
      ? ctx.db
          .query("invoices")
          .withIndex("by_project", (q) => q.eq("project_id", a.project_id!))
      : a.customer_id
        ? ctx.db
            .query("invoices")
            .withIndex("by_customer", (q) =>
              q.eq("customer_id", a.customer_id!),
            )
        : a.realtor_id
          ? ctx.db
              .query("invoices")
              .withIndex("by_realtor", (q) => q.eq("realtor_id", a.realtor_id!))
          : ctx.db
              .query("invoices")
              .withIndex("by_issue", (q) =>
                q
                  .gte("issue_date", a.from || "0000-01-01")
                  .lte("issue_date", a.until || "9999-12-31"),
              );
    const result = await source.order("desc").paginate({
      ...a.paginationOpts,
      numItems: Math.min(20, a.paginationOpts.numItems),
    });
    const rows = await Promise.all(
      result.page
        .filter(
          (i) =>
            (!a.customer_id || i.customer_id === a.customer_id) &&
            (!a.realtor_id || i.realtor_id === a.realtor_id) &&
            (!a.from || i.issue_date >= a.from) &&
            (!a.until || i.issue_date <= a.until),
        )
        .map((i) => core.invoiceState(ctx, i)),
    );
    return {
      ...result,
      page: rows
        .filter(
          (i) =>
            !a.status ||
            i.effective_status === a.status ||
            (a.status === "unpaid" && BigInt(i.balance_cents) > 0n) ||
            (a.status === "partially_paid" &&
              BigInt(i.paid_cents) > 0n &&
              BigInt(i.balance_cents) > 0n),
        )
        .map((i) => ({
          ...i,
          days_outstanding:
            BigInt(i.balance_cents) > 0n
              ? Math.max(
                  0,
                  Math.floor(
                    (Date.parse(day()) - Date.parse(i.issue_date)) / 86400000,
                  ),
                )
              : 0,
        })),
    };
  },
});
export const dashboard = query({
  args: {},
  handler: async (ctx) => {
    await core.manager(ctx);
    const invoices = await ctx.db
      .query("invoices")
      .withIndex("by_status_due", (q) => q.eq("status", "issued"))
      .take(501);
    if (invoices.length > 500)
      core.deny(
        "LIMIT",
        "Use Accounts Receivable filters; dashboard supports up to 500 issued invoices.",
      );
    const rows = await Promise.all(
      invoices.map((i) => core.invoiceState(ctx, i)),
    );
    const acceptedAgreements = core.cap(
      await ctx.db
        .query("agreements")
        .withIndex("by_status", (q) => q.eq("status", "accepted"))
        .take(101),
    );
    const depositsAwaiting = acceptedAgreements.filter(
      (a) =>
        BigInt(a.deposit_cents) >
        rows
          .filter(
            (i) => i.agreement_id === a._id && i.source_type === "deposit",
          )
          .reduce((n, i) => n + BigInt(i.paid_cents), 0n),
    ).length;
    const month = day().slice(0, 7),
      payments = await ctx.db
        .query("payments")
        .withIndex("by_received", (q) =>
          q.gte("received_date", month + "-01").lte("received_date", day()),
        )
        .take(501);
    if (payments.length > 500) core.deny("LIMIT");
    let collected = 0n;
    for (const p of payments)
      if (!(await core.reversal(ctx, p._id)))
        collected += BigInt(p.amount_cents);
    const assessments = await ctx.db
      .query("damage_charge_assessments")
      .withIndex("by_status", (q) => q.eq("status", "approved"))
      .take(101);
    const actionable = await Promise.all(
      assessments.slice(0, 100).map((x) => core.assessmentView(ctx, x)),
    );
    return {
      outstanding_cents: String(
        rows.reduce((n, i) => n + BigInt(i.balance_cents), 0n),
      ),
      overdue: rows.filter((i) => i.effective_status === "overdue").length,
      deposit_unpaid: depositsAwaiting,
      collected_cents: String(collected),
      invoiced_cents: String(
        rows
          .filter((i) => i.issue_date.startsWith(month))
          .reduce((n, i) => n + BigInt(i.total_cents), 0n),
      ),
      charges: actionable.filter((x) => !x.invoice_id || x.recovered_conflict),
      partial: assessments.length > 100,
    };
  },
});

export const history = query({
  args: {
    id: v.union(
      v.id("agreements"),
      v.id("invoices"),
      v.id("payments"),
      v.id("damage_charge_assessments"),
      v.id("package_extensions"),
    ),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, a) => {
    await core.manager(ctx);
    const row = await ctx.db.get(a.id);
    if (!row) core.deny("UNAVAILABLE");
    await core.scope(ctx, row.project_id);
    const result = await ctx.db
      .query("audit_logs")
      .withIndex("by_entity", (q) => q.eq("entity_id", a.id))
      .order("desc")
      .paginate({
        ...a.paginationOpts,
        numItems: Math.min(20, a.paginationOpts.numItems),
      });
    return {
      ...result,
      page: await Promise.all(
        result.page.map(async (log) => ({
          ...log,
          actor_name: log.actor_id
            ? ((
                await ctx.db
                  .query("profiles")
                  .withIndex("by_user", (q) => q.eq("userId", log.actor_id!))
                  .unique()
              )?.display_name ?? "Former staff member")
            : "System",
        })),
      ),
    };
  },
});
export const reviewQueue = query({
  args: {},
  handler: async (ctx) => {
    await core.manager(ctx);
    const pending = await ctx.db
      .query("package_extensions")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .take(21);
    const accepted = await ctx.db
      .query("package_extensions")
      .withIndex("by_status", (q) => q.eq("status", "accepted"))
      .order("desc")
      .take(21);
    const extensions = [];
    for (const x of [...pending.slice(0, 20), ...accepted.slice(0, 20)]) {
      const invoice = (await core.sourceInvoices(ctx, "extension", x._id)).find(
        (i) => i.status !== "void",
      );
      const state = invoice ? await core.invoiceState(ctx, invoice) : null;
      if (
        x.status === "pending" ||
        !invoice ||
        (state && BigInt(state.balance_cents) > 0n)
      )
        extensions.push({
          id: x._id,
          project_id: x.project_id,
          new_end_date: x.new_end_date,
          reason:
            x.status === "pending"
              ? "Extension approval required"
              : invoice
                ? "Extension invoice unpaid"
                : "Accepted extension awaiting invoice",
        });
    }
    const review = await ctx.db
      .query("damage_charge_assessments")
      .withIndex("by_status", (q) => q.eq("status", "review_required"))
      .take(21);
    const under = await ctx.db
      .query("damage_charge_assessments")
      .withIndex("by_status", (q) => q.eq("status", "under_review"))
      .take(21);
    const incidents = await ctx.db
      .query("inventory_damage")
      .order("desc")
      .take(41);
    const unassessed = [];
    for (const d of incidents.slice(0, 40)) {
      if (!d.project_id || !d.reservation_id) continue;
      const assessment = await ctx.db
        .query("damage_charge_assessments")
        .withIndex("by_damage", (q) => q.eq("damage_record_id", d._id))
        .first();
      if (!assessment)
        unassessed.push({
          id: d._id,
          project_id: d.project_id,
          type: d.damage_type,
        });
    }
    return {
      extensions,
      assessments: [...review.slice(0, 20), ...under.slice(0, 20)].map((a) => ({
        id: a._id,
        project_id: a.project_id,
        name: a.evidence.product_name,
        status: a.status,
      })),
      unassessed,
      partial:
        pending.length > 20 ||
        accepted.length > 20 ||
        review.length > 20 ||
        under.length > 20 ||
        incidents.length > 40,
    };
  },
});
