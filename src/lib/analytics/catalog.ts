import type { Role } from "../permissions";
export const salesMetrics = [
  "activities_created",
  "activities_completed",
  "followups_open",
  "cohort_opportunities",
  "cohort_won",
  "realtors_created",
  "realtors_active",
  "opportunities_created",
  "opportunities_won",
  "opportunities_lost",
  "won_value_cents",
  "lost_value_cents",
  "open_opportunities",
  "pipeline_cents",
  "weighted_pipeline_cents",
  "consultations_scheduled",
  "consultations_completed",
  "quotes_created",
  "quotes_sent",
  "quotes_accepted",
  "sales_cycle_ms",
  "sales_cycle_samples",
  "projects_created",
];
export const marketingMetrics = [
  "realtors_created",
  "opportunities_created",
  "projects_staged",
  "projects_listing_live",
  "projects_sold",
];
export function metricAllowed(roles: readonly Role[], metric: string) {
  if (roles.some((r) => r === "owner" || r === "admin")) return true;
  if (
    roles.includes("sales") &&
    (salesMetrics.includes(metric) ||
      /^(stage_(new|contacted|interested|consultation|quote_sent|negotiation)(_cents|_entry_ms)?|cohort_reached_[a-z_]+|reached_[a-z_]+|next_action_[a-z_]+|lost_reason_[a-z_]+)$/.test(
        metric,
      ))
  )
    return true;
  return roles.includes("marketing") && marketingMetrics.includes(metric);
}
export const metricLabels: Record<string, string> = {
  quantity_available: "Warehouse quantity · before reservations",
  quantity_project_staged: "Quantity units installed",
  quantity_inspection: "Quantity units in inspection",
  projects_staged: "Projects staged",
  opportunities_won: "Opportunities won",
  opportunities_lost: "Opportunities lost",
  open_opportunities: "Open opportunities",
  pipeline_cents: "Open pipeline",
  weighted_pipeline_cents: "Weighted pipeline",
  invoiced_cents: "Gross invoiced",
  cash_received_cents: "Gross cash received",
  cash_reversed_cents: "Cash reversals",
  credits_cents: "Credits issued",
  voided_cents: "Invoices voided",
  outstanding_ar_cents: "Outstanding receivables · current",
  customer_credit_cents: "Customer credit · current",
  current_valid_collected_cents: "Valid collected cash · current",
  unallocated_cents: "Unallocated cash · current",
  collectible_cents: "Collectible invoiced value · current",
  invoiced_projects: "Distinct invoiced projects · current",
  active_projects: "Active projects",
  realtors_created: "New realtor relationships",
  realtors_active: "Active realtor records",
  opportunities_created: "New opportunities",
  consultations_completed: "Consultations completed",
  consultations_scheduled: "Consultations scheduled",
  quotes_sent: "Quotes sent",
  quotes_accepted: "Quotes accepted",
  projects_created: "Projects created",
  projects_completed: "Projects completed",
  projects_cancelled: "Projects cancelled",
  projects_listing_live: "Listings live",
  projects_sold: "Properties sold",
  assets_available: "Available assets",
  assets_staged: "Staged assets",
  assets_missing: "Missing assets",
  assets_repair: "Assets in repair",
  assets_damaged: "Damaged assets",
  assets_inspection: "Assets in inspection",
  assets_cleaning: "Assets in cleaning",
  assets_eligible: "Eligible active assets",
  assets_eligible_staged: "Eligible staged assets",
  installations: "Installation movements",
  installed_units: "Units installed",
  inspections: "Inspections",
  unresolved_incidents: "Unresolved incidents",
  extensions_accepted: "Extensions accepted",
  accepted_extension_cents: "Accepted extension value",
  invoiced_extension_cents: "Extensions invoiced",
  invoiced_assessment_cents: "Damage charges invoiced",
  approved_damage_cents: "Damage charges approved",
  damage_charges_approved: "Approved damage charges",
  damage_waived: "Damage charges waived",
  damage_no_charge: "No-charge decisions",
  invoice_discounts_cents: "Invoice discounts",
  quote_discounts_cents: "Sent quote discounts",
  won_value_cents: "Won opportunity value",
  lost_value_cents: "Lost opportunity value",
  payments_received: "Payments received",
  payments_recorded: "Payment records created",
  accepted_contract_cents: "Accepted contract value",
  agreements_accepted: "Agreements accepted",
  allocations_cents: "Payment allocations",
  credits_count: "Credit notes",
  extension_days: "Extension days",
};
export const labelFor = (metric: string) =>
  metricLabels[metric] ?? metric.replaceAll("_", " ");
/** Descriptive definitions shared by M6 reporting and M8; arithmetic remains in M6. */
export const metricDefinitions = {
  win_rate:
    "Won opportunities divided by won plus lost opportunities in the selected period; undefined when there are no closed outcomes. Stored in basis points.",
  invoiced:
    "Gross issued invoice cents use the authoritative invoice issue date. Net invoiced subtracts credits and voids in their own event periods.",
  collected:
    "Gross cash received uses the authoritative payment receipt date. Net cash subtracts reversals in their own event periods; allocations do not create additional company cash.",
  ar: "Current outstanding receivables use M5 collectible invoice balances after payments and credits. Historical AR requires the separate historical reconstruction.",
  staged:
    "Projects staged counts the first authoritative staging event in the selected Vancouver business period; current staged status is a separate snapshot.",
} as const;
