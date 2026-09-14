import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { api } from "../../convex/_generated/api";
import { operationsClient } from "./operations-fixture";
import { credentials } from "./identities";
import type { Id } from "../../convex/_generated/dataModel";
async function main() {
  const { client } = await operationsClient(),
    paginationOpts = { cursor: null, numItems: 25 },
    results: { name: string; passed: boolean }[] = [];
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log("PASS " + name);
    } catch {
      results.push({ name, passed: false });
      console.log("FAIL " + name);
    }
  };
  const archived = await client.query(api.operations.list, {
    paginationOpts,
    archived: true,
    status: "cancelled",
  });
  const fixture = archived.page.find((p) =>
    p.property_address.startsWith("Fictional "),
  );
  if (!fixture) throw Error("Run fictional M3 browser acceptance first");
  const p = await client.query(api.operations.get, { id: fixture.id });
  assert.ok(p.team && p.source);
  await check("archived status filter returns matching history", async () => {
    assert.ok(archived.page.length);
    assert.ok(
      archived.page.every((p) => p.deleted_at && p.status === "cancelled"),
    );
  });
  await check("manager designer and property filters combine", async () => {
    const rows = await client.query(api.operations.list, {
      paginationOpts,
      archived: true,
      status: "cancelled",
      manager: p.team!.project_manager_id!,
      designer: p.team!.designer_id!,
      property: p.source!.property_id,
    });
    assert.ok(rows.page.some((row) => row.id === p.id));
    assert.ok(
      rows.page.every((row) => row.property_address === p.property_address),
    );
  });
  await check(
    "mismatched combined designer excludes manager matches",
    async () => {
      const rows = await client.query(api.operations.list, {
        paginationOpts,
        archived: true,
        status: "cancelled",
        manager: p.team!.project_manager_id!,
        designer: credentials("marketing").id as Id<"users">,
      });
      assert.equal(rows.page.length, 0);
    },
  );
  await check(
    "active list excludes archives and clamps page size",
    async () => {
      const rows = await client.query(api.operations.list, {
        paginationOpts: { cursor: null, numItems: 500 },
      });
      assert.ok(rows.page.length <= 12);
      assert.ok(
        rows.page.every(
          (p) =>
            !p.deleted_at && !["completed", "cancelled"].includes(p.status),
        ),
      );
    },
  );
  await check(
    "marketing cannot retrieve archived operational projects",
    async () => {
      const { client: marketing } = await operationsClient("marketing");
      const rows = await marketing.query(api.operations.list, {
        paginationOpts,
        archived: true,
        status: "cancelled",
      });
      assert.equal(rows.page.length, 0);
    },
  );
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/m3-query-api.json",
    JSON.stringify(
      {
        deployment: "woozy-jaguar-392",
        executedAt: new Date().toISOString(),
        results,
      },
      null,
      2,
    ),
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "M3 query acceptance requires existing fictional browser fixtures.",
  );
  process.exitCode = 1;
});
