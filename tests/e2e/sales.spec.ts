import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { credentials } from "../support/identities";

test.describe("Hosted M2 sales workflows", () => {
  test.skip(
    process.env.GLARA_CONVEX_ACCEPTANCE !== "yes",
    "Requires fictional hosted identity opt-in",
  );
  test.setTimeout(120000);
  test.use({ actionTimeout: 15000 });
  test("property to opportunity, consultation, exact quote and won deal", async ({
    page,
  }, info) => {
    const who = credentials("sales");
    const url = readFileSync(".env.local", "utf8")
      .match(/^NEXT_PUBLIC_CONVEX_URL=(.+)$/m)![1]
      .trim();
    const client = new ConvexHttpClient(url, { logger: false });
    const signIn = await client.action(
      makeFunctionReference<"action">("auth:signIn"),
      {
        provider: "password",
        params: { email: who.email, password: who.password, flow: "signIn" },
      },
    );
    client.setAuth(signIn.tokens.token);
    const suffix = randomUUID().slice(0, 8),
      realtorName = "FictionalM2 " + suffix,
      address = "Fictional " + suffix + " Lane";
    await client.mutation(makeFunctionReference<"mutation">("crm:write"), {
      input: JSON.stringify({
        op: "realtor_create",
        data: {
          first_name: "FictionalM2",
          last_name: suffix,
          assigned_to: who.id,
          relationship_status: "active_partner",
        },
      }),
    });
    await page.goto("/login");
    await page.getByLabel("Work email").fill(who.email);
    await page.getByLabel("Password", { exact: true }).fill(who.password);
    await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
    await expect(page).toHaveURL(/dashboard$/);
    await page.goto("/properties/new");
    await page.getByLabel("Address line 1", { exact: true }).fill(address);
    await page.getByLabel("Primary Realtor", { exact: true }).fill(suffix);
    await page.getByRole("button", { name: realtorName, exact: true }).click();
    await page
      .getByRole("button", { name: "Save property", exact: true })
      .click();
    await expect(page).toHaveURL(/\/properties\/[a-z0-9]+$/);
    await expect(
      page.getByRole("heading", { name: address, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("property.png"),
      fullPage: true,
    });
    const propertyUrl = page.url();
    await page
      .getByRole("link", { name: "New opportunity", exact: true })
      .click();
    await page
      .getByLabel("Estimated value (CAD)", { exact: true })
      .fill("5000.01");
    await page
      .getByLabel("Next action", { exact: true })
      .fill("Call fictional agent");
    await page
      .getByLabel("Next action date", { exact: true })
      .fill("2099-01-01T10:00");
    await page
      .getByRole("button", { name: "Save opportunity", exact: true })
      .click();
    await expect(page).toHaveURL(/\/opportunities\/[a-z0-9]+$/);
    const opportunityUrl = page.url();
    for (const stage of ["contacted", "interested", "consultation"]) {
      await page
        .getByRole("combobox", { name: "Move to stage", exact: true })
        .selectOption(stage);
      await page
        .getByRole("button", { name: "Change stage", exact: true })
        .click();
      await expect(
        page
          .getByRole("combobox", { name: "Move to stage", exact: true })
          .locator(`option[value="${stage}"]`),
      ).toHaveCount(0);
    }
    await page.getByText("Schedule consultation", { exact: true }).click();
    await page
      .getByLabel("Consultation date", { exact: true })
      .fill("2099-01-02T10:00");
    await page
      .getByRole("button", { name: "Save consultation", exact: true })
      .click();
    await expect(
      page.getByText("Onsite · Scheduled", { exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Update consultation", exact: true })
      .click();
    await expect(
      page.getByText("Onsite · Completed", { exact: true }),
    ).toBeVisible();
    await page.getByRole("link", { name: "Create quote", exact: true }).click();
    await page
      .getByLabel("Description 1", { exact: true })
      .fill("Fictional staging service");
    await page.getByLabel("Quantity 1", { exact: true }).fill("2");
    await page.getByLabel("Unit price 1", { exact: false }).fill("100.01");
    await page.getByLabel("Tax rate", { exact: false }).fill("5.00");
    await page.screenshot({
      path: info.outputPath("quote-editor.png"),
      fullPage: true,
    });
    await page.getByRole("button", { name: "Save quote", exact: true }).click();
    await expect(page).toHaveURL(/\/quotes\/[a-z0-9]+$/);
    await expect(page.getByText("$210.02", { exact: true })).toBeVisible();
    await page
      .getByRole("button", { name: "Confirm quote status", exact: true })
      .click();
    await expect(
      page.getByRole("combobox", { name: "Quote status", exact: true }),
    ).toHaveValue("accepted");
    await page.goto(opportunityUrl);
    for (const stage of ["quote_sent", "negotiation", "won"]) {
      await page
        .getByRole("combobox", { name: "Move to stage", exact: true })
        .selectOption(stage);
      await page
        .getByRole("button", { name: "Change stage", exact: true })
        .click();
      await expect(
        page
          .getByRole("combobox", { name: "Move to stage", exact: true })
          .locator(`option[value="${stage}"]`),
      ).toHaveCount(0);
    }
    await expect(
      page.getByText("Create Staging Project — available in M3", {
        exact: true,
      }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("opportunity.png"),
      fullPage: true,
    });
    await page.goto("/opportunities");
    await expect(
      page.getByRole("heading", { name: "Sales pipeline", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Loading your sales workspace…", { exact: true }),
    ).toHaveCount(0);
    if (info.project.name === "mobile")
      await page
        .getByRole("combobox", { name: "Stage", exact: true })
        .selectOption("won");
    await expect(
      page.getByRole("link", { name: address, exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("pipeline.png"),
      fullPage: true,
    });
    await page
      .getByRole("button", { name: "List & filters", exact: true })
      .click();
    await page.getByLabel("Address or Realtor", { exact: true }).fill(suffix);
    await page
      .getByRole("button", { name: "Filter opportunities", exact: true })
      .click();
    await expect(
      page.getByRole("link", { name: address, exact: true }),
    ).toBeVisible();
    expect(propertyUrl).toContain("/properties/");
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth + 1,
    );
    expect(overflow).toBe(false);
  });
  for (const role of ["marketing", "designer", "staging_crew"]) {
    test(role + " cannot open commercial routes", async ({ page }) => {
      const who = credentials(role);
      await page.goto("/login");
      await page.getByLabel("Work email").fill(who.email);
      await page.getByLabel("Password", { exact: true }).fill(who.password);
      await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
      await expect(page).toHaveURL(/dashboard$/);
      await page.goto("/opportunities");
      await expect(page).toHaveURL(/unauthorized/);
      await page.goto("/quotes");
      await expect(page).toHaveURL(/unauthorized/);
    });
  }
});
