import type { FunctionReturnType } from "convex/server";
import { writeFileSync } from "node:fs";
import { api } from "../../convex/_generated/api";
import { operationsClient } from "./operations-fixture";
async function main() {
  if (process.env.GLARA_M10_ACCEPTANCE !== "yes")
    throw Error("Explicit development acceptance required");
  const { client } = await operationsClient();
  const result: Record<
    string,
    { pages: number; entries: number; issues: number }
  > = {};
  let preservedDuplicateHistory = 0;
  const stock = new Map<string, bigint>(),
    deltas = new Map<string, bigint>(),
    actions = new Set<string>();
  for (const domain of [
    "payments",
    "invoices",
    "stock",
    "movements",
    "reservations",
    "automation",
  ] as const) {
    let cursor: string | null = null,
      done = false;
    const count = { pages: 0, entries: 0, issues: 0 };
    while (!done && count.pages < 1000) {
      const page: FunctionReturnType<typeof api.integrity.page> =
        await client.query(api.integrity.page, { domain, cursor });
      count.pages++;
      count.entries += page.entries.length;
      for (const e of page.entries) {
        count.issues += e.issues.length;
        if (e.kind === "resolved_duplicate_history")
          preservedDuplicateHistory++;
        if (e.kind === "stock") {
          if (stock.has(e.key)) count.issues++;
          stock.set(e.key, BigInt(e.amount!));
        }
        if (e.kind === "delta")
          deltas.set(e.key, (deltas.get(e.key) ?? 0n) + BigInt(e.amount!));
        if (e.kind === "active_action") {
          if (actions.has(e.key)) count.issues++;
          actions.add(e.key);
        }
      }
      cursor = page.cursor;
      done = page.done;
    }
    if (!done) throw Error("Reconciliation bound reached");
    result[domain] = count;
  }
  const stockDrift = [...new Set([...stock.keys(), ...deltas.keys()])].filter(
    (k) => (stock.get(k) ?? 0n) !== (deltas.get(k) ?? 0n),
  ).length;
  const issues =
    Object.values(result).reduce((n, x) => n + x.issues, 0) + stockDrift;
  writeFileSync(
    ".acceptance/m10/whole-ledger.json",
    JSON.stringify(
      {
        executed_at: new Date().toISOString(),
        environment: "development",
        deployment: "woozy-jaguar-392",
        source_mutations: 0,
        result,
        stock_bucket_drift: stockDrift,
        preserved_resolved_duplicate_history: preservedDuplicateHistory,
        issues,
        status: issues ? "FAILED" : "PASSED",
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      result,
      stock_bucket_drift: stockDrift,
      preserved_resolved_duplicate_history: preservedDuplicateHistory,
      issues,
    }),
  );
  if (issues) process.exitCode = 1;
}
main().catch(() => {
  console.error("Reconciliation failed; inspect restricted diagnostics.");
  process.exitCode = 1;
});
