import { z } from "zod";
export const categories = [
  "transactional",
  "sales_relationship",
  "commercial_marketing",
] as const;
export const states = [
  "draft",
  "pending_approval",
  "approved",
  "queued",
  "sent",
  "delivered",
  "cancelled",
  "failed",
  "bounced",
  "suppressed",
  "ineligible",
  "needs_review",
  "delivery_unknown",
] as const;
export const bases = [
  "express_consent",
  "existing_business_relationship",
  "existing_non_business_relationship",
  "transactional_service",
  "recipient_requested",
  "other_documented_basis",
  "unknown",
] as const;
export const scopes = [
  "transactional",
  "sales_relationship",
  "commercial_marketing",
  "all_optional",
  "all",
] as const;
export type Category = (typeof categories)[number];
export type State = (typeof states)[number];
export type Scope = (typeof scopes)[number];
export const POLICY_VERSION = "M9-conservative-1";
export const header = z
  .string()
  .trim()
  .min(1)
  .max(180)
  .refine(
    (s) => !/[\x00-\x1f\x7f]/.test(s),
    "Use a single line without control characters.",
  );
export const content = z
  .object({
    subject: header,
    body: z
      .string()
      .trim()
      .min(1)
      .max(12000)
      .refine((s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(s)),
  })
  .strict();
export const normalizeEmail = (value: string) =>
  z.email().max(254).parse(value.trim().toLowerCase());
export function covers(scope: Scope, category: Category) {
  return (
    scope === "all" ||
    scope === category ||
    (scope === "all_optional" && category !== "transactional")
  );
}
export function deliveryState(
  current: State,
  event:
    | "accepted"
    | "delivered"
    | "hard_bounce"
    | "soft_bounce"
    | "complaint"
    | "failed",
): State {
  if (event === "hard_bounce" || event === "complaint") return "bounced";
  if (current === "bounced" || current === "delivered") return current;
  if (event === "delivered") return "delivered";
  if (event === "failed" || current === "failed") return "failed";
  if (event === "accepted") return "sent";
  return current;
}
export function render(template: string, facts: Record<string, string>) {
  const rendered = template.replace(/\{\{([a-z_]+)\}\}/g, (_, key: string) => {
    if (!(key in facts)) throw new Error("Unsupported template field");
    return facts[key];
  });
  if (/[{}]/.test(rendered)) throw new Error("Unresolved template field");
  return rendered;
}
export const editable = (state: State) =>
  [
    "draft",
    "pending_approval",
    "needs_review",
    "ineligible",
    "suppressed",
  ].includes(state);

export const kinds = [
  "realtor_followup",
  "quote_followup",
  "consultation_confirmation",
  "project_update",
  "staging_confirmation",
  "destaging_coordination",
  "package_extension",
  "invoice_reminder",
  "payment_acknowledgement",
  "thank_you",
  "other_transactional",
] as const;
