import { z } from "zod";
import { addDays, day } from "../operations/model";

export const businessTimezone = "America/Vancouver";
const businessDate = z.iso.date();
const timestamp = z.iso.datetime({ offset: true });

/** Date-only source fields retain their precision; they are never parsed as UTC midnight. */
export type EventTime =
  { kind: "instant"; value: string } | { kind: "business_date"; value: string };

export function eventDay(event: EventTime): string {
  return event.kind === "business_date"
    ? businessDate.parse(event.value)
    : day(timestamp.parse(event.value));
}

export function periodKeys(event: EventTime) {
  const date = eventDay(event);
  const year = date.slice(0, 4);
  const quarter = Math.floor((Number(date.slice(5, 7)) - 1) / 3) + 1;
  return {
    day: date,
    month: date.slice(0, 7),
    quarter: `${year}-Q${quarter}`,
    year,
  };
}

export const periodInput = z.discriminatedUnion("period", [
  z
    .object({
      period: z.enum([
        "today",
        "this_week",
        "this_month",
        "previous_month",
        "quarter",
        "year",
      ]),
    })
    .strict(),
  z
    .object({
      period: z.literal("custom"),
      from: businessDate,
      until: businessDate,
    })
    .strict(),
]);
export type PeriodInput = z.infer<typeof periodInput>;
export type BusinessRange = {
  from: string;
  until: string;
  as_of: string;
  timezone: typeof businessTimezone;
};

/** Calendar-day arithmetic, independent of DST and the machine's local timezone. */
export function daysBetween(from: string, until: string) {
  const start = businessDate.parse(from),
    end = businessDate.parse(until);
  return (
    (Date.parse(`${end}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) /
    86400000
  );
}

/** Current presets are period-to-date; future scheduled workload uses a separate forecast. */
export function resolvePeriod(
  input: PeriodInput,
  serverNow: string,
): BusinessRange {
  const selection = periodInput.parse(input);
  const today = eventDay({ kind: "instant", value: serverNow });
  const monthStart = `${today.slice(0, 7)}-01`;
  let from = today,
    until = today;
  switch (selection.period) {
    case "today":
      break;
    case "this_week": {
      const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
      from = addDays(today, -((weekday + 6) % 7));
      break;
    }
    case "this_month":
      from = monthStart;
      break;
    case "previous_month":
      until = addDays(monthStart, -1);
      from = `${until.slice(0, 7)}-01`;
      break;
    case "quarter": {
      const month = Math.floor((Number(today.slice(5, 7)) - 1) / 3) * 3 + 1;
      from = `${today.slice(0, 4)}-${String(month).padStart(2, "0")}-01`;
      break;
    }
    case "year":
      from = `${today.slice(0, 4)}-01-01`;
      break;
    case "custom":
      from = selection.from;
      until = selection.until;
      break;
  }
  if (from > until || until > today || daysBetween(from, until) >= 366)
    throw new Error(
      "Select an ordered reporting range of at most 366 days, ending no later than today.",
    );
  return {
    from,
    until,
    as_of: timestamp.parse(serverNow),
    timezone: businessTimezone,
  };
}

export function includesEvent(range: BusinessRange, event: EventTime) {
  const date = eventDay(event);
  // A later instant on today's date is still future work, even in a period-to-date range.
  if (
    event.kind === "instant" &&
    Date.parse(event.value) > Date.parse(range.as_of)
  )
    return false;
  return date >= range.from && date <= range.until;
}
