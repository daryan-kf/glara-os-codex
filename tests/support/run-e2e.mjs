import { spawnSync } from "node:child_process";
if (process.env.GLARA_CONVEX_ACCEPTANCE !== "yes")
  throw new Error(
    "Set GLARA_CONVEX_ACCEPTANCE=yes and fictional identity credentials for a disposable Convex deployment.",
  );
for (const [entry, args] of [
  ["node_modules/next/dist/bin/next", ["build"]],
  ["node_modules/@playwright/test/cli.js", ["test", ...process.argv.slice(2)]],
]) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
