import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { ConvexError } from "convex/values";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { operationsClient } from "./operations-fixture";
import { day } from "../../src/lib/operations/model";
let inventory_evidence: { checked: number; mismatches: unknown[] } | null =
  null;
let reconciliation: {
  scanned: number;
  source_drift: number;
  bucket_drift: number;
  revision: number;
  status: string;
} | null = null;
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
  const { client: owner, url } = await operationsClient(),
    period = JSON.stringify({ period: "this_month" });
  await check("Anonymous direct analytics access denied", async () => {
    const anonymous = new ConvexHttpClient(url, { logger: false });
    await denied(() => anonymous.query(api.analytics.summary, { period }));
    await denied(() =>
      anonymous.mutation(api.analyticsReconciliation.start, {}),
    );
  });
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
    if (role === "sales")
      await check(
        "Sales cannot override own scope or invoke financial drills",
        async () => {
          await denied(() =>
            c.query(api.analytics.summary, {
              period,
              filter: JSON.stringify({ dimension: "company", member: "all" }),
            }),
          );
          await denied(() =>
            c.query(api.analytics.drill, {
              period,
              metric: "cash_received_cents",
              pagination: { cursor: null, numItems: 10 },
            }),
          );
        },
      );
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
    "Serialized use counters reconcile to actual installation evidence",
    async () => {
      if (
        process.env.CONVEX_DEPLOY_KEY ||
        (process.env.CONVEX_DEPLOYMENT &&
          process.env.CONVEX_DEPLOYMENT !== "dev:woozy-jaguar-392")
      )
        throw Error("Unexpected deployment override");
      const r = spawnSync(
        process.execPath,
        [
          "node_modules/convex/bin/main.js",
          "run",
          "analyticsMaintenance:inventoryEvidence",
          "{}",
          "--env-file",
          ".env.local",
        ],
        { encoding: "utf8", env: process.env },
      );
      assert.equal(r.status, 0);
      inventory_evidence = JSON.parse(r.stdout.trim());
      assert.equal(inventory_evidence?.mismatches.length, 0);
      assert.ok(inventory_evidence && inventory_evidence.checked > 0);
    },
  );
  await check(
    "Independent source rebuild equals incremental projections",
    async () => {
      mkdirSync(".acceptance/m8/resume", { recursive: true });
      const id =
        (process.env.GLARA_M6_RECONCILIATION_ID as
          Id<"analytics_reconciliations"> | undefined) ??
        (await owner.mutation(api.analyticsReconciliation.start, {}));
      writeFileSync(
        ".acceptance/m8/resume/reconciliation-progress.json",
        JSON.stringify({ id, status: "started" }),
      );
      let completed = false;
      for (let step = 0; step < 20000; step++) {
        const r = await owner.action(api.analyticsMaintenance.reconcileBatch, {
          pages: 25,
          id,
        });
        writeFileSync(
          ".acceptance/m8/resume/reconciliation-progress.json",
          JSON.stringify({ id, ...r }),
        );
        if (step % 5 === 0)
          console.log(
            `RECONCILE ${r.phase} ${r.scanned} sources; drift ${r.source_drift}/${r.bucket_drift}`,
          );
        if (r.status !== "running") {
          assert.equal(r.status, "complete");
          assert.equal(r.source_drift, 0);
          assert.equal(r.bucket_drift, 0);
          reconciliation = {
            scanned: r.scanned,
            source_drift: r.source_drift,
            bucket_drift: r.bucket_drift,
            revision: r.revision,
            status: r.status,
          };
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
          reconciliation,
          inventory_evidence,
          multi_period_fixture:
            "See docs/M6-hosted-correction-results.json for the separate multi-period assertions; this run independently reconciles all source data afterwards.",
        },
        null,
        2,
      ) + "\n",
    ),
  );
