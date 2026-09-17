// Trusted deployment maintenance for inventory data. Never callable by browsers.
// Uses the uninstrumented mutation base deliberately: this platform-level purge
// removes fictional development rows wholesale and does not replay analytics.
import { internalMutation } from "./_generated/server";
const purgeTables = [
  "inventory_reservations",
  "inventory_movements",
  "inventory_inspections",
  "inventory_damage",
  "inventory_stock",
  "inventory_assets",
  "inventory_counters",
  "products",
] as const;
export const purgeCatalog = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.GLARA_ENVIRONMENT === "production")
      throw Error("Catalog purge is a non-production maintenance operation.");
    let deleted = 0;
    const counts: Record<string, number> = {};
    for (const table of purgeTables) {
      if (deleted >= 400) break;
      const rows = await ctx.db.query(table).take(400 - deleted);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted += rows.length;
      if (rows.length) counts[table] = rows.length;
    }
    if (deleted)
      await ctx.db.insert("audit_logs", {
        actor_id: null,
        action: "PLATFORM_INVENTORY_PURGED",
        entity: "products",
        entity_id: "inventory-purge",
        old_value: counts,
        new_value: null,
        created_at: new Date().toISOString(),
      });
    return { deleted, done: deleted === 0 };
  },
});
