import { test } from "node:test";
import assert from "node:assert/strict";
import { classifyCrmError, crmLogContext } from "../src/lib/crm/errors";
test("Convex domain errors map to safe business messages", () => {
  for (const [code, category] of Object.entries({
    FORBIDDEN: "permission",
    CONFIGURATION: "configuration",
    INVALID_INPUT: "validation",
    DUPLICATE: "duplicate",
    CONFLICT: "conflict",
    NEXT_ACTION_REQUIRED: "next_action",
    UNAVAILABLE: "unavailable",
    UNKNOWN: "retry",
  })) {
    assert.equal(
      classifyCrmError({ data: { code, message: "Sensitive backend details" } })
        .category,
      category,
    );
  }
});
test("CRM errors and logs exclude payloads and arbitrary codes or operations", () => {
  const sensitive = "PRIVATE notes bearer-token email@example.test";
  const error = {
    data: { code: "DUPLICATE", message: sensitive, details: sensitive },
  };
  const log = crmLogContext("brokerage_save", error);
  assert.deepEqual(Object.keys(log).sort(), [
    "category",
    "error_code",
    "event",
    "operation",
  ]);
  assert.equal(JSON.stringify(log).includes(sensitive), false);
  assert.equal(classifyCrmError(error).message.includes(sensitive), false);
  assert.equal(
    crmLogContext(sensitive, { data: { code: sensitive } }).operation,
    "unknown",
  );
  assert.equal(
    crmLogContext(sensitive, { data: { code: sensitive } }).error_code,
    "UNKNOWN",
  );
});
