import { test, expect, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { credentials } from "../support/identities";
import { operationsClient } from "../support/operations-fixture";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
async function login(page: Page, role: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(credentials(role).email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(credentials(role).password);
  await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
  await expect(page).toHaveURL(/dashboard$/);
}
const policy: Record<string, string[]> = {
  owner: [],
  admin: ["/settings", "/reports", "/marketing"],
  sales: [
    "/settings",
    "/security",
    "/payments",
    "/reports",
    "/automation",
    "/inventory",
  ],
  designer: [
    "/realtors",
    "/opportunities",
    "/quotes",
    "/payments",
    "/reports",
    "/communications",
    "/security",
    "/automation",
  ],
  staging_crew: [
    "/realtors",
    "/properties",
    "/opportunities",
    "/quotes",
    "/payments",
    "/communications",
    "/security",
    "/automation",
  ],
  marketing: [
    "/opportunities",
    "/quotes",
    "/inventory",
    "/payments",
    "/reports",
    "/security",
    "/automation",
  ],
};
test.describe("M10A expanded browser boundaries", () => {
  test.skip(
    process.env.GLARA_M10_ACCEPTANCE !== "yes",
    "Development acceptance only",
  );
  test.setTimeout(180000);
  for (const role of Object.keys(policy))
    test(
      role + " direct URL policy, cache and responsive navigation",
      async ({ page }) => {
        await login(page, role);
        for (const route of policy[role]) {
          await page.goto(
            route + "?role=owner&assigned_to=" + credentials("owner").id,
          );
          await expect(page).toHaveURL(/unauthorized$/);
          expect(await page.content()).not.toMatch(
            /PRIVATE SELLER|PRIVATE NEGOTIATION/,
          );
        }
        for (const route of [
          "/dashboard",
          "/projects",
          "/copilot",
          "/notifications",
          "/profile",
        ]) {
          const response = await page.goto(route);
          await expect(page).not.toHaveURL(/login|unauthorized/);
          await expect(page.locator("main")).toBeVisible();
          expect(response!.headers()["cache-control"]).toContain("no-store");
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
        }
      },
    );
  test("public HTTP, bounded input, CSRF/CORS, prefetch and framing boundaries", async ({
    page,
    request,
  }) => {
    for (const route of [
      "/communications",
      "/security",
      "/payments",
      "/realtors",
    ]) {
      const response = await request.get(route, {
        headers: { RSC: "1", "Next-Router-Prefetch": "1" },
        maxRedirects: 0,
      });
      expect([302, 303, 307, 308]).toContain(response.status());
      expect(await response.text()).not.toMatch(
        /PRIVATE SELLER|PRIVATE NEGOTIATION/,
      );
    }
    const response = await page.goto(
      "/login?next=https://unapproved.example.test",
    );
    const h = response!.headers();
    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["referrer-policy"]).toBeTruthy();
    expect(h["permissions-policy"]).toBeTruthy();
    expect(
      (
        await request.post("/api/auth", {
          headers: { Origin: "http://unapproved.example.test" },
          data: { action: "auth:signOut" },
        })
      ).status(),
    ).toBe(403);
    const cors = await request.fetch("/api/auth", {
      method: "OPTIONS",
      headers: {
        Origin: "http://unapproved.example.test",
        "Access-Control-Request-Method": "POST",
      },
    });
    expect(cors.headers()["access-control-allow-origin"]).not.toBe("*");
    const oversized = await request.post("/api/auth", {
      headers: {
        Origin: "http://localhost:3001",
        "Content-Type": "application/json",
      },
      data: "x".repeat(9000),
    });
    expect([400, 413]).toContain(oversized.status());
    const providerOrigin = JSON.parse(
      process.env.GLARA_CONVEX_IDENTITIES!,
    ).url.replace(/\.convex\.cloud$/, ".convex.site");
    expect(
      (
        await request.post(providerOrigin + "/m9/webhook", {
          data: { type: "email.delivered" },
        })
      ).status(),
    ).toBe(400);
    expect(
      (
        await request.post(providerOrigin + "/m9/webhook", {
          data: "x".repeat(66000),
        })
      ).status(),
    ).toBe(413);
    const token = "fictional-invalid-token";
    const pref = await request.get(
      providerOrigin + "/m9/unsubscribe?token=" + token,
    );
    expect(pref.status()).toBe(200);
    expect(await pref.text()).not.toContain(token);
    expect(pref.headers()["referrer-policy"]).toBe("no-referrer");
    const one = await request.post(
        providerOrigin + "/m9/unsubscribe?token=" + token,
      ),
      two = await request.post(
        providerOrigin + "/m9/unsubscribe?token=" + token,
      );
    expect(await one.text()).toBe(await two.text());
    await page.route("http://localhost:3001/__controlled-frame", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<html><iframe src="http://localhost:3001/login"></iframe></html>',
      }),
    );
    const blocked: string[] = [];
    page.on("console", (m) => {
      if (/frame-ancestors|X-Frame-Options/.test(m.text()))
        blocked.push("blocked");
    });
    await page.goto("http://localhost:3001/__controlled-frame");
    await expect.poll(() => blocked.length).toBeGreaterThan(0);
  });
  test("stored CRM markup, malformed IDs, stale assignment and offline recovery fail safely", async ({
    page,
    context,
  }) => {
    const { client } = await operationsClient(),
      payload =
        '<img src=x onerror="document.documentElement.dataset.m10xss=1">';
    const created = await client.mutation(api.crm.write, {
      input: JSON.stringify({
        op: "realtor_create",
        data: {
          first_name: "FictionalM10",
          last_name: "Browser " + Date.now(),
          relationship_status: "active_partner",
          assigned_to: credentials("sales").id,
          notes: payload,
        },
      }),
    });
    await login(page, "sales");
    await page.goto("/realtors/" + created.id);
    await expect(page.getByText(payload, { exact: true })).toBeVisible();
    expect(await page.locator("html").getAttribute("data-m10xss")).toBeNull();
    const before = (await client.query(api.crm.read, {
      input: JSON.stringify({ op: "detail", id: created.id }),
    })) as { version: number };
    await client.mutation(api.crm.write, {
      input: JSON.stringify({
        op: "realtor_update",
        id: created.id,
        version: before.version,
        data: {
          first_name: "FictionalM10",
          last_name: "Browser reassigned",
          relationship_status: "active_partner",
          assigned_to: credentials("owner").id,
          notes: payload,
        },
      }),
    });
    await page.reload();
    await expect(page.getByText(payload, { exact: true })).toHaveCount(0);
    expect(await page.content()).not.toContain("PRIVATE NEGOTIATION");
    await page.goto("/realtors/not-a-valid-id");
    expect(await page.content()).not.toMatch(
      /ConvexError|Uncaught|PRIVATE SELLER/,
    );
    await context.setOffline(true);
    await page.goto("/dashboard").catch(() => null);
    await context.setOffline(false);
    await page.goto("/dashboard");
    await expect(page.locator("main")).toBeVisible();
  });
  test("archival and role changes invalidate an already-open browser session", async ({
    page,
  }) => {
    const { client } = await operationsClient();
    const user = credentials("staging_crew");
    const restore = () =>
      execFileSync(
        process.execPath,
        [
          "node_modules/convex/bin/main.js",
          "run",
          "admin:setProfile",
          JSON.stringify({
            userId: user.id,
            name: "Fictional staging_crew",
            roles: ["staging_crew"],
            archived: false,
          }),
          "--env-file",
          ".env.local",
        ],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
    try {
      await login(page, "staging_crew");
      await client.action(api.securityAdmin.revokeUser, {
        userId: user.id as Id<"users">,
        reason: "Fictional M10 browser revocation",
        incident: "DRILL-M10-BROWSER",
      });
      await page.goto("/projects");
      await expect(page).toHaveURL(/login|unauthorized/);
    } finally {
      restore();
    }
    await login(page, "staging_crew");
    try {
      execFileSync(
        process.execPath,
        [
          "node_modules/convex/bin/main.js",
          "run",
          "admin:setProfile",
          JSON.stringify({
            userId: user.id,
            name: "Fictional role-change",
            roles: ["designer"],
            archived: false,
          }),
          "--env-file",
          ".env.local",
        ],
        { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
      );
      await page.goto("/inventory");
      await expect(page).toHaveURL(/login|unauthorized/);
    } finally {
      restore();
    }
  });
  test("double submit creates one Realtor and preserves recoverable navigation", async ({
    page,
  }) => {
    const marker = "FictionalDouble" + Date.now();
    await login(page, "owner");
    await page.goto("/realtors/new");
    await page.getByLabel("First name", { exact: false }).fill(marker);
    await page.getByLabel("Last name", { exact: false }).fill("Acceptance");
    await page
      .getByLabel("Next action", { exact: false })
      .first()
      .fill("Fictional next step");
    await page.locator('input[name="next_due_at"]').fill("2026-10-01T10:00");
    await page
      .getByRole("button", { name: "Create realtor", exact: true })
      .dblclick();
    await expect(
      page.getByRole("heading", { name: marker + " Acceptance", exact: true }),
    ).toBeVisible();
    const detail = page.url();
    await page.reload();
    await expect(page).toHaveURL(detail);
    const { client } = await operationsClient();
    const result = (await client.query(api.crm.read, {
      input: JSON.stringify({ op: "list", q: marker }),
    })) as { rows: unknown[] };
    expect(result.rows).toHaveLength(1);
  });
});
