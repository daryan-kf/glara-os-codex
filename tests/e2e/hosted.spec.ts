import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
function credentials(role = "owner") {
  const value: unknown = JSON.parse(
    process.env.GLARA_ACCEPTANCE_IDENTITIES ?? "{}",
  );
  if (!value || typeof value !== "object" || !("users" in value))
    throw new Error("Fictional hosted identities required");
  if (
    !("project_ref" in value) ||
    typeof value.project_ref !== "string" ||
    value.project_ref !==
      readFileSync("supabase/.temp/project-ref", "utf8").trim()
  )
    throw new Error("Disposable project mismatch");
  const configuredUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ??
    readFileSync(".env.local", "utf8").match(
      /^NEXT_PUBLIC_SUPABASE_URL=["']?([^"'\r\n]+)/m,
    )?.[1];
  if (configuredUrl !== "https://" + value.project_ref + ".supabase.co")
    throw new Error("Application must target the disposable identity project");
  const users = value.users as Record<
    string,
    { email: string; password: string }
  >;
  const owner = users[role];
  if (!owner?.email.endsWith("@accounts.example.test"))
    throw new Error("Reserved fictional account required");
  return owner;
}
test.describe("Hosted M1 workflows", () => {
  test.skip(
    process.env.E2E_LIVE !== "1" ||
      process.env.GLARA_ACCEPTANCE_ALLOW_DISPOSABLE !== "yes",
    "Requires explicit disposable hosted project opt-in",
  );
  test.setTimeout(90000);
  test("owner creates a brokerage and realtor, logs a note, follows up, searches and archives", async ({
    page,
  }, testInfo) => {
    const suffix = testInfo.project.name + randomUUID().slice(0, 8);
    const first = "Sarah" + suffix;
    await page.goto("/login");
    await page.getByLabel("Work email").fill(credentials().email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(credentials().password);
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
  test("cancel and reschedule preserve the prospect next action and visible history", async ({
    page,
  }, info) => {
    await page.goto("/login");
    await page.getByLabel("Work email").fill(credentials().email);
    await page
      .getByLabel("Password", { exact: true })
      .fill(credentials().password);
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
});

test.describe("Hosted role boundaries", () => {
  test.skip(
    process.env.E2E_LIVE !== "1" ||
      process.env.GLARA_ACCEPTANCE_ALLOW_DISPOSABLE !== "yes",
    "Requires disposable hosted opt-in",
  );
  for (const role of [
    "owner",
    "sales",
    "admin",
    "marketing",
    "designer",
    "staging_crew",
    "unassigned",
    "archived",
  ]) {
    test(role + " workspace and CRM boundaries", async ({ page }) => {
      await page.goto("/login");
      await page.getByLabel("Work email").fill(credentials(role).email);
      await page
        .getByLabel("Password", { exact: true })
        .fill(credentials(role).password);
      await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
      if (["unassigned", "archived"].includes(role)) {
        await expect(page).toHaveURL(/unauthorized$/);
        await page.goto("/realtors");
        await expect(page).toHaveURL(/unauthorized$/);
        return;
      }
      await expect(page).toHaveURL(/dashboard$/);
      await page.goto("/realtors");
      if (["designer", "staging_crew"].includes(role)) {
        await expect(page).toHaveURL(/unauthorized$/);
      } else {
        await expect(
          page.getByRole("heading", { name: "Realtor relationships" }),
        ).toBeVisible();
        await page.goto("/realtors/new");
        if (role === "marketing") await expect(page).toHaveURL(/unauthorized$/);
        else
          await expect(
            page.getByRole("heading", { name: "A new relationship" }),
          ).toBeVisible();
      }
    });
  }
});
