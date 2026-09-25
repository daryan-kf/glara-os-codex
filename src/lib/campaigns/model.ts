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
    eligible_cities: z.array(line).max(80),
    eligible_province: z.literal("BC").optional(),
    official_rules: z.string().trim().max(20000),
    rules_version: line,
    privacy_notice: z.string().trim().max(6000),
    consent_text: z.string().trim().max(3000),
    prize_terms: z.string().trim().max(6000),
    prize_terms_version: line,
    prize_expires_at: z
      .number()
      .int()
      .positive()
      .max(8640000000000000)
      .optional(),
    expiry_months_after_confirmation: z.literal(6).optional(),
    skill_question_required: z.boolean(),
    assigned_to: z.string().min(1),
    legal_approved: z.boolean(),
  })
  .strict()
  .refine(
    (d) =>
      d.closes_at > d.starts_at &&
      (d.eligible_province === "BC"
        ? d.eligible_cities.length === 0
        : d.eligible_cities.length > 0) &&
      (d.expiry_months_after_confirmation === 6
        ? d.prize_expires_at === undefined
        : (d.prize_expires_at ?? 0) > d.closes_at),
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
    licensed_in_bc: z.boolean().optional(),
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
      timeZone: campaignPacificZone(ms),
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
export function campaignPublicationAllowed(
  env: Record<string, string | undefined>,
) {
  if (
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

export function intakeEnabled(env: Record<string, string | undefined>) {
  return env.GLARA_EXPO_ENABLED === "true" && campaignPublicationAllowed(env);
}

// Eligibility declarations are entry-time facts; final BC licence verification remains mandatory.
export function campaignEligible(
  c: { eligible_province?: "BC"; eligible_cities: string[] },
  e: { licensed_realtor: boolean; licensed_in_bc?: boolean; city: string },
) {
  return (
    e.licensed_realtor &&
    (c.eligible_province === "BC"
      ? e.licensed_in_bc === true
      : c.eligible_cities.some(
          (city) => city.toLowerCase() === e.city.toLowerCase(),
        ))
  );
}
// Vancouver adopted permanent UTC-7 on 2026-03-08. Pin that enacted rule for
// runtimes whose ICU database still predicts winter UTC-8. Older dates retain
// historical Vancouver rules. Source: https://news.gov.bc.ca/releases/2026CITZ0009-001073
// Six calendar months, clamped at month end; historical DST overlaps use the
// earlier occurrence and historical spring gaps advance by one hour.
export const campaignPacificZone = (time: number) =>
  time >= Date.parse("2026-03-08T10:00:00Z")
    ? "Etc/GMT+7"
    : "America/Vancouver";
export function sixMonthExpiry(confirmedAt: number) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: campaignPacificZone(confirmedAt),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(confirmedAt);
  const part = (key: string) =>
    Number(parts.find((x) => x.type === key)!.value);
  const month = new Date(Date.UTC(part("year"), part("month") - 1 + 6, 1));
  const day = Math.min(
    part("day"),
    new Date(
      Date.UTC(month.getUTCFullYear(), month.getUTCMonth() + 1, 0),
    ).getUTCDate(),
  );
  const wall = new Date(
    Date.UTC(
      month.getUTCFullYear(),
      month.getUTCMonth(),
      day,
      part("hour"),
      part("minute"),
      part("second"),
      confirmedAt % 1000,
    ),
  );
  const localParts = (time: number) =>
    new Intl.DateTimeFormat("sv-SE", {
      timeZone: campaignPacificZone(time),
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .format(time)
      .replace(" ", "T");
  for (const shift of [0, 3600000]) {
    const target = new Date(wall.getTime() + shift).toISOString().slice(0, 19);
    for (const offset of [7, 8]) {
      const candidate = wall.getTime() + shift + offset * 3600000;
      if (localParts(candidate) === target) return candidate;
    }
  }
  throw new Error("Unable to determine Vancouver prize expiry");
}
