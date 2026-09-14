import { describe, it, expect } from "vitest";
import {
  agreementInput,
  agreementMath,
  itemInput,
  itemMath,
  sumItems,
  apportion,
  balances,
  safeReference,
} from "../../src/lib/commercial/model";
import { agreementTerms } from "../support/commercial-unit-fixture";
describe("M5 exact commercial arithmetic", () => {
  it("rounds per tax line without floating point and respects quantity/discount", () => {
    const row = itemMath(
      itemInput.parse({
        description: "service",
        quantity: 3,
        unit_amount: "0.15",
        discount: "0.05",
        taxes: [{ name: "Tax", basis_points: 1250 }],
      }),
    );
    expect(row.total_cents).toBe("45");
    expect(sumItems([row, row]).total_cents).toBe("90");
  });
  it("calculates fixed and percentage deposit against the inclusive total", () => {
    expect(
      agreementMath(agreementInput.parse(agreementTerms)).deposit_cents,
    ).toBe("52500");
    expect(() =>
      agreementMath(
        agreementInput.parse({
          ...agreementTerms,
          deposit_type: "fixed",
          deposit_value: "1050.01",
        }),
      ),
    ).toThrow();
  });
  it("allocates every cent without negative components for every small split", () => {
    for (let total = 1; total < 80; total++)
      for (let part = 0; part <= total; part++) {
        const weights = [BigInt(total - 1), 1n];
        const r = apportion(BigInt(part), weights);
        expect(r.reduce((n, v) => n + v, 0n)).toBe(BigInt(part));
        expect(r.every((v, i) => v >= 0n && v <= weights[i])).toBe(true);
      }
    expect(apportion(1n, [1n, 1n, 1n, 1n, 1n, 1n])).toEqual([
      1n,
      0n,
      0n,
      0n,
      0n,
      0n,
    ]);
  });
  it("preserves paid credits as explicit refund review and derives overdue", () => {
    expect(
      balances("10000", 10000n, 2500n, "issued", "2020-01-01", "2026-09-14"),
    ).toMatchObject({ balance_cents: "0", credit_balance_cents: "2500" });
    expect(
      balances("10000", 100n, 0n, "issued", "2020-01-01", "2026-09-14")
        .effective_status,
    ).toBe("overdue");
  });
  it("rejects malformed money, excessive discounts, card references and invalid dates", () => {
    expect(
      agreementInput.safeParse({ ...agreementTerms, subtotal: "1e3" }).success,
    ).toBe(false);
    expect(
      agreementInput.safeParse({
        ...agreementTerms,
        package_end_date: "2026-02-30",
      }).success,
    ).toBe(false);
    expect(() =>
      agreementMath(
        agreementInput.parse({ ...agreementTerms, discount: "1001" }),
      ),
    ).toThrow();
    expect(safeReference.safeParse("4111 1111 1111 1111").success).toBe(false);
  });
});
