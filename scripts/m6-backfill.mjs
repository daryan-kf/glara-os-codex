import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const env = readFileSync(".env.local", "utf8");
if (
  process.env.GLARA_M6_BACKFILL !== "yes" ||
  process.env.CONVEX_DEPLOY_KEY ||
  /^CONVEX_DEPLOY_KEY=/m.test(env) ||
  !/^CONVEX_DEPLOYMENT=dev:woozy-jaguar-392(?:\s|$)/m.test(env) ||
  !/^NEXT_PUBLIC_CONVEX_URL=https:\/\/woozy-jaguar-392\.eu-west-1\.convex\.cloud\s*$/m.test(
    env,
  ) ||
  (process.env.CONVEX_DEPLOYMENT &&
    process.env.CONVEX_DEPLOYMENT !== "dev:woozy-jaguar-392")
)
  throw Error(
    "Explicit M6 backfill opt-in and the exact authorized development target are required",
  );
function run(name, args) {
  const r = spawnSync(
    process.execPath,
    [
      "node_modules/convex/bin/main.js",
      "run",
      name,
      JSON.stringify(args),
      "--env-file",
      ".env.local",
    ],
    { encoding: "utf8", env: process.env },
  );
  if (r.status !== 0)
    throw Error(
      "Backfill stopped at " +
        name +
        "; inspect the development deployment logs before resuming.",
    );
  return JSON.parse(r.stdout.trim());
}
let next =
  process.env.GLARA_M6_BACKFILL_RESTART === "yes"
    ? run("analytics:startBackfill", {})
    : run("analyticsMaintenance:backfillStatus", {});
let count = 0;
for (let step = 0; step < 200 && !next.complete; step++) {
  next = run("analyticsMaintenance:backfillBatch", { pages: 100 });
  count += next.processed;
  console.log("Backfill sources processed this run: " + count);
}
if (!next.complete)
  throw Error("Backfill exceeded the acceptance work limit; rerun to resume");
console.log(
  "Backfill complete. Reporting stays unavailable until an Owner runs a zero-drift reconciliation and explicitly activates it.",
);
