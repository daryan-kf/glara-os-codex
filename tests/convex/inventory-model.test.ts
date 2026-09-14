import type { ReservationState } from "../../src/lib/inventory/model";
import { describe, it, expect } from "vitest";
import {
  peakDemand,
  productInput,
  day,
  readiness,
  usable,
} from "../../src/lib/inventory/model";

describe("inventory planning rules", () => {
  it("uses peak concurrent demand rather than adding disjoint bookings", () => {
    const rows = [
      { needed_from: "2026-09-01", needed_until: "2026-09-10", quantity: 7 },
      { needed_from: "2026-09-11", needed_until: "2026-09-20", quantity: 6 },
    ];
    expect(peakDemand(rows, "2026-09-01", "2026-09-30")).toBe(7);
    expect(peakDemand(rows, "2026-09-12", "2026-09-18")).toBe(6);
    expect(peakDemand(rows, "2026-10-01", "2026-10-31")).toBe(0);
  });
  it("keeps both inclusive boundary dates reserved", () => {
    expect(
      peakDemand(
        [
          {
            needed_from: "2026-09-01",
            needed_until: "2026-09-10",
            quantity: 7,
          },
          {
            needed_from: "2026-09-10",
            needed_until: "2026-09-20",
            quantity: 6,
          },
        ],
        "2026-09-10",
        "2026-09-10",
      ),
    ).toBe(13);
  });
  it("rejects invalid dates and normalizes explicit SKUs", () => {
    expect(day.safeParse("2026-02-30").success).toBe(false);
    expect(day.safeParse("2028-02-29").success).toBe(true);
    const input = {
      sku: " sofa-cream ",
      name: "Sofa",
      track_mode: "serialized",
      staging_eligible: true,
      retail_eligible: false,
      active: true,
    };
    expect(productInput.parse(input).sku).toBe("SOFA-CREAM");
    expect(
      productInput.safeParse({ ...input, sku: "sofa cream" }).success,
    ).toBe(false);
  });
  it("keeps returned stock unavailable until inspection is resolved", () => {
    expect(readiness([{ state: "inspection", quantity: 5 }])).toBe("returning");
    expect(readiness([{ state: "missing", quantity: 1 }])).toBe("exception");
    expect(readiness([{ state: "resolved", quantity: 5 }])).toBe("reconciled");
    expect(usable("poor")).toBe(false);
    expect(usable("damaged")).toBe(false);
  });
});

it.each([
  [[], "not_started"],
  [["planned"], "planning"],
  [["reserved"], "reserved"],
  [["reserved", "picked"], "picking"],
  [["picked", "installed"], "ready"],
  [["installed"], "installed"],
  [["installed", "returning"], "returning"],
  [["cleaning"], "returning"],
  [["repair"], "returning"],
  [["damaged"], "exception"],
  [["released", "resolved"], "reconciled"],
  [["released", "installed"], "installed"],
] as [ReservationState[], string][])(
  "derives readiness for %j as %s",
  (states, expected) => {
    expect(readiness(states.map((state) => ({ state, quantity: 1 })))).toBe(
      expected,
    );
  },
);
it("shortage and an unapproved wrong-item exception override reserved readiness", () => {
  expect(readiness([{ state: "reserved", quantity: 1, shortage: true }])).toBe(
    "exception",
  );
  expect(
    readiness([
      {
        state: "reserved",
        quantity: 1,
        exception: "Wrong item",
        exception_approved: false,
      },
    ]),
  ).toBe("exception");
});
