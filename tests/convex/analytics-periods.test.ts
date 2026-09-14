import { describe, expect, it } from "vitest";
import {
  daysBetween,
  eventDay,
  includesEvent,
  periodInput,
  periodKeys,
  resolvePeriod,
} from "../../src/lib/analytics/periods";

describe("M6 authoritative business periods", () => {
  it("attributes the specified UTC October receipt to Vancouver September", () => {
    expect(
      periodKeys({ kind: "instant", value: "2026-10-01T06:30:00Z" }),
    ).toEqual({
      day: "2026-09-30",
      month: "2026-09",
      quarter: "2026-Q3",
      year: "2026",
    });
  });
  it("keeps a date-only receipt on its actual business date", () => {
    expect(eventDay({ kind: "business_date", value: "2026-09-30" })).toBe(
      "2026-09-30",
    );
  });
  it.each([
    ["2026-01-01T07:59:59Z", "2025-12-31"],
    ["2026-01-01T08:00:00Z", "2026-01-01"],
    ["2026-03-08T09:59:59Z", "2026-03-08"],
    ["2026-03-08T10:00:00Z", "2026-03-08"],
    ["2026-11-01T08:30:00Z", "2026-11-01"],
    ["2026-11-01T09:30:00Z", "2026-11-01"],
  ])("uses Vancouver boundaries for %s", (value, date) => {
    expect(eventDay({ kind: "instant", value })).toBe(date);
  });
  it("rejects timezone-free instants and invalid calendar dates", () => {
    expect(() =>
      eventDay({ kind: "instant", value: "2026-09-30T23:30:00" }),
    ).toThrow();
    expect(() =>
      eventDay({ kind: "business_date", value: "2026-02-30" }),
    ).toThrow();
  });
  it.each([
    ["today", "2026-09-16", "2026-09-16"],
    ["this_week", "2026-09-14", "2026-09-16"],
    ["this_month", "2026-09-01", "2026-09-16"],
    ["previous_month", "2026-08-01", "2026-08-31"],
    ["quarter", "2026-07-01", "2026-09-16"],
    ["year", "2026-01-01", "2026-09-16"],
  ] as const)("resolves %s from server time", (period, from, until) => {
    expect(resolvePeriod({ period }, "2026-09-17T06:30:00Z")).toMatchObject({
      from,
      until,
      timezone: "America/Vancouver",
    });
  });
  it("handles leap February and previous-year months", () => {
    expect(
      resolvePeriod({ period: "previous_month" }, "2024-03-15T12:00:00Z"),
    ).toMatchObject({ from: "2024-02-01", until: "2024-02-29" });
    expect(
      resolvePeriod({ period: "previous_month" }, "2026-01-15T12:00:00Z"),
    ).toMatchObject({ from: "2025-12-01", until: "2025-12-31" });
  });
  it("validates custom bounds including a full leap year", () => {
    const now = "2026-09-17T12:00:00Z";
    expect(
      resolvePeriod(
        { period: "custom", from: "2024-01-01", until: "2024-12-31" },
        now,
      ).from,
    ).toBe("2024-01-01");
    for (const [from, until] of [
      ["2024-01-01", "2025-01-01"],
      ["2026-09-17", "2026-09-16"],
      ["2026-09-17", "2026-09-18"],
    ]) {
      expect(() =>
        resolvePeriod({ period: "custom", from, until }, now),
      ).toThrow();
    }
  });
  it("does not count a future instant on the same business day", () => {
    const range = resolvePeriod({ period: "today" }, "2026-09-17T12:00:00Z");
    expect(
      includesEvent(range, { kind: "instant", value: "2026-09-17T13:00:00Z" }),
    ).toBe(false);
    expect(
      includesEvent(range, { kind: "instant", value: "2026-09-17T11:59:59Z" }),
    ).toBe(true);
    expect(
      includesEvent(range, { kind: "business_date", value: "2026-09-17" }),
    ).toBe(true);
    expect(
      includesEvent(range, { kind: "business_date", value: "2026-09-16" }),
    ).toBe(false);
  });
  it("counts calendar days across both daylight-saving transitions", () => {
    expect(daysBetween("2026-03-07", "2026-03-09")).toBe(2);
    expect(daysBetween("2026-10-31", "2026-11-02")).toBe(2);
  });
  it("rejects unexpected fields rather than accepting client-supplied processing time", () => {
    expect(() =>
      periodInput.parse({ period: "today", as_of: "2020-01-01" }),
    ).toThrow();
  });
});
it("aligns MTD comparisons to the preceding calendar month and clamps leap days", async () => {
  const { comparisonRange } = await import("../../src/lib/analytics/periods");
  expect(
    comparisonRange(
      { period: "this_month" },
      resolvePeriod({ period: "this_month" }, "2026-09-14T18:00:00Z"),
    ),
  ).toEqual({ from: "2026-08-01", until: "2026-08-14" });
  expect(
    comparisonRange(
      { period: "year" },
      resolvePeriod({ period: "year" }, "2024-02-29T18:00:00Z"),
    ),
  ).toEqual({ from: "2023-01-01", until: "2023-02-28" });
});
