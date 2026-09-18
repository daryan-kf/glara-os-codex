// Trusted deployment maintenance for inventory data. Never callable by browsers.
// Uses the uninstrumented mutation base deliberately: this platform-level purge
// removes fictional development rows wholesale and does not replay analytics.
import { internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
const purgeTables = [
  "inventory_reservations",
  "inventory_movements",
  "inventory_inspections",
  "inventory_damage",
  "inventory_stock",
  "inventory_assets",
  "inventory_counters",
  "products",
  "inventory_categories",
  "inventory_locations",
] as const;
export const purgeCatalog = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.GLARA_ENVIRONMENT !== "development")
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
    if (deleted) {
      await ctx.db.insert("audit_logs", {
        actor_id: null,
        action: "PLATFORM_INVENTORY_PURGED",
        entity: "products",
        entity_id: "inventory-purge",
        old_value: counts,
        new_value: null,
        created_at: new Date().toISOString(),
      });
      // Continue in a follow-up transaction until every table is empty.
      await ctx.scheduler.runAfter(
        0,
        internal.inventoryMaintenance.purgeCatalog,
        {},
      );
    }
    return { deleted, done: deleted === 0 };
  },
});
// Removes fictional acceptance CRM, sales, project, commercial, automation,
// communication-delivery, calendar and analytics-ledger rows. Configuration
// (settings, templates, rules, lead sources) and audit history stay.
const businessTables = [
  "quote_items",
  "quotes",
  "activities",
  "consultations",
  "opportunities",
  "properties",
  "realtor_private",
  "realtors",
  "brokerages",
  "sales_realtor_counts",
  "sales_metrics",
  "sales_counters",
  "project_checklist_items",
  "project_rooms",
  "project_notes",
  "project_media",
  "project_access_details",
  "project_team_assignments",
  "project_counters",
  "operations_events",
  "projects",
  "payment_reversals",
  "payment_allocations",
  "credit_notes",
  "invoice_items",
  "invoices",
  "payments",
  "package_extensions",
  "damage_charge_assessments",
  "agreements",
  "commercial_customers",
  "commercial_counters",
  "automation_queue",
  "automation_executions",
  "automation_actions",
  "automation_escalations",
  "automation_suppressions",
  "automation_scan",
  "notifications",
  "communications",
  "communication_outbox",
  "communication_delivery_events",
  "communication_provider_messages",
  "communication_eligibility_decisions",
  "calendar_projections",
  "calendar_sync_events",
  "calendar_conflicts",
  "analytics_facts",
  "analytics_changes",
  "analytics_buckets",
  "analytics_expected",
  "analytics_reconciliations",
  "analytics_state",
] as const;
// Removes the archived delivery-test recipient and every record that
// references it: the realtor, its private row and activities, and the test
// communications with their consent, outbox, decision and delivery evidence.
export const purgeTestRecipient = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.GLARA_ENVIRONMENT !== "development")
      throw Error("Test purge is a non-production maintenance operation.");
    const email = "glarahome.staging@gmail.com";
    let deleted = 0;
    for (const realtor of await ctx.db.query("realtors").collect())
      if ((realtor.email ?? "").toLowerCase() === email) {
        for (const row of await ctx.db
          .query("realtor_private")
          .withIndex("by_realtor", (q) => q.eq("realtor_id", realtor._id))
          .collect()) {
          await ctx.db.delete(row._id);
          deleted++;
        }
        for (const row of await ctx.db
          .query("activities")
          .withIndex("by_realtor_history", (q) =>
            q.eq("realtor_id", realtor._id),
          )
          .collect()) {
          await ctx.db.delete(row._id);
          deleted++;
        }
        await ctx.db.delete(realtor._id);
        deleted++;
      }
    for (const row of await ctx.db.query("communications").collect())
      if (row.snapshot?.email === email || row.recipient_key.includes(email)) {
        for (const job of await ctx.db
          .query("communication_outbox")
          .withIndex("by_communication", (q) =>
            q.eq("communication_id", row._id),
          )
          .collect()) {
          await ctx.db.delete(job._id);
          deleted++;
        }
        for (const event of await ctx.db
          .query("communication_delivery_events")
          .collect())
          if (event.communication_id === row._id) {
            await ctx.db.delete(event._id);
            deleted++;
          }
        for (const decision of await ctx.db
          .query("communication_eligibility_decisions")
          .collect())
          if (decision.communication_id === row._id) {
            await ctx.db.delete(decision._id);
            deleted++;
          }
        await ctx.db.delete(row._id);
        deleted++;
      }
    for (const table of [
      "communication_consents",
      "communication_preferences",
    ] as const)
      for (const row of await ctx.db.query(table).collect())
        if (row.recipient_key.includes(email)) {
          await ctx.db.delete(row._id);
          deleted++;
        }
    if (deleted)
      await ctx.db.insert("audit_logs", {
        actor_id: null,
        action: "PLATFORM_TEST_RECIPIENT_PURGED",
        entity: "realtors",
        entity_id: "test-recipient-purge",
        old_value: { deleted },
        new_value: null,
        created_at: new Date().toISOString(),
      });
    return { deleted };
  },
});
export const purgeBusinessData = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.GLARA_ENVIRONMENT !== "development")
      throw Error("Business purge is a non-production maintenance operation.");
    let deleted = 0;
    const counts: Record<string, number> = {};
    for (const table of businessTables) {
      if (deleted >= 400) break;
      const rows = await ctx.db.query(table).take(400 - deleted);
      for (const row of rows) await ctx.db.delete(row._id);
      deleted += rows.length;
      if (rows.length) counts[table] = rows.length;
    }
    if (deleted) {
      await ctx.db.insert("audit_logs", {
        actor_id: null,
        action: "PLATFORM_BUSINESS_TEST_DATA_PURGED",
        entity: "realtors",
        entity_id: "business-purge",
        old_value: counts,
        new_value: null,
        created_at: new Date().toISOString(),
      });
      await ctx.scheduler.runAfter(
        0,
        internal.inventoryMaintenance.purgeBusinessData,
        {},
      );
    }
    return { deleted, done: deleted === 0 };
  },
});
