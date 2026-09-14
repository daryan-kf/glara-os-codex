import { test, expect } from "@playwright/test";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { operationsClient, wonFixture } from "../support/operations-fixture";
import { credentials } from "../support/identities";
import { day } from "../../src/lib/operations/model";
test.describe("M5 commercial desktop and mobile", () => {
  test.skip(
    process.env.GLARA_CONVEX_ACCEPTANCE !== "yes",
    "Fictional hosted identity opt-in required",
  );
  test.setTimeout(240000);
  test.use({ actionTimeout: 15000 });
  test("billing identity, accepted agreement, deposit, payment receipt and credit", async ({
    page,
  }, info) => {
    const { client: c } = await operationsClient(),
      f = await wonFixture(c),
      project = (await c.mutation(api.operations.create, f.createArgs)).id;
    await page.context().clearCookies();
    const owner = credentials("owner");
    await page.goto("/login");
    await page.getByLabel("Work email").fill(owner.email);
    await page.getByLabel("Password", { exact: true }).fill(owner.password);
    await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
    await expect(page).toHaveURL(/dashboard$/);
    await page.goto("/commercial/settings");
    const customerPanel = page
      .getByRole("heading", { name: "New billing customer" })
      .locator("..");
    await customerPanel
      .getByRole("textbox", { name: "Billing name", exact: true })
      .fill(`Fictional browser M5 ${f.suffix}`);
    await customerPanel
      .getByRole("textbox", { name: "Billing address", exact: true })
      .fill("100 Fictional Avenue");
    await customerPanel
      .getByRole("textbox", { name: "Email", exact: true })
      .fill("m5-browser@accounts.example.test");
    await customerPanel
      .getByRole("button", { name: "Create customer", exact: true })
      .click();
    await expect
      .poll(async () =>
        (await c.query(api.commercial.configuration, {})).customers.some((x) =>
          x.bill_to.name.endsWith(f.suffix),
        ),
      )
      .toBe(true);
    const customer = (
      await c.query(api.commercial.configuration, {})
    ).customers.find((x) => x.bill_to.name.endsWith(f.suffix))!;
    await page.goto(`/projects/${project}/commercial`);
    await page
      .locator("summary")
      .filter({ hasText: /^Prepare agreement$/ })
      .click();
    await page
      .getByRole("combobox", { name: "Bill to", exact: true })
      .selectOption(customer._id);
    await page
      .getByRole("textbox", { name: "liability terms", exact: true })
      .fill("Proven customer damage only");
    await page
      .getByRole("button", { name: "Save agreement draft", exact: true })
      .click();
    await expect(page).toHaveURL(/\/agreements\/[a-z0-9]+$/);
    const agreement = page.url().split("/").at(-1) as Id<"agreements">;
    let action = page
      .getByRole("heading", { name: "Agreement action", exact: true })
      .locator("..");
    await action
      .getByRole("textbox", { name: "Action reason", exact: true })
      .fill("Fictional terms sent");
    await action
      .getByRole("button", { name: "Record agreement action" })
      .click();
    await expect
      .poll(
        async () =>
          (await c.query(api.commercial.agreement, { id: agreement })).status,
      )
      .toBe("sent");
    await page.reload();
    action = page
      .getByRole("heading", { name: "Agreement action", exact: true })
      .locator("..");
    await action
      .getByRole("textbox", { name: "Action reason", exact: true })
      .fill("Fictional acceptance");
    await action
      .getByRole("textbox", { name: "Accepted by", exact: true })
      .fill("Fictional Seller");
    await action
      .getByRole("textbox", { name: "Evidence reference", exact: true })
      .fill("Fictional recorded acknowledgement");
    await action
      .getByRole("button", { name: "Record agreement action" })
      .click();
    await expect
      .poll(
        async () =>
          (await c.query(api.commercial.agreement, { id: agreement })).status,
      )
      .toBe("accepted");
    await page.goto(`/projects/${project}/commercial`);
    await page
      .locator("summary")
      .filter({ hasText: /^Prepare deposit invoice$/ })
      .click();
    await page
      .getByRole("button", { name: "Prepare deposit invoice", exact: true })
      .click();
    await expect(page).toHaveURL(/\/invoices\/[a-z0-9]+$/);
    const invoice = page.url().split("/").at(-1) as Id<"invoices">;
    const row = await c.query(api.commercial.invoice, { id: invoice });
    expect(row.total_cents).toBe("262500");
    const invoiceAction = page
      .getByRole("heading", { name: "Invoice action", exact: true })
      .locator("..");
    await invoiceAction
      .getByRole("textbox", { name: "Action reason", exact: true })
      .fill("Issue fictional deposit");
    await invoiceAction
      .getByRole("button", { name: "Confirm invoice action" })
      .click();
    await expect
      .poll(
        async () =>
          (await c.query(api.commercial.invoice, { id: invoice })).status,
      )
      .toBe("issued");
    await page.goto(`/projects/${project}/commercial`);
    await page
      .locator("summary")
      .filter({ hasText: /^Record received payment$/ })
      .click();
    await page
      .getByRole("combobox", { name: "Bill to", exact: true })
      .selectOption(customer._id);
    await page
      .getByRole("textbox", { name: "Received amount (CAD)", exact: true })
      .fill("3000");
    await page
      .getByRole("textbox", { name: new RegExp(row.number) })
      .fill("2500");
    await page
      .getByRole("button", { name: "Record payment", exact: true })
      .click();
    await expect(page).toHaveURL(/\/payments\/[a-z0-9]+$/);
    await expect(
      page.getByText("Unallocated: $500.00", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await c.query(api.commercial.invoice, { id: invoice }))
            .balance_cents,
      )
      .toBe("12500");
    const allocate = page
      .getByRole("heading", { name: "Allocate remaining payment", exact: true })
      .locator("..");
    await allocate
      .getByRole("textbox", { name: new RegExp(row.number) })
      .fill("125");
    await allocate
      .getByRole("button", { name: "Confirm allocation", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await c.query(api.commercial.invoice, { id: invoice }))
            .effective_status,
      )
      .toBe("paid");
    await expect(
      page.getByText("Unallocated: $375.00", { exact: true }),
    ).toBeVisible();
    await page.goto(`/invoices/${invoice}`);
    const credit = page
      .getByRole("heading", { name: "Issue credit note", exact: true })
      .locator("..");
    await credit
      .getByRole("textbox", {
        name: "Credit amount (CAD, including tax)",
        exact: true,
      })
      .fill("25");
    await credit
      .getByRole("textbox", { name: "Credit reason", exact: true })
      .fill("Fictional courtesy credit");
    await credit.getByRole("button", { name: "Confirm credit note" }).click();
    await expect
      .poll(
        async () =>
          (await c.query(api.commercial.invoice, { id: invoice }))
            .credit_balance_cents,
      )
      .toBe("2500");
    await expect(
      page.getByText(/refund or reallocation review required/),
    ).toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".commercial-document")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Print / save PDF" }),
    ).toBeHidden();
    await page.emulateMedia({ media: "screen" });
    await page.goto(`/projects/${project}/commercial`);
    await expect(
      page.getByRole("heading", { name: "Commercial attention" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("m5-commercial.png"),
      fullPage: true,
    });
    await page
      .locator("summary")
      .filter({ hasText: /^Propose extension$/ })
      .click();
    await page
      .getByLabel("New package end date", { exact: true })
      .fill("2100-01-31");
    await page
      .getByRole("textbox", { name: "Extension rate (CAD)", exact: true })
      .fill("100");
    await page
      .getByRole("textbox", { name: "Extension reason", exact: true })
      .fill("Fictional browser extension");
    await page
      .getByRole("button", { name: "Save extension proposal", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await c.query(api.commercial.project, { project_id: project }))
            .extensions.length,
      )
      .toBe(1);
    await page.reload();
    const extension = page
      .getByRole("heading", { name: "Package extensions", exact: true })
      .locator("..");
    await extension
      .getByRole("textbox", { name: "Decision reason", exact: true })
      .fill("Fictional accepted extension");
    await extension
      .getByRole("textbox", { name: "Accepted by", exact: true })
      .fill("Fictional Seller");
    await extension
      .getByRole("textbox", { name: "Evidence reference", exact: true })
      .fill("Fictional extension acknowledgement");
    await extension
      .getByRole("button", { name: "Record extension decision", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await c.query(api.operations.get, { id: project })).planned_end_date,
      )
      .toBe("2100-01-31");
    await page.goto("/payments");
    await page
      .getByRole("combobox", { name: "Invoice status", exact: true })
      .selectOption("");
    await page
      .getByRole("combobox", { name: "Customer filter", exact: true })
      .selectOption(customer._id);
    await page
      .getByRole("button", { name: "Apply receivable filters", exact: true })
      .click();
    await expect(
      page.getByRole("link").filter({ hasText: row.number }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath("m5-receivables.png"),
      fullPage: true,
    });
    const sales = credentials("sales");
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Work email").fill(sales.email);
    await page.getByLabel("Password", { exact: true }).fill(sales.password);
    await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
    await expect(page).toHaveURL(/dashboard$/);
    await page.goto(`/invoices/${invoice}`);
    await expect(
      page.getByRole("heading", { name: row.number, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Confirm credit note" }),
    ).toHaveCount(0);
  });
  test("damage review, approved charge invoice and restricted-role denial", async ({
    page,
  }, info) => {
    const { client: c } = await operationsClient(),
      f = await wonFixture(c),
      project = (await c.mutation(api.operations.create, f.createArgs)).id,
      room = (await c.query(api.operations.get, { id: project })).rooms[0]._id;
    const customer = await c.mutation(api.commercial.saveCustomer, {
      version: 0,
      input: JSON.stringify({
        type: "seller",
        name: `Fictional damage ${f.suffix}`,
        contact: "",
        email: "",
        phone: "",
        address: "Fictional address",
        company: "",
      }),
    });
    const category = await c.mutation(api.inventory.saveCategory, {
        version: 0,
        name: `M5 browser ${f.suffix}`,
        active: true,
      }),
      location = await c.mutation(api.inventory.saveLocation, {
        version: 0,
        input: JSON.stringify({
          name: `M5 browser warehouse ${f.suffix}`,
          type: "warehouse",
          address: "Fictional",
          active: true,
          staging_source: true,
          retail_source: false,
        }),
      }),
      product = await c.mutation(api.inventory.saveProduct, {
        version: 0,
        category_id: category,
        input: JSON.stringify({
          sku: `M5-UI-${f.suffix}`,
          name: "Fictional M5 browser chair",
          track_mode: "serialized",
          active: true,
          staging_eligible: true,
          retail_eligible: false,
        }),
      }),
      asset = (await c.mutation(api.inventory.receive, {
        product_id: product,
        location_id: location,
        quantity: 1,
        condition: "good",
        acquisition_date: day(),
        reason: "Fictional receipt",
      }))!;
    const reservation = await c.mutation(api.inventory.reserve, {
      project_id: project,
      project_room_id: room,
      product_id: product,
      asset_id: asset,
      location_id: location,
      quantity: 1,
      needed_from: day(),
      needed_until: "2099-12-31",
      notes: "",
      planned: false,
    });
    const physical = await c.query(api.inventory.asset, { id: asset });
    await c.mutation(api.inventory.moveReservation, {
      id: reservation,
      version: 1,
      action: "damage",
      quantity: 1,
      asset_confirmation: physical.asset_number,
      reason: "Fictional reported damage",
    });
    const incident = (
      await c.query(api.commercial.project, { project_id: project })
    ).unassessed_incidents[0];
    const assessment = await c.mutation(api.commercial.createAssessment, {
      project_id: project,
      damage_record_id: incident.id,
    });
    const owner = credentials("owner");
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Work email").fill(owner.email);
    await page.getByLabel("Password", { exact: true }).fill(owner.password);
    await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
    await expect(page).toHaveURL(/dashboard$/);
    await page.goto(`/assessments/${assessment}`);
    await page
      .getByRole("combobox", { name: "Liability basis", exact: true })
      .selectOption("client_damage");
    await page
      .getByRole("combobox", { name: "Valuation basis", exact: true })
      .selectOption("repair_cost");
    await page
      .getByRole("textbox", { name: "Proposed amount (CAD)", exact: true })
      .fill("150");
    await page
      .getByRole("textbox", {
        name: "Review evidence and rationale",
        exact: true,
      })
      .fill("Fictional customer responsibility evidence");
    await page
      .getByRole("button", { name: "Save assessment review", exact: true })
      .click();
    await expect
      .poll(
        async () =>
          (await c.query(api.commercial.assessment, { id: assessment })).status,
      )
      .toBe("under_review");
    await page.reload();
    await page
      .getByRole("combobox", { name: "Decision", exact: true })
      .selectOption("approve");
    await page
      .getByRole("textbox", {
        name: "Approved amount (CAD, before tax)",
        exact: true,
      })
      .fill("125");
    await page
      .getByRole("textbox", { name: "Decision reason", exact: true })
      .fill("Fictional approved repair amount");
    await page
      .getByRole("button", { name: "Confirm assessment decision" })
      .click();
    await expect
      .poll(
        async () =>
          (await c.query(api.commercial.assessment, { id: assessment })).status,
      )
      .toBe("approved");
    await page.reload();
    await page
      .getByRole("combobox", { name: "Bill to", exact: true })
      .selectOption(customer);
    await page
      .getByRole("button", { name: "Prepare assessment invoice" })
      .click();
    await expect(page).toHaveURL(/\/invoices\/[a-z0-9]+$/);
    const invoice = page.url().split("/").at(-1)!;
    await expect(
      page
        .locator(".commercial-document")
        .getByText("$125.00", { exact: true })
        .first(),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath("m5-charge-invoice.png"),
      fullPage: true,
    });
    const crew = credentials("staging_crew");
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByLabel("Work email").fill(crew.email);
    await page.getByLabel("Password", { exact: true }).fill(crew.password);
    await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
    await expect(page).toHaveURL(/dashboard$/);
    await page.goto(`/invoices/${invoice}`);
    await expect(page).toHaveURL(/unauthorized$/);
  });
});
