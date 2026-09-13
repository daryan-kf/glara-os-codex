import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTestDatabase,
  fixtureUsers,
  rpc,
  asUser,
} from "./support/database";

test("M1 bounded search, combined filters, configuration permissions and direct RPC validation", async () => {
  const db = await createTestDatabase();
  const owner = fixtureUsers["owner@example.test"].id;
  const sales = fixtureUsers["sales@example.test"].id;
  const admin = fixtureUsers["admin@example.test"].id;
  const marketing = fixtureUsers["marketing@example.test"].id;
  const mutate = (user: string, input: object) =>
    rpc(db, user, "crm_mutate", input);
  const list = (input: object = {}) =>
    rpc(db, sales, "crm_query", { op: "list", ...input }) as Promise<{
      rows: { id: string; first_name: string }[];
      total: number;
    }>;
  try {
    const brokerage = (await mutate(sales, {
      op: "brokerage_save",
      data: {
        name: "Fictional North",
        office_name: "West",
        notes: "Restricted brokerage note",
      },
    })) as { id: string };
    const source = (await mutate(admin, {
      op: "source_save",
      data: { name: "Fictional campaign" },
    })) as { id: string };
    await assert.rejects(
      mutate(sales, { op: "source_save", data: { name: "Not permitted" } }),
      /Only owner or admin/,
    );
    await assert.rejects(
      mutate(marketing, {
        op: "brokerage_save",
        data: { name: "Not permitted" },
      }),
      /write access denied/,
    );
    const options = (await rpc(db, marketing, "crm_query", {
      op: "brokerage_options",
      q: "Fictional",
    })) as Record<string, unknown>[];
    assert.equal(options[0].id, brokerage.id);
    assert.deepEqual(Object.keys(options[0]).sort(), ["id", "name"]);
    assert.equal(
      (
        await asUser(db, marketing, (tx) =>
          tx.query("select * from brokerages"),
        )
      ).rows.length,
      0,
    );
    const base = {
      first_name: "Sarah",
      last_name: "Fictional",
      assigned_to: sales,
      relationship_status: "active_partner",
      primary_city: "Vancouver",
      primary_area: "Kitsilano",
      brokerage_id: brokerage.id,
      lead_source_id: source.id,
    };
    let firstId = "";
    for (let i = 0; i < 28; i++) {
      const row = (await mutate(i % 2 ? admin : sales, {
        op: "realtor_create",
        data: {
          ...base,
          last_name: "Fictional" + String(i).padStart(2, "0"),
          email: "sarah" + i + "@example.test",
          phone: i === 0 ? "+1 (604) 555-0100" : "",
          created_by: marketing,
          id: marketing,
          deleted_at: "2020-01-01",
        },
      })) as { id: string };
      if (!i) firstId = row.id;
    }
    const first = await list();
    const second = await list({ page: 2 });
    assert.equal(first.total, 28);
    assert.equal(first.rows.length, 25);
    assert.equal(second.rows.length, 3);
    assert.equal(
      new Set([...first.rows, ...second.rows].map((r) => r.id)).size,
      28,
    );
    assert.equal((await list({ q: "Sara" })).total, 28);
    assert.equal((await list({ q: "6045550100" })).total, 1);
    assert.equal((await list({ q: "sarah0@example.test" })).total, 1);
    assert.equal((await list({ q: "'; drop table realtors; --" })).total, 0);
    assert.equal(
      (
        await list({
          area: "kits",
          status: "active_partner",
          assigned_to: sales,
          brokerage_id: brokerage.id,
          lead_source_id: source.id,
        })
      ).total,
      28,
    );
    assert.equal((await list({ area: "Burnaby" })).total, 0);
    assert.equal((await list({ assigned_to: owner })).total, 0);
    assert.equal((await list({ followup: "missing" })).total, 28);
    const search = (await rpc(db, sales, "crm_query", {
      op: "search",
      q: "Sarah",
    })) as { rows: unknown[] };
    assert.equal(search.rows.length, 8);
    for (const patch of [
      { email: "not-an-email" },
      { phone: "12" },
      { website: "javascript:alert(1)" },
      { relationship_score: "101" },
      { assigned_to: fixtureUsers["archived@example.test"].id },
    ]) {
      await assert.rejects(
        mutate(owner, { op: "realtor_create", data: { ...base, ...patch } }),
      );
    }
    await assert.rejects(
      mutate(owner, {
        op: "activity_create",
        data: {
          realtor_id: firstId,
          type: "call",
          title: "Future completed call",
          status: "completed",
          completed_at: "2099-01-01",
          assigned_to: sales,
        },
      }),
      /future/,
    );
    for (let i = 0; i < 31; i++) {
      await mutate(sales, {
        op: "activity_create",
        data: {
          realtor_id: firstId,
          type: "task",
          title: "Fictional task " + i,
          status: "open",
          assigned_to: sales,
          due_at: "2026-10-01T18:00:00Z",
          created_by: marketing,
        },
      });
    }
    const activities = (await rpc(db, sales, "crm_query", {
      op: "activities",
      id: firstId,
    })) as { rows: { created_by: string }[] };
    assert.equal(activities.rows.length, 30);
    assert.ok(activities.rows.every((row) => row.created_by === sales));
    assert.equal(
      (
        (await rpc(db, sales, "crm_query", {
          op: "activities",
          id: firstId,
          page: 2,
        })) as { rows: unknown[] }
      ).rows.length,
      1,
    );
    assert.equal(
      (
        (await rpc(db, sales, "crm_query", { op: "followups" })) as {
          rows: unknown[];
        }
      ).rows.length,
      30,
    );
    assert.equal(
      (
        (await rpc(db, sales, "crm_query", {
          op: "followups",
          assigned_to: owner,
        })) as { rows: unknown[] }
      ).rows.length,
      0,
    );
    assert.equal((await list({ followup: "missing" })).total, 27);
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select public.crm_query('{}'::jsonb)");
      }),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
