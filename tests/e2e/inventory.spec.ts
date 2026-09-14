import { test, expect } from "@playwright/test";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { operationsClient, wonFixture } from "../support/operations-fixture";
import { credentials } from "../support/identities";
import { day } from "../../src/lib/operations/model";
test.describe("M4 inventory workflows", () => {
  test.skip(
    process.env.GLARA_CONVEX_ACCEPTANCE !== "yes",
    "Requires fictional hosted identity opt-in",
  );
  test.setTimeout(240000);
  test.use({ actionTimeout: 15000 });
  test("catalog receipt, designer reservation, crew partial picking and inspection", async ({
    page,
  }, info) => {
    const { client: c } = await operationsClient(),
      f = await wonFixture(c),
      project = (await c.mutation(api.operations.create, f.createArgs)).id;
    const category = await c.mutation(api.inventory.saveCategory, {
        version: 0,
        name: `Fictional browser ${f.suffix}`,
        active: true,
      }),
      location = await c.mutation(api.inventory.saveLocation, {
        version: 0,
        input: JSON.stringify({
          name: `Fictional browser source ${f.suffix}`,
          type: "warehouse",
          address: "Fictional",
          active: true,
          staging_source: true,
          retail_source: false,
        }),
      });
    let product: Id<"products"> | undefined;
    const inventory = () =>
      c.query(api.inventory.projectInventory, { project_id: project });
    const signIn = async (role: string) => {
      await page.context().clearCookies();
      const u = credentials(role);
      await page.goto("/login");
      await page.getByLabel("Work email").fill(u.email);
      await page.getByLabel("Password", { exact: true }).fill(u.password);
      await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
      await expect(page).toHaveURL(/dashboard$/);
    };
    try {
      await signIn("owner");
      await page.goto("/inventory/new");
      await page
        .getByRole("textbox", { name: "Product name", exact: true })
        .fill(`Fictional linen pillows ${f.suffix}`);
      await page
        .getByRole("textbox", { name: "SKU", exact: true })
        .fill(`M4-UI-${f.suffix}`);
      await page
        .getByRole("combobox", { name: "Category", exact: true })
        .selectOption(category);
      await page
        .getByRole("combobox", { name: "Tracking mode", exact: true })
        .selectOption("quantity");
      await page
        .getByRole("button", { name: "Create product", exact: true })
        .click();
      await expect(page).toHaveURL(/\/inventory\/products\/[a-z0-9]+$/);
      product = page.url().split("/").at(-1) as Id<"products">;
      await page
        .getByRole("combobox", { name: "Receiving location", exact: true })
        .selectOption(location);
      await page
        .getByRole("spinbutton", { name: "Quantity received", exact: true })
        .fill("10");
      await page
        .getByRole("textbox", {
          name: "Receipt reference / reason",
          exact: true,
        })
        .fill("Fictional browser receipt");
      await page
        .getByRole("button", { name: "Receive inventory", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await c.query(api.inventory.product, { id: product! })).stock[0]
              ?.available,
        )
        .toBe(10);
      await page
        .getByRole("combobox", { name: "Source location", exact: true })
        .selectOption(location);
      await page
        .getByRole("button", { name: "Check availability", exact: true })
        .click();
      await expect(
        page.getByText("10 available for this window", { exact: true }),
      ).toBeVisible();
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: info.outputPath("inventory-product.png"),
        fullPage: true,
      });
      await signIn("designer");
      await page.goto(`/projects/${project}/inventory`);
      await page
        .getByText("Find and reserve inventory", { exact: true })
        .click();
      await page
        .getByRole("textbox", { name: "Product search", exact: true })
        .fill(f.suffix);
      await page
        .getByRole("combobox", { name: "Staging source", exact: true })
        .selectOption(location);
      await page
        .getByRole("button", { name: "Find products", exact: true })
        .click();
      await page
        .getByRole("button", {
          name: new RegExp(`Fictional linen pillows ${f.suffix}`),
        })
        .click();
      const room = (await c.query(api.operations.get, { id: project })).rooms[0]
        ._id;
      await page
        .getByRole("combobox", { name: "Destination room", exact: true })
        .selectOption(room);
      await page
        .getByRole("spinbutton", { name: "Quantity to reserve", exact: true })
        .fill("5");
      await page
        .getByRole("button", { name: "Save reservation", exact: true })
        .click();
      await expect.poll(async () => (await inventory()).lines.length).toBe(1);
      await expect(
        page.getByText("Asset staging eligible", { exact: true }),
      ).toHaveCount(0);
      const get = () => c.query(api.operations.get, { id: project });
      await c.mutation(api.operations.transition, {
        id: project,
        version: (await get()).version,
        status: "designing",
      });
      for (const check of (await get()).checklist.filter(
        (x) => x.required && x.category === "pre_staging",
      ))
        await c.mutation(api.operations.checklist, {
          id: check._id,
          version: check.version,
          status: "completed",
        });
      await c.mutation(api.operations.transition, {
        id: project,
        version: (await get()).version,
        status: "ready_to_schedule",
      });
      let scheduled = false;
      for (let hour = 20; hour < 24; hour++) {
        try {
          await c.mutation(api.operations.schedule, {
            project_id: project,
            project_version: (await get()).version,
            version: 0,
            event_type: "staging",
            title: "Fictional browser pick",
            description: "",
            location_note: "",
            start_at: day() + `T${hour}:00:00Z`,
            end_at: day() + `T${hour}:30:00Z`,
            assigned_lead_id: f.createArgs.staging_lead_id!,
          });
          scheduled = true;
          break;
        } catch (e) {
          if (
            (e as { data?: { code?: string } }).data?.code !==
            "SCHEDULE_CONFLICT"
          )
            throw e;
        }
      }
      expect(scheduled).toBe(true);
      await signIn("staging_crew");
      await page.goto(`/projects/${project}/inventory`);
      await page
        .getByRole("button", { name: "Pick list", exact: true })
        .click();
      let article = page
        .locator("article")
        .filter({ hasText: `Fictional linen pillows ${f.suffix}` })
        .first();
      await article
        .getByText("Record inventory action", { exact: true })
        .click();
      await article
        .getByRole("combobox", { name: "Action", exact: true })
        .selectOption("pick");
      await article
        .getByRole("spinbutton", { name: "Quantity to confirm", exact: true })
        .fill("3");
      await article
        .getByRole("textbox", { name: "Action notes / reason", exact: true })
        .fill("Fictional mobile pick");
      await article
        .getByRole("button", { name: "Confirm inventory action", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await inventory()).lines.find((r) => r.state === "picked")
              ?.quantity,
        )
        .toBe(3);
      await expect(
        page.getByText("PRIVATE MANAGER NOTES", { exact: true }),
      ).toHaveCount(0);
      await page.screenshot({
        path: info.outputPath("inventory-crew-pick.png"),
        fullPage: true,
      });
      article = page
        .locator("article")
        .filter({ hasText: `Fictional linen pillows ${f.suffix} ×3` });
      await article
        .getByText("Record inventory action", { exact: true })
        .click();
      await article
        .getByRole("combobox", { name: "Action", exact: true })
        .selectOption("return");
      await article
        .getByRole("combobox", {
          name: "Receiving location (returns / found items)",
          exact: true,
        })
        .selectOption(location);
      await article
        .getByRole("textbox", { name: "Action notes / reason", exact: true })
        .fill("Fictional unused pieces returned");
      await article
        .getByRole("button", { name: "Confirm inventory action", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await inventory()).lines.find((r) => r.state === "inspection")
              ?.quantity,
        )
        .toBe(3);
      await page
        .getByRole("button", { name: "Return list", exact: true })
        .click();
      await expect(
        page.getByText("No expected returns", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("Inspect / release inspection", { exact: true }),
      ).toHaveCount(0);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath("inventory-crew-return.png"),
        fullPage: true,
      });
      await signIn("owner");
      await page.goto(`/projects/${project}/inventory`);
      await page
        .getByText("Inspect / release inspection", { exact: true })
        .click();
      await page
        .getByRole("spinbutton", { name: "Quantity inspected", exact: true })
        .fill("3");
      await page
        .getByRole("textbox", { name: "Inspection notes", exact: true })
        .fill("Fictional inspection passed");
      await page
        .getByRole("button", { name: "Record inspection", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await c.query(api.inventory.product, { id: product! })).stock[0]
              .available,
        )
        .toBe(10);
    } finally {
      // Preserve the ledger while releasing only this test's active assignments.
      for (const r of (await inventory()).lines) {
        if (["planned", "reserved"].includes(r.state))
          await c.mutation(api.inventory.moveReservation, {
            id: r._id,
            version: r.version,
            action: "release",
            quantity: r.quantity,
            asset_confirmation: r.asset_number ?? "",
            reason: "Fictional browser cleanup",
          });
      }
      const p = await c.query(api.operations.get, { id: project });
      if ((await inventory()).lines.every((r) => !r.active)) {
        await c.mutation(api.operations.transition, {
          id: project,
          version: p.version,
          status: "cancelled",
          reason: "Fictional browser acceptance cleanup",
        });
        await c.mutation(api.operations.archive, {
          id: project,
          version: (await c.query(api.operations.get, { id: project })).version,
          restore: false,
        });
      }
    }
  });
});
