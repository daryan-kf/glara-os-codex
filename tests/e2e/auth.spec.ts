import { credentials } from "../support/identities";
import { expect, test } from "@playwright/test";
const protectedRoutes = [
  "dashboard",
  "realtors",
  "opportunities",
  "properties",
  "projects",
  "calendar",
  "inventory",
  "quotes",
  "payments",
  "marketing",
  "reports",
  "settings",
  "profile",
  "notifications",
];
test("private routes never expose their content without authentication", async ({
  page,
}) => {
  for (const route of protectedRoutes) {
    await page.goto(`/${route}`);
    await expect(page).toHaveURL(/\/login$/);
    await expect(
      page.getByRole("heading", { name: "Welcome back." }),
    ).toBeVisible();
  }
});
test("login and recovery fit desktop and mobile viewports", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "A fresh start." }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(/\/login$/);
});
test("Convex Auth login, navigation and logout", async ({ page }, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(credentials().email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(credentials().password);
  await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText("More connected.")).toBeVisible();
  await expect(
    page.getByText("Quotes awaiting response", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).filter((key) =>
        key.toLowerCase().includes("convex"),
      ),
    ),
  ).toEqual([]);
  const authCookies = (await page.context().cookies()).filter((cookie) =>
    cookie.name.includes("convexAuth"),
  );
  expect(authCookies.length).toBeGreaterThan(0);
  expect(
    authCookies.every((cookie) => cookie.httpOnly && cookie.sameSite === "Lax"),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("dashboard.png"),
    fullPage: true,
  });
  const mobile = testInfo.project.name === "mobile";
  if (mobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Realtors", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Realtor relationships" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Search workspace" }).click();
  await page.getByLabel("Search modules").fill("Inventory");
  await page
    .getByRole("dialog")
    .getByRole("link", { name: "Inventory" })
    .click();
  await expect(page).toHaveURL(/\/inventory$/);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  if (mobile)
    await page.getByRole("button", { name: "Open navigation" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("dialog")
    .last()
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("sales are denied owner reports even through a direct URL", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(credentials("sales").email);
  await page
    .getByLabel("Password", { exact: true })
    .fill(credentials("sales").password);
  await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto("/reports");
  await expect(page).toHaveURL(/\/unauthorized$/);
  await expect(
    page.getByRole("heading", { name: "Access is restricted." }),
  ).toBeVisible();
});
test("invalid credentials show a safe error and recovery does not enumerate accounts", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("nobody@example.test");
  await page.getByLabel("Password", { exact: true }).fill("Wrong-password");
  await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Unable to sign in" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(
    page.getByRole("heading", { name: "A fresh start." }),
  ).toBeVisible();
  await page.getByLabel("Work email").fill("nobody@example.test");
  await page.getByRole("button", { name: "Send reset code" }).click();
  await expect(
    page.getByText("If an account exists for this email"),
  ).toBeVisible();
  await page.goto("/auth/confirm?type=recovery&token_hash=invalid");
  await expect(page).toHaveURL(/invalid-link/);
});
