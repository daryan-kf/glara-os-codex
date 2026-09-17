import { spawn, spawnSync } from "node:child_process";
import {
  randomBytes,
  randomUUID,
  generateKeyPairSync,
  createHash,
} from "node:crypto";
import {
  mkdirSync,
  cpSync,
  writeFileSync,
  createWriteStream,
  existsSync,
} from "node:fs";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference as ref } from "convex/server";
import { chromium, expect } from "@playwright/test";
const root = process.cwd(),
  home = resolve(".acceptance/m10/auth-browser-" + Date.now()),
  url = "http://127.0.0.1:3350",
  origin = "http://localhost:3352";
mkdirSync(home, { recursive: true });
for (const file of [
  "convex",
  "src",
  "public",
  "package.json",
  "tsconfig.json",
  "next-env.d.ts",
  "next.config.ts",
  "postcss.config.mjs",
  "components.json",
]) {
  if (existsSync(resolve(file)))
    cpSync(resolve(file), home + "/" + file, { recursive: true });
}
writeFileSync(
  home + "/convex/crons.ts",
  'import {cronJobs} from "convex/server";export default cronJobs();',
);
// This fixture exists only in a private isolated copy, never in the deployed application.
writeFileSync(
  home + "/convex/authBrowserDrill.ts",
  String.raw`import {internalMutation} from "./_generated/server";import {v} from "convex/values";export const code=internalMutation({args:{email:v.string(),hash:v.string(),expired:v.boolean()},handler:async(ctx,a)=>{if(!/^http:\/\/127\.0\.0\.1:3351$/.test(process.env.CONVEX_SITE_URL??""))throw Error("ISOLATED_ONLY");const account=await ctx.db.query("authAccounts").withIndex("providerAndAccountId",q=>q.eq("provider","password").eq("providerAccountId",a.email)).unique();if(!account)throw Error("ACCOUNT_REQUIRED");for(const old of await ctx.db.query("authVerificationCodes").withIndex("accountId",q=>q.eq("accountId",account._id)).collect())await ctx.db.delete(old._id);await ctx.db.insert("authVerificationCodes",{accountId:account._id,provider:"glara-email",code:a.hash,expirationTime:Date.now()+(a.expired?-1000:900000),emailVerified:a.email});}});`,
);
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/(CONVEX|RESEND|OPENAI|GOOGLE|GLARA|M9_|SITE_URL)/.test(k),
  ),
);
let backend, frontend, browser;
const streams = [];
const result = {
  executed_at: new Date().toISOString(),
  environment: "isolated_restore",
  production_modified: false,
  shared_development_modified: false,
  provider_calls: 0,
  results: [],
};
let phase = "start";
async function ready(endpoint) {
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      if ((await fetch(endpoint)).ok) return;
    } catch {}
  }
  throw Error("readiness failed");
}
async function main() {
  try {
    const secret = randomBytes(32).toString("hex"),
      binary = root + "/.acceptance/m10/backend/convex-local-backend.exe",
      name = "glara-isolated-auth";
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
    backend = spawn(
      binary,
      [
        "--interface",
        "127.0.0.1",
        "--port",
        "3350",
        "--site-proxy-port",
        "3351",
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
    await ready(url + "/version");
    const cmd = (args) => {
      const r = spawnSync(
        process.execPath,
        [root + "/node_modules/convex/bin/main.js", ...args],
        {
          cwd: home,
          env: {
            ...env,
            CONVEX_SELF_HOSTED_URL: url,
            CONVEX_SELF_HOSTED_ADMIN_KEY: key,
          },
          encoding: "utf8",
          windowsHide: true,
        },
      );
      if (r.status !== 0) {
        writeFileSync(
          home + "/failed-command.log",
          (r.stdout ?? "") + (r.stderr ?? ""),
        );
        throw Error("isolated command failed");
      }
      return r.stdout;
    };
    phase = "configure";
    const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = keys.publicKey.export({ format: "jwk" });
    for (const [k, v] of Object.entries({
      GLARA_ENVIRONMENT: "development",
      GLARA_ACCEPTANCE_MODE: "true",
      SITE_URL: origin,
      M9_EMAIL_ENABLED: "false",
      M9_CALENDAR_ENABLED: "false",
      AUTH_EMAIL_ENABLED: "false",
      JWT_PRIVATE_KEY: keys.privateKey
        .export({ type: "pkcs8", format: "pem" })
        .toString(),
      JWKS: JSON.stringify({ keys: [{ ...jwk, use: "sig" }] }),
    }))
      cmd(["env", "set", "--", k, v]);
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
    const admin = new ConvexHttpClient(url, { logger: false });
    admin.setAdminAuth(key);
    const email = "onboarding@accounts.example.test",
      initial = randomUUID() + randomUUID(),
      next = randomUUID() + randomUUID();
    await admin.action(ref("admin:provision"), {
      email,
      name: "Fictional isolated onboarding",
      roles: ["sales"],
      password: initial,
    });
    const code = async (expired = false) => {
      const token = randomUUID();
      await admin.mutation(ref("authBrowserDrill:code"), {
        email,
        hash: createHash("sha256").update(token).digest("hex"),
        expired,
      });
      return token;
    };
    phase = "frontend";
    const log = createWriteStream(home + "/frontend.log");
    streams.push(log);
    frontend = spawn(
      process.execPath,
      [
        root + "/node_modules/next/dist/bin/next",
        "dev",
        "--webpack",
        "--port",
        "3352",
        "--hostname",
        "127.0.0.1",
      ],
      {
        cwd: home,
        env: {
          ...env,
          NEXT_PUBLIC_CONVEX_URL: url,
          NEXT_PUBLIC_CONVEX_SITE_URL: "http://127.0.0.1:3351",
          GLARA_ENVIRONMENT: "development",
        },
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    frontend.stdout.pipe(log);
    frontend.stderr.pipe(log);
    await ready(origin + "/login");
    browser = await chromium.launch({ channel: "msedge", headless: true });
    for (const [name, viewport] of [
      ["desktop", { width: 1280, height: 900 }],
      ["mobile", { width: 393, height: 851 }],
    ]) {
      const ctx = await browser.newContext({ viewport }),
        page = await ctx.newPage();
      page.setDefaultTimeout(30000);
      const redeem = async (token, address = email) => {
        await page.goto(origin + "/update-password");
        await page.getByLabel("Work email").fill(address);
        await page.getByLabel("Verification code").fill(token);
        await page.getByLabel("New password", { exact: true }).fill(next);
        await page.getByLabel("Confirm password").fill(next);
        await page
          .getByRole("button", { name: "Save new password", exact: true })
          .click();
      };
      phase = name + "-expired";
      await redeem(await code(true));
      await expect(page.locator("form").getByRole("alert")).toContainText(
        "invalid or has expired",
      );
      result.results.push({ scenario: phase, passed: true });
      phase = name + "-mismatch";
      const valid = await code();
      await redeem(valid, "mismatch@accounts.example.test");
      await expect(page.locator("form").getByRole("alert")).toContainText(
        "invalid or has expired",
      );
      result.results.push({ scenario: phase, passed: true });
      phase = name + "-valid";
      await redeem(valid);
      await expect(page).toHaveURL(/login\?status=password-updated$/);
      result.results.push({ scenario: phase, passed: true });
      phase = name + "-reused";
      await redeem(valid);
      await expect(page.locator("form").getByRole("alert")).toContainText(
        "invalid or has expired",
      );
      result.results.push({ scenario: phase, passed: true });
      phase = name + "-new-login";
      await page.goto(origin + "/login?next=https://unapproved.example.test");
      await page.getByLabel("Work email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(next);
      await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
      await expect(page).toHaveURL(origin + "/dashboard");
      await expect(page.locator("main")).toBeVisible();
      result.results.push({ scenario: phase, passed: true });
      phase = name + "-logout";
      if (name === "mobile")
        await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      await expect(page).toHaveURL(/login$/);
      await ctx.close();
      result.results.push({ scenario: phase, passed: true });
    }
    result.status = "PASSED";
  } catch (error) {
    result.status = "FAILED";
    result.failed_phase = phase;
    result.failure = String(error.message)
      .replace(/[a-f0-9-]{24,}/gi, "[redacted]")
      .slice(0, 600);
    process.exitCode = 1;
  } finally {
    await browser?.close();
    for (const p of [frontend, backend])
      if (p)
        await new Promise((r) => {
          p.once("exit", r);
          p.kill();
        });
    for (const s of streams) s.end();
    writeFileSync(
      root + "/.acceptance/m10/auth-browser.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  }
}
main();
