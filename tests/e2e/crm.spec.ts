import { test, expect } from "@playwright/test";
test.describe("M1 Realtor CRM", () => {
  test.skip(
    process.env.E2E_LIVE === "1",
    "Fictional isolated database fixture. Use a disposable live project for manual acceptance.",
  );
  test("owner creates a brokerage and realtor, logs a note, follows up, searches and archives", async ({
    page,
  }, testInfo) => {
    const suffix = testInfo.project.name;
    const first = "Sarah" + suffix;
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("Fictional-password-123!");
    await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
    await expect(page).toHaveURL(/dashboard$/);
    await page.getByRole("button", { name: "New", exact: true }).click();
    await page
      .getByRole("link", { name: "New Brokerage", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "New brokerage", exact: true }),
    ).toBeVisible();
    await page
      .getByLabel("Brokerage name", { exact: false })
      .fill("Fictional Oakwyn " + suffix);
    await page
      .getByLabel("Office name", { exact: false })
      .fill("Fictional office");
    await page.getByLabel("City", { exact: false }).fill("Vancouver");
    await page
      .getByRole("button", { name: "Create brokerage", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText("Saved successfully");
    await page.goto("/realtors/new");
    await expect(
      page.getByRole("heading", { name: "A new relationship" }),
    ).toBeVisible();
    await page.getByLabel("First name", { exact: false }).fill(first);
    await page.getByLabel("Last name", { exact: false }).fill("Chen");
    await page
      .getByLabel("Email", { exact: false })
      .fill(suffix + "@fictional.example.test");
    await page.getByLabel("Primary city", { exact: false }).fill("Vancouver");
    await page
      .getByLabel("Brokerage (optional)", { exact: true })
      .fill("Fictional Oakwyn " + suffix);
    await page
      .getByRole("button", {
        name: "Fictional Oakwyn " + suffix + " · Fictional office",
        exact: true,
      })
      .click();
    await page
      .getByLabel("Next action", { exact: false })
      .first()
      .fill("Introduction call " + suffix);
    await page.locator('input[name="next_due_at"]').fill("2026-10-01T10:00");
    await page
      .getByLabel("Internal notes", { exact: false })
      .fill("Private relationship context");
    await page
      .getByRole("button", { name: "Create realtor", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: first + " Chen", exact: true }),
    ).toBeVisible();
    const detail = page.url();
    await page
      .getByRole("button", { name: "Log activity", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog.getByLabel("Title", { exact: false }).fill("Introduced Glara");
    await dialog
      .getByLabel("Activity notes", { exact: false })
      .fill("Fictional introductory conversation.");
    await dialog
      .getByRole("button", { name: "Save activity", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText("Saved to");
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await expect(
      page.getByRole("heading", { name: "Introduced Glara", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Add follow-up", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByLabel("Title", { exact: false })
      .fill("Send a staging introduction " + suffix);
    await dialog.locator('input[name="due_at"]').fill("2026-10-05T10:00");
    await dialog
      .getByRole("button", { name: "Create follow-up", exact: true })
      .click();
    await expect(dialog.getByRole("status")).toContainText("Saved to");
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    const introduction = page
      .locator("article")
      .filter({
        has: page.getByRole("heading", {
          name: "Introduction call " + suffix,
          exact: true,
        }),
      })
      .first();
    await introduction
      .getByRole("button", { name: "Complete", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .getByRole("button", { name: "Mark complete", exact: true })
      .click();
    await expect(dialog).toHaveCount(0);
    await expect(introduction).toContainText("Completed");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("realtor-360.png"),
      fullPage: true,
    });
    await page.getByRole("link", { name: "Edit profile", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Edit relationship" }),
    ).toBeVisible();
    await page.getByLabel("Primary area", { exact: false }).fill("Kitsilano");
    await page
      .getByRole("button", { name: "Save realtor", exact: true })
      .click();
    await expect(
      page.getByText("Vancouver · Kitsilano", { exact: true }),
    ).toBeVisible();
    await page.goto("/realtors");
    await expect(
      page.getByRole("heading", { name: "Realtor relationships" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Search workspace" }).click();
    await page.getByLabel("Search modules and realtors").fill(first);
    await page
      .getByRole("dialog")
      .getByRole("link", { name: new RegExp(first + " Chen") })
      .click();
    await expect(page).toHaveURL(detail);
    await page
      .getByRole("button", { name: "Archive realtor", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Confirm archive", exact: true })
      .click();
    await expect(page).toHaveURL(/\/realtors$/);
    await page.goto(detail);
    await expect(
      page.getByRole("button", { name: "Restore realtor", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Restore realtor", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: "Restore realtor", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: "Edit profile", exact: true }),
    ).toBeVisible();
    await page.goto("/realtors");
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath("realtor-list.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  });
  test("Marketing cannot write and crew cannot read CRM", async ({ page }) => {
    for (const [email, target] of [
      ["marketing@example.test", "/realtors/new"],
      ["crew@example.test", "/realtors"],
    ] as const) {
      await page.context().clearCookies();
      await page.goto("/login");
      await page.getByLabel("Work email").fill(email);
      await page
        .getByLabel("Password", { exact: true })
        .fill("Fictional-password-123!");
      await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
      await expect(page).toHaveURL(/dashboard$/);
      await page.goto(target);
      await expect(page).toHaveURL(/unauthorized$/);
    }
  });
});
