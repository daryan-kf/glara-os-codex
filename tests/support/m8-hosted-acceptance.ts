import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { api } from "../../convex/_generated/api";
import { operationsClient } from "./operations-fixture";
import { scopeSchema } from "../../src/lib/ai/model";
if (process.env.GLARA_M8_ACCEPTANCE !== "yes")
  throw Error("M8 development acceptance authorization required");
const checks: { name: string; passed: boolean }[] = [];
function check(name: string, value: unknown) {
  if (!value) throw Error(name);
  checks.push({ name, passed: true });
}
async function denied(name: string, work: () => Promise<unknown>) {
  let rejected = false;
  try {
    await work();
  } catch {
    rejected = true;
  }
  check(name, rejected);
}
async function main() {
  const owner = (await operationsClient()).client;
  mkdirSync(".acceptance/m8", { recursive: true });
  const startingHealth = await owner.query(api.ai.health, {});
  const settings = await owner.query(api.ai.settings, {});
  check("AI remains disabled", !settings.enabled);
  check(
    "Server deployment reports M8",
    (await owner.query(api.profiles.viewer, {}))?.ai_version === 1,
  );
  for (const role of [
    "owner",
    "admin",
    "sales",
    "designer",
    "staging_crew",
    "marketing",
  ]) {
    const client = (await operationsClient(role)).client;
    const input = JSON.stringify({
      request_key: randomUUID(),
      question: "Where can I find my modules?",
      scope: scopeSchema.parse({ feature: "navigation" }),
    });
    const id = await client.mutation(api.ai.request, { input });
    check(
      role + " request deduplicates",
      id === (await client.mutation(api.ai.request, { input })),
    );
    await client.action(api.aiProvider.generate, { id });
    const result = await client.query(api.ai.result, { id });
    check(
      role + " deterministic navigation",
      result.status === "completed" && result.output?.answer.includes("module"),
    );
    check(role + " no proposal", result.proposal === null);
    await client.mutation(api.ai.feedback, {
      id,
      kind: "helpful",
      reason: "Fictional M8 development acceptance",
    });
    check(
      role + " conversation accessible",
      (
        await client.query(api.ai.conversation, { id: result.conversation_id })
      ).some((x) => x.id === id),
    );
    if (role !== "owner")
      await denied(role + " cannot read another user's result", () =>
        owner.query(api.ai.result, { id }),
      );
    await denied(role + " provider feature disabled", () =>
      client.mutation(api.ai.request, {
        input: JSON.stringify({
          request_key: randomUUID(),
          question: "Explain executive performance",
          scope: scopeSchema.parse({ feature: "executive" }),
        }),
      }),
    );
    if (!["owner", "admin"].includes(role))
      await denied(role + " AI health denied", () =>
        client.query(api.ai.health, {}),
      );
    if (role === "admin")
      check(
        "Admin costs hidden",
        (await client.query(api.ai.health, {})).day === null,
      );
    await client.mutation(api.ai.archive, { id: result.conversation_id });
    await denied(role + " archived conversation unavailable", () =>
      client.query(api.ai.conversation, { id: result.conversation_id }),
    );
  }
  const health = await owner.query(api.ai.health, {});
  check(
    "Deterministic navigation has no provider charge",
    (health.day?.charged_micros ?? 0) ===
      (startingHealth.day?.charged_micros ?? 0),
  );
  writeFileSync(
    ".acceptance/m8/hosted-disabled.json",
    JSON.stringify(
      {
        deployment: "woozy-jaguar-392",
        provider: "disabled",
        live_provider: "PENDING EXTERNAL ACTION",
        checks,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      passed: checks.length,
      failed: 0,
      live_provider: "PENDING EXTERNAL ACTION",
    }),
  );
}
main().catch(() => {
  console.error("M8 disabled-provider acceptance failed");
  process.exitCode = 1;
});
