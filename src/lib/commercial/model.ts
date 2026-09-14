import { z } from "zod";
import { cents, money } from "../sales/model";
export { cents, decimal, dollars } from "../sales/model";
export const date = z.iso.date();
const text = (max = 2000) => z.string().trim().max(max).default("");
export const billTo = z
  .object({
    type: z.enum(["realtor", "seller", "brokerage", "company", "other"]),
    name: z.string().trim().min(1).max(200),
    contact: text(200),
    email: z.union([z.email(), z.literal("")]),
    phone: text(40),
    address: z.string().trim().min(1).max(500),
    company: text(200),
  })
  .strict();
export const taxInput = z
  .object({
    name: z.string().trim().min(1).max(40),
    basis_points: z.number().int().min(0).max(10000),
  })
  .strict();
export const taxesInput = z
  .array(taxInput)
  .max(5)
  .refine(
    (xs) => new Set(xs.map((x) => x.name.toLowerCase())).size === xs.length,
    "Tax names must be unique.",
  );
export const itemInput = z
  .object({
    description: z.string().trim().min(1).max(500),
    quantity: z.number().int().min(1).max(1000),
    unit_amount: money,
    discount: money.default("0"),
    taxes: taxesInput,
  })
  .strict();
export const invoiceInput = z
  .object({
    issue_date: date,
    due_date: date,
    notes: text(),
    items: z.array(itemInput).min(1).max(50),
  })
  .strict()
  .refine((x) => x.due_date >= x.issue_date);
export const agreementInput = z
  .object({
    effective_date: date,
    staging_start_date: date,
    package_end_date: date,
    description: z.string().trim().min(1).max(500),
    scope: text(8000),
    subtotal: money,
    discount: money,
    taxes: taxesInput,
    deposit_type: z.enum(["fixed", "percentage"]),
    deposit_value: money,
    payment_terms: text(4000),
    extension_terms: text(4000),
    cancellation_terms: text(4000),
    liability_terms: text(4000),
    special_terms: text(4000),
    override_reason: text(),
  })
  .strict()
  .refine((x) => x.package_end_date >= x.staging_start_date);
export const evidenceInput = z
  .object({
    name: z.string().trim().min(1).max(200),
    email: z.union([z.email(), z.literal("")]),
    method: z.enum(["manual_record", "electronic_acknowledgement", "other"]),
    reference: z.string().trim().min(3).max(1000),
  })
  .strict();
export const paymentMethods = [
  "cash",
  "cheque",
  "e_transfer",
  "credit_card",
  "debit",
  "bank_transfer",
  "other",
] as const;
export const liabilityBases = [
  "client_damage",
  "homeowner_damage",
  "realtor_responsibility",
  "guest_or_occupant_damage",
  "normal_wear",
  "glara_handling",
  "transport_damage",
  "pre_existing",
  "unknown",
  "goodwill_waiver",
  "other",
] as const;
export const valuationBases = [
  "repair_cost",
  "replacement_cost",
  "depreciated_replacement",
  "contractual",
  "negotiated",
  "waived",
  "other",
] as const;
export const assessmentInput = z
  .object({
    liability_basis: z.enum(liabilityBases),
    valuation_basis: z.enum(valuationBases),
    notes: z.string().trim().min(3).max(2000),
    description: z.string().trim().min(3).max(500),
    proposed_amount: money,
    taxes: taxesInput,
  })
  .strict();
export const extensionInput = z
  .object({
    new_end_date: date,
    type: z.enum(["monthly", "weekly", "custom"]),
    rate: money,
    quantity: z.number().int().min(1).max(120),
    taxes: taxesInput,
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();
export const settingsInput = z
  .object({
    taxes: taxesInput,
    payment_terms: text(4000),
    extension_terms: text(4000),
    deposit_type: z.enum(["fixed", "percentage"]),
    deposit_value: money,
  })
  .strict();
export function totals(
  subtotal: bigint,
  discount: bigint,
  taxes: z.infer<typeof taxesInput>,
) {
  if (discount > subtotal) throw Error("Discount exceeds subtotal");
  const tax_lines = taxes.map((t) => ({
    ...t,
    amount_cents: String(
      ((subtotal - discount) * BigInt(t.basis_points) + 5000n) / 10000n,
    ),
  }));
  const tax = tax_lines.reduce((n, t) => n + BigInt(t.amount_cents), 0n),
    total = subtotal - discount + tax;
  if (total > 99999999999999n) throw Error("Amount exceeds supported limit");
  return {
    subtotal_cents: String(subtotal),
    discount_cents: String(discount),
    tax_lines,
    tax_cents: String(tax),
    total_cents: String(total),
  };
}
export function agreementMath(input: z.infer<typeof agreementInput>) {
  const a = totals(cents(input.subtotal), cents(input.discount), input.taxes);
  const total = BigInt(a.total_cents),
    value = cents(input.deposit_value);
  if (input.deposit_type === "percentage" && value > 10000n)
    throw Error("Invalid percentage");
  const deposit =
    input.deposit_type === "fixed" ? value : (total * value + 5000n) / 10000n;
  if (deposit > total) throw Error("Deposit exceeds total");
  return { ...a, deposit_cents: String(deposit) };
}
export function itemMath(input: z.infer<typeof itemInput>) {
  return {
    ...totals(
      cents(input.unit_amount) * BigInt(input.quantity),
      cents(input.discount),
      input.taxes,
    ),
    description: input.description,
    quantity: input.quantity,
    unit_amount_cents: String(cents(input.unit_amount)),
  };
}
export function sumItems(items: ReturnType<typeof itemMath>[]) {
  const tax_lines: ReturnType<typeof totals>["tax_lines"] = [];
  for (const i of items)
    for (const t of i.tax_lines) {
      const existing = tax_lines.find(
        (x) => x.name === t.name && x.basis_points === t.basis_points,
      );
      if (existing)
        existing.amount_cents = String(
          BigInt(existing.amount_cents) + BigInt(t.amount_cents),
        );
      else tax_lines.push({ ...t });
    }
  const sum = (
    key: "subtotal_cents" | "discount_cents" | "tax_cents" | "total_cents",
  ) => String(items.reduce((n, i) => n + BigInt(i[key]), 0n));
  return {
    subtotal_cents: sum("subtotal_cents"),
    discount_cents: sum("discount_cents"),
    tax_cents: sum("tax_cents"),
    total_cents: sum("total_cents"),
    tax_lines,
  };
}
export function balances(
  total: string,
  paid: bigint,
  credits: bigint,
  status: string,
  due: string,
  today: string,
) {
  const collectible = status === "issued" ? BigInt(total) - credits : 0n;
  const balance = collectible > paid ? collectible - paid : 0n,
    excess =
      status === "issued" && paid > collectible ? paid - collectible : 0n;
  return {
    paid_cents: String(paid),
    credit_cents: String(credits),
    balance_cents: String(balance),
    credit_balance_cents: String(excess),
    effective_status:
      status !== "issued"
        ? status
        : credits === BigInt(total)
          ? "credited"
          : balance === 0n
            ? "paid"
            : due < today
              ? "overdue"
              : paid > 0n
                ? "partially_paid"
                : "issued",
  };
}
/** Reference fields deliberately reject card-number-like digit sequences. No processor credentials are accepted. */
export const safeReference = z
  .string()
  .trim()
  .max(200)
  .refine(
    (s) => !/(?:\d[ -]?){13,19}/.test(s),
    "Use a receipt reference, never a card number.",
  );

// Largest remainder allocation keeps every cent and never creates negative net tax splits.
export function apportion(amount: bigint, weights: bigint[]): bigint[] {
  const total = weights.reduce((n, w) => n + w, 0n);
  if (
    amount < 0n ||
    total <= 0n ||
    amount > total ||
    weights.some((w) => w < 0n)
  )
    throw Error("Invalid allocation");
  const result = weights.map((w) => (amount * w) / total);
  let left = amount - result.reduce((n, w) => n + w, 0n);
  const order = weights
    .map((w, index) => ({ index, remainder: (amount * w) % total }))
    .sort((a, b) =>
      a.remainder === b.remainder
        ? a.index - b.index
        : a.remainder > b.remainder
          ? -1
          : 1,
    );
  for (const entry of order) {
    if (left === 0n) break;
    result[entry.index]++;
    left--;
  }
  return result;
}
