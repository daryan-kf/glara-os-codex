import { expect, it } from "vitest";
import { operationsFixture } from "../support/operations-unit-fixture";
import { api } from "../../convex/_generated/api";
it("current Sales assignment governs CRM, nested activities and Sales direct IDs across reassignment", async () => {
  const f = await operationsFixture(),
    owner = f.c("owner"),
    sales = f.c("sales");
  const rid = f.r
    .id as import("../../convex/_generated/dataModel").Id<"realtors">;
  const original = await f.t.run((ctx) => ctx.db.get(rid));
  expect(original).toBeTruthy();
  await f.t.run(async (ctx) => {
    await ctx.db.patch(rid, { assigned_to: f.who("owner").id });
    await ctx.db.patch(f.oid, { assigned_to: f.who("owner").id });
  });
  expect(
    await sales.query(api.crm.read, {
      input: JSON.stringify({ op: "detail", id: rid }),
    }),
  ).toBeNull();
  expect(
    await sales.query(api.crm.read, {
      input: JSON.stringify({ op: "activities", id: rid }),
    }),
  ).toMatchObject({ rows: [] });
  const list = await sales.query(api.crm.read, {
    input: JSON.stringify({ op: "list", assigned_to: f.who("owner").id }),
  });
  expect(JSON.stringify(list)).not.toContain(rid);
  expect(await sales.query(api.sales.getOpportunity, { id: f.oid })).toBeNull();
  expect(await sales.query(api.sales.getProperty, { id: f.pid })).toBeNull();
  await expect(
    sales.mutation(api.crm.write, {
      input: JSON.stringify({
        op: "realtor_archive",
        id: rid,
        version: original!.version,
      }),
    }),
  ).rejects.toThrow("UNAVAILABLE");
  await expect(
    sales.mutation(api.sales.transition, {
      id: f.oid,
      version: 1,
      input: JSON.stringify({
        stage: "contacted",
        next_action_title: "Fictional followup",
        next_action_date: "2099-01-01T00:00:00Z",
      }),
    }),
  ).rejects.toThrow();
  const pipeline = await sales.query(api.sales.pipeline, {});
  expect(pipeline.every((x) => x.rows.length === 0 && x.totals === null)).toBe(
    true,
  );
  expect((await sales.query(api.sales.summary, {})).open_count).toBe(0);
  expect(
    await owner.query(api.sales.getOpportunity, { id: f.oid }),
  ).toBeTruthy();
  await f.t.run(async (ctx) => {
    await ctx.db.patch(rid, { assigned_to: f.who("sales").id });
    await ctx.db.patch(f.oid, { assigned_to: f.who("sales").id });
  });
  expect(
    await sales.query(api.crm.read, {
      input: JSON.stringify({ op: "detail", id: rid }),
    }),
  ).toBeTruthy();
  expect(
    await sales.query(api.sales.getOpportunity, { id: f.oid }),
  ).toBeTruthy();
});
