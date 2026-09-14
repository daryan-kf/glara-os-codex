import { it, expect } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { inventoryFixture } from "../support/inventory-unit-fixture";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

it("bounds inventory queries with 1,000 products, 3,000 assets and 1,000 ledger rows under Convex transaction limits", async () => {
  const f = await inventoryFixture("serialized");
  const template = await f.t.run(async (ctx) => ({
    p: (await ctx.db.get(f.product))!,
    a: (await ctx.db.get(f.asset!))!,
    m: (await ctx.db.query("inventory_movements").first())!,
  }));
  const locations = [f.location];
  for (let n = 1; n < 5; n++)
    locations.push(
      await f.owner.mutation(api.inventory.saveLocation, {
        version: 0,
        input: JSON.stringify({
          name: `Scale warehouse ${n}`,
          type: "warehouse",
          address: "Fictional",
          active: true,
          staging_source: true,
          retail_source: true,
        }),
      }),
    );
  const ids: Id<"products">[] = [f.product];
  for (let offset = 1; offset < 1000; offset += 50) {
    ids.push(
      ...(await f.t.run(async (ctx) => {
        const chunk: Id<"products">[] = [];
        const { _id, _creationTime, ...p } = template.p;
        void _id;
        void _creationTime;
        const { _id: ai, _creationTime: at, ...a } = template.a;
        void ai;
        void at;
        for (let n = offset; n < Math.min(offset + 50, 1000); n++) {
          const product = await ctx.db.insert("products", {
            ...p,
            sku: `SCALE-${n}`,
            name: `Fictional scale ${n}`,
            search_text: `SCALE-${n} Fictional scale ${n}`,
          });
          chunk.push(product);
          for (let k = 0; k < 3; k++)
            await ctx.db.insert("inventory_assets", {
              ...a,
              product_id: product,
              location_id: locations[n % 5],
              asset_number: `GLA-SCALE-${n}-${k}`,
            });
        }
        return chunk;
      })),
    );
  }
  await f.t.run(async (ctx) => {
    const { _id, _creationTime, ...a } = template.a;
    void _id;
    void _creationTime;
    for (let n = 0; n < 2; n++)
      await ctx.db.insert("inventory_assets", {
        ...a,
        asset_number: `GLA-SCALE-BASE-${n}`,
      });
  });
  for (let offset = 1; offset < 1000; offset += 100)
    await f.t.run(async (ctx) => {
      const { _id, _creationTime, ...m } = template.m;
      void _id;
      void _creationTime;
      for (let n = offset; n < Math.min(offset + 100, 1000); n++)
        await ctx.db.insert("inventory_movements", {
          ...m,
          reason: `Fictional historical receipt ${n}`,
        });
    });
  const base = await f.reserve(1, "2099-01-01", "2099-01-02");
  await f.t.run(async (ctx) => {
    const { _id, _creationTime, ...r } = (await ctx.db.get(base))!;
    void _id;
    void _creationTime;
    for (const product_id of ids.slice(1, 50)) {
      const a = (await ctx.db
        .query("inventory_assets")
        .withIndex("by_product", (q) => q.eq("product_id", product_id))
        .first())!;
      await ctx.db.insert("inventory_reservations", {
        ...r,
        product_id,
        asset_id: a._id,
        location_id: a.location_id!,
      });
    }
  });
  const measurements: { query: string; milliseconds: number; bytes: number }[] =
    [];
  async function measure<T>(query: string, fn: () => Promise<T>) {
    const start = performance.now();
    const data = await fn();
    measurements.push({
      query,
      milliseconds: Math.round(performance.now() - start),
      bytes: Buffer.byteLength(JSON.stringify(data)),
    });
    return data;
  }
  const filters = {
    search: "",
    available_only: false,
    staging_only: false,
    archived: false,
    paginationOpts: { cursor: null, numItems: 8 },
  };
  const page = await measure("catalog page", () =>
    f.owner.query(api.inventory.list, filters),
  );
  expect(page.page.length).toBeLessThanOrEqual(8);
  expect(page.isDone).toBe(false);
  const second = await measure("catalog next page", () =>
    f.owner.query(api.inventory.list, {
      ...filters,
      paginationOpts: { cursor: page.continueCursor, numItems: 8 },
    }),
  );
  expect(
    second.page.some((p) => page.page.some((first) => first._id === p._id)),
  ).toBe(false);
  const search = await measure("exact SKU search", () =>
    f.owner.query(api.inventory.search, { q: "SCALE-999" }),
  );
  expect(search.some((x) => x.id === ids[999])).toBe(true);
  const product = await measure("product 360", () =>
    f.owner.query(api.inventory.product, { id: ids[750] }),
  );
  expect(product.assets).toHaveLength(3);
  const asset = await measure("asset lookup", () =>
    f.owner.query(api.inventory.search, { q: "GLA-SCALE-999-2" }),
  );
  expect(asset[0].kind).toBe("Asset");
  const history = await measure("ledger page", () =>
    f.owner.query(api.inventory.history, {
      product_id: f.product,
      paginationOpts: { cursor: null, numItems: 20 },
    }),
  );
  expect(history.page).toHaveLength(20);
  expect(history.isDone).toBe(false);
  await measure("project inventory", () =>
    f.owner.query(api.inventory.projectInventory, { project_id: f.project }),
  );
  expect(measurements.every((m) => m.bytes < 100000)).toBe(true);
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/m4-scale.json",
    JSON.stringify(
      {
        environment:
          "convex-test with default Convex transaction limits enabled; local emulator timing, not hosted latency",
        products: 1000,
        assets: 3000,
        locations: 5,
        historicalMovements: 1000,
        activeReservations: 50,
        measurements,
      },
      null,
      2,
    ),
  );
}, 30000);
