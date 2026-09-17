import { spawn, spawnSync, execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference as ref } from "convex/server";
import { commercialFixture } from "../.acceptance/m10/recovery-source/fixtures/commercial-unit-fixture";
import { api } from "../convex/_generated/api";
import { scopeSchema } from "../src/lib/ai/model";
const root = process.cwd(),
  home = resolve(".acceptance/m10"),
  project = home + "/recovery-source",
  cli = root + "/node_modules/convex/bin/main.js";
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/(CONVEX|RESEND|OPENAI|GOOGLE|GLARA|M9_)/.test(k),
  ),
);
const processes = [];
const instances = [];
let phase = "start";
const result = {
  mode: "isolated_restore",
  production_modified: false,
  shared_development_modified: false,
  provider_calls: 0,
};
function cmd(args, e, label, expected = 0, workdir = project) {
  const r = spawnSync(process.execPath, [cli, ...args], {
    cwd: workdir,
    env: e,
    encoding: "utf8",
    windowsHide: true,
    timeout: 180000,
  });
  writeFileSync(
    home + "/" + label + ".log",
    (r.stdout ?? "") + (r.stderr ?? ""),
  );
  if (r.status !== expected) throw Error(label + " failed");
  return r.stdout;
}
const client = (i, identity) => {
  const c = new ConvexHttpClient(i.url);
  c.setAdminAuth(i.key, identity);
  return c;
};
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
    for (const [index, name] of ["source", "target"].entries()) {
      const dir = home + "/drill-" + Date.now() + "-" + name;
      mkdirSync(dir, { recursive: true });
      const port = 3320 + index * 2,
        secret = randomBytes(32).toString("hex"),
        instance = "glara-drill-" + name;
      const backend = home + "/backend/convex-local-backend.exe";
      const kr = spawnSync(
        backend,
        [
          "keygen",
          "admin-key",
          "--instance-name",
          instance,
          "--instance-secret",
          secret,
        ],
        { encoding: "utf8", windowsHide: true },
      );
      if (kr.status !== 0) throw Error("keygen failed");
      const key = kr.stdout.trim();
      const proc = spawn(
        backend,
        [
          "--interface",
          "127.0.0.1",
          "--port",
          String(port),
          "--site-proxy-port",
          String(port + 1),
          "--instance-name",
          instance,
          "--instance-secret",
          secret,
          "--local-storage",
          dir + "/storage",
          "--disable-beacon",
          dir + "/db.sqlite3",
        ],
        { cwd: dir, env, windowsHide: true, stdio: "ignore" },
      );
      processes.push(proc);
      const url = "http://127.0.0.1:" + port;
      instances.push({
        url,
        key,
        env: {
          ...env,
          CONVEX_SELF_HOSTED_URL: url,
          CONVEX_SELF_HOSTED_ADMIN_KEY: key,
        },
      });
      let up = false;
      for (let n = 0; n < 30; n++) {
        await new Promise((r) => setTimeout(r, 500));
        try {
          if ((await fetch(url + "/version")).ok) {
            up = true;
            break;
          }
        } catch {}
      }
      if (!up) throw Error("isolated backend unavailable");
      phase = "deploy-" + name;
      console.log(phase);
      cmd(
        [
          "dev",
          "--once",
          "--typecheck",
          "disable",
          "--codegen",
          "disable",
          "--tail-logs",
          "disable",
        ],
        instances[index].env,
        "deploy-" + name,
      );
      cmd(
        ["env", "set", "M9_EMAIL_ENABLED", "false"],
        instances[index].env,
        "email-off-" + name,
      );
      cmd(
        ["env", "set", "M9_CALENDAR_ENABLED", "false"],
        instances[index].env,
        "calendar-off-" + name,
      );
    }
    const source = instances[0],
      target = instances[1],
      s = client(source),
      t = client(target);
    phase = "seed-fictional";
    console.log(phase);
    process.env.GLARA_DRILL_URL = source.url;
    process.env.GLARA_DRILL_KEY = source.key;
    const f = await commercialFixture("serialized");
    await f.reserve(1);
    await f.agreement();
    const invoice = await f.manual("100");
    await f.issue(invoice);
    await f.payment("25", [{ invoice_id: invoice, amount: "25" }]);
    phase = "populate-M7-M9";
    await f.owner.mutation(api.automation.initialize, {});
    const opportunity = await f.owner.mutation(api.sales.saveOpportunity, {
      version: 0,
      input: JSON.stringify({
        property_id: f.pid,
        assigned_to: f.who("sales").id,
        estimated_value: "1000",
        probability: 20,
        next_action_title: "Fictional recovery follow-up",
        next_action_date: "2099-01-01T18:00:00Z",
      }),
    });
    const rule = (await f.owner.query(api.automation.rules, {})).find(
      (x) => x.key === "new_contact",
    ).record;
    await f.owner.mutation(api.automation.saveRule, {
      id: rule._id,
      version: rule.version,
      config: {
        ...rule.config,
        enabled: true,
        delay_days: 0,
        entity_ids: [opportunity],
      },
    });
    await f.owner.mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: opportunity,
    });
    await f.owner.mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: opportunity,
    });
    const aiRequest = await f.c("sales").mutation(api.ai.request, {
      input: JSON.stringify({
        request_key: crypto.randomUUID(),
        scope: scopeSchema.parse({ feature: "navigation" }),
        question: "Where can I find my opportunities?",
      }),
    });
    await f.c("sales").action(api.aiProvider.generate, { id: aiRequest });
    if (
      (await f.c("sales").query(api.ai.result, { id: aiRequest })).status !==
      "completed"
    )
      throw Error("deterministic AI setup failed");
    const recipient = await f.owner.mutation(api.crm.write, {
      input: JSON.stringify({
        op: "realtor_create",
        data: {
          first_name: "Fictional",
          last_name: "Recovery communication",
          relationship_status: "active_partner",
          assigned_to: f.who("sales").id,
          email: "recovery@example.test",
        },
      }),
    });
    const sourceRef = { type: "realtor", id: recipient.id };
    await f.owner.mutation(api.communications.saveSettings, {
      version: 0,
      signature: "Fictional recovery sender",
      secondary_approval: true,
      paused: true,
    });
    await f.owner.mutation(api.communications.recordConsent, {
      source: sourceRef,
      recipient: sourceRef,
      category: "sales_relationship",
      scope: "sales_relationship",
      basis: "express_consent",
      evidence: "Fictional isolated restore consent",
      evidence_source: "Isolated drill",
      observed_at: Date.now(),
    });
    const communication = await f
      .c("sales")
      .mutation(api.communications.create, {
        source: sourceRef,
        recipient: sourceRef,
        category: "sales_relationship",
        subject: "Fictional recovery message",
        body: "Fictional draft. Never sent.",
        request_key: crypto.randomUUID(),
      });
    const storage = await s.action(ref("drill:store"), {});
    const before = await s.query(ref("drill:snapshot"), {});
    const sourceInvoice = await f.invoice(invoice);
    const sourceAvailability = await f.availability();
    result.source_rows = Object.values(before).reduce(
      (sum, rows) => sum + rows.length,
      0,
    );
    result.source_tables = Object.keys(before).length;
    result.fixture = {
      users: 6,
      realtors: before.realtors.length,
      opportunities: before.opportunities.length,
      properties: 1,
      projects: 1,
      serialized_assets: 1,
      reservations: 1,
      agreements: 1,
      invoices: 1,
      payments: 1,
      storage_files: 1,
      automation_actions: before.automation_actions.length,
      automation_executions: before.automation_executions.length,
      ai_requests: before.ai_requests.length,
      ai_conversations: before.ai_conversations.length,
      communications: before.communications.length,
      consent_events:
        before.communication_consent_events?.length ??
        before.communication_consents?.length ??
        0,
    };
    phase = "export";
    console.log(phase);
    const backup = home + "/fictional-restore-" + Date.now() + ".zip";
    cmd(
      ["export", "--path", backup, "--include-file-storage"],
      source.env,
      "export",
    );
    const bytes = readFileSync(backup);
    result.backup_bytes = bytes.length;
    result.backup_sha256 = createHash("sha256").update(bytes).digest("hex");
    cmd(
      ["env", "set", "GLARA_RECOVERY_MODE", "true"],
      target.env,
      "recovery-on",
    );
    const empty = await t.query(ref("drill:snapshot"), {});
    if (Object.values(empty).some((rows) => rows.length))
      throw Error("target nonempty");
    phase = "import";
    console.log(phase);
    const begin = performance.now();
    cmd(["import", backup, "--yes"], target.env, "import");
    result.restore_elapsed_ms = Math.round(performance.now() - begin);
    const after = await t.query(ref("drill:snapshot"), {});
    const differences = Object.keys(before).filter(
      (k) => stable(before[k]) !== stable(after[k]),
    );
    if (differences.length)
      throw Error("restore mismatch: " + differences.join(","));
    result.exact_table_comparison = "passed";
    const owner = client(target, {
      subject: f.who("owner").subject,
      issuer: "isolated-fictional",
    });
    if (
      stable(sourceInvoice) !==
      stable(await owner.query(api.commercial.invoice, { id: invoice }))
    )
      throw Error("invoice mismatch");
    if (
      stable(sourceAvailability) !==
      stable(
        await owner.query(api.inventory.availability, {
          product_id: f.product,
          location_id: f.location,
          needed_from: new Date().toLocaleDateString("en-CA", {
            timeZone: "America/Vancouver",
          }),
          needed_until: "2099-01-01",
        }),
      )
    )
      throw Error("availability mismatch");
    const storageUrl = await t.query(ref("drill:storage"), { id: storage });
    if (
      (await (await fetch(storageUrl)).text()) !==
      "Fictional restore storage integrity"
    )
      throw Error("storage mismatch");
    const restoredSales = client(target, {
      subject: f.who("sales").subject,
      issuer: "isolated-fictional",
    });
    if (
      (await restoredSales.query(api.ai.result, { id: aiRequest })).status !==
      "completed"
    )
      throw Error("AI history restore failed");
    if (
      (await restoredSales.query(api.communications.get, { id: communication }))
        .row.status !== "draft"
    )
      throw Error("Communication restore failed");
    if (
      (
        await owner.query(api.automation.actions, {
          paginationOpts: { cursor: null, numItems: 25 },
          status: "active",
        })
      ).page.length !== 1
    )
      throw Error("Automation duplicate or missing linkage");
    result.populated_M7_M8_M9_restore = "passed";
    result.storage_integrity = "passed";
    result.financial_and_inventory_projections = "passed";
    let denied = 0;
    for (const role of ["designer", "staging_crew"]) {
      try {
        await client(target, {
          subject: f.who(role).subject,
          issuer: "isolated-fictional",
        }).query(api.crm.read, { input: JSON.stringify({ op: "list" }) });
      } catch {
        denied++;
      }
    }
    if (denied !== 2) throw Error("role denial failed");
    result.role_denial = "passed";
    phase = "compatible-rollback";
    const baseline = execFileSync(
      "git",
      [
        "-c",
        "safe.directory=" + root.replaceAll("\\", "/"),
        "rev-parse",
        "HEAD",
      ],
      { encoding: "utf8", windowsHide: true },
    ).trim();
    const rollbackProject = home + "/rollback-source-" + Date.now();
    mkdirSync(rollbackProject, { recursive: true });
    const paths = execFileSync(
      "git",
      [
        "-c",
        "safe.directory=" + root.replaceAll("\\", "/"),
        "ls-tree",
        "-r",
        "--name-only",
        baseline,
        "--",
        "convex",
        "src/lib",
        "package.json",
      ],
      { encoding: "utf8", windowsHide: true },
    )
      .trim()
      .split(/\r?\n/);
    for (const file of paths) {
      const destination = resolve(rollbackProject, file);
      if (!destination.startsWith(resolve(rollbackProject) + "\\"))
        throw Error("Invalid rollback path");
      mkdirSync(resolve(destination, ".."), { recursive: true });
      writeFileSync(
        destination,
        execFileSync(
          "git",
          [
            "-c",
            "safe.directory=" + root.replaceAll("\\", "/"),
            "show",
            baseline + ":" + file,
          ],
          { windowsHide: true },
        ),
      );
    }
    writeFileSync(
      rollbackProject + "/convex/crons.ts",
      'import {cronJobs} from "convex/server";export default cronJobs();',
    );
    cmd(
      [
        "dev",
        "--once",
        "--typecheck",
        "disable",
        "--codegen",
        "disable",
        "--tail-logs",
        "disable",
      ],
      target.env,
      "rollback-code",
      0,
      rollbackProject,
    );
    if (
      stable(sourceInvoice) !==
      stable(await owner.query(api.commercial.invoice, { id: invoice }))
    )
      throw Error("baseline financial compatibility failed");
    if (!(await owner.query(api.emergency.state, {})).every((x) => x.frozen))
      throw Error("rollback lost recovery fence");
    cmd(
      [
        "dev",
        "--once",
        "--typecheck",
        "disable",
        "--codegen",
        "disable",
        "--tail-logs",
        "disable",
      ],
      target.env,
      "forward-code",
    );
    if (stable(before) !== stable(await t.query(ref("drill:snapshot"), {})))
      throw Error("rollback/forward changed authoritative records");
    result.compatible_code_rollback = {
      baseline,
      previous_source_reads: "passed",
      frozen_throughout: true,
      forward_restore_exact_data: "passed",
    };

    if (!(await owner.query(api.emergency.state, {})).every((x) => x.frozen))
      throw Error("recovery mode failed");
    result.recovery_mode = "all capabilities frozen";
    const retry = spawnSync(
      process.execPath,
      [cli, "import", backup, "--yes"],
      {
        cwd: project,
        env: target.env,
        encoding: "utf8",
        windowsHide: true,
        timeout: 60000,
      },
    );
    writeFileSync(
      home + "/import-nonempty.log",
      (retry.stdout ?? "") + (retry.stderr ?? ""),
    );
    if (retry.status === 0) throw Error("nonempty import accepted");
    result.nonempty_import = "rejected";
    result.status = "PASSED_WITH_SCOPE_LIMITATIONS";
    result.limitations = [
      "Small fictional dataset on isolated local Convex backend; not hosted backup service acceptance",
      "No production backup schedule, encryption/store ACL, retention approval or achieved RPO/RTO proven",
      "No provider state or secrets restored; cron schedule empty only in isolated source copy",
      "Data equality includes IDs, relationships, versions, audit, analytic facts and indexed projections; original commercial fixtures bypass opportunity won prerequisite only for setup",
      "Administrator test identity used; no live browser/login acceptance",
    ];
  } catch (e) {
    result.status = "INCOMPLETE";
    result.phase = phase;
    result.error = e instanceof Error ? e.message : "unknown";
    process.exitCode = 1;
  } finally {
    for (const p of processes) p.kill();
    delete process.env.GLARA_DRILL_KEY;
    writeFileSync(
      home + "/restore-result.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  }
}
main().catch(() => {
  console.error("Isolated drill failed; inspect restricted logs.");
  process.exitCode = 1;
});
