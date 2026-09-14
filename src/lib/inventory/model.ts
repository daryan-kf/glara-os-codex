import { z } from "zod";

export const conditions = [
  "new",
  "excellent",
  "good",
  "fair",
  "poor",
  "damaged",
] as const;
export const assetStates = [
  "available",
  "in_transit",
  "staged",
  "returning",
  "inspection",
  "cleaning",
  "repair",
  "damaged",
  "missing",
  "sold",
  "retired",
] as const;
export const stockStates = [
  "available",
  "inspection",
  "cleaning",
  "repair",
  "damaged",
  "missing",
  "sold",
  "retired",
] as const;
export const reservationStates = [
  "planned",
  "reserved",
  "picked",
  "installed",
  "returning",
  "inspection",
  "cleaning",
  "repair",
  "damaged",
  "missing",
  "released",
  "resolved",
] as const;
export const movementTypes = [
  "received",
  "transfer",
  "reserve",
  "release_reservation",
  "stage_out",
  "installed",
  "destage",
  "returned",
  "inspection_hold",
  "inspection_release",
  "cleaning",
  "repair",
  "damage",
  "missing",
  "found",
  "sold",
  "retired",
  "adjustment",
  "exception",
] as const;
export const locationTypes = [
  "store",
  "warehouse",
  "staging_storage",
  "other",
] as const;
export const damageStatuses = [
  "reported",
  "assessed",
  "repair",
  "resolved",
  "written_off",
] as const;
export const damageTransitions: Record<
  (typeof damageStatuses)[number],
  readonly (typeof damageStatuses)[number][]
> = {
  reported: ["assessed", "written_off"],
  assessed: ["repair", "resolved", "written_off"],
  repair: ["resolved", "written_off"],
  resolved: [],
  written_off: [],
};
export type Condition = (typeof conditions)[number];
export type ReservationState = (typeof reservationStates)[number];
export type StockState = (typeof stockStates)[number];
export const quantity = z.number().int().min(1).max(100000);
export const text = z.string().trim().max(2000);
export const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const d = new Date(value + "T12:00:00Z");
    return (
      Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value
    );
  });
export const windowSchema = z
  .object({ needed_from: day, needed_until: day })
  .refine((w) => w.needed_from <= w.needed_until);
export const productInput = z
  .object({
    sku: z
      .string()
      .trim()
      .transform((s) => s.toUpperCase())
      .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9._-]{1,63}$/)),
    name: z.string().trim().min(1).max(160),
    brand: text.default(""),
    collection: text.default(""),
    description: text.default(""),
    color: z.string().trim().max(80).default(""),
    material: text.default(""),
    dimensions: z.string().trim().max(160).default(""),
    weight: z.string().trim().max(80).default(""),
    track_mode: z.enum(["serialized", "quantity"]),
    staging_eligible: z.boolean(),
    retail_eligible: z.boolean(),
    active: z.boolean(),
  })
  .strict();
export const usable = (condition: Condition) =>
  ["new", "excellent", "good", "fair"].includes(condition);
export const liveReservation = (state: ReservationState) =>
  !["released", "resolved"].includes(state);

/** Inclusive business dates. Ends are processed after starts on the same day. */
export function peakDemand(
  rows: readonly {
    needed_from: string;
    needed_until: string;
    quantity: number;
  }[],
  from: string,
  until: string,
): number {
  const events: { date: string; delta: number }[] = [];
  for (const row of rows) {
    if (row.needed_until < from || row.needed_from > until) continue;
    events.push({
      date: row.needed_from < from ? from : row.needed_from,
      delta: row.quantity,
    });
    events.push({
      date: row.needed_until > until ? until : row.needed_until,
      delta: -row.quantity,
    });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || b.delta - a.delta);
  let current = 0,
    peak = 0;
  for (const e of events) {
    current += e.delta;
    peak = Math.max(peak, current);
  }
  return peak;
}
export function readiness(
  rows: readonly {
    state: ReservationState;
    quantity: number;
    shortage?: boolean;
    exception?: string;
    exception_approved?: boolean;
  }[],
) {
  const live = rows.filter((r) => liveReservation(r.state));
  if (!rows.length) return "not_started";
  if (!live.length) return "reconciled";
  if (
    live.some(
      (r) =>
        ["missing", "damaged"].includes(r.state) ||
        r.shortage ||
        (r.exception &&
          !r.exception_approved &&
          ["planned", "reserved"].includes(r.state)),
    )
  )
    return "exception";
  if (
    live.some((r) =>
      ["returning", "inspection", "cleaning", "repair"].includes(r.state),
    )
  )
    return "returning";
  if (live.every((r) => r.state === "installed")) return "installed";
  if (live.every((r) => ["picked", "installed"].includes(r.state)))
    return "ready";
  if (live.some((r) => ["picked", "installed"].includes(r.state)))
    return "picking";
  if (live.every((r) => r.state === "reserved")) return "reserved";
  return "planning";
}
