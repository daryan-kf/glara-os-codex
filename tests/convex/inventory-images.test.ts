import { describe, it, expect, vi, afterEach } from "vitest";
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
  it("attaches validated images, serves URLs by role, and detaches without destroying a potentially shared blob", async () => {
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
    expect(await stored(f, image)).toBe(true);
  });
  it("rejects non-image uploads, oversized files, the photo limit and non-managers", async () => {
    const f = await fixture();
    const text = await store(f, "text/html");
    const rejected = await f.owner.mutation(api.inventory.attachProductImage, {
      product_id: f.product,
      storage_id: text,
    });
    expect(rejected.ok).toBe(false);
    expect(await stored(f, text)).toBe(true);
    const huge = await store(f, "image/png", 5 * 1024 * 1024 + 1);
    expect(
      (
        await f.owner.mutation(api.inventory.attachProductImage, {
          product_id: f.product,
          storage_id: huge,
        })
      ).ok,
    ).toBe(false);
    expect(await stored(f, huge)).toBe(true);
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
    expect(await stored(f, overflow)).toBe(true);
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
describe("quick add from a photo", () => {
  it("creates sequential draft products with the photo attached, under Uncategorized", async () => {
    const f = await fixture();
    const first = await f.owner.mutation(api.inventory.quickAddProduct, {
      storage_id: await store(f, "image/jpeg"),
    });
    const second = await f.owner.mutation(api.inventory.quickAddProduct, {
      storage_id: await store(f, "image/png"),
    });
    expect(first.ok && second.ok).toBe(true);
    expect(first.sku).toBe("DRAFT-0001");
    expect(second.sku).toBe("DRAFT-0002");
    const detail = await f.owner.query(api.inventory.product, {
      id: first.id!,
    });
    expect(detail.name).toBe("Untitled product DRAFT-0001");
    expect(detail.category_name).toBe("Uncategorized");
    expect(detail.images).toHaveLength(1);
    expect(detail.active).toBe(true);
  });
  it("rejects non-images, retains an untrusted blob reference, and denies non-managers", async () => {
    const f = await fixture();
    const bad = await store(f, "application/pdf");
    const rejected = await f.owner.mutation(api.inventory.quickAddProduct, {
      storage_id: bad,
    });
    expect(rejected.ok).toBe(false);
    expect(await stored(f, bad)).toBe(true);
    await expect(
      f.c("designer").mutation(api.inventory.quickAddProduct, {
        storage_id: await store(f, "image/jpeg"),
      }),
    ).rejects.toThrow();
  });
});
describe("photo import from spreadsheet URLs", () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (type: string, bytes = 32) =>
    new Response(new Uint8Array(bytes), {
      headers: { "content-type": type },
    });
  it("downloads validated https photos, skips products that already have photos", async () => {
    const f = await fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: unknown) =>
        String(url).includes("broken")
          ? respond("text/html")
          : respond("image/jpeg"),
      ),
    );
    const first = await f.owner.action(api.inventory.importProductImages, {
      input: JSON.stringify([
        {
          sku: "TEST-CHAIR",
          urls: [
            "https://media.example.test/chair-front.jpg",
            "https://media.example.test/broken.jpg",
          ],
        },
        { sku: "GHOST-SKU", urls: ["https://media.example.test/x.jpg"] },
      ]),
    });
    expect(first[0]).toMatchObject({ sku: "TEST-CHAIR", added: 1 });
    expect(first[0].errors).toHaveLength(1);
    expect(first[1].errors).toEqual(["Product not found."]);
    const detail = await f.owner.query(api.inventory.product, {
      id: f.product,
    });
    expect(detail.images).toHaveLength(1);
    const second = await f.owner.action(api.inventory.importProductImages, {
      input: JSON.stringify([
        {
          sku: "TEST-CHAIR",
          urls: ["https://media.example.test/chair-front.jpg"],
        },
      ]),
    });
    expect(second[0]).toMatchObject({ added: 0, skipped: 1 });
  });
  it("refuses http URLs and non-manager callers before any download", async () => {
    const f = await fixture();
    const fetchSpy = vi.fn(async () => respond("image/jpeg"));
    vi.stubGlobal("fetch", fetchSpy);
    await expect(
      f.owner.action(api.inventory.importProductImages, {
        input: JSON.stringify([
          { sku: "TEST-CHAIR", urls: ["http://media.example.test/x.jpg"] },
        ]),
      }),
    ).rejects.toThrow("INVALID_INPUT");
    await expect(
      f.c("designer").action(api.inventory.importProductImages, {
        input: JSON.stringify([
          { sku: "TEST-CHAIR", urls: ["https://media.example.test/x.jpg"] },
        ]),
      }),
    ).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

it("rejected attachment cannot delete another product's photo", async () => {
  const f = await fixture();
  const id = await store(f, "image/png");
  await f.owner.mutation(api.inventory.attachProductImage, {
    product_id: f.product,
    storage_id: id,
  });
  const other = await f.owner.mutation(api.inventory.quickAddProduct, {
    storage_id: await store(f, "image/jpeg"),
  });
  await f.t.run((ctx) =>
    ctx.db.patch(other.id!, { deleted_at: new Date().toISOString() }),
  );
  const refused = await f.owner.mutation(api.inventory.attachProductImage, {
    product_id: other.id!,
    storage_id: id,
  });
  expect(refused.ok).toBe(false);
  expect(await stored(f, id)).toBe(true);
  expect(
    (await f.owner.query(api.inventory.product, { id: f.product })).images,
  ).toHaveLength(1);
});
