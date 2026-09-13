import { test, expect } from "@playwright/test";
test.describe("M1 hardening", () => {
  test.skip(
    process.env.E2E_LIVE === "1",
    "Isolated fictional fixtures; hosted acceptance is a separate release gate.",
  );
  test("cancel and reschedule preserve the prospect next action and visible history", async ({
    page,
  }, info) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("owner@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("Fictional-password-123!");
    await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
    await expect(page).toHaveURL(/dashboard$/);
    await page.goto("/realtors/new");
    await page
      .getByLabel("First name", { exact: false })
      .fill("Hardening" + info.project.name);
    await page.getByLabel("Last name", { exact: false }).fill("Fictional");
    await page.locator('input[name="next_title"]').fill("Original call");
    await page.locator('input[name="next_due_at"]').fill("2026-10-01T10:00");
    await page
      .getByRole("button", { name: "Create realtor", exact: true })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Hardening" + info.project.name + " Fictional",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Cancel action", exact: true })
      .click();
    let dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "A prospect needs a next action",
    );
    await dialog.getByRole("button", { name: "Close dialog" }).click();
    await page.getByRole("button", { name: "Reschedule", exact: true }).click();
    dialog = page.getByRole("dialog");
    await expect(dialog.locator('input[name="next_title"]')).toHaveValue(
      "Original call",
    );
    await dialog.locator('input[name="next_title"]').fill("Rescheduled call");
    await dialog.locator('input[name="next_due_at"]').fill("2026-10-05T10:00");
    await dialog.getByRole("button", { name: "Confirm reschedule" }).click();
    await expect(dialog).toHaveCount(0);
    const original = page.locator("article").filter({
      has: page.getByRole("heading", { name: "Original call", exact: true }),
    });
    await expect(original).toContainText("Cancelled");
    await expect(original).toContainText("Originally due Oct 1, 2026");
    await page
      .getByRole("button", { name: "Cancel action", exact: true })
      .click();
    dialog = page.getByRole("dialog");
    await dialog
      .locator('input[name="next_title"]')
      .fill("Replacement conversation");
    await dialog.locator('input[name="next_due_at"]').fill("2026-10-10T10:00");
    await dialog.getByRole("button", { name: "Confirm cancellation" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(
      page.locator("article").filter({
        has: page.getByRole("heading", {
          name: "Rescheduled call",
          exact: true,
        }),
      }),
    ).toContainText("Cancelled");
    await expect(
      page
        .getByRole("heading", { name: "Replacement conversation", exact: true })
        .first(),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath("hardening-followups.png"),
      fullPage: true,
    });
  });
  test("Marketing retains directory and source access without operational owner picker", async ({
    page,
  }) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill("marketing@example.test");
    await page
      .getByLabel("Password", { exact: true })
      .fill("Fictional-password-123!");
    await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
    await expect(page).toHaveURL(/dashboard$/);
    await page.goto("/realtors");
    await expect(
      page.getByRole("heading", { name: "Realtor relationships" }),
    ).toBeVisible();
    await expect(page.getByLabel("Assigned owner")).toHaveCount(0);
    await page.goto("/realtors/sources");
    await expect(
      page.getByRole("heading", { name: "Lead sources", exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Instagram", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add source", exact: true }),
    ).toHaveCount(0);
  });
});
