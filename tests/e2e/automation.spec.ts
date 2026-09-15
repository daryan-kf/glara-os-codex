import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { operationsClient } from "../support/operations-fixture";
import { day } from "../../src/lib/operations/model";
import { test, expect } from "@playwright/test";
import { credentials } from "../support/identities";
test.describe("M7 automation desktop and mobile", () => {
  test.skip(
    process.env.GLARA_M7_ACCEPTANCE !== "yes",
    "M7 development deployment required",
  );
  test.setTimeout(90000);
  async function login(page: import("@playwright/test").Page, role: string) {
    const c = credentials(role);
    await page.goto("/login");
    await page.getByLabel("Work email").fill(c.email);
    await page.getByLabel("Password", { exact: true }).fill(c.password);
    await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
    await expect(page).toHaveURL(/dashboard/);
  }
  for (const role of ["owner", "admin"]) {
    test(`${role} can inspect rules, history, health and bounded reconciliation`, async ({
      page,
    }, info) => {
      await login(page, role);
      await page.goto("/automation");
      await expect(
        page.getByRole("heading", { name: "Automation Center" }),
      ).toBeVisible();
      await expect(
        page.getByText("Quote follow-up · day 2", { exact: false }).first(),
      ).toBeVisible();
      await page
        .locator("summary")
        .filter({ hasText: "Quote follow-up · day 2" })
        .click();
      await expect(
        page.getByRole("button", { name: "Save rule version" }).first(),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      const summary = page
        .locator("summary")
        .filter({ hasText: "Quote follow-up · day 2" });
      const previousText = await summary.textContent();
      await page
        .getByRole("button", { name: "Save rule version" })
        .first()
        .click();
      await expect(summary).not.toHaveText(previousText!);
      await page.screenshot({
        path: info.outputPath("m7-rules.png"),
        fullPage: true,
      });
      await page.getByRole("button", { name: "Failures", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Automation health" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "History", exact: true }).click();
      await expect(
        page.getByRole("heading", { name: "Execution history" }),
      ).toBeVisible();
      await page.getByRole("button", { name: "Settings", exact: true }).click();
      await expect(
        page.getByRole("button", { name: "Enroll next batch" }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Preview & reconcile one source" }),
      ).toBeVisible();
      if (process.env.GLARA_M7_BROWSER_FIXTURE) {
        const f = JSON.parse(
          readFileSync(process.env.GLARA_M7_BROWSER_FIXTURE, "utf8"),
        ) as { project: string };
        await page
          .getByRole("combobox", { name: "Source", exact: true })
          .selectOption("projects");
        await page.getByLabel("Record ID", { exact: true }).fill(f.project);
        await page
          .getByRole("button", { name: "Preview conditions", exact: true })
          .click();
        await expect(page.getByText(/preparation ·/).first()).toBeVisible();
      }
    });
  }
  for (const role of ["sales", "designer", "staging_crew", "marketing"]) {
    test(`${role} sees only personal notifications and cannot open Automation Center`, async ({
      page,
    }, info) => {
      await login(page, role);
      await page.goto("/notifications");
      await expect(
        page.getByRole("heading", { name: "Notifications", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "My automated tasks" }),
      ).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`m7-${role}-notifications.png`),
        fullPage: true,
      });
      await page.goto("/automation");
      await expect(page).toHaveURL(/unauthorized/);
    });
  }
});

test.describe("M7 actionable work", () => {
  test.skip(
    process.env.GLARA_M7_ACCEPTANCE !== "yes" ||
      !process.env.GLARA_M7_BROWSER_FIXTURE,
    "Requires scoped development fixture",
  );
  test.setTimeout(180000);
  for (const role of ["sales", "designer", "staging_crew", "admin"]) {
    test(
      role + " can snooze, complete and navigate linked automated work",
      async ({ page }, info) => {
        const f = JSON.parse(
          readFileSync(process.env.GLARA_M7_BROWSER_FIXTURE!, "utf8"),
        ) as {
          project: Id<"projects">;
          customer: Id<"commercial_customers">;
          realtor: Id<"realtors">;
          marker: string;
        };
        const { client: c } = await operationsClient(),
          who = credentials(role),
          marker = f.marker + " browser " + randomUUID().slice(0, 8);
        let id: string, table: "activities" | "invoices", key: string;
        if (role === "admin") {
          id = await c.mutation(api.commercial.saveInvoice, {
            project_id: f.project,
            customer_id: f.customer,
            version: 0,
            input: JSON.stringify({
              issue_date: day(),
              due_date: day(),
              notes: marker,
              items: [
                {
                  description: marker,
                  quantity: 1,
                  unit_amount: "1",
                  discount: "0",
                  taxes: [],
                },
              ],
            }),
          });
          await c.mutation(api.commercial.invoiceAction, {
            id: id as Id<"invoices">,
            version: 1,
            action: "issue",
            reason: marker,
          });
          table = "invoices";
          key = "invoice_due";
        } else {
          table = "activities";
          key = role === "sales" ? "next_action" : "required_task";
          id =
            role === "sales"
              ? (
                  await c.mutation(api.crm.write, {
                    input: JSON.stringify({
                      op: "activity_create",
                      data: {
                        realtor_id: f.realtor,
                        type: "follow_up",
                        title: marker,
                        description: marker,
                        due_at: new Date(Date.now() - 86400000).toISOString(),
                        completed_at: "",
                        status: "open",
                        priority: "normal",
                        assigned_to: who.id,
                      },
                    }),
                  })
                ).id
              : await c.mutation(api.operations.saveTask, {
                  project_id: f.project,
                  version: 0,
                  title: marker,
                  description: marker,
                  due_at: new Date(Date.now() - 86400000).toISOString(),
                  assigned_to: who.id as Id<"users">,
                  status: "open",
                });
        }
        const rule = (await c.query(api.automation.rules, {})).find(
          (x) => x.key === key,
        )!.record!;
        let action: Id<"automation_actions"> | undefined;
        try {
          await c.mutation(api.automation.saveRule, {
            id: rule._id,
            version: rule.version,
            config: {
              ...rule.config,
              enabled: true,
              entity_ids: [id],
              delay_days: 0,
              daily_limit: 100,
              assignment: role === "admin" ? "admin" : "entity_owner",
              activation: "current",
            },
          });
          await c.mutation(api.automation.execute, { table, entity_id: id });
          const a = (
            await c.query(api.automation.preview, { table, entity_id: id })
          ).flatMap((x) => x.active)[0];
          action = a._id;
          await page.goto("/login");
          await page.getByLabel("Work email").fill(who.email);
          await page.getByLabel("Password", { exact: true }).fill(who.password);
          await page
            .getByRole("button", { name: "Sign in to Glara OS" })
            .click();
          await expect(page).toHaveURL(/dashboard/);
          await page.goto("/notifications");
          const card = page.locator('[data-action-id="' + a._id + '"]');
          await expect(
            page.getByRole("heading", { name: "My automated tasks" }),
          ).toBeVisible();
          for (let i = 0; i < 15 && (await card.count()) === 0; i++) {
            const more = page.getByRole("button", {
              name: "Load more",
              exact: true,
            });
            if (await more.count()) await more.last().click();
            await page.waitForTimeout(150);
          }
          await expect(card).toBeVisible();
          await card
            .locator("summary")
            .filter({ hasText: "Update action" })
            .click();
          await card
            .getByRole("combobox", { name: "Action", exact: true })
            .selectOption("snooze");
          await card.getByLabel("Reason", { exact: true }).fill(marker);
          await card
            .getByRole("button", { name: "Apply action", exact: true })
            .click();
          await expect(card.getByText(/Snoozed until/)).toBeVisible();
          await card
            .getByRole("combobox", { name: "Action", exact: true })
            .selectOption("complete");
          await card.getByLabel("Reason", { exact: true }).fill(marker);
          await card
            .getByRole("button", { name: "Apply action", exact: true })
            .click();
          await expect(
            card.getByText(/task complete, source still open/),
          ).toBeVisible();
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page.screenshot({
            path: info.outputPath("m7-action-" + role + ".png"),
            fullPage: true,
          });
          await card.getByRole("link").first().click();
          await expect(page).toHaveURL(
            new RegExp(a.href.replaceAll("/", "\\/")),
          );
        } finally {
          if (action) {
            const a = (
              await c.query(api.automation.preview, { table, entity_id: id })
            )
              .flatMap((x) => x.active)
              .find((x) => x._id === action);
            if (a)
              await c.mutation(api.automation.changeAction, {
                id: a._id,
                updated_at: a.updated_at,
                op: "resolve",
                reason: marker,
              });
          }
          const current = (await c.query(api.automation.rules, {})).find(
            (x) => x.record?._id === rule._id,
          )!.record!;
          await c.mutation(api.automation.saveRule, {
            id: rule._id,
            version: current.version,
            config: rule.config,
          });
          if (table === "invoices") {
            const inv = await c.query(api.commercial.invoice, {
              id: id as Id<"invoices">,
            });
            await c.mutation(api.commercial.invoiceAction, {
              id: inv._id,
              version: inv.version,
              action: "void",
              reason: marker,
            });
          }
        }
      },
    );
  }
});
