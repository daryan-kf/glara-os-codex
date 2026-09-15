import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { api } from "../../convex/_generated/api";
import { operationsClient } from "./operations-fixture";
async function main() {
  assert.equal(process.env.GLARA_M7_ACCEPTANCE, "yes");
  const ids = JSON.parse(process.env.GLARA_M7_REPAIR_IDS ?? "[]") as string[];
  assert.ok(ids.length > 0 && ids.length <= 20);
  const { client } = await operationsClient();
  function sources() {
    const r = spawnSync(
      process.execPath,
      [
        "node_modules/convex/bin/main.js",
        "data",
        "activities",
        "--limit",
        "5000",
        "--format",
        "json",
        "--env-file",
        ".env.local",
      ],
      { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 },
    );
    assert.equal(r.status, 0);
    return (
      JSON.parse(r.stdout) as {
        _id: string;
        title: string;
        description?: string;
      }[]
    ).filter((x) => ids.includes(x._id));
  }
  const before = sources();
  assert.equal(before.length, ids.length);
  for (const row of before)
    assert.match(row.title + row.description, /Fictional ?M7/);
  let repairs = 0;
  for (const id of ids) {
    for (let step = 0; step < 10; step++) {
      const p = await client.query(api.analytics.compareSource, {
        table: "activities",
        id,
      });
      if (!p.drift.length) break;
      const d = p.drift[0],
        metric = (d.expected ?? d.before)!.metric;
      const r = await client.mutation(api.analytics.repairSource, {
        table: "activities",
        id,
        metric,
        source_version: p.source_version,
        revision: p.revision,
        reason:
          "M7 acceptance: repair fictional legacy-activity projection after version watermark correction; source unchanged",
      });
      assert.equal(r.applied, true);
      repairs++;
    }
    assert.equal(
      (
        await client.query(api.analytics.compareSource, {
          table: "activities",
          id,
        })
      ).drift.length,
      0,
    );
  }
  assert.deepEqual(sources(), before);
  writeFileSync(
    "docs/M7-analytics-repair-results.json",
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        deployment: "woozy-jaguar-392",
        fictional_sources: ids.length,
        projection_repairs: repairs,
        source_records_unchanged: true,
        remaining_source_drift: 0,
        mechanism:
          "Existing authenticated Owner compareSource/repairSource; explicit audit reason; no helper or source mutation",
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS fictional activity projection repair; business records unchanged",
  );
}
main().catch(() => {
  console.error("M7 projection repair failed");
  process.exitCode = 1;
});
