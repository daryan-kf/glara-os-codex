import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { ConvexError } from "convex/values";
import { api } from "../../convex/_generated/api";
import { operationsClient } from "./operations-fixture";
import { day } from "../../src/lib/operations/model";
const results: { name: string; passed: boolean }[] = [];
async function check(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch {
    results.push({ name, passed: false });
    throw Error(name);
  }
}
async function denied(fn: () => Promise<unknown>) {
  await assert.rejects(
    fn,
    (error: unknown) =>
      error instanceof ConvexError &&
      typeof error.data === "object" &&
      error.data !== null &&
      "code" in error.data &&
      error.data.code === "FORBIDDEN",
  );
}
async function main() {
  if (process.env.GLARA_CONVEX_ACCEPTANCE !== "yes")
    throw Error("Explicit fictional development acceptance opt-in required");
  const { client: owner } = await operationsClient(),
    period = JSON.stringify({ period: "this_month" });
  await check("M6 functions available with ready reporting", async () =>
    assert.equal(
      (await owner.query(api.analytics.summary, { period })).ready,
      true,
    ),
  );
  await check(
    "Owner accesses time-correct commercial and inventory reporting",
    async () => {
      await owner.query(api.analytics.aging, {});
      await owner.query(api.analyticsHistory.historicalAR, {
        as_of: day(),
        pagination: { numItems: 10, cursor: null },
      });
      await owner.query(api.analyticsHistory.underused, {
        pagination: { numItems: 10, cursor: null },
      });
      await owner.query(api.analytics.settings, {});
      await owner.query(api.analyticsOperations.forecast, { days: 30 });
      await owner.query(api.analyticsOperations.actionCenter, {});
    },
  );
  for (const role of [
    "admin",
    "sales",
    "designer",
    "staging_crew",
    "marketing",
    "unassigned",
    "archived",
  ]) {
    const { client: c } = await operationsClient(role);
    await check(role + " analytics role boundary", async () => {
      if (["admin", "sales", "marketing"].includes(role)) {
        const r = await c.query(api.analytics.summary, { period });
        if (role !== "admin") {
          assert.equal(r.derived.net_cash_cents, null);
          assert.equal(r.derived.average_project_value_cents, null);
          assert.equal(
            Object.keys(r.flows).some((k) =>
              /cash|invoiced|credits_cents|damage|contract/.test(k),
            ),
            false,
          );
        }
      } else await denied(() => c.query(api.analytics.summary, { period }));
    });
    await check(
      role + " Owner configuration and maintenance denial",
      async () => {
        await denied(() => c.query(api.analytics.settings, {}));
        await denied(() => c.mutation(api.analyticsReconciliation.start, {}));
      },
    );
    if (role !== "admin")
      await check(role + " financial history and capacity denial", async () => {
        await denied(() => c.query(api.analytics.aging, {}));
        await denied(() =>
          c.query(api.analyticsHistory.historicalAR, {
            as_of: day(),
            pagination: { numItems: 10, cursor: null },
          }),
        );
        await denied(() =>
          c.query(api.analyticsOperations.forecast, { days: 7 }),
        );
      });
  }
  await check(
    "Independent source rebuild equals incremental projections",
    async () => {
      const id = await owner.mutation(api.analyticsReconciliation.start, {});
      let completed = false;
      for (let step = 0; step < 20000; step++) {
        const r = await owner.mutation(api.analyticsReconciliation.advance, {
          id,
        });
        if (r.status !== "running") {
          assert.equal(r.status, "complete");
          assert.equal(r.source_drift, 0);
          assert.equal(r.bucket_drift, 0);
          completed = true;
          break;
        }
      }
      assert.equal(completed, true);
    },
  );
}
main()
  .catch(() => {
    console.error("M6 hosted acceptance stopped; see named result.");
    process.exitCode = 1;
  })
  .finally(() =>
    writeFileSync(
      "docs/M6-hosted-api-results.json",
      JSON.stringify(
        {
          deployment: "woozy-jaguar-392",
          timestamp: new Date().toISOString(),
          results,
          passed: results.filter((r) => r.passed).length,
          failed: results.filter((r) => !r.passed).length,
          completed: process.exitCode !== 1,
          multi_period_fixture:
            "Requires the separate hosted correction scenario; this runner alone does not establish that gate.",
        },
        null,
        2,
      ) + "\n",
    ),
  );
