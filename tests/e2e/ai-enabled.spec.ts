import { test, expect, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync } from "node:fs";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import { api } from "../../convex/_generated/api";
import { operationsClient } from "../support/operations-fixture";
import { credentials } from "../support/identities";
import { scopeSchema, features, type Config } from "../../src/lib/ai/model";
import { day } from "../../src/lib/operations/model";
const fixture = () =>
  JSON.parse(readFileSync(".acceptance/m8/resume/fixture.json", "utf8")) as {
    project: Id<"projects">;
    realtor: Id<"realtors">;
    invoice: Id<"invoices">;
    product: Id<"products">;
    location: Id<"inventory_locations">;
  };
const ownerClient = async () => (await operationsClient()).client;
let original: Config;
const deadlines = new Map<string, string>();
async function login(page: Page, role = "owner") {
  const c = credentials(role);
  await page.goto("/login");
  await page.getByLabel("Work email").fill(c.email);
  await page.getByLabel("Password", { exact: true }).fill(c.password);
  await page.getByRole("button", { name: "Sign in to Glara OS" }).click();
  await expect(page).toHaveURL(/dashboard/);
}
async function ask(page: Page, q: string) {
  await page.getByLabel("Your question").fill(q);
  await page.getByRole("button", { name: "Ask Glara", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Answer", exact: true }),
  ).toBeVisible({ timeout: 65000 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
}
async function newRealtor() {
  const dueAt = new Date(Date.now() + 86400000).toISOString();
  const c = await ownerClient();
  const id = (
    await c.mutation(api.crm.write, {
      input: JSON.stringify({
        op: "realtor_create",
        data: {
          first_name: "Fictional M8 browser",
          last_name: randomUUID().slice(0, 8),
          relationship_status: "active_partner",
          assigned_to: credentials("sales").id,
        },
      }),
    })
  ).id;
  await c.mutation(api.crm.write, {
    input: JSON.stringify({
      op: "activity_create",
      data: {
        realtor_id: id,
        type: "note",
        title: "Fictional client requested a follow-up about staging services",
        description: "Fictional acceptance context",
        status: "completed",
        completed_at: new Date().toISOString(),
        due_at: dueAt,
        priority: "normal",
        assigned_to: credentials("sales").id,
      },
    }),
  });
  deadlines.set(id, dueAt);
  return id;
}
async function saveSettings(patch: Partial<Config>) {
  const c = await ownerClient();
  const s = await c.query(api.ai.settings, {});
  await c.mutation(api.ai.saveSettings, {
    version: s.version,
    input: JSON.stringify({ ...s.config!, ...patch }),
  });
}
test.describe("M8 enabled acceptance", () => {
  test.skip(
    process.env.GLARA_M8_ACCEPTANCE !== "yes",
    "Explicit fictional development acceptance required",
  );
  test.beforeAll(async () => {
    const c = await ownerClient();
    const s = await c.query(api.ai.settings, {});
    expect(s.enabled).toBe(false);
    original = s.config!;
    await saveSettings({
      ...original,
      enabled: true,
      features: [...features],
      enabled_roles: [
        "owner",
        "admin",
        "sales",
        "designer",
        "staging_crew",
        "marketing",
      ],
      allowed_user_ids: [
        "owner",
        "admin",
        "sales",
        "designer",
        "staging_crew",
        "marketing",
      ].map((r) => credentials(r).id),
      proposals: true,
      retention_acknowledged: true,
      per_minute: 10,
      daily_requests: 200,
      daily_budget_micros: 5000000,
      monthly_budget_micros: 10000000,
      input_micros_per_million: 750000,
      output_micros_per_million: 4500000,
    });
  });
  test.afterAll(async () => {
    if (original)
      await saveSettings({ ...original, enabled: false, proposals: false });
  });
  test.afterEach(async ({ page }, info) => {
    mkdirSync(".acceptance/m8/resume/browser", { recursive: true });
    await page.screenshot({
      path:
        ".acceptance/m8/resume/browser/" +
        info.project.name +
        "-" +
        info.title.replace(/[^a-z0-9]/gi, "_") +
        ".png",
      fullPage: true,
    });
  });
  test("Owner live experiences, evidence, settings and health", async ({
    page,
  }) => {
    test.setTimeout(240000);
    await login(page);
    const f = fixture();
    for (const [feature, entity, q] of [
      [
        "executive",
        "",
        "Report projects staged this month from the supplied metric.",
      ],
      ["realtor", f.realtor, "State the recorded relationship status."],
      ["project", f.project, "What is the recorded readiness and status?"],
      [
        "inventory",
        f.product,
        "What is the authoritative available quantity for this selected window?",
      ],
      ["commercial", f.invoice, "State the exact invoice balance in CAD."],
    ] as const) {
      await page.goto("/copilot?feature=" + feature + "&entity=" + entity);
      if (feature === "inventory") {
        await page.getByLabel("From", { exact: true }).fill(day());
        await page.getByLabel("Until", { exact: true }).fill(day());
        await page.getByLabel("Inventory location").selectOption(f.location);
      }
      await ask(page, q);
      await expect(
        page.getByRole("heading", { name: "Evidence", exact: true }),
      ).toBeVisible();
      const proof = page
        .locator("a")
        .filter({ hasText: /recorded fact|derived metric/ })
        .first();
      await expect(proof).toBeVisible();
      const href = await proof.getAttribute("href");
      expect(href).toMatch(
        /^\/(dashboard|realtors|projects|inventory|invoices)/,
      );
      await proof.click();
      await expect(page).not.toHaveURL(/login/);
      await expect(
        page.getByText("Something didn’t load.", { exact: true }),
      ).toHaveCount(0);
    }
    await page.goto("/copilot");
    await page.locator("summary").filter({ hasText: "AI settings" }).click();
    await expect(
      page.getByText("OpenAI · gpt-5.4-mini", { exact: false }),
    ).toBeVisible();
    await page.locator("summary").filter({ hasText: "AI health" }).click();
    await expect(
      page.getByText("Provider configuration: Ready", { exact: true }),
    ).toBeVisible();
  });
  test("Sales live brief, editable draft and conversation history", async ({
    page,
  }) => {
    test.setTimeout(90000);
    await login(page, "sales");
    await page.goto("/copilot?feature=realtor&entity=" + fixture().realtor);
    await ask(
      page,
      "Draft a concise internal relationship note using only recorded status. Do not send or propose a task.",
    );
    await expect(
      page.getByRole("heading", { name: "DRAFT — NOT SENT" }),
    ).toBeVisible();
    await page
      .getByLabel("Editable AI draft")
      .fill("Fictional reviewed internal note, not sent.");
    await expect(page.getByLabel("Editable AI draft")).toHaveValue(
      "Fictional reviewed internal note, not sent.",
    );
    await page
      .getByRole("button", { name: "Continue this conversation", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: /completed/ }).first(),
    ).toBeVisible();
    expect(
      await page.getByLabel("Experience").locator("option").allTextContents(),
    ).not.toContain("Executive Analyst");
  });
  test("Crew assigned project brief and financial denial", async ({ page }) => {
    test.setTimeout(90000);
    await login(page, "staging_crew");
    await page.goto("/copilot?feature=project&entity=" + fixture().project);
    await ask(
      page,
      "Summarize recorded project status and checklist readiness.",
    );
    expect(
      await page.getByLabel("Experience").locator("option").allTextContents(),
    ).not.toContain("Commercial Copilot");
    await expect(
      page.getByRole("button", { name: "Approve task", exact: true }),
    ).toHaveCount(0);
  });
  test("Real proposal edits, explicit approval and visible receipt", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const id = await newRealtor();
    await login(page);
    await page.goto("/copilot?feature=realtor&entity=" + id);
    await ask(
      page,
      "Propose a safe internal follow-up Activity about staging services. I request due_at " +
        deadlines.get(id)! +
        ". Use create_activity with the primary Realtor evidence key and normal priority. These task details are my requested future intent. Do not perform the action.",
    );
    await expect(
      page.getByRole("heading", { name: "Proposed follow-up · proposed" }),
    ).toBeVisible();
    await expect(
      page.getByText("No task is created until you approve.", { exact: false }),
    ).toBeVisible();
    await page
      .getByLabel("Task title", { exact: true })
      .fill("Fictional browser human approved follow-up");
    await page
      .getByRole("button", { name: "Approve task", exact: true })
      .click();
    await expect(
      page.getByText("Task created through the existing Glara OS workflow.", {
        exact: true,
      }),
    ).toBeVisible({ timeout: 15000 });
  });
  test("Real proposal rejection and stale source refusal", async ({ page }) => {
    test.setTimeout(150000);
    for (const scenario of ["reject", "stale"]) {
      const id = await newRealtor();
      if (scenario === "reject") await login(page);
      await page.goto("/copilot?feature=realtor&entity=" + id);
      await ask(
        page,
        "Propose a safe internal follow-up Activity about staging services. I request due_at " +
          deadlines.get(id)! +
          ". Use create_activity with the primary Realtor evidence key and normal priority. These task details are my requested future intent. Do not perform the action.",
      );
      await expect(
        page.getByRole("button", { name: "Approve task", exact: true }),
      ).toBeVisible();
      if (scenario === "reject") {
        await page.getByRole("button", { name: "Reject", exact: true }).click();
        await expect(
          page.getByRole("heading", { name: "Proposed follow-up · rejected" }),
        ).toBeVisible();
      } else {
        const c = await ownerClient();
        await c.mutation(api.crm.write, {
          input: JSON.stringify({
            op: "activity_create",
            data: {
              realtor_id: id,
              type: "follow_up",
              title: "Fictional native competing action",
              description: "",
              status: "open",
              completed_at: "",
              due_at: new Date(Date.now() + 86400000).toISOString(),
              priority: "normal",
              assigned_to: credentials("owner").id,
            },
          }),
        });
        await expect(
          page.getByText(
            "The evidence changed. Ask again for a fresh answer.",
            { exact: true },
          ),
        ).toBeVisible();
        await expect(
          page.getByRole("button", { name: "Approve task", exact: true }),
        ).toHaveCount(0);
      }
    }
  });
  test("Controlled timeout, budget error and core availability", async ({
    page,
  }) => {
    test.setTimeout(90000);
    const c = await ownerClient(),
      f = fixture();
    const r = await c.mutation(api.ai.request, {
      input: JSON.stringify({
        request_key: randomUUID(),
        question: "Fictional M8 controlled expired request",
        scope: scopeSchema.parse({ feature: "realtor", entity_id: f.realtor }),
      }),
    });
    const t = await c.query(api.ai.result, { id: r });
    await c.mutation(
      makeFunctionReference<"mutation", { id: Id<"ai_requests"> }, null>(
        "m8AcceptanceControl:expireRequest",
      ),
      { id: r },
    );
    await c.mutation(api.ai.renameThread, {
      id: t.conversation_id,
      title: "Fictional controlled timeout " + r,
    });
    await login(page);
    await page.goto("/copilot");
    await page
      .getByRole("button", {
        name: "Fictional controlled timeout " + r,
        exact: true,
      })
      .click();
    await page
      .getByRole("button", { name: /failed/ })
      .first()
      .click();
    await expect(
      page.getByText("AI took too long. You can retry this request.", {
        exact: true,
      }),
    ).toBeVisible();
    await saveSettings({ daily_budget_micros: 1 });
    try {
      await page.goto("/copilot?feature=realtor&entity=" + f.realtor);
      await page
        .getByLabel("Your question")
        .fill("What is the recorded relationship status?");
      await page
        .getByRole("button", { name: "Ask Glara", exact: true })
        .click();
      await expect(
        page.getByText("The AI budget limit has been reached.", {
          exact: true,
        }),
      ).toBeVisible();
      await page.goto("/projects");
      await expect(page).toHaveURL(/projects/);
    } finally {
      await saveSettings({ daily_budget_micros: 5000000 });
    }
  });
});
