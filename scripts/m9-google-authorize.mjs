import { createServer } from "node:http";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const deployment = "woozy-jaguar-392";
export const scope = "https://www.googleapis.com/auth/calendar.app.created";
export const redirectUri = "http://127.0.0.1:58439/oauth/callback";

// Setup-only loopback process. Nothing is added to Next.js or the deployed backend.
export function authorizationSession({
  clientId,
  clientSecret,
  save,
  request = fetch,
}) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const launch = randomBytes(24).toString("hex");
  let consumed = false;
  const expires = Date.now() + 20 * 60 * 1000;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "false",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  return {
    launchPath: `/start/${launch}`,
    authorizeUrl: url.toString(),
    async callback(params) {
      const supplied = params.get("state") ?? "";
      if (
        Date.now() >= expires ||
        consumed ||
        !/^[-_A-Za-z0-9]{43}$/.test(supplied) ||
        !timingSafeEqual(Buffer.from(supplied), Buffer.from(state))
      )
        return "invalid_callback";
      consumed = true;
      if (params.has("error") || !params.get("code"))
        return "consent_not_completed";
      try {
        const response = await request("https://oauth2.googleapis.com/token", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            code: params.get("code"),
            code_verifier: verifier,
            redirect_uri: redirectUri,
            grant_type: "authorization_code",
          }),
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) return "token_exchange_failed";
        const tokens = await response.json();
        if (
          typeof tokens.access_token !== "string" ||
          typeof tokens.refresh_token !== "string" ||
          tokens.scope !== scope
        )
          return "token_or_scope_invalid";
        // Save recovery material before creating a calendar; never retry an ambiguous create.
        await save("M9_GOOGLE_REFRESH_TOKEN", tokens.refresh_token);
        const created = await request(
          "https://www.googleapis.com/calendar/v3/calendars",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${tokens.access_token}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              summary: "Glara OS — Development Acceptance",
              timeZone: "America/Vancouver",
              description:
                "Glara OS M9 fictional acceptance only. No customers, attendees or production scheduling.",
            }),
            signal: AbortSignal.timeout(15000),
          },
        );
        if (!created.ok) return "calendar_creation_requires_review";
        const calendar = await created.json();
        if (
          typeof calendar.id !== "string" ||
          !calendar.id ||
          calendar.id === "primary"
        )
          return "calendar_identity_invalid";
        await save("M9_GOOGLE_CALENDAR_ID", calendar.id);
        return "configured_sync_still_disabled";
      } catch {
        // Never log raw errors: provider/CLI errors can embed credentials or callback codes.
        return "setup_requires_private_review_no_automatic_retry";
      }
    },
  };
}

function cli(args, input) {
  return execFileSync(
    process.execPath,
    ["node_modules/convex/bin/main.js", ...args, "--deployment", deployment],
    {
      encoding: "utf8",
      input,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 45000,
    },
  ).trim();
}
export async function main() {
  try {
    const names = new Set(
      cli(["env", "list", "--names-only"])
        .split(/\r?\n/)
        .map((x) => x.trim()),
    );
    const required = ["M9_GOOGLE_CLIENT_ID", "M9_GOOGLE_CLIENT_SECRET"];
    const missing = required.filter((name) => !names.has(name));
    if (missing.length) {
      console.log(
        JSON.stringify({
          status: "MISSING_CLIENT_CONFIGURATION",
          missing,
          deployment,
          redirect_uri: redirectUri,
          requested_scope: scope,
        }),
      );
      process.exitCode = 2;
      return;
    }
    if (
      cli(["env", "get", "M9_CALENDAR_ENABLED"]) !== "false" ||
      cli(["env", "get", "M9_EMAIL_ENABLED"]) !== "false"
    )
      throw Error("disabled flags required");
    if (
      names.has("M9_GOOGLE_REFRESH_TOKEN") ||
      names.has("M9_GOOGLE_CALENDAR_ID")
    ) {
      console.log(
        "Existing Calendar authorization requires private review; refusing duplicate setup.",
      );
      process.exitCode = 2;
      return;
    }
    const session = authorizationSession({
      clientId: cli(["env", "get", "M9_GOOGLE_CLIENT_ID"]),
      clientSecret: cli(["env", "get", "M9_GOOGLE_CLIENT_SECRET"]),
      save: (name, value) => cli(["env", "set", name], value),
    });
    let timer;
    const server = createServer(async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'none'; frame-ancestors 'none'",
      );
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      if (req.headers.host !== "127.0.0.1:58439" || req.method !== "GET") {
        res.writeHead(400).end("Invalid request");
        return;
      }
      const incoming = new URL(req.url ?? "/", "http://127.0.0.1:58439");
      if (incoming.pathname === "/finished") {
        res.end(
          "Google authorization processed. Return to Codex for the verified setup result. Calendar sync remains disabled.",
        );
        return;
      }
      if (incoming.pathname === session.launchPath) {
        res.writeHead(302, { Location: session.authorizeUrl }).end();
        return;
      }
      if (incoming.pathname !== "/oauth/callback") {
        res.writeHead(404).end("Not found");
        return;
      }
      const result = await session.callback(incoming.searchParams);
      if (result === "invalid_callback") {
        res.writeHead(400).end("Invalid or expired callback");
        return;
      }
      // Redirect away from the authorization code; no third-party assets or code logging.
      res.writeHead(303, { Location: "/finished" }).end();
      console.log(
        JSON.stringify({ status: result, deployment, calendar_enabled: false }),
      );
      if (result !== "configured_sync_still_disabled") process.exitCode = 2;
      clearTimeout(timer);
      setTimeout(() => server.close(), 2000).unref();
    });
    server.on("error", () => {
      clearTimeout(timer);
      console.log("Loopback listener unavailable; no setup completed.");
      process.exitCode = 2;
    });
    server.listen(58439, "127.0.0.1", () => {
      console.log(
        `Open this local consent start link: http://127.0.0.1:58439${session.launchPath}`,
      );
      console.log(
        "Sign in with the development calendar owner and approve only the displayed app-created Calendar permission. Do not copy codes or tokens.",
      );
    });
    timer = setTimeout(
      () => {
        server.close();
        console.log("Calendar consent session expired; sync remains disabled.");
      },
      20 * 60 * 1000,
    );
  } catch {
    console.log(
      "Calendar setup unavailable; inspect configuration privately. No credentials logged.",
    );
    process.exitCode = 2;
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main();
