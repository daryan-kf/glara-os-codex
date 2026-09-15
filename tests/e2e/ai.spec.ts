import { test, expect } from "@playwright/test";
import { credentials } from "../support/identities";
test.describe("M8 disabled-provider acceptance", () => {
  test.skip(
    process.env.GLARA_M8_ACCEPTANCE !== "yes",
    "Authorized M8 development deployment required",
  );
  for (const role of [
    "owner",
    "admin",
    "sales",
    "designer",
    "staging_crew",
    "marketing",
  ]) {
    test(
      role + " navigation, role-aware AI controls and mobile layout",
      async ({ page }, info) => {
        const c = credentials(role);
        await page.goto("/login");
        await page.getByLabel("Work email").fill(c.email);
        await page.getByLabel("Password", { exact: true }).fill(c.password);
        await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
        await expect(page).toHaveURL(/dashboard/);
        await page.goto("/copilot");
        await expect(
          page.getByRole("heading", { name: "Ask Glara OS", exact: true }),
        ).toBeVisible();
        await expect(page.getByText(/AI is not activated/)).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Ask Glara", exact: true }),
        ).toBeDisabled();
        if (role === "owner")
          await expect(
            page.locator("summary").filter({ hasText: "AI settings" }),
          ).toBeVisible();
        else
          await expect(
            page.locator("summary").filter({ hasText: "AI settings" }),
          ).toHaveCount(0);
        const experience = page.getByRole("combobox", { name: "Experience" });
        if (["designer", "staging_crew", "marketing"].includes(role))
          expect(
            await experience.locator("option").allTextContents(),
          ).not.toContain("Realtor Brief");
        await experience.selectOption("navigation");
        await expect(
          page.getByText("Active context", { exact: true }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Refresh Context", exact: true })
          .click();
        await page
          .getByRole("button", {
            name: "Where can I find my modules?",
            exact: true,
          })
          .click();
        await expect(page.getByLabel("Your question")).toHaveValue(
          "Where can I find my modules?",
        );
        await page
          .getByLabel("Your question")
          .fill("Where can I find my modules?");
        await page
          .getByRole("button", { name: "Ask Glara", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Answer", exact: true }),
        ).toBeVisible({ timeout: 30000 });
        await expect(
          page.getByRole("link", { name: /Glara OS navigation/ }),
        ).toBeVisible();
        await expect(
          page.getByText("strong evidence", { exact: true }),
        ).toBeVisible();
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        await page.screenshot({
          path: info.outputPath("m8-copilot.png"),
          fullPage: true,
        });
        await page
          .getByRole("combobox", { name: "Was this useful?" })
          .selectOption("helpful");
        await expect(
          page.getByRole("button", { name: "Approve task", exact: true }),
        ).toHaveCount(0);
        const manage = page
          .locator("details")
          .filter({
            has: page
              .locator("summary")
              .filter({ hasText: "Manage conversation" }),
          })
          .first();
        await manage.locator("summary").click();
        const title = "Fictional M8 " + role + " " + info.project.name;
        await manage.getByLabel("Conversation title").fill(title);
        await manage
          .getByRole("button", { name: "Rename", exact: true })
          .click();
        await expect(
          page.getByRole("button", { name: title, exact: true }),
        ).toBeVisible();
        await manage
          .getByRole("button", { name: "Delete", exact: true })
          .click();
        await manage
          .getByRole("button", {
            name: "Delete conversation text",
            exact: true,
          })
          .click();
        await expect(
          page.getByRole("button", { name: title, exact: true }),
        ).toHaveCount(0);
      },
    );
  }
});
