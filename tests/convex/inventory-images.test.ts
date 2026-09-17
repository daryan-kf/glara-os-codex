import { describe, it, expect } from "vitest";
import { api } from "../../convex/_generated/api";
import { inventoryFixture as fixture } from "../support/inventory-unit-fixture";
// convex-test's storage.store records size but not contentType; real uploads
// through generateUploadUrl carry it, so backfill it for the validation path.
const store = (
  f: Awaited<ReturnType<typeof fixture>>,
  type: string,
  bytes = 16,
) =>
  f.t.run(async (ctx) => {
    const id = await ctx.storage.store(
      new Blob([new Uint8Array(bytes)], { type }),
    );
    await ctx.db.patch(id as never, { contentType: type } as never);
    return id;
  });
const stored = (
  f: Awaited<ReturnType<typeof fixture>>,
  id: Awaited<ReturnType<typeof store>>,
) => f.t.run(async (ctx) => Boolean(await ctx.storage.get(id)));
describe("product photos", () => {
  it("attaches validated images, serves URLs by role, and removes the blob on delete", async () => {
    const f = await fixture();
    const image = await store(f, "image/jpeg");
    await f.owner.mutation(api.inventory.attachProductImage, {
      product_id: f.product,
      storage_id: image,
    });
    const detail = await f.owner.query(api.inventory.product, {
      id: f.product,
    });
    expect(detail.images).toHaveLength(1);
    expect(detail.images[0].url).toBeTruthy();
    const designer = await f
      .c("designer")
      .query(api.inventory.product, { id: f.product });
    expect(designer.images).toHaveLength(1);
    const listed = await f.owner.query(api.inventory.list, {
      paginationOpts: { numItems: 10, cursor: null },
      search: "",
      available_only: false,
      staging_only: false,
      archived: false,
    });
    expect(listed.page[0].image_url).toBeTruthy();
    await f.owner.mutation(api.inventory.removeProductImage, {
      product_id: f.product,
      storage_id: image,
    });
    expect(
      (await f.owner.query(api.inventory.product, { id: f.product })).images,
    ).toHaveLength(0);
    expect(await stored(f, image)).toBe(false);
  });
  it("rejects non-image uploads, oversized files, the photo limit and non-managers", async () => {
    const f = await fixture();
    const text = await store(f, "text/html");
    const rejected = await f.owner.mutation(api.inventory.attachProductImage, {
      product_id: f.product,
      storage_id: text,
    });
    expect(rejected.ok).toBe(false);
    expect(await stored(f, text)).toBe(false);
    const huge = await store(f, "image/png", 5 * 1024 * 1024 + 1);
    expect(
      (
        await f.owner.mutation(api.inventory.attachProductImage, {
          product_id: f.product,
          storage_id: huge,
        })
      ).ok,
    ).toBe(false);
    expect(await stored(f, huge)).toBe(false);
    for (let i = 0; i < 6; i++)
      expect(
        (
          await f.owner.mutation(api.inventory.attachProductImage, {
            product_id: f.product,
            storage_id: await store(f, "image/webp"),
          })
        ).ok,
      ).toBe(true);
    const overflow = await store(f, "image/webp");
    expect(
      (
        await f.owner.mutation(api.inventory.attachProductImage, {
          product_id: f.product,
          storage_id: overflow,
        })
      ).ok,
    ).toBe(false);
    expect(await stored(f, overflow)).toBe(false);
    for (const role of ["designer", "staging_crew", "sales"] as const) {
      await expect(
        f.c(role).mutation(api.inventory.imageUploadUrl, {}),
      ).rejects.toThrow();
      await expect(
        f.c(role).mutation(api.inventory.attachProductImage, {
          product_id: f.product,
          storage_id: await store(f, "image/jpeg"),
        }),
      ).rejects.toThrow();
    }
  });
});
