import { query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { requireRoles, deny } from "./access";
import { day, addDays } from "../src/lib/operations/model";
import { eventDay, daysBetween } from "../src/lib/analytics/periods";
import { defaultTargets } from "../src/lib/analytics/model";
import { z } from "zod";
const before = (at: string | null | undefined, date: string) =>
  !!at &&
  eventDay({
    kind: at.length === 10 ? "business_date" : "instant",
    value: at,
  }) <= date;
export const historicalAR = query({
  args: { as_of: v.string(), pagination: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireRoles(ctx, ["owner", "admin"]);
    if (
      !z.iso.date().safeParse(args.as_of).success ||
      args.as_of > day() ||
      args.pagination.numItems > 20
    )
      deny("INVALID_INPUT");
    const rows = await ctx.db
        .query("invoices")
        .withIndex("by_issued", (q) =>
          q
            .gt("issued_at", null)
            .lt("issued_at", addDays(args.as_of, 1) + "T12:00:00Z"),
        )
        .paginate(args.pagination),
      page = [];
    let subtotal = 0n;
    for (const i of rows.page) {
      if (!before(i.issued_at, args.as_of) || before(i.voided_at, args.as_of))
        continue;
      const allocations = await ctx.db
          .query("payment_allocations")
          .withIndex("by_invoice", (q) => q.eq("invoice_id", i._id))
          .take(101),
        credits = await ctx.db
          .query("credit_notes")
          .withIndex("by_invoice", (q) => q.eq("invoice_id", i._id))
          .take(101);
      if (allocations.length > 100 || credits.length > 100) deny("LIMIT");
      let paid = 0n;
      for (const a of allocations)
        if (before(a.created_at, args.as_of)) {
          const p = await ctx.db.get(a.payment_id),
            r = await ctx.db
              .query("payment_reversals")
              .withIndex("by_payment", (q) => q.eq("payment_id", a.payment_id))
              .unique();
          if (
            p &&
            before(p.received_date, args.as_of) &&
            !before(r?.created_at, args.as_of)
          )
            paid += BigInt(a.amount_cents);
        }
      const credit = credits
          .filter((c) => before(c.created_at, args.as_of))
          .reduce((n, c) => n + BigInt(c.amount_cents), 0n),
        balance = BigInt(i.total_cents) - paid - credit,
        ar = balance > 0n ? balance : 0n;
      subtotal += ar;
      page.push({
        id: i._id,
        number: i.number,
        issued_at: i.issued_at,
        due_date: i.due_date,
        invoiced_cents: i.total_cents,
        paid_cents: String(paid),
        credit_cents: String(credit),
        balance_cents: String(ar),
        customer_credit_cents: String(balance < 0n ? -balance : 0n),
      });
    }
    return {
      ...rows,
      page,
      as_of: args.as_of,
      page_subtotal_cents: String(subtotal),
      definition:
        "Reconstructed at Vancouver end of day from issued invoices, allocation timing, credits, and reversals. Page subtotal is not company-wide AR.",
    };
  },
});
export const underused = query({
  args: { pagination: paginationOptsValidator },
  handler: async (ctx, args) => {
    await requireRoles(ctx, ["owner", "admin"]);
    if (args.pagination.numItems > 20) deny("INVALID_INPUT");
    const settings =
      (await ctx.db
        .query("analytics_settings")
        .withIndex("by_key", (q) => q.eq("key", "main"))
        .unique()) ?? defaultTargets;
    const result = await ctx.db
        .query("inventory_assets")
        .withIndex("by_eligible", (q) =>
          q.eq("deleted_at", null).eq("staging_eligible", true),
        )
        .paginate(args.pagination),
      page = [];
    for (const asset of result.page) {
      const product = await ctx.db.get(asset.product_id);
      if (!product?.active || product.deleted_at || !product.staging_eligible)
        continue;
      if (["sold", "retired", "staged"].includes(asset.status)) continue;
      const last = await ctx.db
        .query("inventory_movements")
        .withIndex("by_asset_type", (q) =>
          q.eq("asset_id", asset._id).eq("movement_type", "installed"),
        )
        .order("desc")
        .first();
      const since = last
        ? eventDay({ kind: "instant", value: last.occurred_at })
        : asset.staging_use_count === 0
          ? asset.acquisition_date
          : null;
      if (!since || daysBetween(since, day()) >= settings.unused_days) {
        page.push({
          id: asset._id,
          asset_number: asset.asset_number,
          product_name: product?.name ?? "Product",
          status: asset.status,
          last_installed_at: last?.occurred_at ?? null,
          days_unused: since ? daysBetween(since, day()) : null,
          history: since ? "recorded" : "insufficient_history",
        });
      }
    }
    return {
      ...result,
      page,
      threshold_days: settings.unused_days,
      definition:
        "Serialized staging-eligible assets only. Never-installed assets use acquisition date when the source use count is zero.",
    };
  },
});
