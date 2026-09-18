import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canAccess,
  isRole,
  modules,
  roles,
  type Module,
} from "../src/lib/permissions";
describe("central authorization", () => {
  it("allows help for every assigned role without granting anonymous access", () => {
    for (const role of roles) assert.equal(canAccess([role], "help"), true);
    assert.equal(canAccess([], "help"), false);
  });
  it("gives the owner every module and defaults unassigned users to denied", () => {
    for (const moduleKey of Object.keys(modules) as Module[]) {
      assert.equal(canAccess(["owner"], moduleKey), true);
      assert.equal(canAccess([], moduleKey), false);
    }
  });
  it("keeps company financial reporting and settings restricted", () => {
    for (const role of roles.filter((role) => role !== "owner")) {
      assert.equal(canAccess([role], "reports"), false);
      assert.equal(canAccess([role], "settings"), false);
    }
    for (const role of [
      "sales",
      "designer",
      "staging_crew",
      "marketing",
    ] as const)
      assert.equal(canAccess([role], "payments"), false);
    assert.equal(canAccess(["admin"], "payments"), true);
  });
  it("combines explicit assignments without broadening unrelated access", () => {
    assert.equal(canAccess(["sales", "designer"], "inventory"), true);
    assert.equal(canAccess(["sales", "designer"], "payments"), false);
    assert.equal(isRole("super_admin"), false);
  });
});
