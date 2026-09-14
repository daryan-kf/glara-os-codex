import { test, expect } from "@playwright/test";
import { credentials } from "../support/identities";
test.describe("M7 automation desktop and mobile", () => {
  test.skip(
    process.env.GLARA_M7_ACCEPTANCE !== "yes",
    "M7 development deployment required",
  );
  test.setTimeout(90000);
  async function login(page: import("@playwright/test").Page, role: string) {
    const c = credentials(role);
    await page.goto("/login");
    await page.getByLabel("Work email").fill(c.email);
    await page.getByLabel("Password", { exact: true }).fill(c.password);
    await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
    await expect(page).toHaveURL(/dashboard/);
  }
  for (const role of ["owner", "admin"]) {
    test(`${role} can inspect rules, history, health and bounded reconciliation`, async ({
      page,
    }, info) => {
      await login(page, role);
      await page.goto("/automation");
      await expect(
        page.getByRole("heading", { name: "Automation Center" }),
      ).toBeVisible();
      await expect(
        page.getByText("Quote follow-up · day 2", { exact: false }).first(),
      ).toBeVisible();
      await page
        .locator("summary")
        .filter({ hasText: "Quote follow-up · day 2" })
        .click();
      await expect(
        page.getByRole("button", { name: "Save rule version" }).first(),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath("m7-rules.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Failures", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Automation health" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "History", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Execution history" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Enroll next batch" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Preview & reconcile one source" }),
      ).toBeVisible();
    });
  }
  for (const role of ["sales", "designer", "staging_crew", "marketing"]) {
    test(`${role} sees only personal notifications and cannot open Automation Center`, async ({
      page,
    }, info) => {
      await login(page, role);
      await page.goto("/notifications");
      await expect(
        page.getByRole("heading", { name: "Notifications", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "My automated tasks" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`m7-${role}-notifications.png`),
        fullPage: true,
      });
      await page.goto("/automation");
      await expect(page).toHaveURL(/unauthorized/);
    });
  }
});
