import { it, expect } from "vitest";
import { inventoryFixture as fixture } from "../support/inventory-unit-fixture";
import { api } from "../../convex/_generated/api";
import { assetStates } from "../../src/lib/inventory/model";
import { day } from "../../src/lib/operations/model";

it.each([
  { name: "" },
  { sku: "" },
  { sku: "!bad" },
  { track_mode: "unknown" },
  { staging_eligible: "yes" },
  { retail_eligible: 1 },
  { active: null },
  { purchase_cost: 500 },
])("rejects malformed product input %j", async (change) => {
  const f = await fixture();
  await expect(
    f.owner.mutation(api.inventory.saveProduct, {
      version: 0,
      category_id: f.category,
      input: JSON.stringify({
        sku: "NEW-SKU",
        name: "Fictional valid",
        track_mode: "quantity",
        staging_eligible: true,
        retail_eligible: true,
        active: true,
        ...change,
      }),
    }),
  ).rejects.toThrow();
});
it.each(["quantity", "serialized"] as const)(
  "locks %s tracking mode after receipt",
  async (mode) => {
    const f = await fixture(mode);
    await expect(
      f.owner.mutation(api.inventory.saveProduct, {
        id: f.product,
        version: 1,
        category_id: f.category,
        input: JSON.stringify({
          sku: "TEST-CHAIR",
          name: "Fictional chair",
          track_mode: mode === "quantity" ? "serialized" : "quantity",
          staging_eligible: true,
          retail_eligible: true,
          active: true,
        }),
      }),
    ).rejects.toThrow();
  },
);
it("category normalization, rename, dependency guard, inactive state and stale edits", async () => {
  const f = await fixture();
  await expect(
    f.owner.mutation(api.inventory.saveCategory, {
      version: 0,
      name: "  cHaIrS ",
      active: true,
    }),
  ).rejects.toThrow();
  await f.owner.mutation(api.inventory.saveCategory, {
    id: f.category,
    version: 1,
    name: "Seating",
    active: true,
  });
  await expect(
    f.owner.mutation(api.inventory.saveCategory, {
      id: f.category,
      version: 1,
      name: "Stale",
      active: true,
    }),
  ).rejects.toThrow();
  await expect(
    f.owner.mutation(api.inventory.saveCategory, {
      id: f.category,
      version: 2,
      name: "Seating",
      active: false,
    }),
  ).rejects.toThrow();
  const empty = await f.owner.mutation(api.inventory.saveCategory, {
    version: 0,
    name: "Unused",
    active: true,
  });
  await f.owner.mutation(api.inventory.saveCategory, {
    id: empty,
    version: 1,
    name: "Unused",
    active: false,
  });
  expect(
    (await f.owner.query(api.inventory.options, {})).categories.some(
      (c) => c._id === empty,
    ),
  ).toBe(false);
});
it.each(assetStates.filter((s) => s !== "available"))(
  "blocks retail sale and staging reservation from asset status %s",
  async (status) => {
    const f = await fixture("serialized");
    await f.t.run((ctx) => ctx.db.patch(f.asset!, { status }));
    await expect(f.reserve(1)).rejects.toThrow();
    await expect(
      f.owner.mutation(api.inventory.transferOrDispose, {
        product_id: f.product,
        asset_id: f.asset!,
        location_id: f.location,
        version: 1,
        quantity: 1,
        action: "sold",
        reason: "Invalid physical state",
      }),
    ).rejects.toThrow();
  },
);
it("disabling staging eligibility preserves retail access but denies new reservations", async () => {
  const f = await fixture();
  await f.owner.mutation(api.inventory.saveProduct, {
    id: f.product,
    version: 1,
    category_id: f.category,
    input: JSON.stringify({
      sku: "TEST-CHAIR",
      name: "Fictional chair",
      track_mode: "quantity",
      staging_eligible: false,
      retail_eligible: true,
      active: true,
    }),
  });
  await expect(f.reserve(1)).rejects.toThrow();
  expect((await f.availability()).available).toBe(0);
  await f.owner.mutation(api.inventory.transferOrDispose, {
    product_id: f.product,
    location_id: f.location,
    version: 1,
    quantity: 2,
    action: "sold",
    reason: "Retail eligible disposition",
  });
  expect((await f.availability()).stock?.sold).toBe(2);
});
it("archive preserves movement history and prevents receipt, search and reservation until restore", async () => {
  const f = await fixture();
  await f.owner.mutation(api.inventory.transferOrDispose, {
    product_id: f.product,
    location_id: f.location,
    version: 1,
    quantity: 10,
    action: "sold",
    reason: "All free units sold",
  });
  await f.owner.mutation(api.inventory.archiveProduct, {
    id: f.product,
    version: 1,
    archive: true,
  });
  expect(
    await f.owner.query(api.inventory.search, { q: "TEST-CHAIR" }),
  ).toEqual([]);
  await expect(f.reserve(1)).rejects.toThrow();
  await expect(
    f.owner.mutation(api.inventory.receive, {
      product_id: f.product,
      location_id: f.location,
      quantity: 1,
      condition: "good",
      acquisition_date: day(),
      reason: "Archived receipt",
    }),
  ).rejects.toThrow();
  expect(
    (
      await f.owner.query(api.inventory.history, {
        product_id: f.product,
        paginationOpts: { cursor: null, numItems: 20 },
      })
    ).page.length,
  ).toBe(2);
  const p = await f.owner.query(api.inventory.product, { id: f.product });
  await f.owner.mutation(api.inventory.archiveProduct, {
    id: f.product,
    version: p.version,
    archive: false,
  });
  expect(
    (await f.owner.query(api.inventory.search, { q: "TEST-CHAIR" })).length,
  ).toBe(1);
});
it("unassigned designer cannot reserve or retrieve another project's inventory", async () => {
  const f = await fixture();
  await f.t.run((ctx) => ctx.db.patch(f.project, { designer_id: null }));
  await expect(
    f
      .c("designer")
      .query(api.inventory.projectInventory, { project_id: f.project }),
  ).rejects.toThrow();
  await expect(
    f.c("designer").mutation(api.inventory.reserve, {
      project_id: f.project,
      project_room_id: f.room,
      product_id: f.product,
      location_id: f.location,
      quantity: 1,
      needed_from: day(),
      needed_until: day(),
      notes: "Scope attack",
      planned: false,
    }),
  ).rejects.toThrow();
});
