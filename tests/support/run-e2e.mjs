import { spawnSync } from "node:child_process";
// Override public variables at build time too: Next.js inlines NEXT_PUBLIC_*.
// The isolated suite must never pick up a developer's real .env.local database.
const env = { ...process.env };
if (env.E2E_LIVE !== "1") {
  env.NEXT_PUBLIC_SUPABASE_URL = "http://127.0.0.1:54329";
  env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "fictional-publishable-test-key";
}
for (const [entry, args] of [
  ["node_modules/next/dist/bin/next", ["build"]],
  ["node_modules/@playwright/test/cli.js", ["test", ...process.argv.slice(2)]],
]) {
  const result = spawnSync(process.execPath, [entry, ...args], {
    env,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
