import {
  query,
  mutation,
  type QueryCtx,
  type MutationCtx,
} from "./_generated/server";
import { requireRoles, deny } from "./access";
import { v } from "convex/values";
import { frozen } from "./emergencyCore";
import { healthSignals, type Health } from "../src/lib/observability/model";
async function snapshot(ctx: QueryCtx | MutationCtx) {
  const [config, unknown, pending, automation, ai, reconciliation] =
    await Promise.all([
      ctx.db
        .query("communication_settings")
        .withIndex("by_key", (q) => q.eq("key", "company"))
        .unique(),
      ctx.db
        .query("communication_outbox")
        .withIndex("by_due", (q) => q.eq("status", "unknown"))
        .take(101),
      ctx.db
        .query("communication_outbox")
        .withIndex("by_due", (q) => q.eq("status", "ready"))
        .take(101),
      ctx.db
        .query("automation_queue")
        .withIndex("by_due", (q) => q.eq("status", "failed"))
        .take(101),
      ctx.db.query("ai_requests").order("desc").take(100),
      ctx.db.query("analytics_reconciliations").order("desc").first(),
    ]);
  const now = Date.now();
  const dimensions: Health = {
    email: {
      enabled:
        process.env.M9_EMAIL_ENABLED === "true" &&
        !(await frozen(ctx, "email")),
      paused: config?.paused ?? true,
      lag_minutes: Math.floor(
        pending.reduce((age, r) => Math.max(age, now - r.next_attempt_at), 0) /
          60000,
      ),
      unknown: Math.min(unknown.length, 100),
      provider_failures: config?.consecutive_failures ?? 0,
      partial: unknown.length > 100 || pending.length > 100,
    },
    automation: {
      frozen: await frozen(ctx, "automation"),
      failed: Math.min(automation.length, 100),
      partial: automation.length > 100,
    },
    ai: {
      frozen: await frozen(ctx, "ai"),
      failed: ai.filter((r) => r.status === "failed").length,
      partial: ai.length === 100,
    },
    reconciliation: {
      verified: reconciliation?.status === "complete",
      drift:
        (reconciliation?.source_drift ?? 0) +
        (reconciliation?.bucket_drift ?? 0),
    },
    backup: { status: "unknown", verified_at: null, max_age_ms: 86400000 },
  };
  return {
    observed_at: now,
    application: "backend_request_reachable",
    authentication: "current_operator_authorized",
    dimensions,
    financial_integrity: "NOT_CHECKED_BY_THIS_QUERY",
    inventory_integrity: "NOT_CHECKED_BY_THIS_QUERY",
    calendar:
      process.env.M9_CALENDAR_ENABLED === "true"
        ? "REQUIRES_ACCEPTANCE_REVIEW"
        : "DISABLED_DEFERRED",
    alerts: healthSignals(dimensions, now),
    limitations: [
      "Bounded samples, not complete lifetime counts",
      "No independent uptime or authentication-failure monitor configured",
      "Backup monitor and alert destination not configured",
      "No alert is sent externally",
    ],
  };
}
export const health = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner", "admin"]);
    return snapshot(ctx);
  },
});
export const alerts = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner", "admin"]);
    return ctx.db.query("operational_alerts").take(50);
  },
});
export const refresh = mutation({
  args: {},
  handler: async (ctx) => {
    const actor = await requireRoles(ctx, ["owner", "admin"]);
    const observed = await snapshot(ctx),
      keys = new Set(observed.alerts.map((a) => a.key));
    const rows = await ctx.db.query("operational_alerts").take(51);
    if (rows.length > 50) deny("HEALTH_REVIEW_REQUIRED");
    for (const signal of observed.alerts) {
      const old = rows.find((r) => r.key === signal.key);
      if (old)
        await ctx.db.patch(old._id, {
          active: true,
          observed_at: observed.observed_at,
          priority: signal.priority,
          acknowledged_by: old.active ? old.acknowledged_by : null,
          acknowledged_at: old.active ? old.acknowledged_at : null,
          resolved_at: null,
          version: old.version + 1,
        });
      else
        await ctx.db.insert("operational_alerts", {
          key: signal.key,
          priority: signal.priority,
          active: true,
          observed_at: observed.observed_at,
          acknowledged_by: null,
          acknowledged_at: null,
          resolved_at: null,
          version: 1,
        });
    }
    for (const row of rows)
      if (row.active && !keys.has(row.key))
        await ctx.db.patch(row._id, {
          active: false,
          resolved_at: observed.observed_at,
          version: row.version + 1,
        });
    await ctx.db.insert("audit_logs", {
      actor_id: actor.userId,
      action: "HEALTH_REFRESHED",
      entity: "operational_health",
      entity_id: "current",
      old_value: null,
      new_value: { active_conditions: keys.size },
      created_at: new Date().toISOString(),
    });
  },
});
export const acknowledge = mutation({
  args: { id: v.id("operational_alerts"), version: v.number() },
  handler: async (ctx, a) => {
    const actor = await requireRoles(ctx, ["owner", "admin"]),
      row = await ctx.db.get(a.id);
    if (!row || !row.active) deny("UNAVAILABLE");
    if (row.version !== a.version) deny("CONFLICT");
    if (row.acknowledged_at) return;
    await ctx.db.patch(row._id, {
      acknowledged_by: actor.userId,
      acknowledged_at: Date.now(),
      version: row.version + 1,
    });
    await ctx.db.insert("audit_logs", {
      actor_id: actor.userId,
      action: "HEALTH_ACKNOWLEDGED",
      entity: "operational_alerts",
      entity_id: row._id,
      old_value: null,
      new_value: { key: row.key },
      created_at: new Date().toISOString(),
    });
  },
});
