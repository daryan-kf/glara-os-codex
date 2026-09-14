import { test, expect } from "@playwright/test";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { operationsClient, wonFixture } from "../support/operations-fixture";
import { credentials } from "../support/identities";
test.describe("M3 operational workflows", () => {
  test.skip(
    process.env.GLARA_CONVEX_ACCEPTANCE !== "yes",
    "Requires fictional hosted identity opt-in",
  );
  test.setTimeout(180000);
  test.use({ actionTimeout: 15000 });
  test("won handoff, room plan, checklist, scheduling, crew and mobile privacy", async ({
    page,
  }, info) => {
    const { client } = await operationsClient(),
      f = await wonFixture(client),
      owner = credentials(),
      crew = credentials("staging_crew");
    let project: Id<"projects"> | undefined;
    const signIn = async (role: string) => {
      const who = credentials(role);
      await page.goto("/login");
      await page.getByLabel("Work email").fill(who.email);
      await page.getByLabel("Password", { exact: true }).fill(who.password);
      await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
      await expect(page).toHaveURL(/dashboard$/);
    };
    try {
      await signIn("owner");
      await page.goto(`/opportunities/${f.opportunity}`);
      await page
        .getByRole("link", { name: "Create staging project →", exact: true })
        .click();
      await expect(
        page.getByRole("heading", {
          name: "Create staging project",
          exact: true,
        }),
      ).toBeVisible();
      await expect(page.getByText(new RegExp(f.address))).toBeVisible();
      await page
        .getByRole("combobox", { name: "Project manager", exact: true })
        .selectOption(owner.id);
      await page
        .getByRole("combobox", { name: "Designer", exact: true })
        .selectOption(credentials("designer").id);
      await page
        .getByRole("combobox", { name: "Staging lead", exact: true })
        .selectOption(crew.id);
      await page
        .getByLabel("Package end date", { exact: true })
        .fill("2099-12-31");
      await page
        .getByRole("textbox", {
          name: "Rooms — one name per line",
          exact: true,
        })
        .fill("Living room");
      await page
        .getByRole("button", { name: "Create project", exact: true })
        .click();
      await expect(page).toHaveURL(/\/projects\/[a-z0-9]+$/);
      project = page.url().split("/").at(-1) as Id<"projects">;
      await expect(
        page.getByRole("heading", { name: /GLS-\d{4}-\d{4}/ }),
      ).toBeVisible();
      await page
        .locator("#rooms")
        .getByText("Edit or reorder room", { exact: true })
        .click();
      await page
        .getByRole("combobox", { name: "Room status", exact: true })
        .selectOption("design_ready");
      await page
        .getByRole("button", { name: "Save room", exact: true })
        .click();
      await expect(
        page.locator("#rooms span").filter({ hasText: /^design ready$/ }),
      ).toBeVisible();
      await page
        .getByRole("button", { name: "Mark designing", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await client.query(api.operations.get, { id: project! })).status,
        )
        .toBe("designing");
      const row = await client.query(api.operations.get, { id: project });
      for (const item of row.checklist.filter(
        (i) => i.category === "pre_staging" && i.required,
      ))
        await client.mutation(api.operations.checklist, {
          id: item._id,
          version: item.version,
          status: "completed",
        });
      await page.reload();
      await page
        .getByRole("button", { name: "Mark ready to schedule", exact: true })
        .click();
      await expect(
        page.getByText("ready to schedule", { exact: true }),
      ).toBeVisible();
      await page.reload();
      const schedule = page.locator("#schedule");
      await expect(
        schedule.getByRole("heading", { name: "Schedule", exact: true }),
      ).toBeVisible();
      if (
        !(await schedule
          .getByLabel("Start — Vancouver time", { exact: true })
          .isVisible())
      )
        await schedule
          .getByText("Schedule an operation", { exact: true })
          .click();
      const date = `2098-${String(1 + (parseInt(f.suffix.slice(0, 2), 16) % 12)).padStart(2, "0")}-${String(1 + (parseInt(f.suffix.slice(2, 4), 16) % 28)).padStart(2, "0")}`;
      await schedule
        .getByLabel("Start — Vancouver time", { exact: true })
        .fill(date + "T09:00");
      await schedule
        .getByLabel("End — Vancouver time", { exact: true })
        .fill(date + "T11:00");
      await schedule
        .getByRole("button", { name: "Schedule operation", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (await client.query(api.operations.get, { id: project! })).status,
        )
        .toBe("scheduled");
      await page.reload();
      await expect(
        page.getByRole("heading", { name: /GLS-\d{4}-\d{4}/ }),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath("project-overview.png") });
      const reschedule = page.locator("#schedule article").first();
      await reschedule.getByText("Reschedule event", { exact: true }).click();
      for (const [index, title] of [
        "Crew staging window",
        "Confirmed crew staging window",
      ].entries()) {
        await reschedule.getByLabel("Event title", { exact: true }).fill(title);
        await reschedule
          .getByRole("button", { name: "Save schedule", exact: true })
          .click();
        await expect
          .poll(
            async () =>
              (await client.query(api.operations.get, { id: project! }))
                .events[0].version,
          )
          .toBe(index + 2);
      }
      await client.mutation(api.operations.saveAccess, {
        id: project,
        version: 0,
        input: JSON.stringify({
          access_type: "concierge",
          instructions: "Fictional concierge desk",
          sensitive_access_code: "FICTIONAL-CODE",
        }),
      });
      const before = await client.query(api.operations.get, { id: project });
      await client.mutation(api.operations.addNote, {
        id: project,
        body: "PRIVATE MANAGER ONLY",
        note_type: "general",
        visibility: "internal",
      });
      await page.context().clearCookies();
      await signIn("staging_crew");
      await page.goto(`/projects/${project}`);
      await expect(
        page.getByText("Fictional concierge desk", { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText("PRIVATE MANAGER ONLY", { exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "Source quote →" }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Save team", exact: true }),
      ).toHaveCount(0);
      const check = page
        .locator("#checklist article")
        .filter({ hasText: "Final walkthrough complete" });
      if (!(await check.isVisible()))
        await page
          .locator("#checklist summary")
          .filter({ hasText: /^staging$/ })
          .click();
      await check
        .getByRole("button", { name: "Complete", exact: true })
        .click();
      await expect
        .poll(
          async () =>
            (
              await client.query(api.operations.get, { id: project! })
            ).checklist.find(
              (i) => i.gate_key === "staging_walkthrough_complete",
            )?.status,
        )
        .toBe("completed");
      await page.locator("#checklist").scrollIntoViewIfNeeded();
      await page.screenshot({ path: info.outputPath("crew-checklist.png") });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.goto("/calendar");
      await page.getByLabel("Starting date", { exact: true }).fill(date);
      await expect(
        page.getByRole("heading", { name: f.address, exact: true }),
      ).toBeVisible();
      await page.screenshot({ path: info.outputPath("crew-agenda.png") });
      await page
        .getByRole("button", { name: "Search workspace", exact: true })
        .click();
      await page.locator("#global-search").fill(f.suffix);
      await page.locator('a[href="/projects/' + project + '"]').click();
      await expect(
        page.getByRole("heading", { name: before.project_number, exact: true }),
      ).toBeVisible();
      await page.goto("/quotes");
      await expect(page).toHaveURL(/unauthorized/);
      expect(
        (await client.query(api.operations.get, { id: project })).source
          ?.source_quote_id,
      ).toBe(before.source?.source_quote_id);
    } finally {
      if (project) {
        const p = await client.query(api.operations.get, { id: project });
        if (!["completed", "cancelled"].includes(p.status))
          await client.mutation(api.operations.transition, {
            id: project,
            version: p.version,
            status: "cancelled",
            reason: "Fictional browser acceptance cleanup",
          });
        const fresh = await client.query(api.operations.get, { id: project });
        await client.mutation(api.operations.archive, {
          id: project,
          version: fresh.version,
          restore: false,
        });
      }
    }
  });
});
