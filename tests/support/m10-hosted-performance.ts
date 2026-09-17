import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { operationsClient } from "./operations-fixture";
import { makeFunctionReference } from "convex/server";
import type { Value } from "convex/values";
async function main() {
  assert.equal(process.env.GLARA_M10_ACCEPTANCE, "yes");
  const { client } = await operationsClient();
  const paginationOpts = { cursor: null, numItems: 20 };
  const cases: [string, Record<string, Value>][] = [
    ["crm:read", { input: JSON.stringify({ op: "list" }) }],
    ["sales:listOpportunities", { paginationOpts }],
    ["operations:list", { paginationOpts }],
    [
      "inventory:list",
      {
        paginationOpts,
        search: "",
        available_only: false,
        staging_only: false,
        archived: false,
      },
    ],
    ["commercial:dashboard", {}],
    ["automation:actions", { paginationOpts, status: "active" }],
    ["communications:list", { paginationOpts }],
    ["operationalHealth:health", {}],
  ];
  const results = [];
  for (const [name, args] of cases) {
    const elapsed: number[] = [];
    let bytes = 0;
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      const response = await client.query(
        makeFunctionReference<"query">(name),
        args,
      );
      elapsed.push(Math.round(performance.now() - start));
      bytes = Math.max(bytes, Buffer.byteLength(JSON.stringify(response)));
    }
    elapsed.sort((a, b) => a - b);
    results.push({
      query: name,
      samples: 5,
      p50_ms: elapsed[2],
      p95_ms: elapsed[4],
      max_payload_bytes: bytes,
      passed: elapsed[4] < 5000 && bytes < 1000000,
    });
  }
  const result = {
    executed_at: new Date().toISOString(),
    deployment: "woozy-jaguar-392",
    environment: "development",
    threshold:
      "5s end-to-end p95; max 1MB response; five sequential samples per query",
    limitation:
      "Operator-to-development-network smoke benchmark, not production capacity guarantee",
    provider_calls: 0,
    source_mutations: 0,
    results,
  };
  writeFileSync(
    ".acceptance/m10/hosted-performance.json",
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result));
  assert(results.every((x) => x.passed));
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message.slice(0, 300) : "Unknown failure",
  );
  console.error("Performance acceptance failed; inspect restricted result");
  process.exitCode = 1;
});
