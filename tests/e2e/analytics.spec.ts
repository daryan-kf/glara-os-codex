import { test, expect } from "@playwright/test";
import { credentials } from "../support/identities";
test.describe("M6 analytics desktop and mobile", () => {
  test.skip(
    process.env.GLARA_M6_ACCEPTANCE !== "yes",
    "M6 development deployment, backfill and activation required",
  );
  test.setTimeout(90000);
  test("Owner can inspect metrics, change periods, and open reporting tools", async ({
    page,
  }, info) => {
    const c = credentials("owner");
    await page.goto("/login");
    await page.getByLabel("Work email").fill(c.email);
    await page.getByLabel("Password", { exact: true }).fill(c.password);
    await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
    await expect(
      page.getByRole("heading", { name: "Executive command center" }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Monthly staging target" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: /Projects staged/ })
      .first()
      .click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Close dialog" }).click();
    await page.getByLabel("Reporting period").selectOption("previous_month");
    await page.getByRole("button", { name: "Apply period" }).click();
    await expect(
      page.getByRole("heading", { name: "Action center", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("m6-dashboard.png"),
      fullPage: true,
    });
    await page.getByRole("link", { name: "Reports & targets" }).click();
    await expect(
      page.getByRole("heading", { name: "Business targets" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Run independent reconciliation" }),
    ).toBeVisible();
  });
  for (const [role, title] of [
    ["sales", "Your sales overview"],
    ["marketing", "Marketing overview"],
    ["designer", "Today, thoughtfully planned."],
    ["staging_crew", "Today, thoughtfully planned."],
  ] as const)
    test(
      role + " gets its own dashboard without executive financial panels",
      async ({ page }) => {
        const c = credentials(role);
        await page.goto("/login");
        await page.getByLabel("Work email").fill(c.email);
        await page.getByLabel("Password", { exact: true }).fill(c.password);
        await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
        await expect(
          page.getByRole("heading", { name: title, exact: true }),
        ).toBeVisible();
        await expect(
          page.getByRole("heading", { name: "Receivables aging" }),
        ).toHaveCount(0);
        await expect(
          page.getByRole("heading", { name: "Commercial detail" }),
        ).toHaveCount(0);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
      },
    );
});
