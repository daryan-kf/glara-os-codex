import { test, expect } from "@playwright/test";
import { api } from "../../convex/_generated/api";
import { operationsClient, wonFixture } from "../support/operations-fixture";
import { credentials } from "../support/identities";
import { acceptanceDate } from "../support/acceptance-date";
import { day } from "../../src/lib/operations/model";
import type { Id } from "../../convex/_generated/dataModel";

test.describe("M4 mixed inventory operations", () => {
  test.skip(
    process.env.GLARA_CONVEX_ACCEPTANCE !== "yes",
    "Requires fictional hosted identities",
  );
  test.setTimeout(300000);
  test("serialized identity, installation, damaged return, missing quantity, repair, search and transfer", async ({
    page,
  }, info) => {
    const eventDay = acceptanceDate(
      info.project.name === "mobile"
        ? "GLARA_M4_MOBILE_DAY"
        : "GLARA_M4_DESKTOP_DAY",
      info.project.name === "mobile" ? "2026-09-02" : "2026-09-01",
    );
    const { client: c } = await operationsClient();
    const f = await wonFixture(c);
    const project = (await c.mutation(api.operations.create, f.createArgs)).id;
    const get = () => c.query(api.operations.get, { id: project });
    const room = (await get()).rooms[0]._id;
    const category = await c.mutation(api.inventory.saveCategory, {
      version: 0,
      name: `Fictional mixed ${f.suffix}`,
      active: true,
    });
    const location = await c.mutation(api.inventory.saveLocation, {
      version: 0,
      input: JSON.stringify({
        name: `Fictional mixed source ${f.suffix}`,
        type: "warehouse",
        address: "Fictional",
        active: true,
        staging_source: true,
        retail_source: true,
      }),
    });
    const dest = await c.mutation(api.inventory.saveLocation, {
      version: 0,
      input: JSON.stringify({
        name: `Fictional mixed destination ${f.suffix}`,
        type: "warehouse",
        address: "Fictional",
        active: true,
        staging_source: true,
        retail_source: true,
      }),
    });
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
    const transition = async (
      status:
        | "designing"
        | "ready_to_schedule"
        | "staging"
        | "staged"
        | "listing_live"
        | "sold"
        | "destaging",
      date?: string,
    ) =>
      c.mutation(api.operations.transition, {
        id: project,
        version: (await get()).version,
        status,
        date,
      });
    const checks = async (category: string) => {
      for (const x of (await get()).checklist.filter(
        (x) => x.required && x.category === category,
      ))
        await c.mutation(api.operations.checklist, {
          id: x._id,
          version: x.version,
          status: "completed",
        });
    };
    const schedule = async (type: "staging" | "destaging") => {
      // Historical fictional event dates avoid consuming today's operating capacity.
      const d = eventDay;
      for (let h = 10; h < 23; h++) {
        try {
          return await c.mutation(api.operations.schedule, {
            project_id: project,
            project_version: (await get()).version,
            version: 0,
            event_type: type,
            title: "Fictional mixed browser " + type,
            description: "Acceptance fixture",
            location_note: "",
            start_at: `${d}T${h}:00:00Z`,
            end_at: `${d}T${h}:30:00Z`,
            assigned_lead_id: f.createArgs.staging_lead_id!,
          });
        } catch (e) {
          if (
            (e as { data?: { code?: string } }).data?.code !==
            "SCHEDULE_CONFLICT"
          )
            throw e;
        }
      }
      throw Error("No fictional historical slot");
    };
    const createProduct = async (mode: "serialized" | "quantity") => {
      await page.goto("/inventory/new");
      await page
        .getByRole("textbox", { name: "Product name", exact: true })
        .fill(`Fictional ${mode} ${f.suffix}`);
      await page
        .getByRole("textbox", { name: "SKU", exact: true })
        .fill(`UI-${mode}-${f.suffix}`);
      await page
        .getByRole("combobox", { name: "Category", exact: true })
        .selectOption(category);
      await page
        .getByRole("combobox", { name: "Tracking mode", exact: true })
        .selectOption(mode);
      await page
        .getByRole("button", { name: "Create product", exact: true })
        .click();
      await expect(page).toHaveURL(/\/inventory\/products\/[a-z0-9]+$/);
      const id = page.url().split("/").at(-1) as Id<"products">;
      await page
        .getByRole("combobox", { name: "Receiving location", exact: true })
        .selectOption(location);
      if (mode === "quantity")
        await page
          .getByRole("spinbutton", { name: "Quantity received", exact: true })
          .fill("10");
      await page
        .getByRole("textbox", {
          name: "Receipt reference / reason",
          exact: true,
        })
        .fill("Fictional mixed receipt");
      await page
        .getByRole("button", { name: "Receive inventory", exact: true })
        .click();
      await expect
        .poll(async () => {
          const p = await c.query(api.inventory.product, { id });
          return mode === "serialized"
            ? p.assets.length
            : p.stock[0]?.available;
        })
        .toBe(mode === "serialized" ? 1 : 10);
      return id;
    };
    const act = async (
      id: Id<"inventory_reservations">,
      action: string,
      quantity = 1,
      outcome = "good",
      confirmation?: string,
    ) => {
      await page.goto(`/projects/${project}/inventory`);
      const row = (await inventory()).lines.find((r) => r._id === id)!;
      const article = page
        .locator("article")
        .filter({
          has: page.getByRole("heading", {
            name: `${row.product_name} ×${row.quantity}`,
            exact: true,
          }),
        })
        .filter({
          has: page
            .locator("span")
            .filter({ hasText: new RegExp(`^${row.state}$`) }),
        })
        .first();
      await article
        .getByText("Record inventory action", { exact: true })
        .click();
      await article
        .getByRole("combobox", { name: "Action", exact: true })
        .selectOption(action);
      if (row.asset_id)
        await article
          .getByRole("textbox", { name: "Confirm asset number", exact: true })
          .fill(confirmation ?? row.asset_number!);
      else
        await article
          .getByRole("spinbutton", { name: "Quantity to confirm", exact: true })
          .fill(String(quantity));
      await article
        .getByRole("combobox", {
          name: "Receiving location (returns / found items)",
          exact: true,
        })
        .selectOption(location);
      await article
        .getByRole("combobox", {
          name: "Return outcome (returns only)",
          exact: true,
        })
        .selectOption(outcome);
      await article
        .getByRole("textbox", { name: "Action notes / reason", exact: true })
        .fill(`Fictional ${action} ${outcome}`);
      await article
        .getByRole("button", { name: "Confirm inventory action", exact: true })
        .click();
      if (confirmation === "GLA-WRONG") {
        await expect(article.getByRole("alert")).toBeVisible();
        return;
      }
      await expect
        .poll(
          async () =>
            (await inventory()).lines.find((r) => r._id === id)?.version,
        )
        .toBeGreaterThan(row.version);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
      ).toBe(true);
    };
    const inspect = async (
      id: Id<"inventory_reservations">,
      result: "available" | "repair",
    ) => {
      await page.goto(`/projects/${project}/inventory`);
      const r = (await inventory()).lines.find((r) => r._id === id)!;
      const a = page
        .locator("article")
        .filter({
          has: page.getByRole("heading", {
            name: `${r.product_name} ×${r.quantity}`,
            exact: true,
          }),
        })
        .filter({
          has: page
            .locator("span")
            .filter({ hasText: new RegExp(`^${r.state}$`) }),
        })
        .first();
      await a
        .getByText(`Inspect / release ${r.state}`, { exact: true })
        .click();
      if (!r.asset_id)
        await a
          .getByRole("spinbutton", { name: "Quantity inspected", exact: true })
          .fill(String(r.quantity));
      await a
        .getByRole("combobox", { name: "Inspection result", exact: true })
        .selectOption(result);
      await a
        .getByRole("textbox", { name: "Inspection notes", exact: true })
        .fill("Fictional inspection evidence");
      await a
        .getByRole("button", { name: "Record inspection", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await inventory()).lines.find((x) => x._id === id)?.state,
        )
        .toBe(result === "available" ? "resolved" : "repair");
    };
    await signIn("owner");
    const serialized = await createProduct("serialized"),
      qty = await createProduct("quantity");
    const asset = (await c.query(api.inventory.product, { id: serialized }))
      .assets[0];
    const reserve = (
      product_id: Id<"products">,
      quantity: number,
      asset_id?: Id<"inventory_assets">,
    ) =>
      c.mutation(api.inventory.reserve, {
        project_id: project,
        project_room_id: room,
        product_id,
        asset_id,
        location_id: location,
        quantity,
        needed_from: day(),
        needed_until: day(),
        notes: "Fictional mixed plan",
        planned: false,
      });
    const ar = await reserve(serialized, 1, asset.id),
      qr = await reserve(qty, 3);
    await transition("designing");
    await checks("pre_staging");
    await transition("ready_to_schedule");
    await schedule("staging");
    await transition("staging");
    await signIn("staging_crew");
    await act(ar, "pick", 1, "good", "GLA-WRONG");
    await act(ar, "wrong_item");
    await act(ar, "pick");
    await act(qr, "pick", 3);
    await act(ar, "install");
    await act(qr, "install", 3);
    await checks("staging");
    await transition("staged");
    await transition("listing_live", eventDay);
    await transition("sold", eventDay);
    await schedule("destaging");
    await checks("destaging");
    await transition("destaging");
    await act(ar, "destage");
    await act(qr, "destage", 3);
    await act(ar, "return", 1, "damaged");
    await act(qr, "return", 2);
    await act(qr, "missing", 1);
    await page
      .getByRole("button", { name: "Return list", exact: true })
      .click();
    await expect(
      page.getByText("Reported exception: Fictional missing good", {
        exact: true,
      }),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath("mixed-return.png"),
      fullPage: true,
    });
    await signIn("owner");
    await act(qr, "found", 1);
    await inspect(ar, "repair");
    await inspect(ar, "available");
    for (const r of (await inventory()).lines.filter(
      (r) => r.state === "inspection",
    ))
      await inspect(r._id, "available");
    await page.goto(`/inventory/assets/${asset.id}`);
    await expect(
      page.getByRole("heading", { name: asset.asset_number, exact: true }),
    ).toBeVisible();
    await expect(page.getByText(/1 staging uses/)).toBeVisible();
    await page
      .getByRole("button", { name: "Search workspace", exact: true })
      .click();
    await page
      .getByLabel("Search modules and realtors", { exact: true })
      .fill(asset.asset_number);
    await page
      .getByRole("link", { name: `Asset ${asset.asset_number}`, exact: true })
      .click();
    await expect(page).toHaveURL(new RegExp(`/inventory/assets/${asset.id}$`));
    await page.getByText("Transfer / disposition", { exact: true }).click();
    await page
      .getByRole("combobox", {
        name: "Destination (transfers only)",
        exact: true,
      })
      .selectOption(dest);
    await page
      .getByRole("textbox", { name: "Movement reason", exact: true })
      .fill("Fictional post-repair transfer");
    await page
      .getByRole("button", { name: "Record movement", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await c.query(api.inventory.asset, { id: asset.id })).location_id,
      )
      .toBe(dest);
    await expect(
      page.getByText(/Fictional post-repair transfer/),
    ).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: info.outputPath("asset-history.png"),
      fullPage: true,
    });
    await c.mutation(api.operations.transition, {
      id: project,
      version: (await get()).version,
      status: "cancelled",
      reason: "Fictional browser acceptance cleanup",
    });
    await c.mutation(api.operations.archive, {
      id: project,
      version: (await get()).version,
      restore: false,
    });
  });
});
