import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { api } from "../../convex/_generated/api";
import { operationsClient } from "./operations-fixture";
import { credentials } from "./identities";
import { OpenAIProvider } from "../../convex/aiProvider";
import {
  defaults,
  scopeSchema,
  displayValues,
  type Context,
} from "../../src/lib/ai/model";
import { exactWeighted } from "../../src/lib/analytics/model";

async function main() {
  assert.equal(process.env.GLARA_M8_ACCEPTANCE, "yes");
  const { client: c } = await operationsClient();
  if (process.env.GLARA_M8_PIPELINE_RESUME === "yes") {
    const saved = JSON.parse(
      readFileSync(
        ".acceptance/m8/final-three/pipeline-provenance.json",
        "utf8",
      ),
    ) as PipelineEvidence;
    const summary = await c.query(api.analytics.summary, {
      period: JSON.stringify({ period: "this_month" }),
      filter: JSON.stringify({ dimension: "realtor", member: saved.realtor }),
    });
    assert.equal(
      summary.current.pipeline_cents,
      saved.authoritative.pipeline_cents,
    );
    assert.equal(
      summary.current.weighted_pipeline_cents,
      saved.authoritative.weighted_pipeline_cents,
    );
    for (const id of saved.opportunity_ids) {
      const view = await c.query(api.sales.getOpportunity, {
        id: id as import("../../convex/_generated/dataModel").Id<"opportunities">,
      });
      assert.ok(view?.opportunity.notes === saved.marker);
    }
    return evaluate(saved);
  }
  const marker = "Fictional M8 pipeline " + randomUUID().slice(0, 8);
  const realtor = (
    await c.mutation(api.crm.write, {
      input: JSON.stringify({
        op: "realtor_create",
        data: {
          first_name: marker,
          last_name: "Acceptance",
          relationship_status: "active_partner",
          assigned_to: credentials("sales").id,
        },
      }),
    })
  ).id;
  const filter = JSON.stringify({ dimension: "realtor", member: realtor });
  const read = () =>
    c.query(api.analytics.summary, {
      period: JSON.stringify({ period: "this_month" }),
      filter,
    });
  const empty = await read();
  assert.equal(empty.current.pipeline_cents ?? "0", "0");
  assert.equal(empty.current.weighted_pipeline_cents ?? "0", "0");
  const fixture = [
    { amount: "12345.67", cents: "1234567", probability: 37 },
    { amount: "8901.23", cents: "890123", probability: 63 },
  ];
  const ids: string[] = [];
  for (const [i, row] of fixture.entries()) {
    const property = await c.mutation(api.sales.saveProperty, {
      version: 0,
      input: JSON.stringify({
        address_line_1: marker + " " + i,
        city: "Vancouver",
        province: "BC",
        property_type: "detached",
        occupancy_status: "vacant",
        realtor_id: realtor,
      }),
    });
    const id = await c.mutation(api.sales.saveOpportunity, {
      version: 0,
      input: JSON.stringify({
        property_id: property,
        assigned_to: credentials("sales").id,
        estimated_value: row.amount,
        probability: row.probability,
        next_action_title: marker,
        next_action_date: "2099-01-01T18:00:00Z",
        notes: marker,
      }),
    });
    const actual = await c.query(api.sales.getOpportunity, { id });
    assert.ok(actual);
    assert.equal(actual.opportunity.estimated_value_cents, row.cents);
    assert.equal(actual.opportunity.probability, row.probability);
    assert.equal(actual.opportunity.stage, "new");
    assert.equal(actual.opportunity.deleted_at, null);
    ids.push(id);
    assert.equal(
      (
        await c.query(api.analytics.compareSource, {
          table: "opportunities",
          id,
        })
      ).drift.length,
      0,
    );
  }
  const authoritative = await read();
  assert.equal(authoritative.current.open_opportunities, "2");
  const current = {
    pipeline_cents: String(fixture.reduce((n, r) => n + BigInt(r.cents), 0n)),
    weighted_pipeline_cents: String(
      fixture.reduce(
        (n, r) => n + BigInt(exactWeighted(r.cents, r.probability)),
        0n,
      ),
    ),
  };
  assert.equal(authoritative.current.pipeline_cents, current.pipeline_cents);
  assert.equal(
    authoritative.current.weighted_pipeline_cents,
    current.weighted_pipeline_cents,
  );
  // Only whitelisted metrics from newly created exact-ID fixtures reach the provider.
  const data = { current, display_values: displayValues({ current }) };
  const context: Context = {
    scope: scopeSchema.parse({ feature: "executive" }),
    role_stamp: "fictional-acceptance-owner",
    retrieved_at: new Date().toISOString(),
    revision: String(authoritative.revision),
    can_propose: false,
    assignee_id: "",
    existing_task_ids: [],
    limitations: [
      "Isolated fictional acceptance scope only. Not company-wide financial reporting.",
    ],
    evidence: [
      {
        key: "e1",
        entity_type: "analytics",
        entity_id: "current",
        label: "Fictional current pipeline",
        module: "reports",
        route: "/reports",
        kind: "derived_metric",
        version: String(authoritative.revision),
        data: JSON.stringify(data),
      },
    ],
  };
  const dir = ".acceptance/m8/final-three";
  mkdirSync(dir, { recursive: true });
  const evidence = {
    timestamp: new Date().toISOString(),
    marker,
    realtor,
    opportunity_ids: ids,
    fixture,
    authoritative: current,
    revision: authoritative.revision,
    provider_payload: context,
  };
  writeFileSync(
    dir + "/pipeline-provenance.json",
    JSON.stringify(evidence, null, 2),
  );
  await evaluate(evidence);
}
type PipelineEvidence = {
  timestamp: string;
  marker: string;
  realtor: string;
  opportunity_ids: string[];
  fixture: unknown[];
  authoritative: { pipeline_cents: string; weighted_pipeline_cents: string };
  revision: number;
  provider_payload: Context;
};
async function evaluate(evidence: PipelineEvidence) {
  evidence.provider_payload.evidence.forEach((entry, index) => {
    entry.key = `e${index + 1}`;
  });
  const context = evidence.provider_payload,
    current = evidence.authoritative,
    dir = ".acceptance/m8/final-three";
  const originalFetch = globalThis.fetch;
  const attempt = Date.now();
  let calls = 0;
  globalThis.fetch = async (...args: Parameters<typeof fetch>) => {
    const response = await originalFetch(...args);
    if (String(args[0]) === "https://api.openai.com/v1/responses") {
      const body = await response.clone().json();
      writeFileSync(
        dir + "/pipeline-response-" + attempt + "-" + ++calls + ".json",
        JSON.stringify(body, null, 2),
      );
    }
    return response;
  };
  // The development key stays in memory and is never printed or persisted.
  if (!process.env.OPENAI_API_KEY)
    process.env.OPENAI_API_KEY = execFileSync(
      process.execPath,
      [
        "node_modules/convex/bin/main.js",
        "env",
        "get",
        "OPENAI_API_KEY",
        "--env-file",
        ".env.local",
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    ).trim();
  assert.ok(process.env.OPENAI_API_KEY);
  const started = Date.now();
  const response = await new OpenAIProvider().generateStructuredInsight({
    context,
    question:
      "Report only raw Pipeline and Weighted Pipeline in CAD for the isolated fictional scope, using the exact supplied display values. Identify each amount by metric name.",
    model: "gpt-5.4-mini",
    config: { ...defaults, proposals: false, timeout_ms: 45000 },
    history: [],
  });
  writeFileSync(
    dir + "/pipeline-live.json",
    JSON.stringify(
      { ...evidence, response, latency_ms: Date.now() - started },
      null,
      2,
    ),
  );
  assert.equal(response.insight.evidence_state, "strong");
  assert.equal(response.insight.proposal, null);
  const answer = response.insight.answer.replaceAll(",", "");
  for (const v of Object.values(displayValues(current)))
    assert.ok(answer.includes(v.replace("CAD ", "")));
  assert.match(answer, /weighted pipeline/i);

  console.log(
    JSON.stringify({
      result: "EXACT MATCH",
      ...current,
      input_tokens: response.input_tokens,
      output_tokens: response.output_tokens,
      answer: response.insight.answer,
    }),
  );
}
main().catch((e) => {
  console.error(
    e instanceof Error
      ? { message: e.message, cause: e.cause }
      : "Pipeline acceptance failed",
  );
  process.exitCode = 1;
});
