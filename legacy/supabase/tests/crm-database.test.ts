import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createTestDatabase,
  fixtureUsers,
  rpc,
  asUser,
} from "./support/database";
test("M1 atomic CRM lifecycle, RLS scopes, next actions and audit identity", async () => {
  const db = await createTestDatabase();
  try {
    const owner = fixtureUsers["owner@example.test"].id,
      sales = fixtureUsers["sales@example.test"].id;
    const create = {
      op: "realtor_create",
      data: {
        first_name: "Fictional",
        last_name: "Chen",
        email: "fictional@example.test",
        phone: "+1 604 555 0100",
        assigned_to: sales,
        relationship_status: "prospect",
        notes: "Internal relationship note",
        average_listing_price: "2500000.25",
        next_title: "Introduction call",
        next_due_at: "2026-10-01T18:00:00Z",
      },
    };
    const saved = (await rpc(db, owner, "crm_mutate", create)) as {
      id: string;
    };
    assert.ok(saved.id);
    for (const role of ["owner", "sales", "admin"] as const) {
      const row = (await rpc(
        db,
        fixtureUsers[(role + "@example.test") as keyof typeof fixtureUsers].id,
        "crm_query",
        { op: "detail", id: saved.id },
      )) as { notes: string };
      assert.equal(row.notes, "Internal relationship note");
    }
    const marketing = fixtureUsers["marketing@example.test"].id;
    const publicRow = (await rpc(db, marketing, "crm_query", {
      op: "detail",
      id: saved.id,
    })) as Record<string, unknown>;
    assert.equal(publicRow.first_name, "Fictional");
    assert.equal(publicRow.notes, undefined);
    assert.equal(publicRow.average_listing_price, undefined);
    assert.equal(
      (
        await asUser(db, marketing, (tx) =>
          tx.query("select * from realtor_private"),
        )
      ).rows.length,
      0,
    );
    assert.equal(
      (
        await asUser(db, marketing, (tx) =>
          tx.query("select * from activities"),
        )
      ).rows.length,
      0,
    );
    await assert.rejects(
      rpc(db, marketing, "crm_mutate", create),
      /access denied/,
    );
    for (const email of [
      "crew@example.test",
      "designer@example.test",
      "archived@example.test",
    ] as const) {
      await assert.rejects(
        rpc(db, fixtureUsers[email].id, "crm_query", { op: "list" }),
        /access denied/,
      );
      assert.equal(
        (
          await asUser(db, fixtureUsers[email].id, (tx) =>
            tx.query("select * from realtors"),
          )
        ).rows.length,
        0,
      );
    }
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.exec("set local role anon");
        await tx.query("select * from realtors");
      }),
      /permission denied/,
    );
    await assert.rejects(
      asUser(db, sales, (tx) =>
        tx.query("update realtors set first_name='Hacked'"),
      ),
      /permission denied/,
    );
    await assert.rejects(
      rpc(db, owner, "crm_mutate", create),
      /unique constraint/,
    );
    await assert.rejects(
      rpc(db, owner, "crm_mutate", {
        ...create,
        data: {
          ...create.data,
          email: "second@example.test",
          phone: "",
          next_title: "",
          next_due_at: "",
        },
      }),
      /prospect needs a next action/,
    );
    const timeline = (await rpc(db, sales, "crm_query", {
      op: "activities",
      id: saved.id,
    })) as { rows: { id: string }[] };
    await assert.rejects(
      rpc(db, sales, "crm_mutate", {
        op: "activity_complete",
        id: timeline.rows[0].id,
        data: {},
      }),
      /prospect needs a next action/,
    );
    await rpc(db, sales, "crm_mutate", {
      op: "activity_complete",
      id: timeline.rows[0].id,
      data: {
        next_title: "Send introduction",
        next_due_at: "2026-10-05T18:00:00Z",
      },
    });
    await rpc(db, sales, "crm_mutate", {
      op: "activity_create",
      data: {
        realtor_id: saved.id,
        type: "call",
        title: "Introductory call",
        status: "completed",
        assigned_to: sales,
        completed_at: "2026-09-01T18:00:00Z",
      },
    });
    const update = {
      op: "realtor_update",
      id: saved.id,
      version: 1,
      data: {
        ...create.data,
        first_name: "Updated",
        next_title: "",
        next_due_at: "",
      },
    };
    await rpc(db, sales, "crm_mutate", update);
    await assert.rejects(
      rpc(db, sales, "crm_mutate", update),
      /record changed/,
    );
    await rpc(db, sales, "crm_mutate", {
      op: "realtor_archive",
      id: saved.id,
      version: 2,
    });
    assert.equal(
      await rpc(db, sales, "crm_query", { op: "detail", id: saved.id }),
      null,
    );
    assert.equal(
      await rpc(db, marketing, "crm_query", { op: "detail", id: saved.id }),
      null,
    );
    await assert.rejects(
      rpc(db, sales, "crm_mutate", {
        op: "realtor_restore",
        id: saved.id,
        version: 3,
      }),
      /Only owner or admin/,
    );
    await rpc(db, owner, "crm_mutate", {
      op: "realtor_restore",
      id: saved.id,
      version: 3,
    });
    const restored = (await rpc(db, owner, "crm_query", {
      op: "detail",
      id: saved.id,
    })) as { first_name: string; first_contact_date: string };
    assert.equal(restored.first_name, "Updated");
    assert.ok(restored.first_contact_date);
    const audit = await db.query<{ actor_id: string }>(
      "select actor_id from audit_logs where entity='realtors' and entity_id=$1",
      [saved.id],
    );
    assert.ok(audit.rows.some((row) => row.actor_id === sales));
    assert.ok(
      audit.rows.every(
        (row) => row.actor_id === sales || row.actor_id === owner,
      ),
    );
  } finally {
    await db.close();
  }
});
