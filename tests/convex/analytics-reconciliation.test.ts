import { it, expect, describe } from "vitest";
import { api } from "../../convex/_generated/api";
import { commercialFixture } from "../support/commercial-unit-fixture";
import { sourceTables, sourceProjection } from "../../convex/analyticsSources";
import { applySource } from "../../convex/analyticsLedger";
import type { Id } from "../../convex/_generated/dataModel";
async function fixture() {
  const f = await commercialFixture();
  // M3's fixture marks its setup opportunity won directly. Model a migration backfill for that legacy setup write.
  await f.t.run(async (ctx) => {
    const p = await sourceProjection(ctx, "opportunities", f.oid);
    await applySource(ctx, "opportunities", f.oid, p.facts, p.version);
  });
  return f;
}
async function reconcile(f: Awaited<ReturnType<typeof fixture>>) {
  const id = await f.owner.mutation(api.analyticsReconciliation.start, {});
  let last;
  for (let i = 0; i < 500; i++) {
    last = await f.owner.mutation(api.analyticsReconciliation.advance, { id });
    if (last.status !== "running") return { id, run: last };
  }
  throw Error("Reconciliation did not complete within bounded acceptance loop");
}
describe("M6 independent rebuild and explicit repair", () => {
  it("rebuilds all sources and dimensions with zero drift after allocation and reversal", async () => {
    const f = await fixture(),
      i = await f.manual("200");
    await f.issue(i);
    const payment = await f.payment("75", [{ invoice_id: i, amount: "75" }]);
    await f.owner.mutation(api.commercial.reversePayment, {
      id: payment,
      reason: "Fictional reversal acceptance",
    });
    const before = await f.t.run((ctx) =>
      ctx.db.query("analytics_buckets").collect(),
    );
    const result = await reconcile(f);
    expect(result.run.status).toBe("complete");
    expect(result.run.source_drift).toBe(0);
    expect(result.run.bucket_drift).toBe(0);
    expect(
      await f.t.run((ctx) => ctx.db.query("analytics_buckets").collect()),
    ).toEqual(before);
  }, 30000);
  it("detects bucket corruption without repairing it and requires source-backed explicit repair", async () => {
    const f = await fixture(),
      payment = await f.payment("10");
    const bucket = await f.t.run(async (ctx) => {
      const rows = await ctx.db.query("analytics_buckets").collect();
      const b = rows.find(
        (r) =>
          r.metric === "cash_received_cents" &&
          r.grain === "month" &&
          r.dimension === "company",
      )!;
      await ctx.db.patch(b._id, { value: "1001" });
      return b;
    });
    const { id, run } = await reconcile(f);
    expect(run.source_drift).toBe(0);
    expect(run.bucket_drift).toBe(1);
    expect((await f.t.run((ctx) => ctx.db.get(bucket._id)))?.value).toBe(
      "1001",
    );
    const difference = await f.t.run((ctx) =>
      ctx.db
        .query("analytics_expected")
        .withIndex("by_run_key", (q) =>
          q.eq("run_id", id).eq("key", bucket.key),
        )
        .unique(),
    );
    await expect(
      f.c("admin").mutation(api.analyticsReconciliation.repairBucket, {
        id: difference!._id,
        reason: "Fictional explicit repair",
      }),
    ).rejects.toThrow();
    await f.owner.mutation(api.analyticsReconciliation.repairBucket, {
      id: difference!._id,
      reason: "Repair independently verified fictional bucket corruption",
    });
    expect((await f.t.run((ctx) => ctx.db.get(bucket._id)))?.value).toBe(
      "1000",
    );
    expect(
      (
        await f.owner.query(api.analytics.compareSource, {
          table: "payments",
          id: payment,
        })
      ).drift,
    ).toEqual([]);
    expect((await reconcile(f)).run.bucket_drift).toBe(0);
  }, 30000);
  it("invalidates a reconciliation when a business transaction changes the watermark", async () => {
    const f = await fixture(),
      id = await f.owner.mutation(api.analyticsReconciliation.start, {});
    await f.payment("1");
    const run = await f.owner.mutation(api.analyticsReconciliation.advance, {
      id,
    });
    expect(run.status).toBe("stale");
  });
  it("detects missing source contributions independently of the fact ledger", async () => {
    const f = await fixture(),
      p = await f.payment("5");
    await f.t.run(async (ctx) => {
      const rows = await ctx.db
        .query("analytics_facts")
        .withIndex("by_source", (q) =>
          q.eq("source_table", "payments").eq("source_id", p),
        )
        .collect();
      for (const row of rows) await ctx.db.delete(row._id);
    });
    const result = await reconcile(f);
    expect(result.run.source_drift).toBeGreaterThan(0);
    expect(result.run.bucket_drift).toBe(0);
  });
  it("rejects anonymous, archived Owner, and forged identifiers on reporting maintenance", async () => {
    const f = await fixture();
    await expect(
      f.t.mutation(api.analyticsReconciliation.start, {}),
    ).rejects.toThrow();
    await f.t.run(async (ctx) => {
      const p = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", f.who("owner").id))
        .unique();
      await ctx.db.patch(p!._id, { deleted_at: new Date().toISOString() });
    });
    await expect(
      f.owner.query(api.analytics.summary, {
        period: JSON.stringify({ period: "today" }),
      }),
    ).rejects.toThrow();
    await expect(
      f.owner.mutation(api.analyticsReconciliation.start, {}),
    ).rejects.toThrow();
    await expect(
      f.c("marketing").query(api.analyticsReconciliation.result, {
        id: "fake" as Id<"analytics_reconciliations">,
        pagination: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow();
  });
  it("can rebuild every fact twice without changing any aggregate", async () => {
    const f = await fixture();
    await f.payment("10");
    const before = await f.t.run((ctx) =>
      ctx.db.query("analytics_buckets").collect(),
    );
    for (let n = 0; n < 2; n++)
      for (const table of sourceTables)
        await f.t.run(async (ctx) => {
          for (const row of await ctx.db.query(table).collect()) {
            const p = await sourceProjection(ctx, table, row._id);
            await applySource(ctx, table, row._id, p.facts, p.version);
          }
        });
    expect(
      await f.t.run((ctx) => ctx.db.query("analytics_buckets").collect()),
    ).toEqual(before);
  }, 30000);
});
it("requires sequential complete backfill and a zero-drift proof before activation", async () => {
  const f = await fixture(),
    { internal } = await import("../../convex/_generated/api");
  const early = await reconcile(f);
  await expect(
    f.owner.mutation(api.analyticsReconciliation.activate, { id: early.id }),
  ).rejects.toThrow();
  let next: { table: string; cursor: string | null; complete?: boolean } =
    await f.t.mutation(internal.analytics.startBackfill, {});
  const first = { table: next.table, cursor: next.cursor };
  next = await f.t.mutation(internal.analytics.backfillPage, first);
  await expect(
    f.t.mutation(internal.analytics.backfillPage, first),
  ).rejects.toThrow();
  for (let i = 0; i < 150 && !next.complete; i++)
    next = await f.t.mutation(internal.analytics.backfillPage, {
      table: next.table,
      cursor: next.cursor,
    });
  expect(next.complete).toBe(true);
  const proof = await reconcile(f);
  expect(proof.run.source_drift).toBe(0);
  expect(proof.run.bucket_drift).toBe(0);
  await f.owner.mutation(api.analyticsReconciliation.activate, {
    id: proof.id,
  });
  expect(
    (
      await f.owner.query(api.analytics.summary, {
        period: JSON.stringify({ period: "this_month" }),
      })
    ).ready,
  ).toBe(true);
}, 30000);
it("resumes internal backfill batches at the persisted cursor without premature activation", async () => {
  const f = await fixture(),
    { internal } = await import("../../convex/_generated/api");
  await f.t.mutation(internal.analytics.startBackfill, {});
  await expect(
    f.t.action(internal.analyticsMaintenance.backfillBatch, { pages: 101 }),
  ).rejects.toThrow();
  const partial = await f.t.action(
    internal.analyticsMaintenance.backfillBatch,
    { pages: 1 },
  );
  expect(partial.complete).toBe(false);
  const saved = await f.t.query(
    internal.analyticsMaintenance.backfillStatus,
    {},
  );
  expect(saved.table).toBe(partial.table);
  expect(saved.cursor).toBe(partial.cursor);
  const done = await f.t.action(internal.analyticsMaintenance.backfillBatch, {
    pages: 100,
  });
  expect(done.complete).toBe(true);
  expect(
    (
      await f.owner.query(api.analytics.summary, {
        period: JSON.stringify({ period: "this_month" }),
      })
    ).ready,
  ).toBe(false);
});
it("bounds reconciliation batches and enforces live Owner authorization inside actions", async () => {
  const f = await fixture(),
    id = await f.owner.mutation(api.analyticsReconciliation.start, {});
  await expect(
    f
      .c("sales")
      .action(api.analyticsMaintenance.reconcileBatch, { id, pages: 1 }),
  ).rejects.toThrow();
  await expect(
    f.owner.action(api.analyticsMaintenance.reconcileBatch, { id, pages: 51 }),
  ).rejects.toThrow();
  const page = await f.owner.action(api.analyticsMaintenance.reconcileBatch, {
    id,
    pages: 1,
  });
  expect(page.scanned).toBeGreaterThan(0);
  expect(page.status).toBe("running");
});
it("compares serialized counters with installation evidence without repairing source inventory", async () => {
  const f = await fixture(),
    { internal } = await import("../../convex/_generated/api");
  const asset = await f.t.run(
    async (ctx) => (await ctx.db.query("inventory_assets").collect())[0]!,
  );
  expect(
    (await f.t.action(internal.analyticsMaintenance.inventoryEvidence, {}))
      .mismatches,
  ).toEqual([]);
  await f.t.run((ctx) => ctx.db.patch(asset._id, { staging_use_count: 99 }));
  const check = await f.t.action(
    internal.analyticsMaintenance.inventoryEvidence,
    {},
  );
  expect(check.mismatches).toEqual([
    { id: asset._id, recorded: 99, evidenced: 0 },
  ]);
  expect(
    (await f.t.run((ctx) => ctx.db.get(asset._id)))?.staging_use_count,
  ).toBe(99);
});
