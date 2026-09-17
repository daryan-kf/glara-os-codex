import { describe, it, expect } from "vitest";
import { api } from "../../convex/_generated/api";
import { inventoryFixture as fixture } from "../support/inventory-unit-fixture";
import {
  buildXlsx,
  parseXlsx,
  parseCsv,
} from "../../src/lib/inventory/spreadsheet";
describe("spreadsheet codec", () => {
  it("round-trips workbook rows including unicode, ampersands and gaps", async () => {
    const rows = [
      ["sku", "name", "category"],
      ["SOFA-001", "مبل کتان <Ivory> & gold", "Sofas"],
      ["", "Second", 'He said "hi"'],
    ];
    const parsed = await parseXlsx(buildXlsx(rows));
    expect(parsed[1]).toEqual(rows[1]);
    expect(parsed[2][1]).toBe("Second");
    expect(parsed[2][2]).toBe('He said "hi"');
    expect(parsed[2][0]).toBe("");
  });
  it("parses quoted CSV with embedded commas, quotes and BOM", () => {
    const rows = parseCsv(
      '﻿sku,name\r\nA-1,"Sofa, three seats"\n"B-2","Say ""hello"""\n\n',
    );
    expect(rows).toEqual([
      ["sku", "name"],
      ["A-1", "Sofa, three seats"],
      ["B-2", 'Say "hello"'],
    ]);
  });
});
describe("catalog import and export", () => {
  const row = {
    sku: "IMP-CHAIR",
    name: "Imported chair",
    category: "Imported seating",
    track_mode: "quantity",
    brand: "",
    collection: "",
    description: "",
    color: "Green",
    material: "",
    dimensions: "",
    weight: "",
    purchase_price: "250.00",
    rental_price: "25.50",
    sale_price: "400.00",
    staging_eligible: true,
    retail_eligible: false,
    active: true,
  };
  it("creates products and missing categories, then updates by SKU", async () => {
    const f = await fixture();
    const first = await f.owner.mutation(api.inventory.importProducts, {
      input: JSON.stringify([row]),
    });
    expect(first).toEqual({ created: 1, updated: 0 });
    const second = await f.owner.mutation(api.inventory.importProducts, {
      input: JSON.stringify([{ ...row, name: "Renamed", sale_price: "" }]),
    });
    expect(second).toEqual({ created: 0, updated: 1 });
    const product = await f.t.run(async (ctx) =>
      (await ctx.db.query("products").collect()).find(
        (p) => p.sku === "IMP-CHAIR",
      ),
    );
    expect(product?.name).toBe("Renamed");
    expect(product?.rental_price_cents).toBe("2550");
    expect(product?.sale_price_cents).toBeUndefined();
    const category = await f.t.run(async (ctx) =>
      (await ctx.db.query("inventory_categories").collect()).find(
        (c) => c.name_key === "imported seating",
      ),
    );
    expect(category?.active).toBe(true);
  });
  it("rejects invalid rows, oversized batches and non-manager callers", async () => {
    const f = await fixture();
    await expect(
      f.owner.mutation(api.inventory.importProducts, {
        input: JSON.stringify([{ ...row, sale_price: "-4" }]),
      }),
    ).rejects.toThrow();
    await expect(
      f.owner.mutation(api.inventory.importProducts, {
        input: JSON.stringify(
          Array.from({ length: 101 }, (_, i) => ({ ...row, sku: "S-" + i })),
        ),
      }),
    ).rejects.toThrow();
    for (const role of ["designer", "staging_crew", "sales"] as const)
      await expect(
        f.c(role).mutation(api.inventory.importProducts, {
          input: JSON.stringify([row]),
        }),
      ).rejects.toThrow();
  });
  it("exports the catalog with prices, categories and availability to managers only", async () => {
    const f = await fixture();
    await f.owner.mutation(api.inventory.importProducts, {
      input: JSON.stringify([row]),
    });
    const page = await f.owner.query(api.inventory.exportCatalog, {
      cursor: null,
    });
    expect(page.done).toBe(true);
    const imported = page.rows.find((r) => r.sku === "IMP-CHAIR")!;
    expect(imported.category).toBe("Imported seating");
    expect(imported.rental_price_cents).toBe("2550");
    expect(imported.available_units).toBe(0);
    const seeded = page.rows.find((r) => r.sku === "TEST-CHAIR")!;
    expect(seeded.available_units).toBe(10);
    await expect(
      f.c("designer").query(api.inventory.exportCatalog, { cursor: null }),
    ).rejects.toThrow();
  });
});
