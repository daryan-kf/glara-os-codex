import { writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { operationsClient } from "./operations-fixture";
const checks = [];
const queries = [
  ["list", api.calendarSync.list, {}],
  ["candidates", api.calendarSync.candidates, {}],
  [
    "reconcile",
    api.calendarSync.reconcilePage,
    { paginationOpts: { numItems: 25, cursor: null } },
  ],
] as const;
for (const role of [
  "owner",
  "admin",
  "sales",
  "designer",
  "staging_crew",
  "marketing",
  "unassigned",
  "archived",
  "anonymous",
  "revoked",
]) {
  let client: ConvexHttpClient;
  if (role === "anonymous")
    client = new ConvexHttpClient(
      "https://woozy-jaguar-392.eu-west-1.convex.cloud",
      { logger: false },
    );
  else {
    client = (await operationsClient(role === "revoked" ? "owner" : role))
      .client;
    if (role === "revoked") await client.action(api.auth.signOut, {});
  }
  for (const [name, ref, args] of queries) {
    let actual = "deny",
      failureCode = "";
    try {
      await client.query(ref, args);
      actual = "allow";
    } catch (e) {
      const d = (e as { data?: { code?: string } }).data;
      failureCode = d?.code ?? "";
    }
    const expected = ["owner", "admin"].includes(role) ? "allow" : "deny";
    checks.push({
      role,
      query: name,
      expected,
      actual,
      denial_code: failureCode || null,
      result:
        actual === expected &&
        (expected === "allow" || failureCode === "FORBIDDEN")
          ? "passed"
          : "failed",
    });
  }
}
const result = {
  at: new Date().toISOString(),
  scope:
    "Hosted read-only administrative Calendar list/candidates/reconcile guards, including revoked session. No provider calls, source mutations or projection-ID tampering tests.",
  checks,
  passed: checks.filter((x) => x.result === "passed").length,
  failed: checks.filter((x) => x.result === "failed").length,
};
writeFileSync(
  ".acceptance/m9/calendar-roles.json",
  JSON.stringify(result, null, 2),
);
console.log(JSON.stringify(result));
if (result.failed) process.exitCode = 1;
