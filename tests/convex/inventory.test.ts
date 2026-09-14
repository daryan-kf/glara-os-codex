import { describe, it, expect } from "vitest";
import { api } from "../../convex/_generated/api";
import { day } from "../../src/lib/operations/model";
import { inventoryFixture as fixture } from "../support/inventory-unit-fixture";
describe("M4 inventory authorization and ledger integrity", () => {
  it("transfers quantity atomically and sells only free usable stock", async () => {
    const f = await fixture();
    const dest = await f.owner.mutation(api.inventory.saveLocation, {
      version: 0,
      input: JSON.stringify({
        name: "Second fictional store",
        type: "store",
        address: "Fictional",
        active: true,
        staging_source: true,
        retail_source: true,
      }),
    });
    await f.owner.mutation(api.inventory.transferOrDispose, {
      product_id: f.product,
      location_id: f.location,
      to_location_id: dest,
      version: 1,
      quantity: 4,
      action: "transfer",
      reason: "Fictional transfer",
    });
    const destState = () =>
      f.owner.query(api.inventory.availability, {
        product_id: f.product,
        location_id: dest,
        needed_from: day(),
        needed_until: "2099-01-01",
      });
    expect((await f.availability()).stock?.available).toBe(6);
    expect((await destState()).stock?.available).toBe(4);
    await f.owner.mutation(api.inventory.transferOrDispose, {
      product_id: f.product,
      location_id: dest,
      version: (await destState()).stock!.version,
      quantity: 2,
      action: "sold",
      reason: "Fictional sale disposition",
    });
    expect((await destState()).stock).toMatchObject({ available: 2, sold: 2 });
    await expect(
      f.owner.mutation(api.inventory.transferOrDispose, {
        product_id: f.product,
        location_id: f.location,
        version: 1,
        quantity: 1,
        action: "sold",
        reason: "Stale quantity version",
      }),
    ).rejects.toThrow();
  });
  it("repairs serialized inventory through explicit inspection without changing its identity", async () => {
    const f = await fixture("serialized");
    const before = await f.owner.query(api.inventory.asset, { id: f.asset! });
    await f.owner.mutation(api.inventory.holdStock, {
      product_id: f.product,
      asset_id: f.asset!,
      location_id: f.location,
      version: before.version,
      quantity: 1,
      action: "damage",
      reason: "Fictional damaged leg",
    });
    for (const result of ["repair", "available"] as const) {
      const a = await f.owner.query(api.inventory.asset, { id: f.asset! });
      await f.owner.mutation(api.inventory.inspect, {
        product_id: f.product,
        asset_id: f.asset!,
        location_id: f.location,
        version: a.version,
        quantity: 1,
        from_state: a.status as "damaged",
        result,
        condition: result === "available" ? "good" : "damaged",
        notes: "Fictional care assessment",
      });
    }
    const after = await f.owner.query(api.inventory.asset, { id: f.asset! });
    expect(after.asset_number).toBe(before.asset_number);
    expect(after.status).toBe("available");
  });
  it("restricts product assignment links to assigned design projects", async () => {
    const f = await fixture();
    await f.reserve(1);
    const args = {
      product_id: f.product,
      paginationOpts: { cursor: null, numItems: 20 },
    };
    expect(
      (await f.c("designer").query(api.inventory.productAssignments, args))
        .page,
    ).toHaveLength(1);
    await f.t.run(async (ctx) =>
      ctx.db.patch(f.project, { designer_id: null }),
    );
    expect(
      (await f.c("designer").query(api.inventory.productAssignments, args))
        .page,
    ).toHaveLength(0);
    await expect(
      f.c("marketing").query(api.inventory.productAssignments, args),
    ).rejects.toThrow();
  });

  it("completion requires approved missing exceptions and physical receipt of damaged stock", async () => {
    const f = await fixture();
    const r = await f.reserve(2);
    await f.move(r, "missing", 2);
    await f.stage("destaging");
    await f.complete(f.project, "destaging");
    await expect(f.advance(f.project, "completed")).rejects.toThrow();
    await f.move(r, "exception", 2);
    await f.advance(f.project, "completed");
    await expect(
      f.owner.mutation(api.operations.archive, {
        id: f.project,
        version: (await f.get(f.project)).version,
        restore: false,
      }),
    ).rejects.toThrow();
  });

  it("requires receipt before inspecting damaged project quantity and preserves all balances", async () => {
    const f = await fixture();
    const r = await f.reserve(3);
    await f.stage("staging");
    await f.move(r, "pick", 3);
    await f.move(r, "install", 3);
    await f.move(r, "damage", 3);
    await expect(f.inspect(r, "available", 3)).rejects.toThrow();
    await f.move(r, "receive_damage", 3);
    await f.inspect(r, "available", 3);
    expect((await f.availability()).stock).toMatchObject({
      available: 10,
      inspection: 0,
      damaged: 0,
    });
  });
  it("requires an authorized exception at the staging gate and blocks inventory teleporting on status changes", async () => {
    const f = await fixture();
    const r = await f.reserve(2);
    await f.stage("staging");
    await f.complete(f.project, "staging");
    await expect(f.advance(f.project, "staged")).rejects.toThrow();
    await f.move(r, "wrong_item", 2);
    await expect(f.advance(f.project, "staged")).rejects.toThrow();
    await f.move(r, "exception", 2);
    await f.advance(f.project, "staged");
    expect((await f.getLine(r)).state).toBe("reserved");
    expect((await f.availability()).stock?.available).toBe(10);
  });
  it("makes standalone missing corrections visible and requires found-stock inspection", async () => {
    const f = await fixture();
    await f.owner.mutation(api.inventory.holdStock, {
      product_id: f.product,
      location_id: f.location,
      version: 1,
      quantity: 2,
      action: "missing",
      reason: "Fictional warehouse shortage",
    });
    expect(
      (await f.owner.query(api.inventory.exceptions, {})).some(
        (r) => r.project_id === null && r.quantity === 2,
      ),
    ).toBe(true);
    const b = (await f.availability()).stock!;
    await f.owner.mutation(api.inventory.holdStock, {
      product_id: f.product,
      location_id: f.location,
      version: b.version,
      quantity: 2,
      action: "found",
      reason: "Fictional stock found",
    });
    expect((await f.availability()).stock).toMatchObject({
      available: 8,
      inspection: 2,
      missing: 0,
    });
  });
  it("does not allow standalone quantity care to consume project-held balances", async () => {
    const f = await fixture();
    const r = await f.reserve(5);
    await f.stage("staging");
    await f.move(r, "pick", 5);
    await f.move(r, "return", 5);
    const b = (await f.availability()).stock!;
    await expect(
      f.owner.mutation(api.inventory.inspect, {
        product_id: f.product,
        location_id: f.location,
        version: b.version,
        quantity: 5,
        from_state: "inspection",
        result: "available",
        condition: "good",
        notes: "Bypass attempt",
      }),
    ).rejects.toThrow();
  });

  it("normalizes unique SKUs, separates stock and assets, and generates stable asset numbers", async () => {
    const f = await fixture("serialized");
    const a = await f.owner.query(api.inventory.asset, { id: f.asset! });
    expect(a.asset_number).toBe("GLA-000001");
    await expect(
      f.owner.mutation(api.inventory.saveProduct, {
        version: 0,
        category_id: f.category,
        input: JSON.stringify({
          sku: "TEST-CHAIR",
          name: "Duplicate",
          track_mode: "quantity",
          staging_eligible: true,
          retail_eligible: true,
          active: true,
        }),
      }),
    ).rejects.toThrow();
    expect((await f.availability()).stock).toBeNull();
  });
  it("denies anonymous, sales, marketing and crew catalog calls and all non-admin stock writes", async () => {
    const f = await fixture();
    for (const client of [
      f.t,
      f.c("sales"),
      f.c("marketing"),
      f.c("staging_crew"),
    ])
      await expect(
        client.query(api.inventory.product, { id: f.product }),
      ).rejects.toThrow();
    for (const role of [
      "sales",
      "marketing",
      "staging_crew",
      "designer",
    ] as const)
      await expect(
        f.c(role).mutation(api.inventory.receive, {
          product_id: f.product,
          location_id: f.location,
          quantity: 1,
          condition: "good",
          acquisition_date: day(),
          reason: "Unauthorized receipt",
        }),
      ).rejects.toThrow();
    expect(
      (await f.c("designer").query(api.inventory.product, { id: f.product }))
        .manage,
    ).toBe(false);
  });
  it("denies archived users even with a valid session", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const p = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", f.who("designer").id))
        .unique();
      await ctx.db.patch(p!._id, { deleted_at: new Date().toISOString() });
    });
    await expect(
      f.c("designer").query(api.inventory.options, {}),
    ).rejects.toThrow();
  });
  it("keeps project inventory scoped to assignments and rejects foreign rooms", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.project, {
        designer_id: null,
        staging_lead_id: null,
      });
    });
    for (const role of [
      "designer",
      "staging_crew",
      "sales",
      "marketing",
    ] as const)
      await expect(
        f
          .c(role)
          .query(api.inventory.projectInventory, { project_id: f.project }),
      ).rejects.toThrow();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.room, { deleted_at: new Date().toISOString() });
    });
    await expect(f.reserve(1)).rejects.toThrow();
  });
  it("prevents concurrent quantity overbooking and allows nonoverlapping windows", async () => {
    const f = await fixture();
    const outcomes = await Promise.allSettled([
      f.reserve(7, "2098-01-01", "2098-01-10"),
      f.reserve(6, "2098-01-01", "2098-01-10"),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await expect(
      f.reserve(10, "2098-01-11", "2098-01-20"),
    ).resolves.toBeTruthy();
    expect((await f.availability("2098-01-01", "2098-01-30")).available).toBe(
      0,
    );
  });
  it("blocks overlapping serialized bookings, same-day boundaries and retail removal", async () => {
    const f = await fixture("serialized");
    await f.reserve(1, "2098-01-01", "2098-01-10");
    await expect(f.reserve(1, "2098-01-10", "2098-01-20")).rejects.toThrow();
    await expect(
      f.reserve(1, "2098-01-11", "2098-01-20"),
    ).resolves.toBeTruthy();
    expect((await f.availability()).retail_available).toBe(0);
    await expect(
      f.owner.mutation(api.inventory.transferOrDispose, {
        product_id: f.product,
        asset_id: f.asset!,
        location_id: f.location,
        version: 1,
        quantity: 1,
        action: "sold",
        reason: "Cannot sell reserved asset",
      }),
    ).rejects.toThrow();
  });
  it("protects future reservations against quantity sales and corrections", async () => {
    const f = await fixture();
    await f.reserve(7, "2098-01-01", "2098-02-01");
    for (const action of ["sold", "adjustment"] as const)
      await expect(
        f.owner.mutation(api.inventory.transferOrDispose, {
          product_id: f.product,
          location_id: f.location,
          version: 1,
          quantity: 4,
          action,
          reason: "Invalid permanent reduction",
        }),
      ).rejects.toThrow();
    expect((await f.availability()).stock?.available).toBe(10);
  });
  it("splits partial quantities, keeps conservation and requires inspection after return", async () => {
    const f = await fixture();
    const r = await f.reserve(5);
    await f.stage("staging");
    const picked = await f.move(r, "pick", 3);
    expect((await f.getLine(r)).quantity).toBe(2);
    await f.move(picked, "install", 3);
    await f.stage("destaging");
    await f.move(picked, "destage", 3);
    await f.move(picked, "return", 3);
    expect((await f.availability()).stock).toMatchObject({
      available: 7,
      inspection: 3,
    });
    expect((await f.availability()).available).toBe(5);
    const cleaned = await f.inspect(picked, "cleaning", 1);
    expect((await f.availability()).stock?.cleaning).toBe(1);
    await f.inspect(cleaned!, "available", 1);
    await f.inspect(picked, "available", 2);
    expect((await f.availability()).stock).toMatchObject({
      available: 10,
      inspection: 0,
      cleaning: 0,
    });
    const movements = await f.t.run((ctx) =>
      ctx.db.query("inventory_movements").collect(),
    );
    const sums: Record<string, number> = {};
    for (const m of movements) {
      expect(m.actor_id).toBe(f.who("owner").id);
      for (const d of m.stock_deltas)
        sums[d.bucket] = (sums[d.bucket] ?? 0) + d.delta;
    }
    expect(sums).toMatchObject({ available: 10, inspection: 0, cleaning: 0 });
  });
  it("rejects stale and repeated picks without duplicate movement or negative balances", async () => {
    const f = await fixture();
    const r = await f.reserve(5);
    await f.stage("staging");
    const args = {
      id: r,
      version: 1,
      action: "pick" as const,
      quantity: 5,
      asset_confirmation: "",
      reason: "Concurrent pick",
    };
    const outcomes = await Promise.allSettled([
      f.owner.mutation(api.inventory.moveReservation, args),
      f.owner.mutation(api.inventory.moveReservation, args),
    ]);
    expect(outcomes.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await f.availability()).stock?.available).toBe(5);
  });
  it("confirms serialized identity and blocks standalone inspection bypass", async () => {
    const f = await fixture("serialized");
    const r = await f.reserve(1);
    await f.stage("staging");
    await expect(
      f.owner.mutation(api.inventory.moveReservation, {
        id: r,
        version: 1,
        action: "pick",
        quantity: 1,
        asset_confirmation: "GLA-WRONG",
        reason: "Wrong identity",
      }),
    ).rejects.toThrow();
    await f.move(r, "pick");
    await f.move(r, "return");
    const a = await f.owner.query(api.inventory.asset, { id: f.asset! });
    await expect(
      f.owner.mutation(api.inventory.inspect, {
        asset_id: f.asset!,
        product_id: f.product,
        location_id: f.location,
        version: a.version,
        quantity: 1,
        from_state: "inspection",
        result: "available",
        condition: "good",
        notes: "Attempted bypass",
      }),
    ).rejects.toThrow();
    await f.inspect(r, "available");
    expect((await f.availability()).available).toBe(1);
  });
  it("records missing stock explicitly, found stock enters inspection, and crew cannot waive gates", async () => {
    const f = await fixture();
    const r = await f.reserve(2);
    await f.move(r, "missing", 2);
    expect((await f.availability()).stock).toMatchObject({
      available: 8,
      missing: 2,
    });
    const line = await f.getLine(r);
    await expect(
      f.c("staging_crew").mutation(api.inventory.moveReservation, {
        id: r,
        version: line.version,
        action: "exception",
        quantity: 2,
        reason: "Cannot waive own exception",
        asset_confirmation: "",
      }),
    ).rejects.toThrow();
    expect(
      (await f.owner.query(api.inventory.exceptions, {})).some(
        (x) => x.id === r,
      ),
    ).toBe(true);
    await f.move(r, "found", 2);
    expect((await f.availability()).stock).toMatchObject({
      available: 8,
      missing: 0,
      inspection: 2,
    });
    await f.inspect(r, "available", 2);
  });
  it("protects room archive and project cancellation while inventory is allocated", async () => {
    const f = await fixture();
    const r = await f.reserve(2);
    await expect(f.advance(f.project, "cancelled")).rejects.toThrow();
    await expect(
      f.owner.mutation(api.inventory.archiveProduct, {
        id: f.product,
        version: 1,
        archive: true,
      }),
    ).rejects.toThrow();
    await f.move(r, "release", 2);
    expect((await f.getLine(r)).active).toBe(false);
  });
});
