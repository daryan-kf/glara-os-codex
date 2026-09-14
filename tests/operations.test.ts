import { test } from "node:test";
import assert from "node:assert/strict";
import { attention, day, graph, dateInput } from "../src/lib/operations/model";
test("Vancouver business dates and date-only validation avoid ambiguous timestamps", () => {
  assert.equal(day("2026-09-13T03:00:00Z"), "2026-09-12");
  assert.equal(dateInput.safeParse("2026-02-30").success, false);
  assert.equal(dateInput.safeParse("2026-02-28").success, true);
});
test("risk is derived from overdue work, sold handoff and configurable package thresholds", () => {
  const today = "2026-09-13",
    now = today + "T19:00:00Z";
  const base = { status: "sold" as const, planned_end_date: "2026-09-20" };
  const risk = attention(
    base,
    [],
    [],
    [{ status: "open", due_at: today + "T18:00:00Z" }],
    [30, 14, 7],
    today,
    now,
  );
  assert.equal(risk.attention_level, "red");
  assert.equal(risk.overdue_count, 1);
  assert.ok(risk.attention_reasons.includes("Destaging needs to be scheduled"));
  assert.ok(risk.attention_reasons.includes("Package expires in 7 days"));
  assert.equal(
    attention(
      { ...base, status: "completed" },
      [],
      [],
      [],
      [30, 14, 7],
      today,
      now,
    ).attention_reasons.length,
    0,
  );
  assert.deepEqual(graph.staged, ["listing_live", "sold", "cancelled"]);
});

test("Vancouver clock conversion handles daylight saving without guessing ambiguous times", async () => {
  const { vancouverLocal, vancouverUtc } =
    await import("../src/lib/operations/time");
  assert.equal(vancouverUtc("2024-03-10T17:00"), "2024-03-11T00:00:00.000Z");
  assert.equal(vancouverLocal("2024-03-11T00:00:00Z"), "2024-03-10T17:00");
  assert.throws(() => vancouverUtc("2024-03-10T02:30"));
  assert.throws(() => vancouverUtc("2024-11-03T01:30"));
});
