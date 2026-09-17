import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
const root = process.cwd(),
  home = resolve(".acceptance/m10/key-rotation-" + Date.now()),
  binary = resolve(".acceptance/m10/backend/convex-local-backend.exe"),
  url = "http://127.0.0.1:3340",
  name = "glara-fictional-key-drill";
mkdirSync(home + "/convex", { recursive: true });
writeFileSync(
  home + "/package.json",
  JSON.stringify({
    name: "isolated-key-drill",
    dependencies: { convex: "1.45.0" },
  }),
);
writeFileSync(
  home + "/convex/schema.ts",
  'import {defineSchema,defineTable} from "convex/server";import {v} from "convex/values";export default defineSchema({evidence:defineTable({label:v.string()})});',
);
writeFileSync(
  home + "/convex/drill.ts",
  'import {internalQuery,internalMutation} from "./_generated/server";export const read=internalQuery({args:{},handler:ctx=>ctx.db.query("evidence").collect()});export const seed=internalMutation({args:{},handler:async ctx=>{if(await ctx.db.query("evidence").first())throw Error("NONEMPTY");return ctx.db.insert("evidence",{label:"Fictional credential-rotation proof"});}});',
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/(CONVEX|RESEND|GOOGLE|OPENAI|GLARA|M9_)/.test(k),
  ),
);
let child;
async function start(secret) {
  const key = spawnSync(
    binary,
    [
      "keygen",
      "admin-key",
      "--instance-name",
      name,
      "--instance-secret",
      secret,
    ],
    { encoding: "utf8", windowsHide: true },
  );
  if (key.status !== 0) throw Error("key generation failed");
  child = spawn(
    binary,
    [
      "--interface",
      "127.0.0.1",
      "--port",
      "3340",
      "--site-proxy-port",
      "3341",
      "--instance-name",
      name,
      "--instance-secret",
      secret,
      "--disable-beacon",
      "--local-storage",
      home + "/storage",
      home + "/database.sqlite3",
    ],
    { cwd: home, windowsHide: true, stdio: "ignore", env },
  );
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    try {
      if ((await fetch(url + "/version")).ok) return key.stdout.trim();
    } catch {}
  }
  throw Error("isolated backend unavailable");
}
async function stop() {
  if (!child) return;
  const current = child;
  await new Promise((resolve) => {
    current.once("exit", resolve);
    current.kill();
  });
  child = undefined;
}
const client = (key) => {
  const c = new ConvexHttpClient(url, { logger: false });
  c.setAdminAuth(key);
  return c;
};
async function main() {
  const result = {
    executed_at: new Date().toISOString(),
    environment: "isolated_restore",
    production_modified: false,
    shared_development_modified: false,
    provider_calls: 0,
  };
  try {
    const oldKey = await start(randomBytes(32).toString("hex"));
    const deployed = spawnSync(
      process.execPath,
      [
        root + "/node_modules/convex/bin/main.js",
        "dev",
        "--once",
        "--typecheck",
        "disable",
        "--tail-logs",
        "disable",
      ],
      {
        cwd: home,
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...env,
          CONVEX_SELF_HOSTED_URL: url,
          CONVEX_SELF_HOSTED_ADMIN_KEY: oldKey,
        },
      },
    );
    writeFileSync(
      home + "/deploy.log",
      (deployed.stdout ?? "") + (deployed.stderr ?? ""),
    );
    if (deployed.status !== 0) throw Error("isolated deployment failed");
    const old = client(oldKey);
    await old.mutation(makeFunctionReference("drill:seed"), {});
    const before = await old.query(makeFunctionReference("drill:read"), {});
    await stop();
    const newKey = await start(randomBytes(32).toString("hex"));
    let rejected = false;
    try {
      await old.query(makeFunctionReference("drill:read"), {});
    } catch {
      rejected = true;
    }
    if (!rejected) throw Error("old credential remained usable");
    const after = await client(newKey).query(
      makeFunctionReference("drill:read"),
      {},
    );
    if (JSON.stringify(before) !== JSON.stringify(after))
      throw Error("data changed during rotation");
    Object.assign(result, {
      status: "PASSED",
      old_credential_rejected: true,
      new_credential_accepted: true,
      authoritative_data_preserved: true,
      mechanism:
        "official Convex local backend instance secret and keygen; not a hosted/provider-account rotation",
    });
  } catch {
    Object.assign(result, { status: "FAILED" });
    process.exitCode = 1;
  } finally {
    await stop();
    writeFileSync(
      resolve(".acceptance/m10/key-rotation.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  }
}
main();
