import { describe, it, expect } from "vitest";
import { api } from "../../convex/_generated/api";
import { inventoryFixture as fixture } from "../support/inventory-unit-fixture";
const productInput = (prices: Record<string, string> = {}) => ({
  sku: "TEST-CHAIR",
  name: "Fictional chair",
  track_mode: "quantity",
  staging_eligible: true,
  retail_eligible: true,
  active: true,
  ...prices,
});
const listArgs = {
  paginationOpts: { numItems: 10, cursor: null },
  search: "",
  available_only: false,
  staging_only: false,
  archived: false,
};
describe("catalog pricing", () => {
  it("stores purchase, rental and sale prices as exact cents and clears them on empty input", async () => {
    const f = await fixture();
    await f.owner.mutation(api.inventory.saveProduct, {
      id: f.product,
      version: 1,
      category_id: f.category,
      input: JSON.stringify(
        productInput({
          purchase_price: "1250.5",
          rental_price: "89.99",
          sale_price: "2000",
        }),
      ),
    });
    let p = await f.owner.query(api.inventory.product, { id: f.product });
    expect(p.purchase_price_cents).toBe("125050");
    expect(p.rental_price_cents).toBe("8999");
    expect(p.sale_price_cents).toBe("200000");
    await f.owner.mutation(api.inventory.saveProduct, {
      id: f.product,
      version: 2,
      category_id: f.category,
      input: JSON.stringify(productInput({ rental_price: "89.99" })),
    });
    p = await f.owner.query(api.inventory.product, { id: f.product });
    expect(p.purchase_price_cents).toBeNull();
    expect(p.rental_price_cents).toBe("8999");
    expect(p.sale_price_cents).toBeNull();
  });
  it("rejects malformed price inputs", async () => {
    const f = await fixture();
    for (const bad of ["-5", "1.234", "1,000", "abc", "1000000000"])
      await expect(
        f.owner.mutation(api.inventory.saveProduct, {
          id: f.product,
          version: 1,
          category_id: f.category,
          input: JSON.stringify(productInput({ sale_price: bad })),
        }),
      ).rejects.toThrow();
  });
  it("returns stored prices to Owner/Admin only; designers receive null", async () => {
    const f = await fixture();
    await f.owner.mutation(api.inventory.saveProduct, {
      id: f.product,
      version: 1,
      category_id: f.category,
      input: JSON.stringify(
        productInput({
          purchase_price: "100",
          rental_price: "10",
          sale_price: "150",
        }),
      ),
    });
    const admin = await f.c("admin").query(api.inventory.product, {
      id: f.product,
    });
    expect(admin.sale_price_cents).toBe("15000");
    const designer = await f.c("designer").query(api.inventory.product, {
      id: f.product,
    });
    expect(designer.purchase_price_cents).toBeNull();
    expect(designer.rental_price_cents).toBeNull();
    expect(designer.sale_price_cents).toBeNull();
    const ownerList = await f.owner.query(api.inventory.list, listArgs);
    expect(ownerList.page[0].purchase_price_cents).toBe("10000");
    const designerList = await f.c("designer").query(api.inventory.list, {
      ...listArgs,
    });
    expect(designerList.page[0].purchase_price_cents).toBeNull();
    expect(designerList.page[0].sale_price_cents).toBeNull();
  });
});
