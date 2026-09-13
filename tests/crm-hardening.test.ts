import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTestDatabase,
  fixtureUsers,
  rpc,
  asUser,
} from "./support/database";
test("hardening: archived brokerage and stale versions cannot be overwritten", async () => {
  const db = await createTestDatabase();
  const owner = fixtureUsers["owner@example.test"].id;
  try {
    const mutate = (user: string, input: object) =>
      rpc(db, user, "crm_mutate", input);
    const created = (await mutate(owner, {
      op: "brokerage_save",
      data: { name: "Fictional Office" },
    })) as { id: string };
    const input = {
      op: "brokerage_save",
      id: created.id,
      version: 1,
      data: { name: "First valid edit" },
    };
    await mutate(fixtureUsers["sales@example.test"].id, input);
    for (const email of [
      "sales@example.test",
      "admin@example.test",
      "owner@example.test",
    ] as const) {
      await assert.rejects(
        mutate(fixtureUsers[email].id, input),
        /record changed/,
      );
      await assert.rejects(
        mutate(fixtureUsers[email].id, { ...input, version: null }),
        /record changed/,
      );
    }
    await db.query("update brokerages set deleted_at=now() where id=$1", [
      created.id,
    ]);
    const before = (
      await db.query("select * from brokerages where id=$1", [created.id])
    ).rows;
    const count = (
      await db.query(
        "select count(*) from audit_logs where entity='brokerages' and entity_id=$1",
        [created.id],
      )
    ).rows;
    for (const email of [
      "sales@example.test",
      "admin@example.test",
      "owner@example.test",
    ] as const)
      await assert.rejects(
        mutate(fixtureUsers[email].id, {
          ...input,
          version: 2,
          data: { name: "Forbidden", deleted_at: null },
        }),
        /archived or unavailable/,
      );
    assert.deepEqual(
      (await db.query("select * from brokerages where id=$1", [created.id]))
        .rows,
      before,
    );
    assert.deepEqual(
      (
        await db.query(
          "select count(*) from audit_logs where entity='brokerages' and entity_id=$1",
          [created.id],
        )
      ).rows,
      count,
    );
    await assert.rejects(
      mutate(owner, { ...input, id: "20000000-0000-4000-8000-000000000001" }),
      /unavailable/,
    );
  } finally {
    await db.close();
  }
});
test("hardening: Marketing has no roster but retains safe directory owner names and sources", async () => {
  const db = await createTestDatabase();
  const owner = fixtureUsers["owner@example.test"].id,
    marketing = fixtureUsers["marketing@example.test"].id;
  try {
    const created = (await rpc(db, owner, "crm_mutate", {
      op: "realtor_create",
      data: {
        first_name: "Fictional",
        last_name: "Directory",
        assigned_to: owner,
        relationship_status: "dormant",
      },
    })) as { id: string };
    await assert.rejects(
      rpc(db, marketing, "crm_query", { op: "choices" }),
      /roster access denied/,
    );
    const sources = (await rpc(db, marketing, "crm_query", {
      op: "sources",
    })) as { owners: unknown[]; sources: unknown[] };
    assert.equal(sources.owners.length, 0);
    assert.equal(sources.sources.length, 12);
    const profiles = await asUser(db, marketing, (tx) =>
      tx.query<{ id: string }>("select id from profiles"),
    );
    assert.deepEqual(
      profiles.rows.map((r) => r.id),
      [marketing],
    );
    const roles = await asUser(db, marketing, (tx) =>
      tx.query<{ role: string }>("select role from user_roles"),
    );
    assert.deepEqual(
      roles.rows.map((r) => r.role),
      ["marketing"],
    );
    const detail = (await rpc(db, marketing, "crm_query", {
      op: "detail",
      id: created.id,
    })) as { owner_name: string };
    assert.equal(detail.owner_name, "Demo Owner");
    const choices = (await rpc(db, owner, "crm_query", { op: "choices" })) as {
      owners: unknown[];
    };
    assert.equal(choices.owners.length, 3);
  } finally {
    await db.close();
  }
});
test("hardening: cancellation and rescheduling are atomic, keep original due date and audit actor", async () => {
  const db = await createTestDatabase();
  const sales = fixtureUsers["sales@example.test"].id;
  try {
    const mutate = (input: object) => rpc(db, sales, "crm_mutate", input);
    const realtor = (await mutate({
      op: "realtor_create",
      data: {
        first_name: "Fictional",
        last_name: "Followup",
        assigned_to: sales,
        relationship_status: "prospect",
        next_title: "Original",
        next_due_at: "2026-10-01T18:00:00Z",
      },
    })) as { id: string };
    const original = (
      await db.query<{ id: string }>(
        "select id from activities where realtor_id=$1",
        [realtor.id],
      )
    ).rows[0].id;
    await assert.rejects(
      mutate({ op: "activity_cancel", id: original, data: {} }),
      /prospect needs a next action/,
    );
    await assert.rejects(
      mutate({
        op: "activity_reschedule",
        id: original,
        data: { next_title: "Missing date" },
      }),
      /replacement action/,
    );
    await assert.rejects(
      mutate({
        op: "activity_reschedule",
        id: original,
        data: { next_title: "Invalid date", next_due_at: "invalid" },
      }),
    );
    assert.equal(
      (
        await db.query<{ status: string }>(
          "select status from activities where id=$1",
          [original],
        )
      ).rows[0].status,
      "open",
    );
    await mutate({
      op: "activity_reschedule",
      id: original,
      data: {
        next_title: "Replacement",
        next_due_at: "2026-10-05T18:00:00Z",
        assigned_to: fixtureUsers["marketing@example.test"].id,
      },
    });
    const rows = (
      await db.query<{
        id: string;
        status: string;
        due_at: Date;
        completed_at: null;
        assigned_to: string;
        replaces_activity_id: string | null;
      }>(
        "select * from activities where realtor_id=$1 order by created_at,id",
        [realtor.id],
      )
    ).rows;
    const cancelled = rows.find((r) => r.id === original)!;
    const replacement = rows.find((r) => r.id !== original)!;
    assert.equal(cancelled.status, "cancelled");
    assert.equal(cancelled.completed_at, null);
    assert.equal(
      new Date(cancelled.due_at).toISOString(),
      "2026-10-01T18:00:00.000Z",
    );
    assert.equal(replacement.status, "open");
    assert.equal(replacement.assigned_to, sales);
    assert.equal(replacement.replaces_activity_id, original);
    await assert.rejects(
      mutate({
        op: "activity_reschedule",
        id: original,
        data: { next_title: "Again", next_due_at: "2026-10-06T18:00:00Z" },
      }),
      /no longer open/,
    );
    await mutate({
      op: "activity_cancel",
      id: replacement.id,
      data: {
        next_title: "Next conversation",
        next_due_at: "2026-10-10T18:00:00Z",
      },
    });
    const audit = await db.query<{ actor_id: string }>(
      "select actor_id from audit_logs where entity='activities' and entity_id=$1",
      [original],
    );
    assert.ok(audit.rows.length >= 2);
    assert.ok(audit.rows.every((r) => r.actor_id === sales));
    assert.equal(
      (
        await db.query<{ count: number }>(
          "select count(*)::int as count from activities where realtor_id=$1 and status='open'",
          [realtor.id],
        )
      ).rows[0].count,
      1,
    );
  } finally {
    await db.close();
  }
});
