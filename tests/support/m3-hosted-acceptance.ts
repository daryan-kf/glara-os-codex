import assert from "node:assert/strict";
import { writeFileSync, mkdirSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import { operationsClient, wonFixture } from "./operations-fixture";
import { acceptanceDate } from "./acceptance-date";
import { day } from "../../src/lib/operations/model";
async function main() {
  const eventDay = acceptanceDate("GLARA_M3_EVENT_DAY", day());
  const owner = await operationsClient(),
    f = await wonFixture(owner.client),
    c = owner.client,
    results: { name: string; passed: boolean }[] = [];
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
  const p = await c.mutation(api.operations.create, f.createArgs),
    id = p.id,
    get = () => c.query(api.operations.get, { id });
  const advance = async (
    status: Parameters<
      typeof c.mutation<typeof api.operations.transition>
    >[1]["status"],
    date?: string,
  ) =>
    c.mutation(api.operations.transition, {
      id,
      version: (await get()).version,
      status,
      date,
    });
  const complete = async (category: string) => {
    for (const item of (await get()).checklist.filter(
      (x) => x.category === category && x.required && x.status !== "completed",
    ))
      await c.mutation(api.operations.checklist, {
        id: item._id,
        version: item.version,
        status: "completed",
      });
  };
  await check(
    "won handoff derives property and Realtor and retains accepted quote",
    async () => {
      const row = await get();
      assert.equal(row.source?.property_id, f.property);
      assert.equal(row.source?.realtor_id, f.realtor.id);
      assert.equal(row.source?.source_quote_id, f.quote);
    },
  );
  await check("duplicate creation returns original project", async () => {
    const values = await Promise.all(
      [1, 2].map(() => c.mutation(api.operations.create, f.createArgs)),
    );
    assert.ok(values.every((v) => v.id === id && v.existing));
  });
  await check("anonymous project read denied", () =>
    assert.rejects(
      new ConvexHttpClient(owner.url, { logger: false }).query(
        api.operations.get,
        { id },
      ),
    ),
  );
  for (const role of ["designer", "staging_crew", "sales"]) {
    const { client } = await operationsClient(role);
    await check(
      role +
        " operational projection excludes commercial and private manager data",
      async () => {
        const data = JSON.stringify(
          await client.query(api.operations.get, { id }),
        );
        assert.doesNotMatch(data, /PRIVATE|subtotal|discount|seller_name/);
        await assert.rejects(
          client.mutation(api.operations.update, {
            id,
            version: (await get()).version,
            input: f.createArgs.input,
          }),
        );
      },
    );
  }
  for (const role of ["marketing", "unassigned", "archived"]) {
    const { client } = await operationsClient(role);
    await check(role + " cannot access planning project", () =>
      assert.rejects(client.query(api.operations.get, { id })),
    );
  }
  await check(
    "restricted access is absent from generic reads and audit",
    async () => {
      await c.mutation(api.operations.saveAccess, {
        id,
        version: 0,
        input: JSON.stringify({
          access_type: "concierge",
          instructions: "Fictional only",
          sensitive_access_code: "FICTIONAL-ACCESS-ONLY",
        }),
      });
      assert.doesNotMatch(JSON.stringify(await get()), /FICTIONAL-ACCESS/);
      const timeline = await c.query(api.operations.timeline, {
        id,
        kind: "audit",
        paginationOpts: { numItems: 25, cursor: null },
      });
      assert.doesNotMatch(JSON.stringify(timeline), /FICTIONAL-ACCESS/);
      const designer = await operationsClient("designer");
      await assert.rejects(
        designer.client.query(api.operations.accessDetails, { id }),
      );
    },
  );
  await advance("designing");
  await check("required preparation blocks readiness", () =>
    assert.rejects(advance("ready_to_schedule")),
  );
  await complete("pre_staging");
  await advance("ready_to_schedule");
  await check("stale project versions rejected", () =>
    assert.rejects(
      c.mutation(api.operations.update, {
        id,
        version: 1,
        input: f.createArgs.input,
      }),
    ),
  );
  const schedule = async (
    type: "staging" | "destaging",
    preferredHour: number,
  ) => {
    for (let hour = preferredHour; hour <= 22; hour++) {
      try {
        return await c.mutation(api.operations.schedule, {
          project_id: id,
          project_version: (await get()).version,
          version: 0,
          event_type: type,
          title: "Fictional " + type,
          description: "",
          location_note: "",
          start_at: eventDay + "T" + hour + ":00:00Z",
          end_at: eventDay + "T" + (hour + 1) + ":00:00Z",
          assigned_lead_id: f.createArgs.staging_lead_id,
        });
      } catch (error) {
        if (!(
          error &&
          typeof error === "object" &&
          "data" in error &&
          error.data &&
          typeof error.data === "object" &&
          "code" in error.data &&
          error.data.code === "SCHEDULE_CONFLICT"
        ))
          throw error;
      }
    }
    throw Error("No fictional acceptance slot available today");
  };
  // Fictional work uses a short interval; terminal transitions release active queues.
  await check(
    "schedule creates canonical staging date and detects overlap",
    async () => {
      await schedule("staging", 16);
      assert.ok((await get()).staging_date);
      await assert.rejects(
        c.mutation(api.operations.schedule, {
          project_id: id,
          project_version: (await get()).version,
          version: 0,
          event_type: "walkthrough",
          title: "Conflict",
          description: "",
          location_note: "",
          start_at: new Date(
            Date.parse((await get()).staging_date!) + 30 * 60000,
          ).toISOString(),
          end_at: new Date(
            Date.parse((await get()).staging_date!) + 90 * 60000,
          ).toISOString(),
          assigned_lead_id: f.createArgs.staging_lead_id,
        }),
      );
    },
  );
  await check(
    "staged transition requires walkthrough and staging checklist",
    async () => {
      await advance("staging");
      await assert.rejects(advance("staged"));
      await complete("staging");
      await advance("staged");
    },
  );
  await check(
    "marketing receives only content-stage safe projection",
    async () => {
      const marketing = await operationsClient("marketing"),
        row = await marketing.client.query(api.operations.get, { id });
      assert.equal(row.source, null);
      assert.equal(row.team, null);
      assert.equal(row.checklist.length, 0);
      assert.doesNotMatch(JSON.stringify(row), /PRIVATE|FICTIONAL-ACCESS/);
    },
  );
  await check(
    "sold requires explicit destaging, completion gates preserve quote terms",
    async () => {
      await advance("sold", eventDay);
      assert.ok(
        (await get()).attention_reasons.includes(
          "Destaging needs to be scheduled",
        ),
      );
      const before = await c.query(api.sales.getQuote, { id: f.quote });
      await schedule("destaging", 18);
      await complete("destaging");
      await advance("destaging");
      await advance("completed");
      assert.deepEqual(
        await c.query(api.sales.getQuote, { id: f.quote }),
        before,
      );
      await assert.rejects(
        c.mutation(api.operations.update, {
          id,
          version: (await get()).version,
          input: f.createArgs.input,
        }),
      );
    },
  );
  const final = await get();
  if (!["completed", "cancelled"].includes(final.status))
    await c.mutation(api.operations.transition, {
      id,
      version: final.version,
      status: "cancelled",
      reason: "Fictional acceptance cleanup",
    });
  await c.mutation(api.operations.archive, {
    id,
    version: (await get()).version,
    restore: false,
  });
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/m3-hosted-api.json",
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
    `${results.filter((r) => r.passed).length}/${results.length} M3 hosted checks passed`,
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "M3 acceptance could not finish; inspect deployment and fictional fixture setup.",
  );
  process.exitCode = 1;
});
