import { contentSecurityPolicy } from "../../src/lib/security/csp";
import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { inventoryFixture } from "../support/inventory-unit-fixture";
import { buildXlsx, parseXlsx } from "../../src/lib/inventory/spreadsheet";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
const input = {
  sku: "TEST-CHAIR",
  name: "Fictional chair",
  category: "Chairs",
  track_mode: "quantity",
  active: true,
  staging_eligible: true,
  retail_eligible: true,
};
it("spreadsheet import preserves reservation dependencies and transaction rollback", async () => {
  const f = await inventoryFixture();
  await f.reserve(1);
  for (const patch of [{ active: false }, { staging_eligible: false }]) {
    await expect(
      f.owner.mutation(api.inventory.importProducts, {
        input: JSON.stringify([{ ...input, ...patch }]),
      }),
    ).rejects.toThrow("DEPENDENCY");
    const p = await f.t.run((ctx) => ctx.db.get(f.product));
    expect(p?.active).toBe(true);
    expect(p?.staging_eligible).toBe(true);
  }
});
it("spreadsheet import rejects archived categories", async () => {
  const f = await inventoryFixture();
  await f.t.run((ctx) =>
    ctx.db.patch(f.category, { deleted_at: new Date().toISOString() }),
  );
  await expect(
    f.owner.mutation(api.inventory.importProducts, {
      input: JSON.stringify([input]),
    }),
  ).rejects.toThrow("INVALID_INPUT");
});
it("inventory freeze prevents issuing upload URLs and remote image requests", async () => {
  const f = await inventoryFixture();
  vi.stubEnv("GLARA_RECOVERY_MODE", "true");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    f.owner.mutation(api.inventory.imageUploadUrl, {}),
  ).rejects.toThrow("CAPABILITY_FROZEN");
  await expect(
    f.owner.action(api.inventory.importProductImages, {
      input: JSON.stringify([
        { sku: "TEST-CHAIR", urls: ["https://media.example.test/a.jpg"] },
      ]),
    }),
  ).rejects.toThrow("CAPABILITY_FROZEN");
  expect(fetcher).not.toHaveBeenCalled();
});
it("closed production rejects remote image calls even with an authenticated identity", async () => {
  const f = await inventoryFixture();
  vi.stubEnv("GLARA_ENVIRONMENT", "production");
  const fetcher = vi.fn();
  vi.stubGlobal("fetch", fetcher);
  await expect(
    f.owner.action(api.inventory.importProductImages, {
      input: JSON.stringify([
        { sku: "TEST-CHAIR", urls: ["https://media.example.test/a.jpg"] },
      ]),
    }),
  ).rejects.toThrow("CAPABILITY_FROZEN");
  expect(fetcher).not.toHaveBeenCalled();
});
it("maintenance purge fails closed without an explicit development environment", async () => {
  const f = await inventoryFixture();
  for (const env of [undefined, "preview", "production"]) {
    vi.stubEnv("GLARA_ENVIRONMENT", env);
    for (const ref of [
      internal.inventoryMaintenance.purgeCatalog,
      internal.inventoryMaintenance.purgeBusinessData,
      internal.inventoryMaintenance.purgeTestRecipient,
    ])
      await expect(f.t.mutation(ref, {})).rejects.toThrow(
        "non-production maintenance operation",
      );
  }
  expect(await f.t.run((ctx) => ctx.db.get(f.product))).not.toBeNull();
});
it("catalog export handles a realistic thousand-row workbook without call-stack overflow", async () => {
  const rows = Array.from({ length: 1000 }, (_, n) => [
    String(n),
    "Fictional product ".repeat(12),
    "Chairs",
  ]);
  const bytes = buildXlsx(rows);
  expect(await parseXlsx(bytes)).toEqual(rows);
});

it("production address lookup remains off until separately approved", async () => {
  const f = await inventoryFixture();
  vi.stubEnv("GLARA_ENVIRONMENT", "production");
  vi.stubEnv("GLARA_PRODUCTION_APPROVED", "true");
  expect(
    (await f.owner.query(api.profiles.viewer, {}))?.address_lookup_enabled,
  ).toBe(false);
  expect(
    contentSecurityPolicy(
      "123456789012345678901234",
      "https://fictional.convex.cloud",
      false,
    ),
  ).not.toContain("photon.komoot.io");
  vi.stubEnv("GLARA_PRODUCTION_ADDRESS_LOOKUP_APPROVED", "true");
  expect(
    (await f.owner.query(api.profiles.viewer, {}))?.address_lookup_enabled,
  ).toBe(true);
  vi.stubEnv("GLARA_RECOVERY_MODE", "true");
  expect(
    (await f.owner.query(api.profiles.viewer, {}))?.address_lookup_enabled,
  ).toBe(false);
});
