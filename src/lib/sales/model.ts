import { z } from "zod";
import { recordId } from "../crm/model";
export const stages = [
  "new",
  "contacted",
  "interested",
  "consultation",
  "quote_sent",
  "negotiation",
  "won",
  "lost",
] as const;
export type Stage = (typeof stages)[number];
export const lossReasons = [
  "price",
  "competitor",
  "seller_declined",
  "already_staged",
  "timing",
  "no_response",
  "diy",
  "listing_cancelled",
  "property_sold",
  "other",
] as const;
export const propertyTypes = [
  "detached",
  "townhouse",
  "condo",
  "duplex",
  "apartment",
  "luxury_estate",
  "other",
] as const;
export const occupancies = [
  "vacant",
  "occupied",
  "partially_furnished",
  "unknown",
] as const;
export const active = (stage: Stage) => stage !== "won" && stage !== "lost";
export function transitions(stage: Stage): Stage[] {
  const i = stages.indexOf(stage);
  return active(stage)
    ? [
        ...(i > 0 ? [stages[i - 1]] : []),
        ...(i < 5 ? [stages[i + 1]] : ["won" as const]),
        "lost",
      ]
    : ["contacted"];
}
export const money = z
  .string()
  .regex(
    /^(0|[1-9]\d{0,8})(\.\d{1,2})?$/,
    "Use a non-negative amount with at most two decimals.",
  );
export function cents(value: string): bigint {
  const [whole, fraction = ""] = money.parse(value).split(".");
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0"));
}
export function decimal(value: string | bigint): string {
  const raw = BigInt(value),
    n = raw < 0n ? -raw : raw;
  return `${raw < 0n ? "-" : ""}${n / 100n}.${(n % 100n).toString().padStart(2, "0")}`;
}
export function dollars(value: string): string {
  const [whole, fraction] = decimal(value).split(".");
  return "$" + whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + fraction;
}
const text = (max: number) => z.string().trim().max(max).default("");
const date = z.union([z.iso.date(), z.literal("")]).default("");
const time = z.iso.datetime({ offset: true });
const optionalNumber = (max: number) =>
  z.union([z.literal(""), z.coerce.number().min(0).max(max)]).default("");
export const propertyInput = z.object({
  address_line_1: z.string().trim().min(3).max(250),
  address_line_2: text(100),
  city: z.string().trim().min(2).max(100),
  province: z.string().trim().min(2).max(80).default("BC"),
  postal_code: text(20),
  property_type: z.enum(propertyTypes),
  occupancy_status: z.enum(occupancies),
  bedrooms: optionalNumber(100),
  bathrooms: optionalNumber(100),
  square_feet: optionalNumber(1000000),
  listing_price: z.union([money, z.literal("")]).default(""),
  mls_number: text(50),
  listing_date: date,
  realtor_id: recordId,
  seller_name: text(200),
  notes: text(10000),
});
export const opportunityInput = z
  .object({
    property_id: recordId,
    assigned_to: recordId,
    estimated_value: money,
    probability: z.coerce.number().int().min(0).max(100),
    expected_close_date: date,
    lead_source_id: z.union([recordId, z.literal("")]).default(""),
    notes: text(10000),
    next_action_title: text(200),
    next_action_date: z.union([time, z.literal("")]).default(""),
  })
  .refine((d) => !!d.next_action_title === !!d.next_action_date, {
    message: "Provide both next action and date.",
    path: ["next_action_date"],
  });
export const stageInput = z
  .object({
    stage: z.enum(stages),
    lost_reason: z.union([z.enum(lossReasons), z.literal("")]).default(""),
    lost_notes: text(2000),
    next_action_title: text(200),
    next_action_date: z.union([time, z.literal("")]).default(""),
  })
  .refine((d) => d.stage !== "lost" || !!d.lost_reason, {
    message: "Choose a loss reason.",
    path: ["lost_reason"],
  });
export const consultationInput = z.object({
  opportunity_id: recordId,
  scheduled_at: time,
  assigned_to: recordId,
  consultation_type: z.enum(["onsite", "virtual", "phone", "office", "other"]),
  notes: text(10000),
});
export const actionInput = z
  .object({
    opportunity_id: z.union([recordId, z.literal("")]).default(""),
    property_id: z.union([recordId, z.literal("")]).default(""),
    title: z.string().trim().min(1).max(200),
    due_at: time,
    assigned_to: recordId,
    description: text(10000),
  })
  .refine((d) => !!d.opportunity_id !== !!d.property_id, {
    message: "Choose exactly one activity parent.",
  });
export const quoteTypes = ["staging", "rental", "sale"] as const;
export const itemInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.coerce.number().int().min(1).max(1000),
  unit_price: money,
  // "monthly" lines bill once per rental month; "item" lines bill once.
  kind: z.enum(["item", "monthly"]).default("item"),
  product_id: z.union([recordId, z.literal("")]).default(""),
});
export const quoteInput = z
  .object({
    opportunity_id: recordId,
    quote_type: z.enum(quoteTypes).default("staging"),
    rental_months: z.coerce.number().int().min(1).max(24).default(1),
    items: z.array(itemInput).min(1).max(50),
    discount: money,
    tax_rate: z
      .string()
      .regex(
        /^(0|[1-9]\d?)(\.\d{1,2})?$|^100(\.00?)?$/,
        "Tax rate must be 0–100%.",
      ),
    valid_until: z.iso.date(),
  })
  .refine(
    (d) => d.quote_type !== "sale" || d.items.every((i) => i.kind === "item"),
    { message: "Sale quotes bill every line once." },
  );
export function quoteMath(data: z.infer<typeof quoteInput>) {
  const months = BigInt(data.rental_months);
  const lines = data.items.map(
    (i) =>
      cents(i.unit_price) *
      BigInt(i.quantity) *
      (i.kind === "monthly" ? months : 1n),
  );
  const subtotal = lines.reduce((a, b) => a + b, 0n),
    discount = cents(data.discount);
  if (discount > subtotal) throw new Error("Discount exceeds subtotal.");
  const rate = cents(data.tax_rate);
  const tax = ((subtotal - discount) * rate + 5000n) / 10000n;
  return {
    lines: lines.map(String),
    subtotal_cents: String(subtotal),
    discount_cents: String(discount),
    tax_cents: String(tax),
    total_cents: String(subtotal - discount + tax),
    tax_basis_points: Number(rate),
  };
}
export const label = (s: string) =>
  s.replaceAll("_", " ").replace(/\b\w/g, (c) => c.toUpperCase());
