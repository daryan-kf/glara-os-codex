import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { operationsClient, wonFixture } from "./operations-fixture";
import { day } from "../../src/lib/operations/model";
async function main() {
  const eventDay = process.env.GLARA_M4_EVENT_DAY ?? day();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDay) || eventDay > day())
    throw Error("Invalid fictional event day");
  const { client: c, url } = await operationsClient(),
    suffix = randomUUID().slice(0, 8),
    f = await wonFixture(c),
    f2 = await wonFixture(c);
  const p = (
      await c.mutation(api.operations.create, f.createArgs, { skipQueue: true })
    ).id,
    p2 = (
      await c.mutation(api.operations.create, f2.createArgs, {
        skipQueue: true,
      })
    ).id;
  const get = () => c.query(api.operations.get, { id: p }),
    room = (await get()).rooms[0]._id,
    room2 = (await c.query(api.operations.get, { id: p2 })).rooms[0]._id;
  const category = await c.mutation(
      api.inventory.saveCategory,
      {
        version: 0,
        name: `Fictional M4 ${suffix}`,
        active: true,
      },
      { skipQueue: true },
    ),
    location = await c.mutation(
      api.inventory.saveLocation,
      {
        version: 0,
        input: JSON.stringify({
          name: `Fictional warehouse ${suffix}`,
          type: "warehouse",
          address: "Fictional acceptance",
          active: true,
          staging_source: true,
          retail_source: true,
        }),
      },
      { skipQueue: true },
    );
  const product = await c.mutation(
    api.inventory.saveProduct,
    {
      version: 0,
      category_id: category,
      input: JSON.stringify({
        sku: `M4-Q-${suffix}`,
        name: `Fictional pillows ${suffix}`,
        track_mode: "quantity",
        active: true,
        staging_eligible: true,
        retail_eligible: true,
      }),
    },
    { skipQueue: true },
  );
  const serialized = await c.mutation(
    api.inventory.saveProduct,
    {
      version: 0,
      category_id: category,
      input: JSON.stringify({
        sku: `M4-A-${suffix}`,
        name: `Fictional chair ${suffix}`,
        track_mode: "serialized",
        active: true,
        staging_eligible: true,
        retail_eligible: true,
      }),
    },
    { skipQueue: true },
  );
  await c.mutation(
    api.inventory.receive,
    {
      product_id: product,
      location_id: location,
      quantity: 10,
      condition: "good",
      acquisition_date: day(),
      reason: "Fictional M4 acceptance receipt",
    },
    { skipQueue: true },
  );
  const asset = (await c.mutation(
    api.inventory.receive,
    {
      product_id: serialized,
      location_id: location,
      quantity: 1,
      condition: "good",
      acquisition_date: day(),
      reason: "Fictional M4 acceptance receipt",
    },
    { skipQueue: true },
  ))!;
  const results: { name: string; passed: boolean }[] = [];
  const check = async (name: string, fn: () => Promise<unknown>) => {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log("PASS " + name);
    } catch {
      results.push({ name, passed: false });
      console.log("FAIL " + name);
    }
  };
  const available = () =>
    c.query(api.inventory.availability, {
      product_id: product,
      location_id: location,
      needed_from: day(),
      needed_until: "2099-01-01",
    });
  const reserve = (count: number, project = p, roomId = room) =>
    c.mutation(
      api.inventory.reserve,
      {
        project_id: project,
        project_room_id: roomId,
        product_id: product,
        location_id: location,
        quantity: count,
        needed_from: day(),
        needed_until: "2099-01-01",
        notes: "Fictional acceptance",
        planned: false,
      },
      { skipQueue: true },
    );
  const lines = (id = p) =>
    c.query(api.inventory.projectInventory, { project_id: id });
  const row = async (id: Id<"inventory_reservations">) =>
    (await lines()).lines.find((r) => r._id === id)!;
  const move = async (
    id: Id<"inventory_reservations">,
    action: Parameters<
      typeof c.mutation<typeof api.inventory.moveReservation>
    >[1]["action"],
    count = 1,
  ) => {
    const r = await row(id);
    return c.mutation(
      api.inventory.moveReservation,
      {
        id,
        version: r.version,
        action,
        quantity: count,
        asset_confirmation: r.asset_number ?? "",
        location_id: location,
        reason: "Fictional M4 acceptance movement",
      },
      { skipQueue: true },
    );
  };
  const advance = async (
    status: Parameters<
      typeof c.mutation<typeof api.operations.transition>
    >[1]["status"],
    date?: string,
  ) =>
    c.mutation(
      api.operations.transition,
      {
        id: p,
        version: (await get()).version,
        status,
        date,
      },
      { skipQueue: true },
    );
  const complete = async (category: string) => {
    for (const item of (await get()).checklist.filter(
      (x) => x.category === category && x.required && x.status !== "completed",
    ))
      await c.mutation(
        api.operations.checklist,
        {
          id: item._id,
          version: item.version,
          status: "completed",
        },
        { skipQueue: true },
      );
  };
  const schedule = async (type: "staging" | "destaging", start = 10) => {
    for (let hour = start; hour < 22; hour++) {
      try {
        return await c.mutation(
          api.operations.schedule,
          {
            project_id: p,
            project_version: (await get()).version,
            version: 0,
            event_type: type,
            title: "Fictional M4 " + type,
            description: "",
            location_note: "",
            start_at: eventDay + `T${String(hour).padStart(2, "0")}:00:00Z`,
            end_at: eventDay + `T${String(hour + 1).padStart(2, "0")}:00:00Z`,
            assigned_lead_id: f.createArgs.staging_lead_id!,
          },
          { skipQueue: true },
        );
      } catch (e) {
        const code = (e as { data?: { code?: string } }).data?.code;
        if (code !== "SCHEDULE_CONFLICT") throw e;
      }
    }
    throw Error("No fictional schedule slot");
  };
  await check("anonymous inventory reads denied", () =>
    assert.rejects(
      new ConvexHttpClient(url, { logger: false }).query(
        api.inventory.product,
        { id: product },
      ),
    ),
  );
  for (const role of [
    "sales",
    "marketing",
    "staging_crew",
    "unassigned",
    "archived",
  ]) {
    const { client } = await operationsClient(role);
    await check(role + " cannot read the inventory catalog", () =>
      assert.rejects(client.query(api.inventory.product, { id: product })),
    );
  }
  const { client: designer } = await operationsClient("designer"),
    { client: crew } = await operationsClient("staging_crew");
  await check(
    "assigned designer has nonfinancial inventory access and no stock write privilege",
    async () => {
      const data = await designer.query(api.inventory.product, { id: product });
      assert.equal(data.manage, false);
      assert.doesNotMatch(
        JSON.stringify(data),
        /acquisition_cost|PRIVATE|discount|seller_name/,
      );
      await assert.rejects(
        designer.mutation(
          api.inventory.receive,
          {
            product_id: product,
            location_id: location,
            quantity: 1,
            condition: "good",
            acquisition_date: day(),
            reason: "Forbidden receipt",
          },
          { skipQueue: true },
        ),
      );
    },
  );
  await check(
    "assigned crew can read project pick lists without commercial fields",
    async () => {
      const data = await crew.query(api.inventory.projectInventory, {
        project_id: p,
      });
      assert.doesNotMatch(
        JSON.stringify(data),
        /PRIVATE|discount|seller_name|source_quote/,
      );
    },
  );
  await check(
    "concurrent reservations on different projects cannot exceed stock",
    async () => {
      const outcomes = await Promise.allSettled([
        reserve(7),
        reserve(6, p2, room2),
      ]);
      assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
      for (const project of [p, p2])
        for (const r of (await lines(project)).lines)
          if (r.active)
            await c.mutation(
              api.inventory.moveReservation,
              {
                id: r._id,
                version: r.version,
                action: "release",
                quantity: r.quantity,
                asset_confirmation: "",
                reason: "Fictional concurrency cleanup",
              },
              { skipQueue: true },
            );
    },
  );
  await check(
    "SKU normalization and uniqueness enforced server-side",
    async () => {
      await assert.rejects(
        c.mutation(
          api.inventory.saveProduct,
          {
            version: 0,
            category_id: category,
            input: JSON.stringify({
              sku: ` m4-q-${suffix} `,
              name: "Duplicate",
              track_mode: "quantity",
              active: true,
              staging_eligible: true,
              retail_eligible: true,
            }),
          },
          { skipQueue: true },
        ),
      );
    },
  );
  let serializedLine: Id<"inventory_reservations">;
  await check(
    "serialized date overlap and inclusive boundary protection",
    async () => {
      serializedLine = await c.mutation(
        api.inventory.reserve,
        {
          project_id: p,
          project_room_id: room,
          product_id: serialized,
          asset_id: asset,
          location_id: location,
          quantity: 1,
          needed_from: day(),
          needed_until: "2098-01-10",
          notes: "",
          planned: false,
        },
        { skipQueue: true },
      );
      await assert.rejects(
        c.mutation(
          api.inventory.reserve,
          {
            project_id: p2,
            project_room_id: room2,
            product_id: serialized,
            asset_id: asset,
            location_id: location,
            quantity: 1,
            needed_from: "2098-01-10",
            needed_until: "2098-02-01",
            notes: "",
            planned: false,
          },
          { skipQueue: true },
        ),
      );
    },
  );
  await check(
    "nonoverlapping future asset reservation is accepted",
    async () => {
      const r = await c.mutation(
        api.inventory.reserve,
        {
          project_id: p2,
          project_room_id: room2,
          product_id: serialized,
          asset_id: asset,
          location_id: location,
          quantity: 1,
          needed_from: "2098-01-11",
          needed_until: "2098-02-01",
          notes: "",
          planned: false,
        },
        { skipQueue: true },
      );
      await c.mutation(
        api.inventory.moveReservation,
        {
          id: r,
          version: 1,
          action: "release",
          quantity: 1,
          asset_confirmation: "",
          reason: "Fictional future booking cleanup",
        },
        { skipQueue: true },
      );
    },
  );
  await check("reserved asset cannot be sold", () =>
    assert.rejects(
      c.mutation(
        api.inventory.transferOrDispose,
        {
          product_id: serialized,
          asset_id: asset,
          location_id: location,
          version: 1,
          quantity: 1,
          action: "sold",
          reason: "Must be denied",
        },
        { skipQueue: true },
      ),
    ),
  );
  await check(
    "hosted SKU and asset global search enforce role isolation",
    async () => {
      assert.equal(
        (await c.query(api.inventory.search, { q: `M4-Q-${suffix}` }))[0].kind,
        "Product",
      );
      const a = await c.query(api.inventory.asset, { id: asset });
      assert.equal(
        (await crew.query(api.inventory.search, { q: a.asset_number }))[0].kind,
        "Asset",
      );
      const { client: marketing } = await operationsClient("marketing");
      await assert.rejects(
        marketing.query(api.inventory.search, { q: a.asset_number }),
      );
    },
  );
  await check(
    "direct inventory mutation attacks are rejected for restricted roles",
    async () => {
      for (const role of [
        "marketing",
        "sales",
        "designer",
        "staging_crew",
        "archived",
        "unassigned",
      ]) {
        const { client } = await operationsClient(role);
        await assert.rejects(
          client.mutation(
            api.inventory.transferOrDispose,
            {
              product_id: product,
              location_id: location,
              version: (await available()).stock!.version,
              quantity: 1,
              action: "retired",
              reason: "Forbidden direct mutation",
            },
            { skipQueue: true },
          ),
        );
      }
      await assert.rejects(
        c.mutation(
          api.inventory.reserve,
          {
            project_id: p,
            project_room_id: room2,
            product_id: product,
            location_id: location,
            quantity: 1,
            needed_from: day(),
            needed_until: day(),
            notes: "Foreign room attack",
            planned: false,
          },
          { skipQueue: true },
        ),
      );
      assert.equal((await available()).stock!.available, 10);
    },
  );
  await check(
    "hosted concurrent serialized transfers preserve one location and identity",
    async () => {
      const tempAsset = (await c.mutation(
        api.inventory.receive,
        {
          product_id: serialized,
          location_id: location,
          quantity: 1,
          condition: "good",
          acquisition_date: day(),
          reason: "Fictional transfer test",
        },
        { skipQueue: true },
      ))!;
      const dest = await c.mutation(
        api.inventory.saveLocation,
        {
          version: 0,
          input: JSON.stringify({
            name: `Fictional transfer ${suffix}`,
            type: "warehouse",
            address: "Fictional",
            active: true,
            staging_source: true,
            retail_source: true,
          }),
        },
        { skipQueue: true },
      );
      const a = await c.query(api.inventory.asset, { id: tempAsset });
      const args = {
        product_id: serialized,
        asset_id: tempAsset,
        location_id: location,
        to_location_id: dest,
        version: a.version,
        quantity: 1,
        action: "transfer" as const,
        reason: "Fictional competing transfers",
      };
      const results = await Promise.allSettled([
        c.mutation(api.inventory.transferOrDispose, args, { skipQueue: true }),
        c.mutation(api.inventory.transferOrDispose, args, { skipQueue: true }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      const after = await c.query(api.inventory.asset, { id: tempAsset });
      assert.equal(after.location_id, dest);
      assert.equal(after.asset_number, a.asset_number);
      await c.mutation(
        api.inventory.holdStock,
        {
          product_id: serialized,
          asset_id: tempAsset,
          location_id: dest,
          version: after.version,
          quantity: 1,
          action: "inspection_hold",
          reason: "Fictional concurrency inspection",
        },
        { skipQueue: true },
      );
      const held = await c.query(api.inventory.asset, { id: tempAsset });
      const decisions = await Promise.allSettled(
        (["available", "repair"] as const).map((result) =>
          c.mutation(
            api.inventory.inspect,
            {
              product_id: serialized,
              asset_id: tempAsset,
              location_id: dest,
              version: held.version,
              quantity: 1,
              from_state: "inspection",
              result,
              condition: "good",
              notes: "Fictional competing inspection",
            },
            { skipQueue: true },
          ),
        ),
      );
      assert.equal(decisions.filter((r) => r.status === "fulfilled").length, 1);
      const final = await c.query(api.inventory.asset, { id: tempAsset });
      if (final.status === "repair")
        await c.mutation(
          api.inventory.inspect,
          {
            product_id: serialized,
            asset_id: tempAsset,
            location_id: dest,
            version: final.version,
            quantity: 1,
            from_state: "repair",
            result: "available",
            condition: "good",
            notes: "Fictional repair complete",
          },
          { skipQueue: true },
        );
    },
  );
  const reservation = await reserve(5);
  await advance("designing");
  await complete("pre_staging");
  await advance("ready_to_schedule");
  await schedule("staging");
  await advance("staging");
  await check(
    "incorrect asset identity is rejected before picking",
    async () => {
      const r = await row(serializedLine);
      await assert.rejects(
        c.mutation(
          api.inventory.moveReservation,
          {
            id: r._id,
            version: r.version,
            action: "pick",
            quantity: 1,
            asset_confirmation: "GLA-WRONG",
            reason: "Wrong identity",
          },
          { skipQueue: true },
        ),
      );
    },
  );
  await check(
    "partial pick preserves remaining quantity and rejects stale replay",
    async () => {
      const version = (await row(reservation)).version;
      const picked = await move(reservation, "pick", 3);
      assert.equal((await row(reservation)).quantity, 2);
      assert.equal((await available()).stock?.available, 7);
      await assert.rejects(
        c.mutation(
          api.inventory.moveReservation,
          {
            id: reservation,
            version,
            action: "pick",
            quantity: 3,
            asset_confirmation: "",
            reason: "Stale replay",
          },
          { skipQueue: true },
        ),
      );
      await move(picked, "install", 3);
    },
  );
  await move(reservation, "release", 2);
  await move(serializedLine!, "pick");
  await move(serializedLine!, "install");
  await complete("staging");
  await advance("staged");
  await check(
    "explicit installation updates asset whereabouts and staging use count",
    async () => {
      const a = await c.query(api.inventory.asset, { id: asset });
      assert.equal(a.status, "staged");
      assert.equal(a.project_id, p);
      assert.equal(a.location_id, null);
      assert.equal(a.staging_use_count, 1);
    },
  );
  await advance("listing_live", eventDay);
  await advance("sold", eventDay);
  await schedule("destaging", 12);
  await complete("destaging");
  await advance("destaging");
  await check(
    "destaging receipts enter inspection and remain unavailable",
    async () => {
      for (const r of (await lines()).lines.filter(
        (x) => x.state === "installed",
      )) {
        await move(r._id, "destage", r.quantity);
        if (r.asset_id) {
          const live = await row(r._id);
          await c.mutation(
            api.inventory.moveReservation,
            {
              id: r._id,
              version: live.version,
              action: "return",
              return_outcome: "damaged",
              quantity: 1,
              asset_confirmation: r.asset_number!,
              location_id: location,
              reason: "Fictional damaged return",
            },
            { skipQueue: true },
          );
        } else {
          await move(r._id, "return", r.quantity - 1);
          await move(r._id, "missing", 1);
        }
      }
      assert.equal((await available()).stock?.inspection, 2);
      assert.equal((await available()).stock?.missing, 1);
      assert.equal((await available()).stock?.available, 7);
      await assert.rejects(advance("completed"));
    },
  );
  await check("project cannot archive while care holds remain", async () => {
    await assert.rejects(
      c.mutation(
        api.operations.archive,
        {
          id: p,
          version: (await get()).version,
          restore: false,
        },
        { skipQueue: true },
      ),
    );
  });
  await check(
    "owner reconciles missing stock and repairs damaged returns before completing the project",
    async () => {
      for (const r of (await lines()).lines.filter(
        (x) => x.state === "missing",
      ))
        await move(r._id, "found", r.quantity);
      const damagedAsset = await c.query(api.inventory.asset, { id: asset });
      assert.equal(damagedAsset.condition, "damaged");
      const ar = await row(serializedLine!);
      await c.mutation(
        api.inventory.inspect,
        {
          reservation_id: ar._id,
          asset_id: asset,
          product_id: serialized,
          location_id: location,
          version: ar.version,
          quantity: 1,
          from_state: "inspection",
          result: "repair",
          condition: "damaged",
          notes: "Fictional repair assessment",
        },
        { skipQueue: true },
      );
      assert.equal(
        (await c.query(api.inventory.asset, { id: asset })).status,
        "repair",
      );
      for (const r of (await lines()).lines.filter((x) =>
        ["inspection", "repair"].includes(x.state),
      ))
        await c.mutation(
          api.inventory.inspect,
          {
            reservation_id: r._id,
            asset_id: r.asset_id ?? undefined,
            product_id: r.product_id,
            location_id: location,
            version: r.version,
            quantity: r.quantity,
            from_state: r.state as "inspection" | "repair",
            result: "available",
            condition: "good",
            notes: "Fictional final inspection",
          },
          { skipQueue: true },
        );
      assert.equal((await available()).stock?.available, 10);
      assert.equal(
        (await c.query(api.inventory.asset, { id: asset })).status,
        "available",
      );
    },
  );
  await check(
    "ledger is append-only, conserves quantity, and attributes authenticated actor",
    async () => {
      let cursor: string | null = null,
        done = false,
        total = 0;
      while (!done) {
        const h: import("convex/server").FunctionReturnType<
          typeof api.inventory.history
        > = await c.query(api.inventory.history, {
          product_id: product,
          paginationOpts: { cursor, numItems: 20 },
        });
        for (const m of h.page) {
          assert.ok(m.actor_id);
          for (const d of m.stock_deltas)
            if (d.bucket === "available") total += d.delta;
        }
        cursor = h.continueCursor;
        done = h.isDone;
      }
      assert.equal(total, 10);
    },
  );
  await advance("completed");
  await check("archival preserves project inventory history", async () => {
    await c.mutation(
      api.operations.archive,
      {
        id: p,
        version: (await get()).version,
        restore: false,
      },
      { skipQueue: true },
    );
    assert.ok((await lines()).lines.length);
  });
  const cancelledReservation = await reserve(2, p2, room2);
  const other = await c.query(api.operations.get, { id: p2 });
  await c.mutation(
    api.operations.transition,
    {
      id: p2,
      version: other.version,
      status: "cancelled",
      reason: "Fictional M4 cleanup",
    },
    { skipQueue: true },
  );
  await check(
    "cancelling an unpicked project releases its stock automatically",
    async () => {
      assert.equal(
        (await lines(p2)).lines.find((r) => r._id === cancelledReservation)
          ?.state,
        "released",
      );
      assert.equal((await available()).available, 10);
    },
  );
  await c.mutation(
    api.operations.archive,
    {
      id: p2,
      version: (await c.query(api.operations.get, { id: p2 })).version,
      restore: false,
    },
    { skipQueue: true },
  );
  // Fictional stock remains visible, labelled clearly, as a reviewable acceptance example.
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/m4-hosted-api.json",
    JSON.stringify(
      {
        deployment: "woozy-jaguar-392",
        executedAt: new Date().toISOString(),
        results,
      },
      null,
      2,
    ),
  );
  console.log(
    `${results.filter((r) => r.passed).length}/${results.length} M4 hosted checks passed`,
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
main().catch((e) => {
  const code = (e as { data?: { code?: string } }).data?.code;
  console.error(
    "M4 hosted acceptance could not finish" + (code ? ": " + code : ""),
  );
  process.exitCode = 1;
});
