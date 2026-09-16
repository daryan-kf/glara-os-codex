import { query } from "./_generated/server";
import { requireRoles } from "./access";
import { frozen } from "./emergencyCore";
import { healthSignals, type Health } from "../src/lib/observability/model";
export const health = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner", "admin"]);
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
          pending.reduce(
            (age, r) => Math.max(age, now - r.next_attempt_at),
            0,
          ) / 60000,
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
  },
});
