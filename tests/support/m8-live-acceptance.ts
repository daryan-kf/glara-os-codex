import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { api } from "../../convex/_generated/api";
import { operationsClient } from "./operations-fixture";
import { credentials } from "./identities";
import { scopeSchema } from "../../src/lib/ai/model";

async function main() {
  assert.equal(process.env.GLARA_M8_ACCEPTANCE, "yes");
  mkdirSync(".acceptance/m8", { recursive: true });
  const { client: owner } = await operationsClient();
  const initial = await owner.query(api.ai.settings, {});
  assert.equal(initial.enabled, false);
  assert.equal(initial.model, "gpt-5.4-mini");
  assert.equal(initial.secret_configured, true);
  assert.equal(initial.security_approved, true);
  const result: Record<string, unknown> = {
    deployment: "woozy-jaguar-392",
    provider: "openai",
    model: initial.model,
    status: "started",
  };
  const fixture = await owner.mutation(api.crm.write, {
    input: JSON.stringify({
      op: "realtor_create",
      data: {
        first_name: "Fictional M8",
        last_name: randomUUID().slice(0, 8),
        relationship_status: "active_partner",
        assigned_to: credentials("sales").id,
      },
    }),
  });
  result.fixture_id = fixture.id;
  const settings = {
    ...initial.config!,
    enabled: true,
    enabled_roles: ["owner"],
    allowed_user_ids: [credentials("owner").id],
    features: ["realtor"],
    proposals: false,
    retention_acknowledged: true,
    input_micros_per_million: 750000,
    output_micros_per_million: 4500000,
    daily_budget_micros: 5000000,
    monthly_budget_micros: 10000000,
    daily_requests: 100,
    per_minute: 10,
  };
  await owner.mutation(api.ai.saveSettings, {
    version: initial.version,
    input: JSON.stringify(settings),
  });
  try {
    const before = await owner.query(api.ai.health, {});
    const started = Date.now();
    const id = await owner.mutation(api.ai.request, {
      input: JSON.stringify({
        request_key: randomUUID(),
        question:
          "What is the recorded relationship status of this Realtor? Do not infer other facts.",
        scope: scopeSchema.parse({ feature: "realtor", entity_id: fixture.id }),
      }),
    });
    result.request_id = id;
    await owner.action(api.aiProvider.generate, { id });
    const view = await owner.query(api.ai.result, { id });
    result.elapsed_ms = Date.now() - started;
    result.status = view.status;
    result.error = view.error;
    result.output = view.output;
    result.evidence = view.evidence.map((e) => ({
      key: e.key,
      kind: e.kind,
      entity_type: e.entity_type,
    }));
    const after = await owner.query(api.ai.health, {});
    result.usage = {
      input_tokens:
        (after.day?.input_tokens ?? 0) - (before.day?.input_tokens ?? 0),
      output_tokens:
        (after.day?.output_tokens ?? 0) - (before.day?.output_tokens ?? 0),
      charged_micros:
        (after.day?.charged_micros ?? 0) - (before.day?.charged_micros ?? 0),
    };
    assert.equal(view.status, "completed");
    assert.match(view.output!.answer, /active/i);
    assert.equal(view.proposal, null);
    assert.ok(view.evidence.length);
    assert.ok((result.usage as { input_tokens: number }).input_tokens > 0);
  } finally {
    const current = await owner.query(api.ai.settings, {});
    await owner.mutation(api.ai.saveSettings, {
      version: current.version,
      input: JSON.stringify({
        ...initial.config!,
        enabled: false,
        proposals: false,
      }),
    });
    writeFileSync(
      ".acceptance/m8/live-" + Date.now() + ".json",
      JSON.stringify(result, null, 2),
    );
    console.log(
      JSON.stringify({
        status: result.status,
        error: result.error,
        elapsed_ms: result.elapsed_ms,
        usage: result.usage,
        final_ai_enabled: false,
      }),
    );
  }
}
main().catch(() => {
  console.error("M8 first live acceptance failed; sanitized evidence saved.");
  process.exitCode = 1;
});
