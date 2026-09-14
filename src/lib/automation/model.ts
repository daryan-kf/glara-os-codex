import { z } from "zod";
import { day } from "../operations/model";
export const sourceTables = [
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
] as const;
export type SourceTable = (typeof sourceTables)[number];
export const domains = [
  "sales",
  "operations",
  "inventory",
  "commercial",
  "management",
] as const;
export type Domain = (typeof domains)[number];
export const configSchema = z
  .object({
    enabled: z.boolean(),
    entity_ids: z.array(z.string().min(1).max(100)).max(20).optional(),
    delay_days: z.number().int().min(0).max(365),
    cooldown_days: z.number().int().min(1).max(90),
    priority: z.enum(["normal", "high", "urgent"]),
    assignment: z.enum([
      "entity_owner",
      "project_manager",
      "admin",
      "owner",
      "specific_user",
    ]),
    user_id: z.string().max(100).nullable(),
    escalation_days: z.array(z.number().int().min(1).max(365)).max(2),
    minimum_cents: z.string().regex(/^(0|[1-9]\d{0,14})$/),
    activation: z.enum(["current", "future"]),
    daily_limit: z.number().int().min(1).max(100),
  })
  .strict()
  .refine(
    (c) => c.escalation_days.every((d, i, a) => i === 0 || d > a[i - 1]),
    "Escalation days must increase",
  )
  .refine(
    (c) => c.assignment !== "specific_user" || !!c.user_id,
    "Select a user",
  );
export type Config = z.infer<typeof configSchema>;
type Template = {
  key: string;
  name: string;
  domain: Domain;
  table: SourceTable;
  family: string;
  clock: string;
  description: string;
  config: Config;
};
function rule(
  key: string,
  name: string,
  domain: Domain,
  table: SourceTable,
  family: string,
  clock: string,
  delay: number,
  description: string,
  priority: Config["priority"] = "high",
): Template {
  return {
    key,
    name,
    domain,
    table,
    family,
    clock,
    description,
    config: {
      enabled: false,
      delay_days: delay,
      cooldown_days: 3,
      priority,
      assignment:
        domain === "sales"
          ? "entity_owner"
          : domain === "operations"
            ? "project_manager"
            : "admin",
      user_id: null,
      escalation_days: [7, 14],
      minimum_cents: "0",
      activation: "current",
      daily_limit: 25,
    },
  };
}
export const templates = [
  rule(
    "new_contact",
    "New opportunity contact",
    "sales",
    "opportunities",
    "contact",
    "opportunity.created_at",
    1,
    "New opportunity remains uncontacted.",
  ),
  rule(
    "quote_day2",
    "Quote follow-up · day 2",
    "sales",
    "quotes",
    "quote_followup",
    "quote.sent_at",
    2,
    "Sent quote remains awaiting a decision.",
  ),
  rule(
    "quote_day5",
    "Quote follow-up · day 5",
    "sales",
    "quotes",
    "quote_followup",
    "quote.sent_at",
    5,
    "Escalate the existing quote follow-up.",
    "urgent",
  ),
  rule(
    "next_action",
    "Overdue next action",
    "sales",
    "activities",
    "task_overdue",
    "activity.due_at",
    0,
    "An existing manual CRM next action is overdue.",
  ),
  rule(
    "stale_opportunity",
    "High-value stalled opportunity",
    "sales",
    "opportunities",
    "stale_sales",
    "opportunity.stage_changed_at",
    14,
    "Open opportunity has not advanced; uses the M6 high-value threshold.",
  ),
  rule(
    "dormant_realtor",
    "Realtor nurture",
    "sales",
    "realtors",
    "nurture",
    "latest completed communication or realtor.created_at",
    90,
    "No completed communication within the configured interval.",
  ),
  rule(
    "lost_reactivation",
    "Timing / no-response reactivation",
    "sales",
    "opportunities",
    "reactivation",
    "opportunity.lost_at",
    30,
    "Lost for timing or no response; review suitability before reopening.",
  ),
  rule(
    "won_handoff",
    "Won opportunity handoff",
    "operations",
    "opportunities",
    "handoff",
    "opportunity.won_at",
    1,
    "Won opportunity has no active project; review the handoff.",
  ),
  rule(
    "prep_day3",
    "Staging preparation · 3 days",
    "operations",
    "projects",
    "preparation",
    "scheduled staging start_at",
    3,
    "Upcoming staging has incomplete required preparation.",
  ),
  rule(
    "prep_tomorrow",
    "Staging preparation · tomorrow",
    "operations",
    "projects",
    "preparation",
    "scheduled staging start_at",
    1,
    "Staging is tomorrow or overdue with incomplete preparation.",
    "urgent",
  ),
  rule(
    "sold_destage",
    "Sold without destaging",
    "operations",
    "projects",
    "destaging",
    "project.sold_date",
    1,
    "Sold project has no active destaging event.",
  ),
  rule(
    "package_expiry",
    "Package expiry review",
    "operations",
    "projects",
    "package",
    "project.planned_end_date (M5 accepted extension applied)",
    30,
    "Review the active package at 30/14/7 days and while expired.",
  ),
  rule(
    "required_task",
    "Overdue project task",
    "operations",
    "activities",
    "task_overdue",
    "activity.due_at",
    0,
    "Assigned project task is overdue.",
  ),
  rule(
    "inventory_shortage",
    "Upcoming inventory shortage",
    "inventory",
    "inventory_reservations",
    "readiness",
    "reservation.needed_from",
    3,
    "A required reservation is short or not ready before staging.",
  ),
  rule(
    "missing_asset",
    "Missing physical asset",
    "inventory",
    "inventory_assets",
    "missing",
    "latest missing movement.occurred_at",
    0,
    "Physical asset remains missing; no liability is inferred.",
    "urgent",
  ),
  rule(
    "repair_backlog",
    "Long repair",
    "inventory",
    "inventory_assets",
    "repair",
    "latest repair inspection.inspected_at",
    14,
    "Asset remains in repair beyond the configured interval.",
  ),
  rule(
    "inventory_return",
    "Inventory not returned",
    "inventory",
    "inventory_reservations",
    "return",
    "reservation.needed_until",
    1,
    "Installed or returning inventory is past the return date.",
  ),
  rule(
    "quantity_missing",
    "Missing quantity stock",
    "inventory",
    "inventory_stock",
    "missing",
    "first current-condition observation",
    0,
    "Quantity stock has unresolved missing units.",
    "urgent",
  ),
  rule(
    "damage_review",
    "Incident without assessment",
    "commercial",
    "inventory_damage",
    "assessment",
    "incident.discovered_at",
    1,
    "Open project incident needs commercial review; no automatic assessment.",
  ),
  rule(
    "deposit_unpaid",
    "Unpaid deposit",
    "commercial",
    "agreements",
    "deposit",
    "agreement.acceptance.recorded_at",
    1,
    "Accepted agreement deposit has not been collected; does not block staging.",
  ),
  rule(
    "invoice_due",
    "Invoice due soon",
    "commercial",
    "invoices",
    "collection",
    "invoice.due_date",
    3,
    "Issued invoice has a remaining balance and is due soon.",
  ),
  rule(
    "invoice_overdue",
    "Overdue invoice",
    "commercial",
    "invoices",
    "collection",
    "invoice.due_date",
    0,
    "Issued invoice has an overdue balance.",
    "urgent",
  ),
  rule(
    "invoice_escalation",
    "Invoice collection escalation",
    "commercial",
    "invoices",
    "collection",
    "invoice.due_date",
    7,
    "Escalate the same collection action at configured 7/14/30-day thresholds.",
    "urgent",
  ),
  rule(
    "extension_invoice",
    "Accepted extension not invoiced",
    "commercial",
    "package_extensions",
    "extension",
    "extension.approval.recorded_at",
    1,
    "Accepted extension has no live invoice.",
  ),
  rule(
    "assessment_invoice",
    "Approved assessment not invoiced",
    "commercial",
    "damage_charge_assessments",
    "assessment_invoice",
    "assessment.approved_at",
    1,
    "Approved charge needs invoicing review; recovered conflicts remain manual.",
  ),
  rule(
    "unallocated_payment",
    "Unallocated payment review",
    "commercial",
    "payments",
    "allocation",
    "payment.received_date",
    1,
    "Unreversed payment has unallocated cents.",
  ),
  rule(
    "customer_credit",
    "Customer credit review",
    "commercial",
    "commercial_customers",
    "credit",
    "first current-condition observation",
    1,
    "Customer has unallocated payments to review; no automatic refund.",
  ),
  rule(
    "red_project",
    "Unresolved red project",
    "management",
    "projects",
    "preparation",
    "scheduled staging start_at",
    1,
    "Urgent incomplete staging preparation requires management review.",
    "urgent",
  ),
] as const;
export function template(key: string) {
  const value = templates.find((t) => t.key === key);
  if (!value) throw Error("UNKNOWN_RULE");
  return value;
}
export function elapsedDays(instant: string, now: number) {
  return Math.floor((now - Date.parse(instant)) / 86400000);
}
export function businessDays(date: string, now: number) {
  return Math.round(
    (Date.parse(day(new Date(now).toISOString())) - Date.parse(date)) /
      86400000,
  );
}
export function escalationLevel(created: number, now: number, days: number[]) {
  return days.filter((d) => now - created >= d * 86400000).length;
}
export function conditionKey(table: string, id: string, family: string) {
  return `${table}:${id}:${family}`;
}
export function executionKey(
  key: string,
  cycle: number,
  version: number,
  event: string,
) {
  return `${key}:${cycle}:v${version}:${event}`;
}
export function due(instant: string, days: number, now: number) {
  return (
    Number.isFinite(Date.parse(instant)) &&
    now >= Date.parse(instant) + days * 86400000
  );
}
