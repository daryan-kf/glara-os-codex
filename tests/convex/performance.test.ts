import { expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { commercialFixture } from "../support/commercial-unit-fixture";
import { api } from "../../convex/_generated/api";
import { z } from "zod";
import { realtorRow } from "../../src/lib/crm/model";
it("fictional CRM scale preserves paging and search; records a local multi-module baseline", async () => {
  const f = await commercialFixture();
  const original = await f.t.run((ctx) =>
    ctx.db.get(ctx.db.normalizeId("realtors", f.r.id)!),
  );
  if (!original) throw Error("fixture missing");
  const { _id, _creationTime, ...base } = original;
  void _id;
  void _creationTime;
  for (let batch = 0; batch < 10; batch++)
    await f.t.run(async (ctx) => {
      for (let n = 0; n < 50; n++)
        await ctx.db.insert("realtors", {
          ...base,
          first_name: "Scale",
          last_name: String(batch * 50 + n).padStart(4, "0"),
          email: null,
          phone: null,
          phone_key: null,
        });
    });
  const page = z.object({ rows: z.array(realtorRow), total: z.number() });
  const list = async (input: object) =>
    page.parse(
      await f.owner.query(api.crm.read, { input: JSON.stringify(input) }),
    );
  const first = await list({ op: "list", q: "Scale", page: 1 }),
    second = await list({ op: "list", q: "Scale", page: 2 });
  expect(first.total).toBe(500);
  expect(first.rows).toHaveLength(25);
  expect(first.rows.map((r) => r.last_name)).toEqual(
    Array.from({ length: 25 }, (_, n) => String(n).padStart(4, "0")),
  );
  expect(new Set([...first.rows, ...second.rows].map((r) => r.id)).size).toBe(
    50,
  );
  expect((await list({ op: "search", q: "Scale" })).rows).toHaveLength(8);
  expect((await list({ op: "list", q: "Scale", page: 21 })).rows).toHaveLength(
    0,
  );
  const invoice = await f.manual();
  await f.issue(invoice);
  const operations: Record<string, () => Promise<unknown>> = {
    dashboard: () => f.owner.query(api.commercial.dashboard, {}),
    realtor_search: () => list({ op: "search", q: "Scale" }),
    project_load: () => f.get(f.project),
    inventory_availability: () => f.availability(),
    invoice_ar: () =>
      f.owner.query(api.commercial.receivables, {
        paginationOpts: { numItems: 25, cursor: null },
        status: "",
        from: "",
        until: "",
      }),
    analytics: () =>
      f.owner.query(api.analytics.summary, {
        period: JSON.stringify({ period: "this_month" }),
      }),
    automation_queue: () => f.owner.query(api.automation.health, {}),
    communication_history: () =>
      f.owner.query(api.communications.list, {
        paginationOpts: { numItems: 25, cursor: null },
      }),
    ai_settings_setup: () => f.owner.query(api.ai.settings, {}),
  };
  const measured: Record<
    string,
    {
      samples: number;
      failures: number;
      p50_ms: number;
      p95_ms: number;
      max_ms: number;
    }
  > = {};
  for (const [name, run] of Object.entries(operations)) {
    await run();
    const samples: number[] = [];
    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await run();
      samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    measured[name] = {
      samples: 10,
      failures: 0,
      p50_ms: Math.round(samples[4] * 100) / 100,
      p95_ms: Math.round(samples[9] * 100) / 100,
      max_ms: Math.round(samples[9] * 100) / 100,
    };
  }
  mkdirSync(".acceptance/m10", { recursive: true });
  writeFileSync(
    ".acceptance/m10/performance-result.json",
    JSON.stringify(
      {
        environment: "local",
        dataset: {
          realtors: 501,
          projects: 1,
          serialized_assets: 1,
          invoices: 1,
        },
        concurrency: 1,
        measured,
        limitations: [
          "Convex-test in-process; not hosted, browser, mobile or provider latency",
          "Only Realtor list has scale data; other modules smoke baseline",
          "AI settings read is not full provider request setup",
          "No production SLA asserted",
        ],
      },
      null,
      2,
    ),
  );
});

it("long Realtor activity histories use stable cursor pages and indexed contact dates", async () => {
  const f = await commercialFixture();
  const source = await f.t.run((ctx) => ctx.db.query("activities").first());
  if (!source) throw Error("fixture missing");
  const { _id, _creationTime, ...base } = source;
  void _id;
  void _creationTime;
  const rid = f.r
    .id as import("../../convex/_generated/dataModel").Id<"realtors">;
  for (let batch = 0; batch < 10; batch++)
    await f.t.run(async (ctx) => {
      for (let n = 0; n < 100; n++) {
        const stamp = new Date(
          Date.UTC(2025, 0, 1, 0, batch * 100 + n),
        ).toISOString();
        await ctx.db.insert("activities", {
          ...base,
          realtor_id: rid,
          type: n === 0 ? "call" : "note",
          title: "Fictional long history " + (batch * 100 + n),
          description: "Fictional ".repeat(200),
          status: "completed",
          created_at: stamp,
          completed_at: stamp,
        });
      }
    });
  const schema = z.object({
    rows: z.array(z.object({ id: z.string() })),
    next_cursor: z.string().nullable(),
  });
  let cursor: string | null = null;
  const seen = new Set<string>();
  let pages = 0;
  do {
    const value = schema.parse(
      await f.owner.query(api.crm.read, {
        input: JSON.stringify({ op: "activities", id: rid, cursor }),
      }),
    );
    expect(value.rows.length).toBeLessThanOrEqual(30);
    for (const row of value.rows) {
      expect(seen.has(row.id)).toBe(false);
      seen.add(row.id);
    }
    cursor = value.next_cursor;
    pages++;
  } while (cursor && pages < 40);
  expect(cursor).toBeNull();
  expect(seen.size).toBe(1000);
  const detail = realtorRow.parse(
    await f.owner.query(api.crm.read, {
      input: JSON.stringify({ op: "detail", id: rid }),
    }),
  );
  expect(detail.first_contact_date).toBe("2025-01-01T00:00:00.000Z");
  expect(detail.last_contact_date).toBe("2025-01-01T15:00:00.000Z");
}, 30000);
