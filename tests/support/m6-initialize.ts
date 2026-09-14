import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { api } from "../../convex/_generated/api";
import { operationsClient } from "./operations-fixture";
async function main() {
  if (process.env.GLARA_M6_ACCEPTANCE !== "yes")
    throw Error("Explicit M6 acceptance opt-in required");
  const { client } = await operationsClient(),
    id = await client.mutation(api.analyticsReconciliation.start, {});
  for (let step = 0; step < 20000; step++) {
    const r = await client.action(api.analyticsMaintenance.reconcileBatch, {
      pages: 50,
      id,
    });
    if (step % 2 === 0)
      console.log(
        `Reconciliation ${r.phase}: ${r.scanned} source records; drift ${r.source_drift}/${r.bucket_drift}`,
      );
    if (r.status !== "running") {
      writeFileSync(
        "docs/M6-initial-reconciliation-results.json",
        JSON.stringify(
          {
            deployment: "woozy-jaguar-392",
            timestamp: new Date().toISOString(),
            status: r.status,
            scanned: r.scanned,
            source_drift: r.source_drift,
            bucket_drift: r.bucket_drift,
            revision: r.revision,
          },
          null,
          2,
        ) + "\n",
      );
      assert.equal(r.status, "complete");
      assert.equal(r.source_drift, 0);
      assert.equal(r.bucket_drift, 0);
      await client.mutation(api.analyticsReconciliation.activate, { id });
      console.log("PASS zero-drift source rebuild and Owner activation");
      return;
    }
  }
  throw Error("Reconciliation work bound exceeded");
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "M6 initialization failed");
  process.exitCode = 1;
});
