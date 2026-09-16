import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { makeFunctionReference } from "convex/server";
import { z } from "zod";
import { operationsClient } from "./operations-fixture";
import { api } from "../../convex/_generated/api";
async function main() {
  assert.equal(process.env.GLARA_M10_ACCEPTANCE, "yes");
  const { client } = await operationsClient();
  const results: Record<string, unknown> = {
    executed_at: new Date().toISOString(),
    deployment: "woozy-jaguar-392",
    production_mutations: 0,
    provider_calls: 0,
  };
  const persist = () =>
    writeFileSync(
      ".acceptance/m10/reconciliation.json",
      JSON.stringify(results, null, 2),
    );
  const page = z.object({
    page: z.array(
      z.object({
        issues: z.array(z.string()).optional(),
        mismatch: z.boolean().optional(),
      }),
    ),
    continueCursor: z.string(),
    isDone: z.boolean(),
  });
  for (const name of [
    "reconcilePage",
    "outboxReconcilePage",
    "eventReconcilePage",
    "providerReconcilePage",
  ]) {
    let cursor: string | null = null,
      checked = 0,
      complete = false;
    const issues: Record<string, number> = {};
    for (let n = 0; n < 10000; n++) {
      const r = page.parse(
        await client.query(
          makeFunctionReference<"query">("communications:" + name),
          { paginationOpts: { cursor, numItems: 25 } },
        ),
      );
      checked += r.page.length;
      for (const item of r.page)
        for (const code of [
          ...(item.issues ?? []),
          ...(item.mismatch ? ["event_mapping_mismatch"] : []),
        ])
          issues[code] = (issues[code] ?? 0) + 1;
      cursor = r.continueCursor;
      if (r.isDone) {
        complete = true;
        break;
      }
    }
    results[name] = { checked, complete, issues };
    persist();
    assert(complete);
    assert.equal(Object.keys(issues).length, 0);
  }
  const inventory = z
    .object({ checked: z.number(), mismatches: z.array(z.unknown()) })
    .parse(
      JSON.parse(
        execFileSync(
          process.execPath,
          [
            "node_modules/convex/bin/main.js",
            "run",
            "analyticsMaintenance:inventoryEvidence",
            "{}",
            "--deployment",
            "woozy-jaguar-392",
          ],
          {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
            windowsHide: true,
          },
        ),
      ),
    );
  results.serialized_inventory = {
    checked: inventory.checked,
    mismatches: inventory.mismatches.length,
  };
  persist();
  assert.equal(inventory.mismatches.length, 0);
  const id = await client.mutation(api.analyticsReconciliation.start, {});
  writeFileSync(
    ".acceptance/m10/reconciliation-progress.json",
    JSON.stringify({ id }),
  );
  let complete = false;
  for (let step = 0; step < 20000; step++) {
    const r = await client.action(api.analyticsMaintenance.reconcileBatch, {
      id,
      pages: 25,
    });
    writeFileSync(
      ".acceptance/m10/reconciliation-progress.json",
      JSON.stringify({ id, ...r }),
    );
    if (step % 5 === 0)
      console.log(
        "M6 reconciliation progress: " +
          r.phase +
          "; " +
          r.scanned +
          " sources",
      );
    if (r.status !== "running") {
      results.analytics = {
        status: r.status,
        scanned: r.scanned,
        source_drift: r.source_drift,
        bucket_drift: r.bucket_drift,
        revision: r.revision,
      };
      persist();
      assert.equal(r.status, "complete");
      assert.equal(r.source_drift, 0);
      assert.equal(r.bucket_drift, 0);
      complete = true;
      break;
    }
  }
  assert(complete);
  results.completed = true;
  persist();
  console.log(JSON.stringify(results));
}
main().catch(() => {
  console.error(
    "Reconciliation incomplete or findings require review; inspect restricted counts.",
  );
  process.exitCode = 1;
});
