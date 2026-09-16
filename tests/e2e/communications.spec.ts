import { test, expect } from "@playwright/test";
import { credentials } from "../support/identities";
test.describe("M9 disabled external provider browser acceptance", () => {
  test.skip(
    process.env.GLARA_M9_ACCEPTANCE !== "yes",
    "M9 development deployment authorization required",
  );
  for (const role of [
    "owner",
    "admin",
    "sales",
    "marketing",
    "designer",
    "staging_crew",
  ]) {
    test(`${role}: communications boundaries and responsive navigation`, async ({
      page,
    }) => {
      const identity = credentials(role);
      await page.goto("/login");
      await page.getByLabel("Work email").fill(identity.email);
      await page
        .getByLabel("Password", { exact: true })
        .fill(identity.password);
      await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
      await expect(page).toHaveURL(/dashboard/);
      await page.goto("/communications");
      if (["designer", "staging_crew"].includes(role)) {
        await expect(page).toHaveURL(/unauthorized/);
        return;
      }
      await expect(
        page.getByRole("heading", { name: "Communications", exact: true }),
      ).toBeVisible();
      await expect(page.getByText(/Email delivery is disabled/)).toBeVisible();
      await page
        .getByRole("button", { name: "New message", exact: true })
        .click();
      await expect(
        page.getByRole("heading", { name: "Prepare a message" }),
      ).toBeVisible();
      await expect(page.getByLabel("Purpose", { exact: true })).toHaveValue(
        role === "marketing" ? "commercial_marketing" : "sales_relationship",
      );
      if (["owner", "admin"].includes(role)) {
        await page
          .getByRole("button", { name: "Settings", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Communication settings" }),
        ).toBeVisible();
        await page
          .getByRole("button", { name: "Calendar", exact: true })
          .click();
        await expect(
          page.getByRole("heading", { name: "Development calendar" }),
        ).toBeVisible();
      } else
        await expect(
          page.getByRole("button", { name: "Settings", exact: true }),
        ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.goto("/inventory");
      await expect(page.getByText("Something didn’t load.")).toHaveCount(0);
    });
  }
  test("unauthenticated communications route is protected", async ({
    page,
  }) => {
    await page.goto("/communications");
    await expect(page).toHaveURL(/login/);
  });
});
