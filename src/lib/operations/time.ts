// Operational clock values always use the business timezone, never the browser's timezone.
export function vancouverLocal(value: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(value));
  const p = (key: string) => parts.find((x) => x.type === key)?.value;
  return `${p("year")}-${p("month")}-${p("day")}T${p("hour")}:${p("minute")}`;
}
export function vancouverUtc(value: string) {
  if (!value) return "";
  const candidates = ["-07:00", "-08:00"]
    .map((offset) => new Date(value + offset))
    .filter(
      (d) =>
        !Number.isNaN(d.getTime()) && vancouverLocal(d.toISOString()) === value,
    );
  if (candidates.length !== 1)
    throw new Error(
      "Choose an unambiguous Vancouver time outside the daylight-saving clock change.",
    );
  return candidates[0].toISOString();
}
