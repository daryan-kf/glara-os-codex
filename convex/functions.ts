import { requireCapability } from "./emergencyCore";
import { commercialTables } from "./commercialSchema";
import { inventoryTables } from "./inventorySchema";
import { touched as automationTouched } from "./automationCore";
import {
  mutation as baseMutation,
  internalMutation as baseInternalMutation,
  query as baseQuery,
} from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { PropertyValidators } from "convex/values";
import {
  sourceTables,
  sourceProjection,
  sourceRow,
  captureContexts,
  type SourceTable,
  str,
} from "./analyticsSources";
import { applySource, sourceFacts, factValue } from "./analyticsLedger";
import type { Fact } from "../src/lib/analytics/model";

type Definition = {
  args: PropertyValidators;
  handler: (ctx: MutationCtx, args: Record<string, unknown>) => unknown;
};
type Touch = { table: SourceTable; id: string; before: Fact[] };
function sourceOf(ctx: MutationCtx, id: string) {
  for (const table of sourceTables)
    if (ctx.db.normalizeId(table, id)) return table;
  return null;
}
async function instrument(
  ctx: MutationCtx,
  handler: Definition["handler"],
  args: Record<string, unknown>,
) {
  const checked = new Set<string>();
  const financial = Object.keys(commercialTables),
    inventory = Object.keys(inventoryTables);
  const checkWrite = async (table: string) => {
    const capability = financial.includes(table)
      ? "financial"
      : inventory.includes(table)
        ? "inventory"
        : null;
    if (capability && !checked.has(capability)) {
      await requireCapability(ctx, capability);
      checked.add(capability);
    }
  };
  const touched = new Map<string, Touch>();
  const automationWrites = new Map<string, string>();
  const touch = async (id: string, table: SourceTable, inserted = false) => {
    if (!touched.has(id)) {
      const stored = inserted ? [] : await sourceFacts(ctx, table, id);
      touched.set(id, {
        id,
        table,
        before: inserted
          ? []
          : stored.length
            ? stored.filter((f) => f.active).map(factValue)
            : (await sourceProjection(ctx, table, id)).facts,
      });
    }
  };
  // Preserve Convex's typed database interface. Only actual writes are intercepted; authorization stays in each source handler.
  const db = new Proxy(ctx.db, {
    get(target, key, receiver) {
      if (key === "insert")
        return async (...parameters: unknown[]) => {
          if (typeof parameters[0] === "string")
            await checkWrite(parameters[0]);
          const result: unknown = await Reflect.apply(
            target.insert,
            target,
            parameters,
          );
          if (typeof result === "string" && typeof parameters[0] === "string")
            automationWrites.set(result, parameters[0]);
          if (
            typeof result === "string" &&
            sourceTables.includes(parameters[0] as SourceTable)
          )
            await touch(result, parameters[0] as SourceTable, true);
          return result;
        };
      if (key === "patch" || key === "replace" || key === "delete")
        return async (...parameters: unknown[]) => {
          const id = parameters[0];
          if (typeof id === "string") {
            for (const table of [...financial, ...inventory])
              if (
                ctx.db.normalizeId(
                  table as keyof import("./_generated/dataModel").DataModel,
                  id,
                )
              ) {
                await checkWrite(table);
                break;
              }
            for (const name of [
              "profiles",
              "realtors",
              "opportunities",
              "quotes",
              "projects",
              "activities",
              "inventory_assets",
              "inventory_stock",
              "inventory_reservations",
              "inventory_damage",
              "invoices",
              "agreements",
              "payments",
              "package_extensions",
              "damage_charge_assessments",
              "commercial_customers",
              "operations_events",
              "project_checklist_items",
              "payment_allocations",
              "payment_reversals",
              "credit_notes",
              "inventory_movements",
              "inventory_inspections",
            ] as const)
              if (ctx.db.normalizeId(name, id)) automationWrites.set(id, name);
            const table = sourceOf(ctx, id);
            if (table) await touch(id, table);
          }
          return Reflect.apply(target[key], target, parameters);
        };
      const value: unknown = Reflect.get(target, key, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const result = await handler({ ...ctx, db }, args);
  // Related balance projections must change in the same transaction as their allocation/credit/reversal.
  const related = async (table: SourceTable, id: string) => {
    if (id) await touch(id, table);
  };
  const projectActivities = async (
    id: import("./_generated/dataModel").Id<"projects">,
  ) => {
    const tasks = await ctx.db
      .query("activities")
      .withIndex("by_project", (q) =>
        q.eq("project_id", id).eq("deleted_at", null),
      )
      .filter((q) => q.eq(q.field("status"), "open"))
      .take(201);
    if (tasks.length > 200)
      throw Error("Project activity projection limit exceeded");
    for (const task of tasks) await related("activities", task._id);
  };
  for (const t of touched.values()) {
    const row = await sourceRow(ctx, t.table, t.id);
    if (!row) continue;
    if (t.table === "activities")
      await related("opportunities", str(row, "opportunity_id"));
    if (t.table === "opportunities") {
      const id = ctx.db.normalizeId("opportunities", t.id);
      if (id) {
        const tasks = await ctx.db
          .query("activities")
          .withIndex("by_opportunity", (q) =>
            q
              .eq("opportunity_id", id)
              .eq("status", "open")
              .eq("deleted_at", null),
          )
          .take(201);
        const projects = await ctx.db
          .query("projects")
          .withIndex("by_opportunity", (q) => q.eq("opportunity_id", id))
          .take(201);
        if (tasks.length > 200 || projects.length > 200)
          throw Error("Opportunity activity projection limit exceeded");
        for (const task of tasks) await related("activities", task._id);
        for (const project of projects) await projectActivities(project._id);
      }
    }
    if (t.table === "properties") {
      const id = ctx.db.normalizeId("properties", t.id);
      if (id) {
        const rows = await ctx.db
          .query("opportunities")
          .withIndex("by_property", (q) => q.eq("property_id", id))
          .take(201);
        if (rows.length > 200)
          throw Error("Property opportunity projection limit exceeded");
        for (const r of rows) await related("opportunities", r._id);
        const tasks = await ctx.db
          .query("activities")
          .withIndex("by_property", (q) =>
            q.eq("property_id", id).eq("deleted_at", null),
          )
          .filter((q) => q.eq(q.field("status"), "open"))
          .take(201);
        const projects = await ctx.db
          .query("projects")
          .withIndex("by_property", (q) => q.eq("property_id", id))
          .take(201);
        if (tasks.length > 200 || projects.length > 200)
          throw Error("Property activity projection limit exceeded");
        for (const task of tasks) await related("activities", task._id);
        for (const project of projects) await projectActivities(project._id);
      }
    }
    if (t.table === "products") {
      const id = ctx.db.normalizeId("products", t.id);
      if (id) {
        const assets = await ctx.db
          .query("inventory_assets")
          .withIndex("by_product", (q) => q.eq("product_id", id))
          .take(201);
        const stock = await ctx.db
          .query("inventory_stock")
          .withIndex("by_product_location", (q) => q.eq("product_id", id))
          .take(101);
        if (assets.length > 200 || stock.length > 100)
          throw Error("Product projection limit exceeded");
        for (const a of assets) await related("inventory_assets", a._id);
        for (const s of stock) await related("inventory_stock", s._id);
      }
    }
    if (t.table === "invoices")
      await related("projects", str(row, "project_id"));
    if (t.table === "payment_allocations" || t.table === "credit_notes")
      await related("invoices", str(row, "invoice_id"));
    if (t.table === "payment_allocations" || t.table === "payment_reversals")
      await related("payments", str(row, "payment_id"));
    if (t.table === "payment_reversals") {
      const id = ctx.db.normalizeId("payments", str(row, "payment_id"));
      if (id) {
        const allocations = await ctx.db
          .query("payment_allocations")
          .withIndex("by_payment", (q) => q.eq("payment_id", id))
          .take(101);
        if (allocations.length > 100)
          throw Error("Payment allocation limit exceeded");
        for (const a of allocations) {
          await related("invoices", a.invoice_id);
          await related("payment_allocations", a._id);
        }
      }
    }
  }
  for (const t of touched.values())
    await captureContexts(ctx, t.table, t.id, t.before);
  let changed = false;
  for (const t of touched.values()) {
    const p = await sourceProjection(ctx, t.table, t.id);
    const r = await applySource(ctx, t.table, t.id, p.facts, p.version);
    changed ||= r.applied;
  }
  if (changed) {
    const state = await ctx.db
      .query("analytics_state")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    const value = {
      key: "main",
      ready: state?.ready ?? false,
      revision: (state?.revision ?? 0) + 1,
      source_through: new Date().toISOString(),
    };
    if (state) await ctx.db.patch(state._id, value);
    else await ctx.db.insert("analytics_state", value);
  }
  for (const [id, table] of automationWrites)
    if (!table.startsWith("automation_") && table !== "notifications")
      await automationTouched(ctx, table, id);
  return result;
}
// The builder casts preserve Convex's external validator inference across this registration wrapper.
// Internally arguments remain unknown; this layer does not interpret or relax source input validators.
export const mutation = ((definition: Definition) =>
  baseMutation({
    ...definition,
    handler: (ctx, args) => instrument(ctx, definition.handler, args),
  })) as typeof baseMutation;
export const internalMutation = ((definition: Definition) =>
  baseInternalMutation({
    ...definition,
    handler: (ctx, args) => instrument(ctx, definition.handler, args),
  })) as typeof baseInternalMutation;
function publicValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(publicValue);
  if (
    value &&
    typeof value === "object" &&
    Object.getPrototypeOf(value) === Object.prototype
  )
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => key !== "event_contexts")
        .map(([key, v]) => [key, publicValue(v)]),
    );
  return value;
}
type QueryDefinition = {
  args: PropertyValidators;
  handler: (ctx: QueryCtx, args: Record<string, unknown>) => unknown;
};
export const query = ((definition: QueryDefinition) =>
  baseQuery({
    ...definition,
    handler: async (ctx, args) =>
      publicValue(await definition.handler(ctx, args)),
  })) as typeof baseQuery;
export {
  internalQuery,
  action,
  internalAction,
  httpAction,
} from "./_generated/server";
export type { MutationCtx, QueryCtx, ActionCtx } from "./_generated/server";
