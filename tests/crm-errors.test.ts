import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCrmError, crmLogContext } from "../src/lib/crm/errors";
test("CRM error categories separate permissions, schema, constraints and transient failures", () => {
  for (const [code, category] of [
    ["42501", "permission"],
    ["42883", "configuration"],
    ["PGRST202", "configuration"],
    ["42P01", "configuration"],
    ["23514", "validation"],
    ["23505", "duplicate"],
    ["40001", "conflict"],
    ["PT409", "conflict"],
    ["08006", "retry"],
  ] as const)
    assert.equal(
      classifyCrmError({ code, message: "Sensitive raw database text" })
        .category,
      category,
    );
  assert.equal(
    classifyCrmError({
      code: "P0001",
      message: "A prospect needs a next action. PRIVATE",
    }).category,
    "next_action",
  );
});
test("CRM logging and user messages never include raw records, payloads or arbitrary operation text", () => {
  const sensitive = "PRIVATE notes bearer-token email@example.test";
  const raw = {
    code: "23505",
    message: sensitive,
    details: sensitive,
    hint: sensitive,
    notes: sensitive,
  };
  const log = crmLogContext("brokerage_save", raw);
  assert.deepEqual(Object.keys(log).sort(), [
    "category",
    "database_code",
    "event",
    "operation",
  ]);
  assert.equal(JSON.stringify(log).includes(sensitive), false);
  assert.equal(classifyCrmError(raw).message.includes(sensitive), false);
  assert.equal(
    crmLogContext(sensitive, { code: sensitive }).operation,
    "unknown",
  );
  assert.equal(
    crmLogContext(sensitive, { code: sensitive }).database_code,
    "UNKNOWN",
  );
  assert.equal(
    classifyCrmError({
      code: "P0001",
      message: "This record changed. " + sensitive,
    }).message.includes(sensitive),
    false,
  );
});
