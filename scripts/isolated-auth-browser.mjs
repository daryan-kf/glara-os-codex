import { createServer as createHttpsServer } from "node:https";
import { request as httpRequest } from "node:http";
import { connect as tcpConnect } from "node:net";
import { spawn, spawnSync } from "node:child_process";
import {
  randomBytes,
  randomUUID,
  generateKeyPairSync,
  createHash,
} from "node:crypto";
import {
  mkdirSync,
  appendFileSync,
  cpSync,
  writeFileSync,
  createWriteStream,
  existsSync,
  readFileSync,
} from "node:fs";
import { resolve } from "node:path";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference as ref } from "convex/server";
import { chromium, expect as playwrightExpect } from "@playwright/test";
const expect = playwrightExpect.configure({ timeout: 15000 });
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
if (process.env.GLARA_PAYMENT_PROJECTS_REGRESSION === "yes") {
  // Fixture preparation only: the generated module never leaves this local copy.
  appendFileSync(
    home + "/convex/authBrowserDrill.ts",
    String.raw`
export const won=internalMutation({args:{id:v.id("opportunities")},handler:async(ctx,a)=>{
if(process.env.CONVEX_SITE_URL!=="http://127.0.0.1:3351")throw Error("ISOLATED_ONLY");
await ctx.db.patch(a.id,{stage:"won",won_at:new Date().toISOString()});
}});`,
  );
}
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/(CONVEX|RESEND|OPENAI|GOOGLE|GLARA|M9_|SITE_URL)/.test(k),
  ),
);
const expo = process.env.GLARA_EXPO_REGRESSION === "yes",
  expoSecret = randomBytes(32).toString("hex");
const pacificwest = expo
  ? JSON.parse(readFileSync(resolve("docs/pacificwest-campaign.json"), "utf8"))
  : null;
const expoSlug = (viewport) =>
  viewport === "desktop" ? "pacificwest-2026" : "fictional-expo-mobile";
if (expo)
  appendFileSync(
    home + "/convex/authBrowserDrill.ts",
    String.raw`
export const expoWindow=internalMutation({args:{starts:v.number(),closes:v.number()},handler:async(ctx,a)=>{
if(process.env.CONVEX_SITE_URL!=="http://127.0.0.1:3351")throw Error("ISOLATED_ONLY");
for(const c of await ctx.db.query("marketing_campaigns").collect())await ctx.db.patch(c._id,{starts_at:a.starts,closes_at:a.closes});
}});
export const expoEvidence=internalMutation({args:{},handler:async(ctx)=>{
if(process.env.CONVEX_SITE_URL!=="http://127.0.0.1:3351")throw Error("ISOLATED_ONLY");
return {
entries:await ctx.db.query("campaign_entries").collect(),
awards:await ctx.db.query("campaign_awards").collect(),
realtors:await ctx.db.query("realtors").collect(),
payments:(await ctx.db.query("payments").collect()).length,
outbox:(await ctx.db.query("communication_outbox").collect()).length,
providerMessages:(await ctx.db.query("communication_provider_messages").collect()).length,
calendarEvents:(await ctx.db.query("calendar_sync_events").collect()).length,
};}});`,
  );

let backend, frontend, browser, tlsProxy;
const tlsSockets = new Set();
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
    if (backend && backend.exitCode !== null)
      throw Error("Isolated backend exited; inspect backend.log");
    if (frontend && frontend.exitCode !== null)
      throw Error("Isolated frontend exited; inspect frontend.log");
    await new Promise((r) => setTimeout(r, 500));
    try {
      if ((await fetch(endpoint)).ok) return;
    } catch {}
  }
  throw Error("readiness failed");
}
async function main() {
  try {
    if (expo) {
      const openssl =
        process.env.GLARA_TEST_OPENSSL ??
        "C:/Program Files/Git/usr/bin/openssl.exe";
      const generated = spawnSync(
        openssl,
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          home + "/localhost.key",
          "-out",
          home + "/localhost.crt",
          "-days",
          "1",
          "-subj",
          "/CN=localhost",
          "-addext",
          "subjectAltName=DNS:localhost,IP:127.0.0.1",
        ],
        { encoding: "utf8", windowsHide: true },
      );
      if (generated.status !== 0)
        throw Error("Local TLS certificate generation failed");
    }
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
    const backendLog = createWriteStream(home + "/backend.log");
    streams.push(backendLog);
    backend = spawn(
      binary,
      [
        "--interface",
        "127.0.0.1",
        "--port",
        "3350",
        "--site-proxy-port",
        "3351",
        ...(expo
          ? [
              "--convex-origin",
              "https://127.0.0.1:3353",
              "--convex-site",
              "http://127.0.0.1:3351",
            ]
          : []),
        "--instance-name",
        name,
        "--instance-secret",
        secret,
        "--disable-beacon",
        "--local-storage",
        home + "/storage",
        home + "/db.sqlite3",
      ],
      {
        cwd: home,
        env: {
          ...env,
          ...(expo ? { NODE_EXTRA_CA_CERTS: home + "/localhost.crt" } : {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    backend.stdout.pipe(backendLog);
    backend.stderr.pipe(backendLog);
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
      ...(expo
        ? { GLARA_EXPO_ENABLED: "true", GLARA_EXPO_INGRESS_SECRET: expoSecret }
        : {}),
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
    const ownerId = await admin.action(ref("admin:provision"), {
      email,
      name: "Fictional isolated onboarding",
      roles:
        process.env.GLARA_POST_M10_REGRESSION === "yes" ||
        process.env.GLARA_PAYMENT_PROJECTS_REGRESSION === "yes" ||
        expo
          ? ["owner"]
          : ["sales"],
      password: initial,
    });
    const paymentProjects = [];
    if (process.env.GLARA_PAYMENT_PROJECTS_REGRESSION === "yes") {
      const signed = await admin.action(ref("auth:signIn"), {
        provider: "password",
        params: { email, password: initial, flow: "signIn" },
      });
      const actor = new ConvexHttpClient(url, { logger: false });
      actor.setAuth(signed.tokens.token);
      const customer = await actor.mutation(ref("commercial:saveCustomer"), {
        version: 0,
        input: JSON.stringify({
          type: "seller",
          name: "Fictional payment customer",
          contact: "Fictional",
          email: "payment@accounts.example.test",
          phone: "",
          company: "",
          address: "Fictional Vancouver",
        }),
      });
      const realtor = await actor.mutation(ref("crm:write"), {
        input: JSON.stringify({
          op: "realtor_create",
          data: {
            first_name: "Fictional",
            last_name: "Payments",
            relationship_status: "active_partner",
            assigned_to: ownerId,
          },
        }),
      });
      for (const [address, renewal] of [
        ["10 Fictional Balance Avenue", false],
        ["20 Fictional Renewal Avenue", true],
      ]) {
        const property = await actor.mutation(ref("sales:saveProperty"), {
          version: 0,
          input: JSON.stringify({
            address_line_1: address,
            city: "Vancouver",
            province: "BC",
            property_type: "detached",
            occupancy_status: "vacant",
            realtor_id: realtor.id,
          }),
        });
        const opportunity = await actor.mutation(ref("sales:saveOpportunity"), {
          version: 0,
          input: JSON.stringify({
            property_id: property,
            assigned_to: ownerId,
            estimated_value: "1000",
            probability: 20,
            next_action_title: "Fictional follow-up",
            next_action_date: "2099-01-01T18:00:00Z",
          }),
        });
        await admin.mutation(ref("authBrowserDrill:won"), { id: opportunity });
        const project = await actor.mutation(ref("operations:create"), {
          opportunity_id: opportunity,
          source_quote_id: null,
          project_manager_id: ownerId,
          designer_id: ownerId,
          staging_lead_id: ownerId,
          input: JSON.stringify({
            package_type: "standard",
            planned_end_date: renewal
              ? new Date().toISOString().slice(0, 10)
              : "2099-01-01",
            priority: "normal",
            internal_notes: "Fictional browser fixture",
          }),
          rooms: [
            JSON.stringify({
              room_type: "living_room",
              room_name: "Living room",
              staging_scope: "full",
              style_direction: "Calm",
              notes: "",
              status: "design_ready",
              sort_order: 0,
            }),
          ],
        });
        paymentProjects.push(project.id);
        if (!renewal) {
          const invoice = await actor.mutation(ref("commercial:saveInvoice"), {
            project_id: project.id,
            customer_id: customer,
            version: 0,
            input: JSON.stringify({
              issue_date: "2026-09-01",
              due_date: "2026-09-01",
              notes: "Fictional browser invoice",
              items: [
                {
                  description: "Fictional service",
                  quantity: 1,
                  unit_amount: "100",
                  discount: "0",
                  taxes: [],
                },
              ],
            }),
          });
          await actor.mutation(ref("commercial:invoiceAction"), {
            id: invoice,
            version: 1,
            action: "issue",
            reason: "Fictional test invoice",
          });
          await actor.mutation(ref("commercial:recordPayment"), {
            project_id: project.id,
            customer_id: customer,
            amount: "25",
            method: "e_transfer",
            received_date: "2026-09-01",
            external_reference: "Fictional test receipt",
            notes: "",
            allocations: [{ invoice_id: invoice, amount: "25" }],
            request_key: randomUUID(),
          });
        }
      }
    }
    if (expo) {
      const signed = await admin.action(ref("auth:signIn"), {
        provider: "password",
        params: { email, password: initial, flow: "signIn" },
      });
      const actor = new ConvexHttpClient(url, { logger: false });
      actor.setAuth(signed.tokens.token);
      for (const viewport of ["desktop", "mobile"]) {
        const id = await actor.mutation(ref("campaigns:save"), {
          version: 0,
          input: JSON.stringify({
            name: "Fictional Expo " + viewport,
            slug: expoSlug(viewport),
            public_title: "WIN A $2,000 GLARA STAGING CREDIT",
            public_description:
              "Meet the Glara team and enter our fictional acceptance giveaway.",
            prize_name: "Glara Staging Credit",
            prize_value_cents: 200000,
            starts_at: Date.now() + 3600000,
            closes_at: Date.now() + 86400000,
            eligibility_summary:
              "Licensed Realtors in British Columbia. One eligible entry per Realtor.",
            eligible_cities: [],
            eligible_province: "BC",
            rules_version: "test-1",
            prize_terms_version: "test-1",
            expiry_months_after_confirmation: 6,
            skill_question_required: true,
            // Use the approved PacificWest copy; only fixture dates/identities differ.
            official_rules: pacificwest.official_rules,
            privacy_notice: pacificwest.privacy_notice,
            consent_text: pacificwest.consent_text,
            prize_terms: pacificwest.prize_terms,
            assigned_to: ownerId,
            legal_approved: true,
          }),
        });
        await actor.mutation(ref("campaigns:transition"), {
          id,
          version: 1,
          to: "scheduled",
        });
      }
    }
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
    let browserBackend = url;
    if (expo) {
      phase = "isolated-tls-proxy";
      tlsProxy = createHttpsServer(
        {
          key: readFileSync(home + "/localhost.key"),
          cert: readFileSync(home + "/localhost.crt"),
        },
        (request, response) => {
          const upstream = httpRequest(
            {
              host: "127.0.0.1",
              port: 3350,
              path: request.url,
              method: request.method,
              headers: { ...request.headers, host: "127.0.0.1:3350" },
            },
            (remote) => {
              response.writeHead(remote.statusCode ?? 502, remote.headers);
              remote.pipe(response);
            },
          );
          upstream.on("error", () => {
            response.writeHead(502);
            response.end();
          });
          request.pipe(upstream);
        },
      );
      tlsProxy.on("upgrade", (request, socket, head) => {
        const upstream = tcpConnect(3350, "127.0.0.1", () => {
          const headers = request.rawHeaders.reduce(
            (list, value, index, all) =>
              index % 2
                ? list
                : [
                    ...list,
                    value +
                      ": " +
                      (value.toLowerCase() === "host"
                        ? "127.0.0.1:3350"
                        : all[index + 1]),
                  ],
            [],
          );
          upstream.write(
            request.method +
              " " +
              request.url +
              " HTTP/" +
              request.httpVersion +
              "\r\n" +
              headers.join("\r\n") +
              "\r\n\r\n",
          );
          if (head.length) upstream.write(head);
          socket.pipe(upstream).pipe(socket);
        });
        for (const stream of [socket, upstream]) {
          tlsSockets.add(stream);
          stream.on("close", () => tlsSockets.delete(stream));
        }
        upstream.on("error", () => socket.destroy());
        socket.on("error", () => upstream.destroy());
        socket.on("close", () => upstream.destroy());
      });
      await new Promise((resolve, reject) => {
        tlsProxy.once("error", reject);
        tlsProxy.listen(3353, "127.0.0.1", resolve);
      });
      browserBackend = "https://127.0.0.1:3353";
    }
    const frontendEnv = {
      ...env,
      NEXT_PUBLIC_CONVEX_URL: browserBackend,
      NEXT_PUBLIC_CONVEX_SITE_URL: "http://127.0.0.1:3351",
      GLARA_ENVIRONMENT: "development",
      SITE_URL: origin,
      ...(expo
        ? {
            GLARA_EXPO_ENABLED: "true",
            GLARA_EXPO_INGRESS_SECRET: expoSecret,
            GLARA_PUBLIC_CAMPAIGN_ROUTING: "true",
            NODE_EXTRA_CA_CERTS: home + "/localhost.crt",
          }
        : {}),
    };
    if (expo) {
      phase = "isolated-production-build";
      const build = spawnSync(
        process.execPath,
        [root + "/node_modules/next/dist/bin/next", "build", "--webpack"],
        {
          cwd: home,
          env: frontendEnv,
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 20 * 1024 * 1024,
        },
      );
      writeFileSync(
        home + "/build.log",
        (build.stdout ?? "") + (build.stderr ?? ""),
      );
      if (build.status !== 0)
        throw Error("Isolated production build failed; inspect build.log");
    }
    frontend = spawn(
      process.execPath,
      [
        root + "/node_modules/next/dist/bin/next",
        ...(expo ? ["start"] : ["dev", "--webpack"]),
        "--port",
        "3352",
        "--hostname",
        "127.0.0.1",
      ],
      {
        cwd: home,
        env: frontendEnv,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    frontend.stdout.pipe(log);
    frontend.stderr.pipe(log);
    await ready(origin + "/login");
    browser = await chromium.launch({ channel: "msedge", headless: true });
    if (expo) {
      // Shared development remains disabled. This disposable localhost backend alone opens for rehearsal.
      for (const [name, viewport] of [
        ["desktop", { width: 1280, height: 900 }],
        ["mobile", { width: 393, height: 851 }],
      ]) {
        phase = name + "-win-alias-final-copy-and-disabled-gate";
        const context = await browser.newContext({
          viewport,
          ignoreHTTPSErrors: true,
        });
        await context.route("**/*", (route) =>
          ["localhost", "127.0.0.1"].includes(
            new URL(route.request().url()).hostname,
          )
            ? route.continue()
            : route.abort(),
        );
        const page = await context.newPage();
        cmd(["env", "set", "GLARA_EXPO_ENABLED", "false"]);
        await page.goto(origin + "/win");
        await expect(
          page.getByRole("heading", {
            name: "Registration opens soon",
            exact: true,
          }),
        ).toBeVisible();
        cmd(["env", "set", "GLARA_EXPO_ENABLED", "true"]);
        await page.reload();
        await expect(
          page.getByRole("heading", {
            name: "Registration opens soon",
            exact: true,
          }),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "ENTER TO WIN", exact: true }),
        ).toBeDisabled();
        await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
          "href",
          "https://glarahome.com/win",
        );
        await expect(page).toHaveURL(origin + "/win");
        await page.getByText("Official Rules", { exact: true }).click();
        await expect(page.getByText(/three \(3\) business days/)).toBeVisible();
        await expect(
          page
            .getByText(/may not be combined with any other promotion/)
            .first(),
        ).toBeVisible();
        await page.getByText("Privacy Notice", { exact: true }).first().click();
        await expect(page.locator("#privacy-notice")).toContainText(
          "Support@glarahome.com",
        );
        await expect(page.locator('[name="marketing_consent"]')).toBeDisabled();
        await expect(
          page.locator('[name="marketing_consent"]'),
        ).not.toBeChecked();
        await expect(page.locator('[name="first_name"]')).toBeDisabled();
        expect(
          await page
            .locator(
              'img[alt="A bright living and dining space styled by Glara Home Staging"]',
            )
            .evaluate((image) => image.complete && image.naturalWidth > 0),
        ).toBe(true);
        await page.locator("#official-rules summary").click();
        await page.locator("#privacy-notice summary").click();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: home + "/win-" + name + ".png",
          fullPage: true,
        });
        result.results.push({
          scenario: name + "-win-alias-final-copy-and-disabled-gate",
          passed: true,
        });
        await context.close();
      }
    }

    if (expo) {
      phase = "scheduled-browser-boundaries";
      await admin.mutation(ref("authBrowserDrill:expoWindow"), {
        starts: Date.now() + 5000,
        closes: Date.now() + 12000,
      });
      const context = await browser.newContext({ ignoreHTTPSErrors: true });
      await context.route("**/*", (route) =>
        ["localhost", "127.0.0.1"].includes(
          new URL(route.request().url()).hostname,
        )
          ? route.continue()
          : route.abort(),
      );
      const page = await context.newPage();
      await page.goto(origin + "/win");
      await expect(
        page.getByRole("heading", {
          name: "Registration opens soon",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "ENTER TO WIN", exact: true }),
      ).toBeEnabled({ timeout: 15000 });
      await expect(
        page.getByRole("heading", {
          name: "Registration is closed",
          exact: true,
        }),
      ).toBeVisible({ timeout: 15000 });
      await expect(
        page.getByRole("button", { name: "ENTER TO WIN", exact: true }),
      ).toBeDisabled();
      result.results.push({ scenario: phase, passed: true });
      await context.close();
      await admin.mutation(ref("authBrowserDrill:expoWindow"), {
        starts: Date.now() - 60000,
        closes: Date.now() + 86400000,
      });
    }
    for (const [name, viewport] of [
      ["desktop", { width: 1280, height: 900 }],
      ["mobile", { width: 393, height: 851 }],
    ]) {
      const ctx = await browser.newContext({
          viewport,
          ignoreHTTPSErrors: expo,
        }),
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
      if (process.env.GLARA_POST_M10_REGRESSION === "yes") {
        phase = name + "-profile-and-settings";
        await page.goto(origin + "/profile");
        await expect(
          page.getByRole("heading", { name: "Change password", exact: true }),
        ).toBeVisible();
        await page.goto(origin + "/settings");
        await expect(
          page.getByRole("link", { name: /Inventory categories & locations/ }),
        ).toBeVisible();
        result.results.push({ scenario: phase, passed: true });
        phase = name + "-marketing";
        await page.goto(origin + "/marketing");
        await expect(
          page.getByRole("heading", { name: "Marketing", exact: true }),
        ).toBeVisible();
        await expect(
          page.getByText("Marketing workspace", { exact: true }),
        ).toBeVisible();
        result.results.push({ scenario: phase, passed: true });
        phase = name + "-address-keyboard";
        await page.route("https://photon.komoot.io/**", (route) =>
          route.fulfill({
            json: {
              features: [
                {
                  properties: {
                    countrycode: "CA",
                    housenumber: "123",
                    street: "Fictional Avenue",
                    city: "Burnaby",
                    state: "British Columbia",
                    postcode: "V5A 1A1",
                  },
                },
              ],
            },
          }),
        );
        await page.goto(origin + "/properties/new");
        await page
          .getByLabel("Address line 1", { exact: true })
          .fill("123 Fictional");
        const suggestion = page.getByRole("button", {
          name: "123 Fictional Avenue, Burnaby, V5A 1A1",
          exact: true,
        });
        await expect(suggestion).toBeVisible();
        await suggestion.focus();
        await page.keyboard.press("Enter");
        await expect(page.getByLabel("City", { exact: true })).toHaveValue(
          "Burnaby",
        );
        await expect(
          page.getByLabel("Postal code", { exact: true }),
        ).toHaveValue("V5A 1A1");
        result.results.push({ scenario: phase, passed: true });
        phase = name + "-product-photo";
        await page.goto(origin + "/inventory");
        await page.locator('input[type="file"][multiple]').setInputFiles({
          name: "fictional.png",
          mimeType: "image/png",
          buffer: Buffer.from(
            "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aRysAAAAASUVORK5CYII=",
            "base64",
          ),
        });
        const draft = page.getByRole("link", {
          name: /DRAFT-.*complete details/,
        });
        await expect(draft).toBeVisible();
        await draft.click();
        await expect(page.getByText("Photos", { exact: true })).toBeVisible();
        expect(
          await page
            .locator("img")
            .evaluateAll((images) =>
              images.some((image) => image.complete && image.naturalWidth > 0),
            ),
        ).toBe(true);
        result.results.push({ scenario: phase, passed: true });
      }
      if (process.env.GLARA_HELP_REGRESSION === "yes") {
        phase = name + "-guide-navigation";
        if (name === "mobile")
          await page.getByRole("button", { name: "Open navigation" }).click();
        await page.getByRole("link", { name: "Help", exact: true }).click();
        await expect(page).toHaveURL(origin + "/help");
        await expect(
          page.getByRole("heading", { name: "User guide", exact: true }),
        ).toBeVisible();
        await expect(page.locator('main [lang="en"]')).toHaveAttribute(
          "dir",
          "ltr",
        );
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({ path: home + "/guide-" + name + ".png" });
        result.results.push({ scenario: phase, passed: true });

        phase = name + "-guide-search";
        const search = page.locator("#guide-search");
        await page
          .getByRole("button", { name: "Package extensions", exact: true })
          .click();
        await expect(page.locator("#renewals")).toBeVisible();
        await expect(page.locator("#start")).toBeHidden();
        await search.fill("  PACKAGE   EXPIRY  ");
        await expect(page.locator("#renewals")).toBeVisible();
        await search.fill("STAGED");
        await expect(page.locator("#staged")).toBeVisible();
        await search.fill("no-such-guide-topic");
        await expect(
          page.getByRole("heading", { name: "No matching topics" }),
        ).toBeVisible();
        await page.getByRole("button", { name: "Show all chapters" }).click();
        await expect(page.locator("#start")).toBeVisible();
        result.results.push({ scenario: phase, passed: true });

        phase = name + "-guide-contents-and-permissions";
        await page.getByText("Chapters", { exact: true }).click();
        await page.locator('a[href="#renewals"]').click();
        await expect(page).toHaveURL(/help#renewals$/);
        if (process.env.GLARA_POST_M10_REGRESSION !== "yes")
          await expect(
            page.locator('#payments a[href="/payments"]'),
          ).toHaveCount(0);
        await expect(page.locator('#staged a[href="/projects"]')).toBeVisible();
        result.results.push({ scenario: phase, passed: true });

        phase = name + "-guide-print-all";
        await search.fill("no-such-guide-topic");
        await page.emulateMedia({ media: "print" });
        await expect(page.locator("#start")).toBeVisible();
        await expect(page.locator("#renewals")).toBeVisible();
        await expect(page.locator("#glossary")).toBeVisible();
        await expect(search).toBeHidden();
        await page.emulateMedia({ media: "screen" });
        await search.fill("");
        result.results.push({ scenario: phase, passed: true });
      }
      if (process.env.GLARA_PAYMENT_PROJECTS_REGRESSION === "yes") {
        phase = name + "-payment-project-dropdown";
        await page.goto(origin + "/payments");
        const picker = page.getByRole("combobox", {
          name: "Project",
          exact: true,
        });
        await picker.click();
        await expect(
          page
            .getByRole("listbox", {
              name: "Projects needing payment or renewal",
            })
            .getByRole("option"),
        ).toHaveCount(2);
        await expect(
          page
            .getByRole("listbox", {
              name: "Projects needing payment or renewal",
            })
            .getByRole("option", { name: /Balance Avenue/ }),
        ).toContainText("75.00");
        await expect(
          page
            .getByRole("listbox", {
              name: "Projects needing payment or renewal",
            })
            .getByRole("option", { name: /Renewal Avenue/ }),
        ).toContainText("Renewal");
        await page.screenshot({
          path: home + "/payment-projects-" + name + ".png",
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        result.results.push({ scenario: phase, passed: true });
        phase = name + "-payment-project-search-and-selection";
        await picker.fill("balance");
        await expect(
          page
            .getByRole("listbox", {
              name: "Projects needing payment or renewal",
            })
            .getByRole("option"),
        ).toHaveCount(1);
        await picker.press("ArrowDown");
        await picker.press("Enter");
        await expect(picker).toHaveAttribute("aria-expanded", "false");
        await expect(page.locator('input[name="project_id"]')).toHaveValue(
          paymentProjects[0],
        );
        await page
          .getByRole("button", { name: "Apply receivable filters" })
          .click();
        await expect(
          page.getByRole("link", { name: /Total.*paid/ }),
        ).toContainText("75.00");
        result.results.push({ scenario: phase, passed: true });
        phase = name + "-payment-project-clear-and-renewal";
        await picker.fill("nothing-matches");
        await expect(page.locator('input[name="project_id"]')).toHaveValue("");
        await expect(
          page.getByText(
            "No projects match this search with outstanding invoices or a renewal due.",
          ),
        ).toBeVisible();
        await page.getByRole("button", { name: "Clear project" }).click();
        await expect(
          page
            .getByRole("listbox", {
              name: "Projects needing payment or renewal",
            })
            .getByRole("option"),
        ).toHaveCount(2);
        await page
          .getByRole("listbox", { name: "Projects needing payment or renewal" })
          .getByRole("option", { name: /Renewal Avenue/ })
          .click();
        const commercial = page.getByRole("link", {
          name: "Open project to record payment or review renewal →",
        });
        await expect(commercial).toHaveAttribute(
          "href",
          `/projects/${paymentProjects[1]}/commercial`,
        );
        await picker.click();
        await picker.press("Escape");
        await expect(picker).toHaveAttribute("aria-expanded", "false");
        result.results.push({ scenario: phase, passed: true });
      }
      if (expo) {
        phase = name + "-giveaway-anonymous-form";
        await page.goto("about:blank");
        const publicContext = await browser.newContext({
          viewport,
          ignoreHTTPSErrors: expo,
        });
        await publicContext.route("**/*", (route) => {
          const u = new URL(route.request().url());
          if (!["localhost", "127.0.0.1"].includes(u.hostname))
            return route.abort();
          return route.continue();
        });
        const publicPage = await publicContext.newPage();
        publicPage.setDefaultTimeout(30000);
        await publicPage.goto(
          origin +
            (name === "desktop" ? "/win" : "/giveaway/" + expoSlug(name)) +
            "?source=booth",
        );
        await expect(
          publicPage.getByRole("heading", {
            name: "WIN A $2,000 GLARA STAGING CREDIT",
          }),
        ).toBeVisible();
        await expect(
          publicPage.locator('[name="marketing_consent"]'),
        ).not.toBeChecked();
        await expect(
          publicPage.getByRole("button", {
            name: "ENTER TO WIN",
            exact: true,
          }),
        ).toBeEnabled();
        // The live anti-bot guard intentionally rejects submissions younger than 1.5 seconds.
        await publicPage.waitForTimeout(1600);
        await publicPage.getByText("Official Rules", { exact: true }).click();
        await expect(publicPage.locator("#official-rules p")).toBeVisible();
        expect(
          await publicPage.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        await publicPage.screenshot({
          path: home + "/giveaway-" + name + ".png",
          fullPage: true,
        });
        result.results.push({ scenario: phase, passed: true });
        phase = name + "-giveaway-entry-success";
        for (const [label, value] of [
          ["First Name", "Fictional"],
          ["Last Name", name],
          ["Brokerage", "Fictional Expo Brokerage"],
          ["Email Address", name + "@accounts.example.test"],
          ["Mobile Phone", name === "desktop" ? "6045550121" : "6045550122"],
          ["City / Primary Market", "Vancouver"],
        ])
          await publicPage
            .getByRole("textbox", { name: label, exact: true })
            .fill(value);
        await publicPage
          .getByRole("radio", { name: "Yes", exact: true })
          .check();
        await publicPage
          .getByRole("radio", { name: "21+", exact: true })
          .check();
        await publicPage.locator('[name="rules_accepted"]').check();
        const submission = publicPage.waitForResponse(
          (response) =>
            response.url() === origin + "/api/giveaway" &&
            response.request().method() === "POST",
        );
        await publicPage
          .getByRole("button", { name: "ENTER TO WIN", exact: true })
          .click();
        const submitted = await submission;
        const submissionResult = await submitted.json();
        if (submitted.status() !== 200)
          throw Error(
            "Giveaway returned HTTP " +
              submitted.status() +
              " (" +
              String(submissionResult.status) +
              ")",
          );

        await expect(
          publicPage.getByRole("heading", { name: "You're entered!" }),
        ).toBeVisible({ timeout: 20000 });
        await publicPage.screenshot({
          path: home + "/giveaway-success-" + name + ".png",
          fullPage: true,
        });
        result.results.push({ scenario: phase, passed: true });
        phase = name + "-giveaway-duplicate-and-CRM";
        const duplicate = await publicPage.request.post(
          origin + "/api/giveaway",
          {
            headers: { origin },
            data: submitted.request().postDataJSON(),
          },
        );
        expect(duplicate.status()).toBe(200);
        const evidence = await admin.mutation(
          ref("authBrowserDrill:expoEvidence"),
          {},
        );
        const entries = evidence.entries.filter(
          (e) => e.normalized_email === name + "@accounts.example.test",
        );
        expect(entries).toHaveLength(1);
        expect(entries[0].marketing_consent).toBe(false);
        expect(entries[0].licensed_in_bc).toBe(true);
        expect(entries[0].crm_origin).toBe("new");
        expect(
          evidence.realtors.filter((r) => r._id === entries[0].realtor_id),
        ).toHaveLength(1);
        result.results.push({ scenario: phase, passed: true });
        phase = name + "-giveaway-origin-protection";
        const denied = await publicPage.request.post(origin + "/api/giveaway", {
          headers: { origin: "https://unapproved.example.test" },
          data: {},
        });
        expect(denied.status()).toBe(403);
        const oversized = await publicPage.request.post(
          origin + "/api/giveaway",
          {
            headers: { origin, "content-type": "application/json" },
            data: "x".repeat(6001),
          },
        );
        expect(oversized.status()).toBe(413);
        const malformed = await publicPage.request.post(
          origin + "/api/giveaway",
          { headers: { origin }, data: { role: "owner" } },
        );
        expect(malformed.status()).toBe(400);
        await expect(publicPage).not.toHaveURL(/email=/);

        result.results.push({ scenario: phase, passed: true });
        await publicContext.close();
        phase = name + "-campaign-admin-filter-and-close";
        await page.goto(origin + "/marketing/campaigns");
        await page
          .getByRole("button", { name: new RegExp("Fictional Expo " + name) })
          .click();
        await expect(
          page.getByRole("heading", { name: "Registrations & follow-up" }),
        ).toBeVisible();
        await page
          .getByLabel("Search registrations")
          .fill(name + "@accounts.example.test");
        await expect(
          page.getByRole("heading", { name: "Fictional " + name, exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Close campaign", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Confirm action", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: "Run audited draw" }),
        ).toBeVisible();
        const closedHtml = await (
          await fetch(
            origin +
              (name === "desktop" ? "/win" : "/giveaway/" + expoSlug(name)),
          )
        ).text();
        expect(closedHtml).toContain("Registration is closed");
        result.results.push({ scenario: phase, passed: true });
        phase = name + "-campaign-draw-and-verification-gate";
        await page.getByRole("button", { name: "Run audited draw" }).click();
        await page
          .getByRole("button", { name: "Confirm action", exact: true })
          .click();
        await page
          .getByText("Verify selected entrant", { exact: true })
          .click();
        await expect(
          page.getByLabel("Required skill-testing question passed"),
        ).not.toBeChecked();
        await page.locator('select[name="decision"]').selectOption("confirm");
        await page
          .getByLabel("Review reason / verification reference")
          .fill("Fictional acceptance reference");
        await page
          .getByRole("button", { name: "Record reviewed decision" })
          .click();
        await expect(page.getByRole("alert")).toBeVisible();
        await page.screenshot({
          path: home + "/campaign-review-" + name + ".png",
          fullPage: true,
        });
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= window.innerWidth,
          ),
        ).toBe(true);
        result.results.push({ scenario: phase, passed: true });
        phase = name + "-verified-winner-credit-and-zero-provider-effects";
        for (const label of [
          "Identity verified",
          "Realtor licence verified",
          "Official rules and prize terms verified",
          "Required skill-testing question passed",
        ])
          await page.getByLabel(label, { exact: true }).check();
        await page
          .getByRole("button", { name: "Record reviewed decision" })
          .click();
        await expect(
          page.getByText("Verify selected entrant", { exact: true }),
        ).toHaveCount(0);
        const final = await admin.mutation(
          ref("authBrowserDrill:expoEvidence"),
          {},
        );
        const winner = final.entries.find(
          (e) => e.normalized_email === name + "@accounts.example.test",
        );
        expect(winner.eligibility_status).toBe("confirmed_winner");
        const award = final.awards.find((a) => a.entry_id === winner._id);
        expect(award.original_cents).toBe(200000);
        expect(award.remaining_cents).toBe(200000);
        expect(award.currency).toBe("CAD");
        expect(award.status).toBe("issued_unapplied");
        expect(award.terms).toBe(pacificwest.prize_terms);
        expect(award.expires_at).toBeGreaterThan(
          award.issued_at + 180 * 86400000,
        );
        expect(award.expires_at).toBeLessThan(award.issued_at + 185 * 86400000);
        for (const field of [
          "payments",
          "outbox",
          "providerMessages",
          "calendarEvents",
        ])
          expect(final[field]).toBe(0);
        result.results.push({ scenario: phase, passed: true });
      }
      phase = name + "-logout";
      if (name === "mobile")
        await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("button", { name: "Sign out", exact: true }).click();
      await page
        .getByRole("dialog")
        .getByRole("button", { name: "Sign out", exact: true })
        .click();
      await expect(page).toHaveURL(/login$/);
      if (process.env.GLARA_HELP_REGRESSION === "yes") {
        result.results.push({ scenario: phase, passed: true });
        phase = name + "-guide-unauthenticated";
        await page.goto(origin + "/help");
        await expect(page).toHaveURL(/login$/);
        await expect(
          page.getByRole("heading", { name: "User guide", exact: true }),
        ).toHaveCount(0);
      }
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
    // Persist the result before cleanup so a Windows child-process shutdown cannot hide a failure.
    writeFileSync(
      root + "/.acceptance/m10/auth-browser.json",
      JSON.stringify(result, null, 2),
    );
    await browser?.close();
    for (const p of [frontend, backend])
      if (p && p.exitCode === null && p.signalCode === null)
        await new Promise((r) => {
          const timeout = setTimeout(r, 5000);
          p.once("exit", () => {
            clearTimeout(timeout);
            r();
          });
          p.kill();
        });
    for (const socket of tlsSockets) socket.destroy();
    tlsProxy?.closeAllConnections();
    tlsProxy?.close();
    for (const s of streams) s.end();
    writeFileSync(
      root + "/.acceptance/m10/auth-browser.json",
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  }
}
// Local executor descendants can retain inherited Windows pipe handles after services stop.
main().then(() => process.exit(process.exitCode ?? 0));
