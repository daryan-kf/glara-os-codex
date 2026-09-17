import { spawn, spawnSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference as ref } from "convex/server";
import { operationsFixture } from "../.acceptance/m10/recovery-source/fixtures/operations-unit-fixture";
import { fictionalMigrationPackage } from "../tests/support/m10-migration-package";
const root = process.cwd(),
  home = resolve(".acceptance/m10/migration-" + Date.now()),
  project = resolve(".acceptance/m10/recovery-source"),
  url = "http://127.0.0.1:3360";
mkdirSync(home, { recursive: true });
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/(CONVEX|RESEND|OPENAI|GOOGLE|GLARA|M9_|SITE_URL)/.test(k),
  ),
);
const result = {
  executed_at: new Date().toISOString(),
  environment: "isolated_restore",
  production_modified: false,
  shared_development_modified: false,
  provider_calls: 0,
  results: [],
};
let child,
  phase = "start";
const stable = (x) =>
  JSON.stringify(x, (_k, v) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
async function main() {
  try {
    const binary = root + "/.acceptance/m10/backend/convex-local-backend.exe",
      secret = randomBytes(32).toString("hex"),
      name = "glara-migration";
    const kr = spawnSync(
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
    if (kr.status !== 0) throw Error("keygen failed");
    const key = kr.stdout.trim();
    child = spawn(
      binary,
      [
        "--interface",
        "127.0.0.1",
        "--port",
        "3360",
        "--site-proxy-port",
        "3361",
        "--instance-name",
        name,
        "--instance-secret",
        secret,
        "--disable-beacon",
        "--local-storage",
        home + "/storage",
        home + "/db.sqlite3",
      ],
      { cwd: home, env, stdio: "ignore", windowsHide: true },
    );
    let up = false;
    for (let n = 0; n < 40; n++) {
      await new Promise((r) => setTimeout(r, 250));
      try {
        if ((await fetch(url + "/version")).ok) {
          up = true;
          break;
        }
      } catch {}
    }
    assert(up);
    const cmd = (args) => {
      const r = spawnSync(
        process.execPath,
        [root + "/node_modules/convex/bin/main.js", ...args],
        {
          cwd: project,
          env: {
            ...env,
            CONVEX_SELF_HOSTED_URL: url,
            CONVEX_SELF_HOSTED_ADMIN_KEY: key,
          },
          encoding: "utf8",
          windowsHide: true,
        },
      );
      if (r.status !== 0) throw Error("isolated command failed");
    };
    phase = "deploy";
    cmd([
      "dev",
      "--once",
      "--typecheck",
      "disable",
      "--codegen",
      "disable",
      "--tail-logs",
      "disable",
    ]);
    for (const [k, v] of Object.entries({
      GLARA_ENVIRONMENT: "development",
      GLARA_MIGRATION_ENABLED: "true",
      M9_EMAIL_ENABLED: "false",
      M9_CALENDAR_ENABLED: "false",
      AUTH_EMAIL_ENABLED: "false",
    }))
      cmd(["env", "set", k, v]);
    process.env.GLARA_DRILL_URL = url;
    process.env.GLARA_DRILL_KEY = key;
    const admin = new ConvexHttpClient(url, { logger: false });
    admin.setAdminAuth(key);
    const f = await operationsFixture();
    await f.won();
    const owner = f.c("owner"),
      data = fictionalMigrationPackage(f),
      input = JSON.stringify(data);
    const snapshot = () => admin.query(ref("drill:snapshot"), {}),
      apply = (dry_run = false, through = data.rows.length, value = input) =>
        owner.mutation(ref("migration:apply"), {
          input: value,
          dry_run,
          through,
        });
    phase = "dry-run";
    const before = stable(await snapshot());
    await assert.rejects(() => apply(true), /MIGRATION_DRY_RUN_VALID/);
    assert.equal(stable(await snapshot()), before);
    result.results.push({ scenario: phase, passed: true });
    phase = "invalid-input-rollback";
    for (const kind of ["parent", "money", "date", "role"]) {
      const bad = structuredClone(data);
      if (kind === "parent") bad.rows[0].args.input = { $ref: "missing" };
      if (kind === "money") bad.rows[11].args.amount = "NaN";
      if (kind === "date") bad.rows[11].args.received_date = "2026-02-31";
      if (kind === "role") bad.staff.sales = "bad";
      await assert.rejects(() => apply(false, 13, JSON.stringify(bad)));
      assert.equal(stable(await snapshot()), before);
    }
    result.results.push({ scenario: phase, passed: true });
    phase = "checkpoint-resume";
    assert.equal((await apply(false, 3)).applied, 3);
    const resumed = await apply();
    assert.deepEqual(resumed, { applied: 10, skipped: 3, complete: true });
    result.results.push({ scenario: phase, passed: true });
    phase = "replay";
    const after = await snapshot(),
      afterText = stable(after);
    assert.deepEqual(await apply(), {
      applied: 0,
      skipped: 13,
      complete: true,
    });
    assert.equal(stable(await snapshot()), afterText);
    result.results.push({ scenario: phase, passed: true });
    phase = "source-conflict";
    const changed = structuredClone(data);
    changed.source_sha = "0".repeat(40);
    await assert.rejects(
      () => apply(false, 13, JSON.stringify(changed)),
      /MIGRATION_SOURCE_CHANGED/,
    );
    assert.equal(stable(await snapshot()), afterText);
    result.results.push({ scenario: phase, passed: true });
    phase = "reconciliation";
    const record = (id) =>
        after.migration_records.find((r) => r.stable_id === id),
      id = (key) => JSON.parse(record(key).result);
    assert.equal(after.migration_records.length, 13);
    assert.equal(after.migration_runs[0].applied, 13);
    assert(after.migration_runs[0].completed_at);
    assert.equal(
      after.invoices.find((x) => x._id === id("invoice")).total_cents,
      "10000",
    );
    assert.equal(
      after.payments.find((x) => x._id === id("payment")).amount_cents,
      "2500",
    );
    assert(
      after.inventory_movements.some((x) => x.product_id === id("product")),
    );
    assert.equal(after.projects.length, 1);
    result.results.push({ scenario: phase, passed: true });
    Object.assign(result, {
      status: "PASSED",
      commands: 13,
      source_package_sha256: createHash("sha256").update(input).digest("hex"),
      source_tables: Object.keys(after).length,
      authoritative_snapshot_sha256: createHash("sha256")
        .update(afterText)
        .digest("hex"),
      limitations: [
        "Fictional command package reuses existing staff and a fixture-only won opportunity; not a real customer import",
        "Fresh isolated local backend and admin test identities only; no production migration authorized",
        "Atomic dry-run rollback and checkpoint continuation; irreversible external effects excluded",
      ],
    });
  } catch (error) {
    result.status = "FAILED";
    result.failed_phase = phase;
    result.error = String(error.message).slice(0, 350);
    process.exitCode = 1;
  } finally {
    if (child && child.exitCode === null)
      await new Promise((r) => {
        child.once("exit", r);
        child.kill();
      });
    writeFileSync(
      root + "/.acceptance/m10/migration-result.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  }
}
main();
