import { internalAction, internalQuery } from "./_generated/server";
import { makeFunctionReference } from "convex/server";
import { v } from "convex/values";
type Progress = {
  complete: boolean;
  table: string;
  cursor: string | null;
  processed: number;
};
export const backfillStatus = internalQuery({
  args: {},
  handler: async (ctx): Promise<Progress> => {
    const state = await ctx.db
      .query("analytics_state")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    if (!state?.backfill_table)
      throw Error("Start analytics backfill before resuming");
    return {
      complete: state.backfill_complete ?? false,
      table: state.backfill_table,
      cursor: state.backfill_cursor ?? null,
      processed: 0,
    };
  },
});
export const backfillBatch = internalAction({
  args: { pages: v.number() },
  handler: async (ctx, args): Promise<Progress> => {
    if (!Number.isInteger(args.pages) || args.pages < 1 || args.pages > 100)
      throw Error("Invalid backfill batch size");
    let next = await ctx.runQuery(
        makeFunctionReference<"query", Record<string, never>, Progress>(
          "analyticsMaintenance:backfillStatus",
        ),
        {},
      ),
      processed = 0;
    for (let i = 0; i < args.pages && !next.complete; i++) {
      next = await ctx.runMutation(
        makeFunctionReference<
          "mutation",
          { table: string; cursor: string | null },
          Progress
        >("analytics:backfillPage"),
        { table: next.table, cursor: next.cursor },
      );
      processed += next.processed;
    }
    return { ...next, processed };
  },
});
import {
  sourceTables,
  sourceTableInput,
  sourceProjection,
} from "./analyticsSources";
import { sourceFacts, factValue, differences } from "./analyticsLedger";
type Issue = { table: string; id: string; key: string; fields: string[] };
type DiagnosticPage = { issues: Issue[]; done: boolean; cursor: string };
export const driftPage = internalQuery({
  args: { table: v.string(), cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<DiagnosticPage> => {
    const table = sourceTableInput.parse(args.table),
      page = await ctx.db
        .query(table)
        .paginate({ cursor: args.cursor, numItems: 10 }),
      issues: Issue[] = [];
    for (const row of page.page) {
      const expected = await sourceProjection(ctx, table, row._id),
        stored = await sourceFacts(ctx, table, row._id);
      for (const d of differences(
        stored.filter((r) => r.active).map(factValue),
        expected.facts,
      )) {
        const before = d.before,
          after = d.expected;
        const fields =
          before && after
            ? Object.keys(before).filter(
                (key) =>
                  JSON.stringify(Reflect.get(before, key)) !==
                  JSON.stringify(Reflect.get(after, key)),
              )
            : [before ? "unexpected_fact" : "missing_fact"];
        issues.push({ table, id: row._id, key: d.key, fields });
      }
    }
    return { issues, done: page.isDone, cursor: page.continueCursor };
  },
});
export const diagnose = internalAction({
  args: {},
  handler: async (ctx): Promise<Issue[]> => {
    const issues: Issue[] = [];
    for (const table of sourceTables) {
      let cursor: string | null = null;
      for (let page = 0; page < 2000; page++) {
        const result: DiagnosticPage = await ctx.runQuery(
          makeFunctionReference<
            "query",
            { table: string; cursor: string | null },
            DiagnosticPage
          >("analyticsMaintenance:driftPage"),
          { table, cursor },
        );
        issues.push(...result.issues);
        if (issues.length >= 100) return issues.slice(0, 100);
        if (result.done) break;
        cursor = result.cursor;
      }
    }
    return issues;
  },
});
import { action } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
export const reconcileBatch = action({
  args: { id: v.id("analytics_reconciliations"), pages: v.number() },
  handler: async (ctx, args): Promise<Doc<"analytics_reconciliations">> => {
    if (!Number.isInteger(args.pages) || args.pages < 1 || args.pages > 50)
      throw Error("Invalid reconciliation batch size");
    // Calling an Owner query and each protected mutation preserves live session/role checks throughout the batch.
    await ctx.runQuery(
      makeFunctionReference<"query", Record<string, never>, unknown>(
        "analytics:settings",
      ),
      {},
    );
    let result: Doc<"analytics_reconciliations"> | undefined;
    for (let page = 0; page < args.pages; page++) {
      result = await ctx.runMutation(
        makeFunctionReference<
          "mutation",
          { id: Id<"analytics_reconciliations"> },
          Doc<"analytics_reconciliations">
        >("analyticsReconciliation:advance"),
        { id: args.id },
      );
      if (result.status !== "running") return result;
    }
    return result!;
  },
});
type InventoryEvidencePage = {
  done: boolean;
  cursor: string;
  checked: number;
  mismatches: { id: string; recorded: number; evidenced: number }[];
};
export const inventoryEvidencePage = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, args): Promise<InventoryEvidencePage> => {
    const page = await ctx.db
        .query("inventory_assets")
        .paginate({ cursor: args.cursor, numItems: 20 }),
      mismatches: InventoryEvidencePage["mismatches"] = [];
    for (const asset of page.page) {
      const moves = await ctx.db
        .query("inventory_movements")
        .withIndex("by_asset_type", (q) =>
          q.eq("asset_id", asset._id).eq("movement_type", "installed"),
        )
        .take(501);
      if (moves.length > 500)
        throw Error("Asset installation evidence requires expanded pagination");
      if (asset.staging_use_count !== moves.length)
        mismatches.push({
          id: asset._id,
          recorded: asset.staging_use_count,
          evidenced: moves.length,
        });
    }
    return {
      done: page.isDone,
      cursor: page.continueCursor,
      checked: page.page.length,
      mismatches,
    };
  },
});
export const inventoryEvidence = internalAction({
  args: {},
  handler: async (
    ctx,
  ): Promise<{
    checked: number;
    mismatches: InventoryEvidencePage["mismatches"];
  }> => {
    let cursor: string | null = null,
      checked = 0;
    const mismatches: InventoryEvidencePage["mismatches"] = [];
    for (let page = 0; page < 2000; page++) {
      const r: InventoryEvidencePage = await ctx.runQuery(
        makeFunctionReference<
          "query",
          { cursor: string | null },
          InventoryEvidencePage
        >("analyticsMaintenance:inventoryEvidencePage"),
        { cursor },
      );
      checked += r.checked;
      mismatches.push(...r.mismatches);
      if (r.done) return { checked, mismatches };
      cursor = r.cursor;
    }
    throw Error("Inventory evidence work bound exceeded");
  },
});
