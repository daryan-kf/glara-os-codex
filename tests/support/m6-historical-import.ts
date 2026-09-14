/** Development acceptance fixture import only. Copy into convex temporarily; remove after acceptance. */
import { internalMutation } from "../../convex/functions";
import { v } from "convex/values";
import { number } from "../../convex/commercialCore";
import type { Dimensions } from "../../src/lib/analytics/model";
function data<T extends { _id: unknown; _creationTime: number }>(row: T) {
  const { _id, _creationTime, ...value } = row;
  void _id;
  void _creationTime;
  return value;
}
export const importHistory = internalMutation({
  args: {
    project: v.id("projects"),
    invoice: v.id("invoices"),
    payment: v.id("payments"),
  },
  handler: async (ctx, args) => {
    if (
      process.env.CONVEX_CLOUD_URL !==
      "https://woozy-jaguar-392.eu-west-1.convex.cloud"
    )
      throw Error("Development fixture import only");
    const p = await ctx.db.get(args.project),
      i = await ctx.db.get(args.invoice),
      pay = await ctx.db.get(args.payment);
    if (
      !p ||
      !i ||
      !pay ||
      i.project_id !== p._id ||
      pay.project_id !== p._id ||
      p.internal_notes !== "Fictional M6 historical import template" ||
      i.notes !== "Fictional M6 historical import template" ||
      pay.external_reference !== "Fictional M6 historical import template" ||
      i.total_cents !== "10000" ||
      pay.amount_cents !== "4000"
    )
      throw Error("Only the isolated M6 fictional template is permitted");
    const actor = await ctx.db.get(i.created_by),
      prop = await ctx.db.get(p.property_id),
      r = await ctx.db.get(p.realtor_id),
      o = await ctx.db.get(p.opportunity_id);
    if (
      !actor?.email?.endsWith("@accounts.example.test") ||
      !prop ||
      !r ||
      !o ||
      !prop.address_line_1.startsWith("Fictional ")
    )
      throw Error("Fictional source identity required");
    const may = "2026-05-15T18:00:00Z",
      won = "2026-06-10T18:00:00Z",
      staged = "2026-06-12T18:00:00Z",
      issued = "2026-06-15T18:00:00Z",
      recorded = "2026-07-05T18:00:00Z",
      creditAt = "2026-08-05T18:00:00Z";
    const realtor = await ctx.db.insert("realtors", {
      ...data(r),
      first_name: "FictionalM6History",
      email: "",
      created_at: may,
      updated_at: may,
      event_contexts: {},
      version: 1,
    });
    const property = await ctx.db.insert("properties", {
      ...data(prop),
      address_line_1: prop.address_line_1 + " historical fixture",
      realtor_id: realtor,
      created_at: may,
      updated_at: may,
      version: 1,
    });
    const dims: Dimensions = {
      salesperson: o.assigned_to,
      realtor,
      city: prop.city,
      lead_source: o.lead_source_id ?? "unknown",
    };
    const contexts = (keys: string[], at: string) =>
      Object.fromEntries(
        keys.map((k) => [k, { event_at: at, dimensions: dims }]),
      );
    const opportunity = await ctx.db.insert("opportunities", {
      ...data(o),
      realtor_id: realtor,
      property_id: property,
      created_at: may,
      updated_at: won,
      stage_changed_at: won,
      won_at: won,
      version: 1,
      event_contexts: {
        ...contexts(["opportunities_created", "cohort"], may),
        ...contexts(["won"], won),
      },
    });
    const key = "2026",
      counter = await ctx.db
        .query("project_counters")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique(),
      value = (counter?.value ?? 0) + 1;
    if (counter) await ctx.db.patch(counter._id, { value });
    else await ctx.db.insert("project_counters", { key, value });
    const projectNumber = `GLS-${key}-${String(value).padStart(4, "0")}`;
    const project = await ctx.db.insert("projects", {
      ...data(p),
      project_number: projectNumber,
      opportunity_id: opportunity,
      property_id: property,
      realtor_id: realtor,
      source_quote_id: null,
      status: "staged",
      created_at: won,
      updated_at: staged,
      version: 1,
      internal_notes: "Fictional M6 imported historical evidence",
      event_contexts: {
        ...contexts(["projects_created"], won),
        ...contexts(["staged_first"], staged),
      },
    });
    dims.project = project;
    const invoice = await ctx.db.insert("invoices", {
      ...data(i),
      number: await number(ctx, "invoice"),
      project_id: project,
      realtor_id: realtor,
      identity: {
        ...i.identity,
        project_number: projectNumber,
        property_address: prop.address_line_1 + " historical fixture",
        realtor_name: "FictionalM6History",
      },
      created_at: issued,
      updated_at: issued,
      issued_at: issued,
      issue_date: "2026-06-15",
      due_date: "2026-06-30",
      version: 1,
      event_contexts: contexts(["invoiced_cents"], issued),
    });
    for (const item of await ctx.db
      .query("invoice_items")
      .withIndex("by_invoice", (q) => q.eq("invoice_id", i._id))
      .collect())
      await ctx.db.insert("invoice_items", {
        ...data(item),
        invoice_id: invoice,
      });
    const payment = await ctx.db.insert("payments", {
      ...data(pay),
      number: await number(ctx, "payment"),
      project_id: project,
      received_date: "2026-06-20",
      created_at: recorded,
      request_key: "m6-history-" + project,
      event_contexts: {
        ...contexts(["cash_received_cents", "payments_received"], "2026-06-20"),
        ...contexts(["payments_recorded"], recorded),
      },
    });
    await ctx.db.insert("payment_allocations", {
      payment_id: payment,
      invoice_id: invoice,
      amount_cents: "4000",
      created_by: actor._id,
      created_at: recorded,
    });
    const credit = await ctx.db.insert("credit_notes", {
      number: await number(ctx, "credit"),
      invoice_id: invoice,
      amount_cents: "1000",
      reason: "Fictional later historical credit",
      created_by: actor._id,
      created_at: creditAt,
    });
    for (const event of [
      {
        entity_id: opportunity,
        entity: "opportunity",
        action: "STAGE_CHANGED",
        created_at: won,
        new_value: {
          stage: "won",
          won_at: won,
          assigned_to: o.assigned_to,
          lead_source_id: o.lead_source_id,
        },
      },
      {
        entity_id: project,
        entity: "project",
        action: "PROJECT_STATUS_CHANGED",
        created_at: staged,
        new_value: { status: "staged" },
      },
    ])
      await ctx.db.insert("audit_logs", {
        ...event,
        actor_id: actor._id,
        old_value: null,
      });
    await ctx.db.insert("audit_logs", {
      actor_id: actor._id,
      entity: "project",
      entity_id: project,
      action: "FICTIONAL_HISTORY_IMPORTED",
      old_value: null,
      new_value: {
        template_project: p._id,
        reason: "M6 development multi-period acceptance only",
      },
      created_at: new Date().toISOString(),
    });
    return {
      project,
      opportunity,
      realtor,
      invoice,
      payment,
      credit,
      original_salesperson: o.assigned_to,
    };
  },
});
