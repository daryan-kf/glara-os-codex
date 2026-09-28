// Fictional localhost-only rehearsal. No hosted data, credentials, or providers.
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, randomUUID, generateKeyPairSync } from "node:crypto";
import {
  mkdirSync,
  cpSync,
  writeFileSync,
  readFileSync,
  createWriteStream,
} from "node:fs";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference as ref } from "convex/server";
import { chromium, expect as baseExpect } from "@playwright/test";
const expect = baseExpect.configure({ timeout: 20000 });
const folder = resolve(".acceptance/campaign-portal/" + Date.now());
const url = "http://127.0.0.1:3370",
  origin = "http://localhost:3372";
mkdirSync(folder, { recursive: true });
for (const name of [
  "convex",
  "src",
  "public",
  "package.json",
  "tsconfig.json",
  "next-env.d.ts",
  "next.config.ts",
  "postcss.config.mjs",
])
  cpSync(resolve(name), folder + "/" + name, { recursive: true });
writeFileSync(
  folder + "/convex/crons.ts",
  'import {cronJobs} from "convex/server"; export default cronJobs();',
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !/(CONVEX|GLARA|AUTH_|SITE_URL|M9_|RESEND|OPENAI|GOOGLE)/.test(key),
  ),
);
const binary = resolve(".acceptance/m10/backend/convex-local-backend.exe"),
  secret = randomBytes(32).toString("hex"),
  name = "glara-portal-rehearsal";
const generated = spawnSync(
  binary,
  ["keygen", "admin-key", "--instance-name", name, "--instance-secret", secret],
  { encoding: "utf8", windowsHide: true },
);
if (generated.status !== 0) throw Error("Local backend unavailable");
const key = generated.stdout.trim();
let backend, frontend, browser, lastPage;
const streams = [];
let phase = "start";
const evidence = {
  environment: "isolated_localhost",
  production_modified: false,
  shared_development_modified: false,
  provider_calls: 0,
  results: [],
};
async function ready(endpoint) {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch(endpoint)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 400));
  }
  throw Error("Local readiness failed");
}
function command(args) {
  const r = spawnSync(
    process.execPath,
    [resolve("node_modules/convex/bin/main.js"), ...args],
    {
      cwd: folder,
      env: {
        ...env,
        CONVEX_SELF_HOSTED_URL: url,
        CONVEX_SELF_HOSTED_ADMIN_KEY: key,
      },
      encoding: "utf8",
      windowsHide: true,
      timeout: 180000,
    },
  );
  if (r.status !== 0) {
    writeFileSync(
      folder + "/command.private.log",
      (r.stdout ?? "") + (r.stderr ?? ""),
    );
    throw Error("Local fixture command failed");
  }
  return r.stdout;
}
function logProcess(process, file) {
  const stream = createWriteStream(folder + "/" + file);
  streams.push(stream);
  process.stdout.pipe(stream);
  process.stderr.pipe(stream);
}
try {
  backend = spawn(
    binary,
    [
      "--interface",
      "127.0.0.1",
      "--port",
      "3370",
      "--site-proxy-port",
      "3371",
      "--instance-name",
      name,
      "--instance-secret",
      secret,
      "--disable-beacon",
      "--local-storage",
      folder + "/storage",
      folder + "/db.sqlite3",
    ],
    {
      cwd: folder,
      env: { ...env, RUST_LOG: "warn" },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  logProcess(backend, "backend.log");
  await ready(url + "/version");
  phase = "configure";
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 }),
    jwk = keys.publicKey.export({ format: "jwk" });
  for (const [k, v] of Object.entries({
    GLARA_ENVIRONMENT: "development",
    GLARA_ACCEPTANCE_MODE: "true",
    GLARA_PUBLIC_CAMPAIGN_ONLY: "false",
    SITE_URL: origin,
    M9_EMAIL_ENABLED: "false",
    M9_CALENDAR_ENABLED: "false",
    AUTH_EMAIL_ENABLED: "false",
    GLARA_AUTOMATION_ENABLED: "false",
    GLARA_AI_SECURITY_APPROVED: "false",
    GLARA_EXPO_RECEIPTS_ENABLED: "false",
    GLARA_EXPO_ENABLED: "true",
    GLARA_EXPO_INGRESS_SECRET: randomBytes(32).toString("hex"),
    JWT_PRIVATE_KEY: keys.privateKey
      .export({ type: "pkcs8", format: "pem" })
      .toString(),
    JWKS: JSON.stringify({ keys: [{ ...jwk, use: "sig" }] }),
  }))
    command(["env", "set", "--", k, v]);
  phase = "deploy_local";
  command([
    "dev",
    "--once",
    "--typecheck",
    "disable",
    "--codegen",
    "disable",
    "--tail-logs",
    "disable",
  ]);
  const admin = new ConvexHttpClient(url, { logger: false });
  admin.setAdminAuth(key);
  const email = "portal-owner@accounts.example.test",
    password = randomUUID() + randomUUID();
  const userId = await admin.action(ref("admin:provision"), {
    email,
    password,
    name: "Fictional Portal Owner",
    roles: ["owner"],
  });
  const login = await admin.action(ref("auth:signIn"), {
    provider: "password",
    params: { flow: "signIn", email, password },
  });
  const owner = new ConvexHttpClient(url, { logger: false });
  owner.setAuth(login.tokens.token);
  const fixture = JSON.parse(
    readFileSync(resolve("docs/pacificwest-campaign.json"), "utf8"),
  );
  const campaign = await owner.mutation(ref("campaigns:save"), {
    version: 0,
    input: JSON.stringify({
      ...fixture,
      name: "Fictional PacificWest Rehearsal",
      assigned_to: userId,
      starts_at: Date.now() - 60000,
      closes_at: Date.now() + 86400000,
    }),
  });
  await owner.mutation(ref("campaigns:transition"), {
    id: campaign,
    version: 1,
    to: "open",
  });
  const enter = async (n) => {
    const r = await admin.mutation(ref("campaigns:register"), {
      input: JSON.stringify({
        slug: "pacificwest-2026",
        first_name: "Fictional",
        last_name: "Participant " + n,
        brokerage: "Fictional Brokerage",
        email: `participant${n}@accounts.example.test`,
        phone: "604555" + String(n).padStart(4, "0"),
        city: "Vancouver",
        licensed_realtor: true,
        licensed_in_bc: true,
        annual_listings: "11–20",
        rules_version: fixture.rules_version,
        rules_accepted: true,
        marketing_consent: n % 2 === 0,
        source: "direct",
        website: "",
        started_at: Date.now() - 10000,
      }),
      network_key: "local-network",
      identity_key: "local-email-" + n,
      phone_identity_key: "local-phone-" + n,
    });
    if (r.status !== "received") throw Error("Fixture registration failed");
  };
  await enter(1);
  for (const [k, v] of Object.entries({
    GLARA_PUBLIC_CAMPAIGN_ONLY: "true",
    GLARA_EXPO_ADMIN_ENABLED: "true",
    GLARA_EXPO_ADMIN_USER_ID: userId,
  }))
    command(["env", "set", k, v]);
  phase = "frontend";
  frontend = spawn(
    process.execPath,
    [
      resolve("node_modules/next/dist/bin/next"),
      "dev",
      "--webpack",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3372",
    ],
    {
      cwd: folder,
      env: {
        ...env,
        NEXT_PUBLIC_CONVEX_URL: url,
        NEXT_PUBLIC_CONVEX_SITE_URL: "http://127.0.0.1:3371",
        GLARA_ENVIRONMENT: "development",
        SITE_URL: origin,
        GLARA_PUBLIC_CAMPAIGN_ONLY: "true",
        GLARA_EXPO_ADMIN_ENABLED: "true",
      },
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  logProcess(frontend, "frontend.log");
  await ready(origin + "/campaign-admin");
  browser = await chromium.launch({ channel: "msedge", headless: true });
  for (const [view, viewport, n] of [
    ["desktop", { width: 1440, height: 1000 }, 2],
    ["mobile", { width: 390, height: 844 }, 3],
  ]) {
    phase = view + "_login";
    const context = await browser.newContext({ viewport });
    const page = await context.newPage();
    lastPage = page;
    await page.goto(origin + "/campaign-admin", { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    await expect(
      page.getByRole("heading", { name: "Owner sign-in" }),
    ).toBeVisible();
    await expect(
      page.getByText("participant1@accounts.example.test", { exact: true }),
    ).toHaveCount(0);
    await page.getByLabel("Email address").fill(email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page
      .getByRole("button", { name: "View registrations", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Fictional Participant 1",
        exact: true,
      }),
    ).toBeVisible();
    phase = view + "_realtime";
    await enter(n);
    await expect(
      page.getByRole("heading", {
        name: "Fictional Participant " + n,
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Find a participant").fill("participant" + n + "@");
    await expect(
      page.getByRole("heading", {
        name: "Fictional Participant 1",
        exact: true,
      }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("heading", {
        name: "Fictional Participant " + n,
        exact: true,
      }),
    ).toBeVisible();
    await page.getByLabel("Find a participant").fill("");
    await expect(
      page.getByRole("heading", {
        name: "Fictional Participant 1",
        exact: true,
      }),
    ).toBeVisible();
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth + 1,
      )
    )
      throw Error("Horizontal overflow");
    await page.screenshot({
      path: folder + "/" + view + ".png",
      fullPage: true,
    });
    for (const path of [
      "/dashboard",
      "/marketing",
      "/campaign-admin/export",
      "/login",
    ]) {
      const r = await context.request.get(origin + path);
      if (r.status() !== 404) throw Error("Scope route escaped");
    }
    phase = view + "_logout";
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Owner sign-in" }),
    ).toBeVisible();
    await expect(
      page.getByText("participant1@accounts.example.test", { exact: true }),
    ).toHaveCount(0);
    evidence.results.push({
      view,
      login: "PASS",
      realtime: "PASS",
      search: "PASS",
      layout: "PASS",
      scope: "PASS",
      logout: "PASS",
    });
    await context.close();
  }
  phase = "disabled";
  command(["env", "set", "GLARA_EXPO_ADMIN_ENABLED", "false"]);
  let denied = false;
  try {
    await admin.action(ref("auth:signIn"), {
      provider: "password",
      params: { flow: "signIn", email, password },
    });
  } catch {
    denied = true;
  }
  if (!denied) throw Error("Disabled portal still signs in");
  evidence.disabled_signin = "PASS";
  evidence.status = "PASS";
} catch (error) {
  if (lastPage && !lastPage.isClosed()) {
    await lastPage
      .screenshot({ path: folder + "/failure.png", fullPage: true })
      .catch(() => {});
    writeFileSync(
      folder + "/failure.html",
      await lastPage.content().catch(() => ""),
    );
  }
  evidence.status = "FAIL";
  evidence.phase = phase;
  writeFileSync(folder + "/error.private.log", String(error.stack ?? error));
  process.exitCode = 1;
} finally {
  await browser?.close();
  for (const child of [frontend, backend]) {
    if (!child?.pid) continue;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } else child.kill();
  }
  for (const stream of streams) stream.end();
  evidence.finished_at = new Date().toISOString();
  writeFileSync(folder + "/evidence.json", JSON.stringify(evidence, null, 2));
  console.log(
    JSON.stringify({ ...evidence, evidence_directory: folder }, null, 2),
  );
}
