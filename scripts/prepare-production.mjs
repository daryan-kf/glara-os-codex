// Closed preparation only. No owner creation, provider credentials or data import.
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";
const target = "terrific-seahorse-419";
const projectId = 2991851;
const flags = {
  GLARA_ENVIRONMENT: "production",
  GLARA_PRODUCTION_APPROVED: "false",
  GLARA_RECOVERY_MODE: "true",
  GLARA_ACCEPTANCE_MODE: "false",
  GLARA_PRODUCTION_EMAIL_APPROVED: "false",
  GLARA_PRODUCTION_CALENDAR_APPROVED: "false",
  GLARA_PRODUCTION_AI_APPROVED: "false",
  GLARA_PRODUCTION_AUTOMATION_APPROVED: "false",
  GLARA_PRODUCTION_AUTH_EMAIL_APPROVED: "false",
  GLARA_PRODUCTION_ONBOARDING_APPROVED: "false",
  GLARA_PRODUCTION_EXTERNAL_ASSETS_APPROVED: "false",
  GLARA_PRODUCTION_ADDRESS_LOOKUP_APPROVED: "false",
  M9_EMAIL_ENABLED: "false",
  M9_CALENDAR_ENABLED: "false",
  AUTH_EMAIL_ENABLED: "false",
  GLARA_AI_SECURITY_APPROVED: "false",
  GLARA_AUTOMATION_ENABLED: "false",
  GLARA_HTTPS_READY: "false",
};
const args = new Set(process.argv.slice(2));
if ([...args].some((arg) => !["--configure", "--deploy"].includes(arg)))
  throw Error("Unsupported preparation option");
const root = process.cwd();
const folder = resolve(".acceptance/production");
mkdirSync(folder, { recursive: true });
const baseEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/^(CONVEX|GLARA|M9_|AUTH_|OPENAI|SITE_URL)/.test(key),
  ),
);
function cli(args, extraEnv = {}, input) {
  const result = spawnSync(
    process.execPath,
    [resolve("node_modules/convex/bin/main.js"), ...args],
    {
      cwd: root,
      env: { ...baseEnv, ...extraEnv },
      input,
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
    },
  );
  if (result.status !== 0) {
    writeFileSync(
      folder + "/last-command.private.log",
      (result.stdout ?? "") + (result.stderr ?? ""),
    );
    throw Error(
      "Preparation command failed: " +
        args[0] +
        "; inspect private log locally",
    );
  }
  const output = result.stdout.trim();
  if (
    args[0] === "data" &&
    args.includes("--format") &&
    !output &&
    result.stderr.includes("There are no documents in this table.")
  )
    return "[]";
  return output;
}
const auth = JSON.parse(
  readFileSync(homedir() + "/.convex/config.json", "utf8"),
);
const inventoryResponse = await fetch(
  "https://api.convex.dev/v1/projects/" + projectId + "/list_deployments",
  { headers: { Authorization: "Bearer " + auth.accessToken } },
);
if (!inventoryResponse.ok) throw Error("Cannot verify production identity");
const inventory = await inventoryResponse.json();
const deployment = inventory.find((item) => item.name === target);
if (
  deployment?.deploymentType !== "prod" ||
  deployment.projectId !== projectId ||
  deployment.reference !== "production-preparation" ||
  deployment.isDefault
)
  throw Error("Unexpected production target");
const names = cli(["env", "list", "--names-only", "--deployment", target])
  .split(/\r?\n/)
  .filter(Boolean);
if (names.some((name) => !Object.hasOwn(flags, name)))
  throw Error("Production configuration changed; review before preparation");
for (const name of names)
  if (cli(["env", "get", name, "--deployment", target]) !== flags[name])
    throw Error("Production is no longer in closed preparation state");
for (const table of [
  "users",
  "profiles",
  "realtors",
  "projects",
  "products",
  "payments",
  "_storage",
])
  if (
    JSON.parse(
      cli([
        "data",
        table,
        "--limit",
        "1",
        "--format",
        "json",
        "--deployment",
        target,
      ]),
    ).length
  )
    throw Error("Nonempty production target: " + table);
if (args.has("--configure")) {
  for (const [name, value] of Object.entries(flags))
    if (!names.includes(name))
      cli(["env", "set", name, "--deployment", target], {}, value);
}
for (const [name, value] of Object.entries(flags))
  if (cli(["env", "get", name, "--deployment", target]) !== value)
    throw Error("Disabled flag verification failed: " + name);
let deployed = false;
if (args.has("--deploy")) {
  const name = "closed-preparation-" + Date.now();
  let keyCreated = false;
  try {
    const key = cli([
      "deployment",
      "token",
      "create",
      name,
      "--deployment",
      target,
    ]);
    keyCreated = true;
    if (!key.startsWith("prod:" + target + "|"))
      throw Error("Scoped deployment key mismatch");
    cli(["deploy", "--yes", "--typecheck", "enable", "--codegen", "disable"], {
      CONVEX_DEPLOY_KEY: key,
    });
    deployed = true;
  } finally {
    if (keyCreated)
      cli(["deployment", "token", "delete", name, "--deployment", target]);
  }
}
const tables = cli(["data", "--deployment", target])
  .split(/\r?\n/)
  .filter(Boolean);
const empty = [];
for (const table of [
  ...new Set([...tables, "users", "profiles", "_storage"]),
]) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(table))
    throw Error("Unexpected table metadata");
  if (
    JSON.parse(
      cli([
        "data",
        table,
        "--limit",
        "1",
        "--format",
        "json",
        "--deployment",
        target,
      ]),
    ).length
  )
    throw Error("Nonempty production table: " + table);
  empty.push(table);
}
const evidence = {
  checked_at: new Date().toISOString(),
  deployment: target,
  project_id: projectId,
  type: "prod",
  reference: deployment.reference,
  region: deployment.region,
  url: deployment.deploymentUrl,
  flags,
  empty_tables_verified: empty,
  code_deployed_this_run: deployed,
  owner_created: false,
  secrets_copied: false,
  provider_credentials_configured: false,
  production_traffic_authorized: false,
};
writeFileSync(
  folder + "/closed-preparation.json",
  JSON.stringify(evidence, null, 2) + "\n",
);
console.log(JSON.stringify(evidence));
