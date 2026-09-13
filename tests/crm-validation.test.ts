import { test } from "node:test";
import assert from "node:assert/strict";
import {
  realtorInput,
  activityInput,
  queryInput,
  canWriteCrm,
  canManageCrm,
  followupState,
} from "../src/lib/crm/model";
const assigned = "10000000-0000-4000-8000-000000000001";
test("Realtor validation rejects invalid contact data, scores, URLs and incomplete next actions", () => {
  const valid = {
    first_name: "Sarah",
    last_name: "Fictional",
    assigned_to: assigned,
    relationship_status: "prospect",
    next_title: "Call Sarah",
    next_due_at: "2026-10-01T18:00:00Z",
  };
  assert.equal(realtorInput.safeParse(valid).success, true);
  for (const patch of [
    { email: "invalid" },
    { phone: "12" },
    { website: "javascript:alert(1)" },
    { relationship_score: "101" },
    { average_listing_price: "-2" },
    { next_due_at: "" },
    { assigned_to: "owner" },
    { first_name: " " },
  ]) {
    assert.equal(
      realtorInput.safeParse({ ...valid, ...patch }).success,
      false,
      JSON.stringify(patch),
    );
  }
});
test("Activities require owner and due date; queries reject unsafe filter shapes", () => {
  const activity = {
    realtor_id: assigned,
    assigned_to: assigned,
    type: "follow_up",
    title: "Call",
    status: "open",
    priority: "normal",
    due_at: "2026-10-01T18:00:00Z",
  };
  assert.equal(activityInput.safeParse(activity).success, true);
  assert.equal(
    activityInput.safeParse({ ...activity, due_at: "" }).success,
    false,
  );
  assert.equal(
    activityInput.safeParse({
      ...activity,
      status: "completed",
      completed_at: "2099-01-01T00:00:00Z",
    }).success,
    false,
  );
  assert.equal(queryInput.safeParse({ page: 99999 }).success, false);
  assert.equal(
    queryInput.safeParse({ sort: "email desc;drop table realtors" }).success,
    false,
  );
  assert.equal(queryInput.safeParse({ q: "x".repeat(101) }).success, false);
});
test("M1 grants keep Marketing read-only and recovery restricted", () => {
  assert.equal(canWriteCrm(["sales"]), true);
  assert.equal(canWriteCrm(["admin"]), true);
  for (const role of ["marketing", "designer", "staging_crew"] as const)
    assert.equal(canWriteCrm([role]), false);
  assert.equal(canManageCrm(["sales"]), false);
  assert.equal(canManageCrm(["admin"]), true);
  assert.equal(
    followupState("2026-09-13T22:00:00Z", new Date("2026-09-13T18:00:00Z")),
    "Due today",
  );
  assert.equal(followupState(null), "No next action");
});
