import { describe, it, expect } from "vitest";
import { inventoryFixture as fixture } from "../support/inventory-unit-fixture";
import { api } from "../../convex/_generated/api";
import { stockStates, conditions } from "../../src/lib/inventory/model";
import { day } from "../../src/lib/operations/model";

import type { Role } from "../../src/lib/permissions";

async function reconcile(f: Awaited<ReturnType<typeof fixture>>) {
  const { stocks, movements } = await f.t.run(async (ctx) => ({
    stocks: await ctx.db.query("inventory_stock").collect(),
    movements: await ctx.db.query("inventory_movements").collect(),
  }));
  for (const s of stocks)
    for (const bucket of stockStates) {
      const expected = movements
        .filter((m) => m.product_id === s.product_id)
        .flatMap((m) => m.stock_deltas)
        .filter((d) => d.location_id === s.location_id && d.bucket === bucket)
        .reduce((n, d) => n + d.delta, 0);
      expect(s[bucket]).toBe(expected);
      expect(s[bucket]).toBeGreaterThanOrEqual(0);
    }
}
async function snapshot(f: Awaited<ReturnType<typeof fixture>>) {
  return f.t.run(async (ctx) => ({
    assets: await ctx.db.query("inventory_assets").collect(),
    stock: await ctx.db.query("inventory_stock").collect(),
    lines: await ctx.db.query("inventory_reservations").collect(),
    ledger: await ctx.db.query("inventory_movements").collect(),
    inspections: await ctx.db.query("inventory_inspections").collect(),
    audit: await ctx.db.query("audit_logs").collect(),
    damage: await ctx.db.query("inventory_damage").collect(),
  }));
}
const locationInput = (name: string, active = true) =>
  JSON.stringify({
    name,
    type: "warehouse",
    address: "Fictional",
    active,
    staging_source: true,
    retail_source: true,
  });

describe("M4 comprehensive release gate", () => {
  it("cancels unpicked plans atomically without physical movement and rejects replay", async () => {
    const f = await fixture();
    const r = await f.reserve(7);
    await f.owner.mutation(api.operations.transition, {
      id: f.project,
      version: (await f.get(f.project)).version,
      status: "cancelled",
      reason: "Fictional cancellation",
    });
    expect((await f.getLine(r)).state).toBe("released");
    expect((await f.availability()).available).toBe(10);
    await expect(f.move(r, "release", 7)).rejects.toThrow();
    const release = (await snapshot(f)).ledger.filter(
      (m) => m.movement_type === "release_reservation",
    );
    expect(release).toHaveLength(1);
    expect(release[0].stock_deltas).toEqual([]);
    await reconcile(f);
  });
  it("rejects cancellation after pickup with all records unchanged", async () => {
    const f = await fixture();
    const r = await f.reserve(2);
    await f.stage("staging");
    await f.move(r, "pick", 2);
    const before = await snapshot(f);
    await expect(
      f.owner.mutation(api.operations.transition, {
        id: f.project,
        version: (await f.get(f.project)).version,
        status: "cancelled",
        reason: "Must physically return",
      }),
    ).rejects.toThrow();
    expect(await snapshot(f)).toEqual(before);
  });
  it.each(conditions)(
    "receives serialized %s condition with independent availability",
    async (condition) => {
      const f = await fixture("serialized");
      const id = (await f.owner.mutation(api.inventory.receive, {
        product_id: f.product,
        location_id: f.location,
        quantity: 1,
        condition,
        acquisition_date: day(),
        reason: "Fictional condition receipt",
      }))!;
      const a = await f.owner.query(api.inventory.asset, { id });
      expect(a.condition).toBe(condition);
      expect(a.status).toBe(
        ["poor", "damaged"].includes(condition) ? "inspection" : "available",
      );
    },
  );
  it.each([0, -1, 0.5, 100001, Number.MAX_SAFE_INTEGER])(
    "rejects invalid receipt quantity %s atomically",
    async (quantity) => {
      const f = await fixture();
      const before = await snapshot(f);
      await expect(
        f.owner.mutation(api.inventory.receive, {
          product_id: f.product,
          location_id: f.location,
          quantity,
          condition: "good",
          acquisition_date: day(),
          reason: "Invalid count",
        }),
      ).rejects.toThrow();
      expect(await snapshot(f)).toEqual(before);
    },
  );
  it("uniquely numbers concurrent assets and rejects client-owned identity fields", async () => {
    const f = await fixture("serialized");
    const args = {
      product_id: f.product,
      location_id: f.location,
      quantity: 1,
      condition: "good" as const,
      acquisition_date: day(),
      reason: "Concurrent receipt",
    };
    const ids = await Promise.all(
      Array.from({ length: 8 }, () =>
        f.owner.mutation(api.inventory.receive, args),
      ),
    );
    const assets = await Promise.all(
      ids.map((id) => f.owner.query(api.inventory.asset, { id: id! })),
    );
    expect(new Set(assets.map((a) => a.asset_number)).size).toBe(8);
    await expect(
      f.owner.mutation(api.inventory.receive, {
        ...args,
        ...{ asset_number: "GLA-FAKE" },
      }),
    ).rejects.toThrow();
  });
  it("damaged return records condition, installation ancestry, incident and repair history", async () => {
    const f = await fixture("serialized");
    const r = await f.reserve(1);
    await f.stage("staging");
    await f.move(r, "pick");
    expect((await f.getLine(r)).installed_at).toBeUndefined();
    await f.move(r, "install");
    const installed = (await f.getLine(r)).installed_at;
    expect(installed).toBeTruthy();
    await expect(f.move(r, "install")).rejects.toThrow();
    await f.stage("destaging");
    await f.move(r, "destage");
    const row = await f.getLine(r);
    await f.owner.mutation(api.inventory.moveReservation, {
      id: r,
      version: row.version,
      quantity: 1,
      action: "return",
      return_outcome: "damaged",
      asset_confirmation: row.asset_number!,
      location_id: f.location,
      reason: "Fictional damaged return",
    });
    expect(await f.getLine(r)).toMatchObject({
      state: "inspection",
      return_outcome: "damaged",
      installed_at: installed,
    });
    expect(
      await f.owner.query(api.inventory.asset, { id: f.asset! }),
    ).toMatchObject({
      condition: "damaged",
      status: "inspection",
      staging_use_count: 1,
    });
    const incident = (await snapshot(f)).damage[0];
    expect(incident.damage_type).toBe("damage");
    await f.inspect(r, "repair");
    expect((await f.availability()).assets[0].available).toBe(0);
    await f.inspect(r, "available");
    expect(
      (await f.owner.query(api.inventory.asset, { id: f.asset! })).status,
    ).toBe("available");
    let version = incident.version;
    for (const status of ["assessed", "repair", "resolved"] as const)
      await f.owner.mutation(api.inventory.resolveDamage, {
        id: incident._id,
        version: version++,
        status,
        resolution: "Fictional documented repair",
      });
    await expect(
      f.owner.mutation(api.inventory.resolveDamage, {
        id: incident._id,
        version,
        status: "assessed",
        resolution: "Cannot move backwards",
      }),
    ).rejects.toThrow();
  });
  it("keeps future asset bookings safe during inspection retirement and missing write-off", async () => {
    const f = await fixture("serialized");
    const current = await f.reserve(1, day(), day());
    const future = await f.reserve(1, "2099-02-01", "2099-02-02");
    await f.stage("staging");
    await f.move(current, "pick");
    await f.move(current, "return");
    await expect(f.inspect(current, "retired")).rejects.toThrow();
    await f.inspect(current, "available");
    await f.move(future, "missing");
    // Add a future plan, confirm after a recovery, then make the current item missing again.
    await f.move(future, "found");
    await f.inspect(future, "available");
    const a = await f.reserve(1, day(), day());
    const b = await f.reserve(1, "2099-04-01", "2099-04-02");
    await f.move(a, "missing");
    await expect(f.move(a, "write_off")).rejects.toThrow();
    await f.move(b, "release");
    await f.move(a, "write_off");
    expect(
      (await f.owner.query(api.inventory.asset, { id: f.asset! })).status,
    ).toBe("retired");
  });
  it("serializes competing transfers and inspections with stale-version protection", async () => {
    const f = await fixture("serialized");
    const dests = await Promise.all(
      ["North", "South"].map((name) =>
        f.owner.mutation(api.inventory.saveLocation, {
          version: 0,
          input: locationInput(name),
        }),
      ),
    );
    const results = await Promise.allSettled(
      dests.map((to_location_id) =>
        f.owner.mutation(api.inventory.transferOrDispose, {
          product_id: f.product,
          asset_id: f.asset!,
          location_id: f.location,
          to_location_id,
          version: 1,
          quantity: 1,
          action: "transfer",
          reason: "Concurrent asset transfer",
        }),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const a = await f.owner.query(api.inventory.asset, { id: f.asset! });
    await f.owner.mutation(api.inventory.holdStock, {
      product_id: f.product,
      asset_id: f.asset!,
      location_id: a.location_id!,
      version: a.version,
      quantity: 1,
      action: "inspection_hold",
      reason: "Fictional inspection hold",
    });
    const b = await f.owner.query(api.inventory.asset, { id: f.asset! });
    const inspections = await Promise.allSettled(
      (["available", "repair"] as const).map((result) =>
        f.owner.mutation(api.inventory.inspect, {
          product_id: f.product,
          asset_id: f.asset!,
          location_id: b.location_id!,
          version: b.version,
          quantity: 1,
          from_state: "inspection",
          result,
          condition: "good",
          notes: "Concurrent inspection decision",
        }),
      ),
    );
    expect(inspections.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await snapshot(f)).inspections).toHaveLength(1);
  });
  it("reconciles every stock bucket after receipt, transfer, reserve, partial installation, missing, care and adjustment", async () => {
    const f = await fixture();
    await f.owner.mutation(api.inventory.receive, {
      product_id: f.product,
      location_id: f.location,
      quantity: 90,
      condition: "good",
      acquisition_date: day(),
      reason: "Controlled 100 receipt",
    });
    await reconcile(f);
    const dest = await f.owner.mutation(api.inventory.saveLocation, {
      version: 0,
      input: locationInput("Second warehouse"),
    });
    await f.owner.mutation(api.inventory.transferOrDispose, {
      product_id: f.product,
      location_id: f.location,
      to_location_id: dest,
      version: (await f.availability()).stock!.version,
      quantity: 20,
      action: "transfer",
      reason: "Controlled transfer",
    });
    await reconcile(f);
    const r = await f.reserve(30);
    await reconcile(f);
    await f.move(r, "release", 10);
    await reconcile(f);
    await f.stage("staging");
    await f.move(r, "pick", 20);
    await reconcile(f);
    const installed = await f.move(r, "install", 18);
    await reconcile(f);
    await f.move(r, "return", 2);
    await reconcile(f);
    await f.stage("destaging");
    await f.move(installed, "destage", 18);
    const returned = await f.move(installed, "return", 17);
    await reconcile(f);
    await f.move(installed, "missing", 1);
    expect((await f.getLine(installed)).current_location).toBe(
      "Unconfirmed — missing",
    );
    await reconcile(f);
    await f.move(installed, "found", 1);
    await reconcile(f);
    const care = await f.inspect(returned, "cleaning", 5);
    await reconcile(f);
    await f.inspect(care!, "available", 5);
    await reconcile(f);
    await f.owner.mutation(api.inventory.transferOrDispose, {
      product_id: f.product,
      location_id: f.location,
      version: (await f.availability()).stock!.version,
      quantity: 3,
      action: "adjustment",
      reason: "Documented count variance",
    });
    await reconcile(f);
    expect((await f.availability()).stock!.missing).toBe(3);
  });
  it.each([1, 2, 3])(
    "preserves capacity in repeated three-client quantity race %s",
    async () => {
      const f = await fixture();
      await f.owner.mutation(api.inventory.receive, {
        product_id: f.product,
        location_id: f.location,
        quantity: 10,
        condition: "good",
        acquisition_date: day(),
        reason: "Twenty units total",
      });
      const results = await Promise.allSettled(
        [8, 7, 9].map((n) => f.reserve(n)),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
      expect((await f.availability()).available).toBeGreaterThanOrEqual(0);
      await reconcile(f);
    },
  );
  it("global search isolates roles and returns distinct product and assigned asset destinations", async () => {
    const f = await fixture("serialized");
    const a = await f.owner.query(api.inventory.asset, { id: f.asset! });
    expect(
      (await f.owner.query(api.inventory.search, { q: "test-chair" }))[0].kind,
    ).toBe("Product");
    expect(
      (await f.owner.query(api.inventory.search, { q: a.asset_number }))[0]
        .kind,
    ).toBe("Asset");
    for (const role of ["sales", "marketing"] as Role[])
      await expect(
        f.c(role).query(api.inventory.search, { q: a.asset_number }),
      ).rejects.toThrow();
    expect(
      await f
        .c("staging_crew")
        .query(api.inventory.search, { q: a.asset_number }),
    ).toEqual([]);
    await f.reserve(1);
    expect(
      (
        await f
          .c("staging_crew")
          .query(api.inventory.search, { q: a.asset_number })
      )[0].href,
    ).toBe(`/projects/${f.project}/inventory`);
    await expect(
      f.t.query(api.inventory.search, { q: a.asset_number }),
    ).rejects.toThrow();
  });
  it("wrong-item readiness and alerts clear only after an actual corrected pick", async () => {
    const f = await fixture();
    const r = await f.reserve(2);
    await f.move(r, "wrong_item", 2);
    expect(
      (
        await f.owner.query(api.inventory.projectInventory, {
          project_id: f.project,
        })
      ).readiness,
    ).toBe("exception");
    expect(
      (await f.owner.query(api.inventory.exceptions, {})).some(
        (x) => x.id === r,
      ),
    ).toBe(true);
    await f.stage("staging");
    await f.move(r, "pick", 2);
    expect(
      (await f.owner.query(api.inventory.exceptions, {})).some(
        (x) => x.id === r,
      ),
    ).toBe(false);
  });
  it("rejects real foreign-room, product-asset mismatch, inactive destination and stale metadata", async () => {
    const f = await fixture("serialized");
    const foreignRoom = await f.t.run(async (ctx) => {
      const { _id, _creationTime, ...p } = (await ctx.db.get(f.project))!;
      void _id;
      void _creationTime;
      const other = await ctx.db.insert("projects", {
        ...p,
        project_number: "GLS-TEST-OTHER",
      });
      const { _id: rid, _creationTime: rt, ...r } = (await ctx.db.get(f.room))!;
      void rid;
      void rt;
      return ctx.db.insert("project_rooms", { ...r, project_id: other });
    });
    const input = {
      project_id: f.project,
      project_room_id: foreignRoom,
      product_id: f.product,
      asset_id: f.asset!,
      location_id: f.location,
      quantity: 1,
      needed_from: day(),
      needed_until: day(),
      notes: "",
      planned: false,
    };
    await expect(
      f.owner.mutation(api.inventory.reserve, input),
    ).rejects.toThrow();
    const inactive = await f.owner.mutation(api.inventory.saveLocation, {
      version: 0,
      input: locationInput("Closed location", false),
    });
    await expect(
      f.owner.mutation(api.inventory.transferOrDispose, {
        product_id: f.product,
        asset_id: f.asset!,
        location_id: f.location,
        to_location_id: inactive,
        version: 1,
        quantity: 1,
        action: "transfer",
        reason: "Inactive destination",
      }),
    ).rejects.toThrow();
    await f.owner.mutation(api.inventory.saveAssetDetails, {
      id: f.asset!,
      version: 1,
      notes: "Updated",
      staging_eligible: true,
    });
    await expect(
      f.owner.mutation(api.inventory.saveAssetDetails, {
        id: f.asset!,
        version: 1,
        notes: "Stale",
        staging_eligible: true,
      }),
    ).rejects.toThrow();
  });
});
it("rejects mismatched product/asset pairs and spoofed audit actors atomically", async () => {
  const f = await fixture("serialized");
  const product = await f.owner.mutation(api.inventory.saveProduct, {
    version: 0,
    category_id: f.category,
    input: JSON.stringify({
      sku: "OTHER-SERIAL",
      name: "Fictional other chair",
      track_mode: "serialized",
      staging_eligible: true,
      retail_eligible: true,
      active: true,
    }),
  });
  const args = {
    project_id: f.project,
    project_room_id: f.room,
    product_id: product,
    asset_id: f.asset!,
    location_id: f.location,
    quantity: 1,
    needed_from: day(),
    needed_until: day(),
    planned: false,
    notes: "Invalid pair",
  };
  const before = await snapshot(f);
  await expect(f.owner.mutation(api.inventory.reserve, args)).rejects.toThrow();
  await expect(
    f.owner.mutation(api.inventory.reserve, {
      ...args,
      product_id: f.product,
      ...{ reserved_by: f.who("sales").id },
    }),
  ).rejects.toThrow();
  expect(await snapshot(f)).toEqual(before);
  const r = await f.reserve(1);
  await f.stage("staging");
  await f.move(r, "pick");
  await f.move(r, "return");
  const row = await f.getLine(r);
  const held = await snapshot(f);
  await expect(
    f.owner.mutation(api.inventory.inspect, {
      reservation_id: r,
      asset_id: f.asset!,
      product_id: f.product,
      location_id: f.location,
      version: row.version,
      quantity: 1,
      from_state: "inspection",
      result: "available",
      condition: "good",
      notes: "Spoofed actor",
      ...{ inspected_by: f.who("sales").id },
    }),
  ).rejects.toThrow();
  expect(await snapshot(f)).toEqual(held);
});
