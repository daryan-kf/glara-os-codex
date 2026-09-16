import { test, expect, type Page } from "@playwright/test";
import { credentials } from "../support/identities";
import { operationsClient } from "../support/operations-fixture";
import { api } from "../../convex/_generated/api";
async function login(page: Page, role: string) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(credentials(role).email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(credentials(role).password);
  await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
  await expect(page).toHaveURL(/dashboard$/);
}
test.describe("M10A controlled security", () => {
  test.skip(
    process.env.GLARA_M10_ACCEPTANCE !== "yes",
    "Development-only explicit opt-in required",
  );
  test.setTimeout(90000);
  for (const role of [
    "owner",
    "admin",
    "sales",
    "designer",
    "staging_crew",
    "marketing",
  ])
    test(`${role} emergency-control route and private browser storage`, async ({
      page,
    }) => {
      await login(page, role);
      await page.goto("/security");
      if (!["owner", "admin"].includes(role)) {
        await expect(page).toHaveURL(/unauthorized$/);
        return;
      }
      await expect(
        page.getByRole("heading", {
          name: "Security & operations",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByText("Email: Disabled", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Google Calendar: Disabled Â· Acceptance deferred", {
          exact: true,
        }),
      ).toBeVisible();
      if (role === "admin")
        await expect(
          page.getByRole("button", { name: "Freeze financial", exact: true }),
        ).toHaveCount(0);
      expect(
        await page.evaluate(() =>
          Object.keys(localStorage)
            .concat(Object.keys(sessionStorage))
            .filter((k) => /token|secret|convex/i.test(k)),
        ),
      ).toEqual([]);
      const cookies = (await page.context().cookies()).filter((c) =>
        c.name.includes("convexAuth"),
      );
      expect(
        cookies.length > 0 &&
          cookies.every((c) => c.httpOnly && c.sameSite === "Lax"),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
    });
  test("Owner freezes and recovers financial execution with accessible confirmation", async ({
    page,
  }) => {
    const { client } = await operationsClient();
    const before = (await client.query(api.emergency.state, {})).find(
      (s) => s.capability === "financial",
    )!;
    expect(before.frozen).toBe(false);
    await login(page, "owner");
    await page.goto("/security");
    try {
      await page
        .getByRole("button", { name: "Freeze financial", exact: true })
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page
        .getByLabel("Reason", { exact: true })
        .fill("Fictional browser containment drill");
      await page
        .getByLabel("Incident reference (optional)")
        .fill("DRILL-M10-BROWSER");
      await page
        .getByRole("button", { name: "Confirm change", exact: true })
        .focus();
      await page.keyboard.press("Enter");
      await expect(
        page.getByRole("button", { name: "Release financial", exact: true }),
      ).toBeVisible();
      await expect(
        client.mutation(api.commercial.saveCustomer, {
          version: 0,
          input: JSON.stringify({
            type: "seller",
            name: "Fictional blocked customer",
            contact: "Fictional",
            email: "fictional@accounts.example.test",
            phone: "",
            company: "",
            address: "Fictional",
          }),
        }),
      ).rejects.toThrow("CAPABILITY_FROZEN");
      await page
        .getByRole("button", { name: "Release financial", exact: true })
        .click();
      await page
        .getByLabel("Reason", { exact: true })
        .fill("Fictional drill verified; controlled recovery");
      await page
        .getByRole("button", { name: "Confirm change", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Freeze financial", exact: true }),
      ).toBeVisible();
    } finally {
      const current = (await client.query(api.emergency.state, {})).find(
        (s) => s.capability === "financial",
      )!;
      if (current.frozen)
        await client.mutation(api.emergency.change, {
          changes: [
            {
              capability: "financial",
              frozen: false,
              version: current.version,
            },
          ],
          reason: "Fictional browser drill finally cleanup",
          incident: "DRILL-M10-BROWSER",
        });
    }
  });
  test("CSP nonce, no-store, script injection and hostile auth origin fail safely", async ({
    page,
    request,
  }) => {
    const violations: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error" && m.text().includes("Content Security Policy"))
        violations.push("csp");
    });
    const response = await page.goto("/login"),
      headers = response!.headers();
    expect(headers["content-security-policy"]).toContain(
      "script-src-attr 'none'",
    );
    expect(headers["content-security-policy"]).not.toContain("unsafe-eval");
    expect(headers["cache-control"]).toContain("no-store");
    expect(headers["x-frame-options"]).toBe("DENY");
    const nonces = await page
      .locator("script[nonce]")
      .evaluateAll((nodes) => nodes.map((n) => (n as HTMLScriptElement).nonce));
    expect(nonces.length).toBeGreaterThan(0);
    expect(violations).toEqual([]);
    await page.route("**/login", async (route) => {
      const upstream = await route.fetch();
      const body = (await upstream.text()).replace(
        "<body>",
        "<body><script>document.documentElement.dataset.unsafeExecuted='yes'</script><img src='/fictional-missing-image' onerror=\"document.documentElement.dataset.unsafeExecuted='yes'\">",
      );
      await route.fulfill({ response: upstream, body });
    });
    await page.goto("/login");
    expect(
      await page.locator("html").getAttribute("data-unsafe-executed"),
    ).toBeNull();
    const hostile = await request.post("/api/auth", {
      headers: { Origin: "https://unapproved.example.test" },
      data: { action: "auth:signOut", args: {} },
    });
    expect([400, 403]).toContain(hostile.status());
  });
});
