import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { operationsClient, wonFixture } from "./operations-fixture";
import { credentials } from "./identities";
import { api } from "../../convex/_generated/api";
import { makeFunctionReference } from "convex/server";
import type { Id } from "../../convex/_generated/dataModel";
import { z } from "zod";
const results: { scenario: string; passed: boolean }[] = [];
async function check(scenario: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ scenario, passed: true });
  } catch {
    results.push({ scenario, passed: false });
  } finally {
    writeFileSync(
      ".acceptance/m10/hosted-record-security.json",
      JSON.stringify(
        {
          executed_at: new Date().toISOString(),
          deployment: "woozy-jaguar-392",
          production_mutations: 0,
          provider_calls: 0,
          results,
        },
        null,
        2,
      ),
    );
  }
}
async function main() {
  assert.equal(process.env.GLARA_M10_ACCEPTANCE, "yes");
  const { client: owner } = await operationsClient(),
    { client: sales } = await operationsClient("sales"),
    { client: marketing } = await operationsClient("marketing"),
    { client: crew } = await operationsClient("staging_crew");
  const marker = "FictionalM10" + randomUUID().slice(0, 8),
    read = (c: typeof owner, input: object) =>
      c.query(api.crm.read, { input: JSON.stringify(input) }),
    write = (input: object) =>
      owner.mutation(api.crm.write, { input: JSON.stringify(input) });
  const data = {
    first_name: marker,
    last_name: "Record boundary",
    relationship_status: "active_partner",
    assigned_to: credentials("sales").id,
    notes: "PRIVATE M10 RELATIONSHIP",
  };
  const realtor = await write({ op: "realtor_create", data });
  await check(
    "Marketing DTO excludes private relationship notes and nested history",
    async () => {
      const view = JSON.stringify(
        await read(marketing, { op: "detail", id: realtor.id }),
      );
      assert(!view.includes("PRIVATE M10"));
      await assert.rejects(() =>
        read(marketing, { op: "activities", id: realtor.id }),
      );
    },
  );
  await check(
    "Optimistic Realtor update permits exactly one same-version winner",
    async () => {
      const before = z
        .object({ version: z.number() })
        .parse(await read(owner, { op: "detail", id: realtor.id }));
      const writes = await Promise.allSettled(
        [1, 2].map((n) =>
          write({
            op: "realtor_update",
            id: realtor.id,
            version: before.version,
            data: { ...data, last_name: "Concurrent " + n },
          }),
        ),
      );
      assert.equal(writes.filter((x) => x.status === "fulfilled").length, 1);
    },
  );
  await check(
    "Current assignment immediately revokes existing Sales token and nested CRM access",
    async () => {
      assert(await read(sales, { op: "detail", id: realtor.id }));
      const before = z
        .object({ version: z.number() })
        .parse(await read(owner, { op: "detail", id: realtor.id }));
      await write({
        op: "realtor_update",
        id: realtor.id,
        version: before.version,
        data: { ...data, assigned_to: credentials("owner").id },
      });
      assert.equal(await read(sales, { op: "detail", id: realtor.id }), null);
      assert.deepEqual(
        z
          .object({ rows: z.array(z.unknown()) })
          .parse(await read(sales, { op: "activities", id: realtor.id })).rows,
        [],
      );
      await assert.rejects(() =>
        sales.mutation(api.crm.write, {
          input: JSON.stringify({
            op: "realtor_archive",
            id: realtor.id,
            version: before.version + 1,
          }),
        }),
      );
    },
  );
  await check(
    "Direct backend caller cannot invoke internal administration or migration",
    async () => {
      for (const name of [
        "admin:setProfile",
        "migration:apply",
        "authSecurity:eligible",
      ])
        await assert.rejects(() =>
          sales.mutation(makeFunctionReference<"mutation">(name), {}),
        );
    },
  );
  const property = await owner.mutation(api.sales.saveProperty, {
    version: 0,
    input: JSON.stringify({
      address_line_1: marker + " Crescent",
      city: "Vancouver",
      province: "BC",
      property_type: "detached",
      occupancy_status: "vacant",
      realtor_id: realtor.id,
      seller_name: "PRIVATE M10 SELLER",
    }),
  });
  const opportunity = await owner.mutation(api.sales.saveOpportunity, {
    version: 0,
    input: JSON.stringify({
      property_id: property,
      assigned_to: credentials("owner").id,
      estimated_value: "1000",
      probability: 10,
      next_action_title: "Fictional action",
      next_action_date: "2099-01-01T18:00:00Z",
    }),
  });
  await check(
    "Unassigned Sales cannot dereference commercial parent IDs or spoof owner filters",
    async () => {
      assert.equal(
        await sales.query(api.sales.getOpportunity, { id: opportunity }),
        null,
      );
      assert.equal(
        await sales.query(api.sales.getProperty, { id: property }),
        null,
      );
      const page = await sales.query(api.sales.listOpportunities, {
        paginationOpts: { cursor: null, numItems: 25 },
        assigned_to: credentials("owner").id as Id<"users">,
      });
      assert(!JSON.stringify(page).includes(opportunity));
    },
  );
  await check(
    "Active opportunity rejects missing next action without partial status writes",
    async () => {
      const before = await owner.query(api.sales.getOpportunity, {
        id: opportunity,
      });
      await assert.rejects(() =>
        owner.mutation(api.sales.saveOpportunity, {
          id: opportunity,
          version: before!.opportunity.version,
          input: JSON.stringify({
            property_id: property,
            assigned_to: credentials("owner").id,
            estimated_value: "1000",
            probability: 10,
            next_action_title: "",
            next_action_date: null,
          }),
        }),
      );
      assert.deepEqual(
        await owner.query(api.sales.getOpportunity, { id: opportunity }),
        before,
      );
    },
  );
  const f = await wonFixture(owner),
    project = (await owner.mutation(api.operations.create, f.createArgs)).id;
  await check(
    "Crew assigned-project DTO omits financial and manager context",
    async () => {
      const value = JSON.stringify(
        await crew.query(api.operations.get, { id: project }),
      );
      assert(!value.includes("PRIVATE MANAGER"));
      assert(!value.includes("PRIVATE NEGOTIATION"));
    },
  );
  await check(
    "Wrong-table IDs cannot cross project, commercial or inventory boundaries",
    async () => {
      await assert.rejects(() =>
        owner.query(api.operations.get, { id: realtor.id as Id<"projects"> }),
      );
      await assert.rejects(() =>
        owner.query(api.inventory.projectInventory, {
          project_id: property as unknown as Id<"projects">,
        }),
      );
    },
  );
  console.log(JSON.stringify(results));
  assert(results.every((x) => x.passed));
}
main().catch(() => {
  console.error(
    "Record security acceptance incomplete; inspect restricted result",
  );
  process.exitCode = 1;
});
