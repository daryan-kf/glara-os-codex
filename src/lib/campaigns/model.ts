import { productionCapabilityAllowed } from "../security/preflight";
import { z } from "zod";
export const campaignRoles = ["owner", "admin", "marketing"] as const;
export const managerRoles = ["owner", "admin"] as const;
export const statuses = [
  "draft",
  "scheduled",
  "open",
  "closed",
  "drawn",
  "completed",
  "cancelled",
] as const;
export const eligibility = [
  "pending",
  "eligible",
  "ineligible",
  "selected_pending_verification",
  "confirmed_winner",
  "disqualified",
] as const;
export const listingRanges = ["1–5", "6–10", "11–20", "21+"] as const;
const line = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((s) => !/[\x00-\x1f\x7f<>]/.test(s));
export const campaignInput = z
  .object({
    name: line,
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .min(3)
      .max(80),
    public_title: line,
    public_description: z.string().trim().max(2000),
    prize_name: line,
    prize_value_cents: z.number().int().min(1).max(10000000),
    starts_at: z.number().int().positive().max(8640000000000000),
    closes_at: z.number().int().positive().max(8640000000000000),
    eligibility_summary: z.string().trim().max(3000),
    eligible_cities: z.array(line).min(1).max(80),
    official_rules: z.string().trim().max(20000),
    rules_version: line,
    privacy_notice: z.string().trim().max(6000),
    consent_text: z.string().trim().max(3000),
    prize_terms: z.string().trim().max(6000),
    prize_terms_version: line,
    prize_expires_at: z.number().int().positive().max(8640000000000000),
    skill_question_required: z.boolean(),
    assigned_to: z.string().min(1),
    legal_approved: z.boolean(),
  })
  .strict()
  .refine(
    (d) => d.closes_at > d.starts_at && d.prize_expires_at > d.closes_at,
    "Check campaign and prize dates.",
  );
export const registrationInput = z
  .object({
    slug: z.string().min(3).max(80),
    first_name: line,
    last_name: line,
    brokerage: line,
    email: z
      .email()
      .max(254)
      .transform((s) => s.trim().toLowerCase()),
    phone: z
      .string()
      .max(30)
      .transform((s) => s.replace(/\D/g, ""))
      .refine(
        (s) => /^(?:1)?[2-9]\d{2}[2-9]\d{6}$/.test(s),
        "Enter a valid Canadian mobile number.",
      ),
    city: line,
    licensed_realtor: z.boolean(),
    annual_listings: z.enum(listingRanges),
    rules_version: line,
    rules_accepted: z.literal(true),
    marketing_consent: z.boolean(),
    source: z.enum(["expo_qr", "booth", "day_1", "day_2", "direct"]),
    utm_source: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{0,80}$/)
      .default(""),
    utm_medium: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{0,80}$/)
      .default(""),
    utm_campaign: z
      .string()
      .regex(/^[a-zA-Z0-9_-]{0,80}$/)
      .default(""),
    website: z.string().max(200).default(""),
    started_at: z.number().int().positive().max(8640000000000000),
  })
  .strict();
export const phoneIdentity = (phone: string) =>
  phone.replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");
export function eventDay(starts: number, entered: number) {
  const date = (ms: number) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Vancouver",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(ms);
  const start = date(starts),
    at = date(entered);
  const days = Math.round((Date.parse(at) - Date.parse(start)) / 86400000);
  return days === 0 ? "day_1" : days === 1 ? "day_2" : "other";
}
export function priority(range: string) {
  return range === "21+" ? "High" : range === "11–20" ? "Medium" : "Standard";
}
export function intakeEnabled(env: Record<string, string | undefined>) {
  if (
    env.GLARA_EXPO_ENABLED !== "true" ||
    env.GLARA_RECOVERY_MODE === "true" ||
    !["development", "production"].includes(env.GLARA_ENVIRONMENT ?? "") ||
    !productionCapabilityAllowed(env, "expo")
  )
    return false;
  return (
    env.GLARA_ENVIRONMENT === "development" ||
    env.GLARA_PRODUCTION_EXPO_APPROVED === "true"
  );
}
