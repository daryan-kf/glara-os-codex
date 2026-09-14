import { z } from "zod";
import { periodKeys, type EventTime } from "./periods";

export const dimensionNames = [
  "salesperson",
  "realtor",
  "lead_source",
  "city",
  "project",
  "product",
  "category",
  "method",
  "due_date",
] as const;
export type Dimension = (typeof dimensionNames)[number];
export type Dimensions = Partial<Record<Dimension, string>>;
export type Fact = {
  key: string;
  metric: string;
  scope: "flow" | "outcome" | "current";
  event_at: string;
  precision: EventTime["kind"];
  day: string;
  month: string;
  value: string;
  dimensions: Dimensions;
  href: string;
  label: string;
};
export const integer = z.string().regex(/^-?(0|[1-9]\d*)$/);
export function fact(input: Omit<Fact, "day" | "month">): Fact {
  integer.parse(input.value);
  const keys = periodKeys({ kind: input.precision, value: input.event_at });
  return {
    ...input,
    day: input.scope === "current" ? "current" : keys.day,
    month: input.scope === "current" ? "current" : keys.month,
  };
}
export function axesFor(metric: string): readonly Dimension[] {
  if (
    /^(assets_|asset_|quantity_|reserved_quantity_|inventory_|incidents_|installations$|installed_units$|inspections$|unresolved_incidents$)/.test(
      metric,
    )
  )
    return ["product", "category", "project", "city"];
  const axes: Dimension[] = [
    "salesperson",
    "realtor",
    "lead_source",
    "city",
    "project",
  ];
  if (
    /^(cash_|payments_|unallocated_cents$|current_valid_collected_cents$|allocations_cents$)/.test(
      metric,
    )
  )
    axes.push("method");
  if (
    metric === "outstanding_ar_cents" ||
    metric === "followups_open" ||
    metric.startsWith("next_action_")
  )
    axes.push("due_date");
  return axes;
}
export function contributionKeys(f: Fact) {
  const dimensions = [
    ["company", "all"],
    ...axesFor(f.metric).map((k) => [k, f.dimensions[k] ?? "unknown"]),
  ] as const;
  const periods =
    f.scope === "current"
      ? [["current", "current"]]
      : [
          ["day", f.day],
          ["month", f.month],
        ];
  return periods.flatMap(([grain, period]) =>
    dimensions.map(([dimension, member]) => ({
      key: JSON.stringify([grain, period, f.metric, dimension, member]),
      grain,
      period,
      metric: f.metric,
      dimension,
      member,
      value: f.value,
    })),
  );
}
/** Net changes collapse before writes, so a same-month date correction does not churn monthly totals. */
export function bucketChanges(before: Fact[], after: Fact[]) {
  const changes = new Map<
    string,
    ReturnType<typeof contributionKeys>[number]
  >();
  for (const [facts, sign] of [
    [before, -1n],
    [after, 1n],
  ] as const) {
    for (const f of facts)
      for (const c of contributionKeys(f)) {
        const old = changes.get(c.key);
        changes.set(c.key, {
          ...c,
          value: String(BigInt(old?.value ?? "0") + sign * BigInt(c.value)),
        });
      }
  }
  return [...changes.values()].filter((c) => c.value !== "0");
}
export function exactWeighted(value: string, probability: number) {
  if (!Number.isInteger(probability) || probability < 0 || probability > 100)
    throw Error("Invalid probability");
  return String(
    (BigInt(integer.parse(value)) * BigInt(probability) + 50n) / 100n,
  );
}
export function ratio(
  numerator: string | number,
  denominator: string | number,
): string | null {
  const n = BigInt(numerator),
    d = BigInt(denominator);
  return d === 0n ? null : String((n * 10000n + d / 2n) / d);
}
export function change(current: string, previous: string) {
  const difference = BigInt(current) - BigInt(previous);
  return {
    difference: String(difference),
    percent_basis_points:
      previous === "0"
        ? null
        : String(
            (difference * 10000n) /
              (BigInt(previous) < 0n ? -BigInt(previous) : BigInt(previous)),
          ),
  };
}
export const targetInput = z
  .object({
    minimum: z.number().int().min(0).max(10000),
    target: z.number().int().min(1).max(10000),
    stretch: z.number().int().min(1).max(10000),
    unused_days: z.number().int().min(1).max(3650),
    stale_sales_days: z.number().int().min(1).max(365),
    high_value_cents: integer.refine((v) => BigInt(v) >= 0n),
    vip_projects: z.number().int().min(1).max(1000),
    vip_value_cents: integer.refine((v) => BigInt(v) >= 0n),
    dormant_days: z.number().int().min(1).max(3650),
  })
  .strict()
  .refine(
    (v) => v.minimum <= v.target && v.target <= v.stretch,
    "Targets must be ordered",
  );
export const defaultTargets = {
  minimum: 20,
  target: 35,
  stretch: 50,
  unused_days: 90,
  stale_sales_days: 14,
  high_value_cents: "1000000",
  vip_projects: 3,
  vip_value_cents: "1500000",
  dormant_days: 90,
};
