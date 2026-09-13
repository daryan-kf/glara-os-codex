import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cents,
  decimal,
  quoteMath,
  quoteInput,
  stages,
  transitions,
  stageInput,
  opportunityInput,
} from "../src/lib/sales/model";
test("CAD arithmetic uses exact cents, integer quantities and half-up quote tax", () => {
  const d = quoteInput.parse({
    opportunity_id: "a".repeat(32),
    items: [
      { description: "Chair", quantity: 3, unit_price: "0.10" },
      { description: "Sofa", quantity: 2, unit_price: "1000.01" },
    ],
    discount: "0.01",
    tax_rate: "5.00",
    valid_until: "2099-01-01",
  });
  assert.equal(quoteMath(d).subtotal_cents, "200032");
  assert.equal(quoteMath(d).tax_cents, "10002");
  assert.equal(quoteMath(d).total_cents, "210033");
  assert.equal(decimal(cents("999999999.99")), "999999999.99");
  assert.throws(() => cents("1e4"));
  assert.throws(() => cents("0.001"));
  assert.throws(() => quoteMath({ ...d, discount: "999999.99" }));
  assert.equal(
    quoteInput.safeParse({
      ...d,
      items: [{ description: "Bad", quantity: 0.5, unit_price: "5.00" }],
    }).success,
    false,
  );
});
test("sales stage graph is explicit and lost requires a valid reason", () => {
  assert.deepEqual(transitions("new"), ["contacted", "lost"]);
  assert.deepEqual(transitions("won"), ["contacted"]);
  assert.ok(transitions("negotiation").includes("won"));
  for (const s of stages) assert.ok(!transitions(s).includes(s));
  assert.equal(stageInput.safeParse({ stage: "lost" }).success, false);
  assert.equal(
    stageInput.safeParse({
      stage: "lost",
      lost_reason: "other",
      lost_notes: "Seller postponed",
    }).success,
    true,
  );
  assert.equal(
    opportunityInput.safeParse({
      property_id: "a".repeat(32),
      assigned_to: "b".repeat(32),
      estimated_value: "1.00",
      probability: 101,
    }).success,
    false,
  );
});
