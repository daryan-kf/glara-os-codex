import { query } from "./_generated/server";
import { v } from "convex/values";
import { requireRoles } from "./access";
import { paymentState, invoiceState } from "./commercialCore";
import { stockStates } from "../src/lib/inventory/model";
export const page = query({
  args: {
    domain: v.union(
      v.literal("payments"),
      v.literal("invoices"),
      v.literal("stock"),
      v.literal("movements"),
      v.literal("reservations"),
      v.literal("automation"),
    ),
    cursor: v.union(v.string(), v.null()),
  },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin"]);
    if (a.cursor && a.cursor.length > 4096) throw Error("INVALID_CURSOR");
    const entries: {
      key: string;
      amount?: string;
      kind: string;
      issues: string[];
    }[] = [];
    const paging = { cursor: a.cursor, numItems: 20 };
    if (a.domain === "payments") {
      const result = await ctx.db.query("payments").paginate(paging);
      for (const p of result.page) {
        const state = await paymentState(ctx, p),
          issues: string[] = [];
        if (BigInt(state.unallocated_cents) < 0n) issues.push("OVERALLOCATION");
        for (const x of state.allocations) {
          const i = await ctx.db.get(x.invoice_id);
          if (
            !i ||
            i.project_id !== p.project_id ||
            i.customer_id !== p.customer_id ||
            BigInt(x.amount_cents) <= 0n
          )
            issues.push("ALLOCATION_LINK");
        }
        entries.push({ key: p._id, kind: "payment", issues });
      }
      return { entries, done: result.isDone, cursor: result.continueCursor };
    }
    if (a.domain === "invoices") {
      const result = await ctx.db.query("invoices").paginate(paging);
      for (const i of result.page) {
        const state = await invoiceState(ctx, i),
          issues: string[] = [];
        const items = await ctx.db
          .query("invoice_items")
          .withIndex("by_invoice", (q) => q.eq("invoice_id", i._id))
          .take(101);
        if (items.length > 100) issues.push("BOUNDED_REVIEW_REQUIRED");
        if (
          items.reduce((n, x) => n + BigInt(x.total_cents), 0n) !==
          BigInt(i.total_cents)
        )
          issues.push("ITEM_TOTAL");
        if (
          BigInt(state.credit_cents) > BigInt(i.total_cents) ||
          state.credits.some((c) => BigInt(c.amount_cents) <= 0n)
        )
          issues.push("INVALID_CREDIT");
        for (const allocation of state.allocations)
          if (!(await ctx.db.get(allocation.payment_id)))
            issues.push("MISSING_PAYMENT");
        if (
          i.status === "void" &&
          (state.allocations.length || state.credits.length)
        )
          issues.push("VOID_LEDGER_REVIEW");
        entries.push({ key: i._id, kind: "invoice", issues });
      }
      return { entries, done: result.isDone, cursor: result.continueCursor };
    }
    if (a.domain === "stock") {
      const result = await ctx.db.query("inventory_stock").paginate(paging);
      for (const r of result.page)
        for (const bucket of stockStates)
          entries.push({
            key: r.product_id + ":" + r.location_id + ":" + bucket,
            kind: "stock",
            amount: String(r[bucket]),
            issues:
              r[bucket] < 0 || !Number.isSafeInteger(r[bucket])
                ? ["INVALID_STOCK"]
                : [],
          });
      return { entries, done: result.isDone, cursor: result.continueCursor };
    }
    if (a.domain === "movements") {
      const result = await ctx.db.query("inventory_movements").paginate(paging);
      for (const r of result.page)
        for (const d of r.stock_deltas)
          entries.push({
            key: r.product_id + ":" + d.location_id + ":" + d.bucket,
            kind: "delta",
            amount: String(d.delta),
            issues: [],
          });
      return { entries, done: result.isDone, cursor: result.continueCursor };
    }
    if (a.domain === "reservations") {
      const result = await ctx.db
        .query("inventory_reservations")
        .paginate(paging);
      for (const r of result.page) {
        const [project, room, product] = await Promise.all([
            ctx.db.get(r.project_id),
            ctx.db.get(r.project_room_id),
            ctx.db.get(r.product_id),
          ]),
          issues: string[] = [];
        if (!project || !room || room.project_id !== r.project_id || !product)
          issues.push("RESERVATION_LINK");
        if (
          !Number.isSafeInteger(r.quantity) ||
          r.quantity < 1 ||
          r.needed_from > r.needed_until
        )
          issues.push("RESERVATION_RANGE");
        if (r.asset_id && r.active) {
          const matches = await ctx.db
            .query("inventory_reservations")
            .withIndex("by_asset", (q) =>
              q.eq("asset_id", r.asset_id).eq("active", true),
            )
            .take(101);
          if (matches.length > 100) issues.push("BOUNDED_REVIEW_REQUIRED");
          if (
            matches.some(
              (x) =>
                x._id !== r._id &&
                x.needed_from <= r.needed_until &&
                x.needed_until >= r.needed_from,
            )
          )
            issues.push("OVERLAPPING_ASSET");
        }
        entries.push({ key: r._id, kind: "reservation", issues });
      }
      return { entries, done: result.isDone, cursor: result.continueCursor };
    }
    const result = await ctx.db.query("automation_actions").paginate(paging);
    for (const r of result.page) {
      const task = await ctx.db.get(r.activity_id),
        issues: string[] = [];
      if (!task) issues.push("MISSING_TASK");
      if (
        task &&
        r.status === "active" &&
        !task.deleted_at &&
        task.assigned_to !== r.assigned_to
      )
        issues.push("TASK_ASSIGNMENT");
      if (r.execution_id) {
        const execution = await ctx.db.get(r.execution_id);
        const linked = execution?.action_id
          ? await ctx.db.get(execution.action_id)
          : null;
        const preservedDuplicate =
          r.status === "resolved" &&
          r.resolution === "Duplicate linkage repaired" &&
          linked &&
          linked.activity_id === r.activity_id &&
          linked.table === r.table &&
          linked.entity_id === r.entity_id &&
          linked.family === r.family &&
          execution?.table === r.table &&
          execution.entity_id === r.entity_id;
        if (
          !execution ||
          (execution.action_id !== r._id && !preservedDuplicate)
        )
          issues.push("EXECUTION_LINK");
      }
      entries.push({
        key:
          r.status === "active"
            ? r.table + ":" + r.entity_id + ":" + r.family
            : r._id,
        kind:
          r.status === "active"
            ? "active_action"
            : r.resolution === "Duplicate linkage repaired" && !issues.length
              ? "resolved_duplicate_history"
              : "resolved_action",
        issues,
      });
    }
    return { entries, done: result.isDone, cursor: result.continueCursor };
  },
});
