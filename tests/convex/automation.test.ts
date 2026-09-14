import { describe, it, expect } from "vitest";
import { operationsFixture } from "../support/operations-unit-fixture";
import { api, internal } from "../../convex/_generated/api";
import {
  configSchema,
  escalationLevel,
  businessDays,
  due,
} from "../../src/lib/automation/model";
const paginationOpts = { cursor: null, numItems: 30 };
async function fixture() {
  const f = await operationsFixture();
  await f.c("owner").mutation(api.automation.initialize, {});
  const enable = async (key: string, patch: Record<string, unknown> = {}) => {
    const rules = await f.c("owner").query(api.automation.rules, {}),
      r = rules.find((r) => r.key === key)!.record!;
    await f.c("owner").mutation(api.automation.saveRule, {
      id: r._id,
      version: r.version,
      config: { ...r.config, enabled: true, delay_days: 0, ...patch },
    });
    return r;
  };
  const act = () =>
    f
      .c("owner")
      .query(api.automation.actions, { paginationOpts, status: "active" });
  return { ...f, enable, act };
}
describe("M7 deterministic automation", () => {
  it("validates bounded controlled policy and Vancouver dates", () => {
    expect(businessDays("2026-03-08", Date.parse("2026-03-09T06:59:00Z"))).toBe(
      0,
    );
    expect(
      due("2026-01-01T10:00:00Z", 2, Date.parse("2026-01-03T10:00:00Z")),
    ).toBe(true);
    expect(escalationLevel(0, 14 * 86400000, [7, 14])).toBe(2);
    expect(
      configSchema.safeParse({ enabled: true, delay_days: -1 }).success,
    ).toBe(false);
  });
  it("ships disabled defaults and denies non-managers and expired sessions", async () => {
    const f = await fixture();
    expect(
      (await f.c("owner").query(api.automation.rules, {})).every(
        (r) => !r.record?.config.enabled,
      ),
    ).toBe(true);
    for (const role of [
      "sales",
      "designer",
      "staging_crew",
      "marketing",
    ] as const)
      await expect(
        f.c(role).mutation(api.automation.initialize, {}),
      ).rejects.toThrow();
    await expect(f.t.query(api.automation.rules, {})).rejects.toThrow();
  });
  it("deduplicates concurrent runs, preserves immutable versions and server actor", async () => {
    const f = await fixture();
    await f.enable("new_contact");
    await Promise.all([
      f.c("owner").mutation(api.automation.execute, {
        table: "opportunities",
        entity_id: f.oid,
      }),
      f.c("admin").mutation(api.automation.execute, {
        table: "opportunities",
        entity_id: f.oid,
      }),
    ]);
    expect((await f.act()).page).toHaveLength(1);
    const a = (await f.act()).page[0];
    expect(a.task?.actor_kind).toBe("system");
    expect(a.assigned_to).toBe(f.who("sales").id);
    await f.enable("new_contact", { priority: "urgent" });
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    expect((await f.act()).page).toHaveLength(1);
    const h = await f
      .c("owner")
      .query(api.automation.history, { paginationOpts });
    expect(h.page.some((x) => x.config.priority === "high")).toBe(true);
    expect(h.page.some((x) => x.config.priority === "urgent")).toBe(true);
  });
  it("suppresses then safely replays and resolves archived source", async () => {
    const f = await fixture();
    await f.enable("new_contact");
    await f.c("owner").mutation(api.automation.suppress, {
      table: "opportunities",
      entity_id: f.oid,
      family: "contact",
      days: 1,
      reason: "Client requested delay",
    });
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    expect((await f.act()).page).toHaveLength(0);
    await f.t.run(async (ctx) => {
      for (const s of await ctx.db.query("automation_suppressions").collect())
        await ctx.db.patch(s._id, { until: Date.now() - 1 });
    });
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    expect((await f.act()).page).toHaveLength(1);
    await f.t.run((ctx) =>
      ctx.db.patch(f.oid, { deleted_at: new Date().toISOString() }),
    );
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    expect((await f.act()).page).toHaveLength(0);
  });
  it("completion does not resolve the source and cooldown creates a new cycle", async () => {
    const f = await fixture();
    await f.enable("new_contact");
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    const a = (await f.act()).page[0];
    await f.c("sales").mutation(api.automation.changeAction, {
      id: a._id,
      updated_at: a.updated_at,
      op: "complete",
      reason: "Call attempted today",
    });
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    expect((await f.act()).page[0].task_completed_at).not.toBeNull();
    await f.t.run((ctx) =>
      ctx.db.patch(a._id, { next_cycle_at: Date.now() - 1 }),
    );
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    const next = (await f.act()).page;
    expect(next).toHaveLength(1);
    expect(next[0].cycle).toBe(2);
    expect(next[0].activity_id).not.toBe(a.activity_id);
  });
  it("falls back from archived Sales, escalates one task, and hides revoked notifications", async () => {
    const f = await fixture();
    await f.enable("new_contact");
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    const a = (await f.act()).page[0];
    await f.t.run(async (ctx) => {
      const p = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", f.who("sales").id))
        .unique();
      await ctx.db.patch(p!._id, { roles: ["marketing"] });
      await ctx.db.patch(a._id, { created_at: Date.now() - 15 * 86400000 });
    });
    expect(
      (
        await f.c("sales").query(api.automation.notifications, {
          paginationOpts,
          resolved: false,
        })
      ).page,
    ).toHaveLength(0);
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    const next = (await f.act()).page[0];
    expect(next.assigned_to).toBe(f.who("owner").id);
    expect(next.activity_id).toBe(a.activity_id);
    expect(next.level).toBe(2);
  });
  it("dry-run reconciliation is read only and repair is explicit", async () => {
    const f = await fixture();
    await f.enable("new_contact");
    const preview = await f.c("owner").query(api.automation.preview, {
      table: "opportunities",
      entity_id: f.oid,
    });
    expect(preview.find((x) => x.family === "contact")?.drift).toBe("missing");
    expect((await f.act()).page).toHaveLength(0);
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    expect(
      (
        await f.c("owner").query(api.automation.preview, {
          table: "opportunities",
          entity_id: f.oid,
        })
      ).find((x) => x.family === "contact")?.drift,
    ).toBe("none");
  });
  it("bounds queue scans and retries failures three times", async () => {
    const f = await fixture();
    const scan = await f.c("owner").mutation(api.automation.scanBatch, {});
    expect(scan.count).toBeLessThanOrEqual(20);
    const q = (await f.t.query(internal.automation.pending, {}))[0];
    for (let i = 0; i < 3; i++)
      await f.t.mutation(internal.automation.failed, {
        id: q._id,
        generation: q.generation,
      });
    const health = await f.c("owner").query(api.automation.health, {});
    expect(health.failed[0].attempts).toBe(3);
    await f.c("owner").mutation(api.automation.retry, { id: q._id });
    expect(
      (await f.c("owner").query(api.automation.health, {})).failed,
    ).toHaveLength(0);
  });
});
import { commercialFixture } from "../support/commercial-unit-fixture";
import { inventoryFixture } from "../support/inventory-unit-fixture";
import { day, addDays } from "../../src/lib/operations/model";
describe("M7 source authority and privacy", () => {
  async function enable(
    f: Awaited<ReturnType<typeof operationsFixture>>,
    key: string,
    patch: Record<string, unknown> = {},
  ) {
    await f.c("owner").mutation(api.automation.initialize, {});
    const r = (await f.c("owner").query(api.automation.rules, {})).find(
      (r) => r.key === key,
    )!.record!;
    await f.c("owner").mutation(api.automation.saveRule, {
      id: r._id,
      version: r.version,
      config: { ...r.config, enabled: true, delay_days: 0, ...patch },
    });
    return r;
  }
  it("invoice collection survives concurrency and reversals without modifying the ledger", async () => {
    const f = await commercialFixture(),
      invoice = await f.manual("100.01");
    await f.issue(invoice);
    await enable(f, "invoice_due");
    await enable(f, "invoice_overdue");
    const run = () =>
      f.owner.mutation(api.automation.execute, {
        table: "invoices",
        entity_id: invoice,
      });
    await Promise.all([run(), run(), run()]);
    let actions = (
      await f.owner.query(api.automation.actions, {
        status: "active",
        paginationOpts,
      })
    ).page;
    expect(actions).toHaveLength(1);
    expect(actions[0].impact_cents).toBe("10001");
    for (const role of [
      "sales",
      "designer",
      "staging_crew",
      "marketing",
    ] as const) {
      expect(
        (
          await f
            .c(role)
            .query(api.automation.actions, { status: "active", paginationOpts })
        ).page,
      ).toHaveLength(0);
      await expect(
        f.c(role).mutation(api.automation.execute, {
          table: "invoices",
          entity_id: invoice,
        }),
      ).rejects.toThrow();
    }
    const payment = await f.payment("100.01", [
      { invoice_id: invoice, amount: "100.01" },
    ]);
    expect(
      (
        await f.owner.query(api.automation.actions, {
          status: "active",
          paginationOpts,
        })
      ).page,
    ).toHaveLength(0);
    await run();
    expect(
      (
        await f.owner.query(api.automation.actions, {
          status: "active",
          paginationOpts,
        })
      ).page,
    ).toHaveLength(0);
    const before = await f.invoice(invoice);
    expect(before.balance_cents).toBe("0");
    await f.owner.mutation(api.commercial.reversePayment, {
      id: payment,
      reason: "Fictional reversal acceptance",
    });
    await run();
    actions = (
      await f.owner.query(api.automation.actions, {
        status: "active",
        paginationOpts,
      })
    ).page;
    expect(actions).toHaveLength(1);
    expect(actions[0].cycle).toBe(2);
    expect((await f.invoice(invoice)).balance_cents).toBe("10001");
    expect(
      (await f.get(f.project)).tasks.some(
        (t) => t.automation_domain === "commercial",
      ),
    ).toBe(false);
  });
  it("staging preparation resolves from checklist facts and never changes project state", async () => {
    const f = await operationsFixture(),
      project = await f.create();
    await enable(f, "prep_tomorrow", { delay_days: 1 });
    await f.t.run(async (ctx) => {
      await ctx.db.insert("operations_events", {
        project_id: project,
        event_type: "staging",
        title: "Fictional",
        description: "",
        start_at: addDays(day(), 1) + "T18:00:00Z",
        end_at: addDays(day(), 1) + "T20:00:00Z",
        local_day: addDays(day(), 1),
        assigned_lead_id: f.who("staging_crew").id,
        status: "scheduled",
        location_note: "",
        version: 1,
        created_by: f.who("owner").id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      });
    });
    await f.c("owner").mutation(api.automation.execute, {
      table: "projects",
      entity_id: project,
    });
    expect(
      (
        await f
          .c("owner")
          .query(api.automation.actions, { status: "active", paginationOpts })
      ).page,
    ).toHaveLength(1);
    await f.t.run(async (ctx) => {
      for (const c of await ctx.db
        .query("project_checklist_items")
        .withIndex("by_project", (q) =>
          q.eq("project_id", project).eq("deleted_at", null),
        )
        .collect())
        if (["pre_staging", "staging"].includes(c.category))
          await ctx.db.patch(c._id, { status: "completed" });
    });
    await f.c("owner").mutation(api.automation.execute, {
      table: "projects",
      entity_id: project,
    });
    expect(
      (
        await f
          .c("owner")
          .query(api.automation.actions, { status: "active", paginationOpts })
      ).page,
    ).toHaveLength(0);
    expect((await f.get(project)).status).toBe("planning");
  });
  it("missing physical asset resolves after recovery and never creates liability", async () => {
    const f = await inventoryFixture("serialized");
    await enable(f, "missing_asset");
    await f.t.run((ctx) => ctx.db.patch(f.asset!, { status: "missing" }));
    const run = () =>
      f.owner.mutation(api.automation.execute, {
        table: "inventory_assets",
        entity_id: f.asset!,
      });
    await run();
    await run();
    expect(
      (
        await f.owner.query(api.automation.actions, {
          status: "active",
          paginationOpts,
        })
      ).page,
    ).toHaveLength(1);
    await f.t.run((ctx) => ctx.db.patch(f.asset!, { status: "available" }));
    await run();
    expect(
      (
        await f.owner.query(api.automation.actions, {
          status: "active",
          paginationOpts,
        })
      ).page,
    ).toHaveLength(0);
    expect(
      await f.t.run((ctx) =>
        ctx.db.query("damage_charge_assessments").collect(),
      ),
    ).toHaveLength(0);
  });
  it("adopts an overdue manual task instead of creating a duplicate", async () => {
    const f = await fixture();
    await f.enable("next_action");
    const task = await f.t.run(async (ctx) => {
      const a = await ctx.db
        .query("activities")
        .withIndex("by_opportunity", (q) => q.eq("opportunity_id", f.oid))
        .first();
      await ctx.db.patch(a!._id, { due_at: "2020-01-01T18:00:00Z" });
      return a!._id;
    });
    const before = await f.t.run((ctx) => ctx.db.query("activities").collect());
    await f.c("owner").mutation(api.automation.execute, {
      table: "activities",
      entity_id: task,
    });
    expect((await f.act()).page[0].activity_id).toBe(task);
    expect(
      (await f.t.run((ctx) => ctx.db.query("activities").collect())).length,
    ).toBe(before.length);
  });
  it("daily limits stop a storm and stale configuration writes fail", async () => {
    const f = await fixture(),
      r = await f.enable("new_contact", { daily_limit: 1 });
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    const other = await f.t.run(async (ctx) => {
      const row = (await ctx.db.get(f.oid))!;
      const { _id, _creationTime, ...value } = row;
      void _id;
      void _creationTime;
      return ctx.db.insert("opportunities", value);
    });
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: other,
    });
    expect((await f.act()).page).toHaveLength(1);
    expect(
      (await f.c("owner").query(api.automation.health, {})).limited,
    ).toHaveLength(1);
    await expect(
      f.c("owner").mutation(api.automation.saveRule, {
        id: r._id,
        version: r.version,
        config: r.config,
      }),
    ).rejects.toThrow();
  });
  it("future-only activation excludes existing backlog", async () => {
    const f = await fixture();
    await f.enable("new_contact", { activation: "future" });
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    expect((await f.act()).page).toHaveLength(0);
  });
});
describe("M7 release hardening", () => {
  it("disabling a rule preserves existing action and evidence", async () => {
    const f = await fixture();
    await f.enable("new_contact");
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    await f.enable("new_contact", { enabled: false });
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    expect((await f.act()).page).toHaveLength(1);
    expect(
      (await f.c("owner").query(api.automation.history, { paginationOpts }))
        .page.length,
    ).toBeGreaterThan(0);
  });
  it("snooze is bounded and prevents escalation until its expiry", async () => {
    const f = await fixture();
    await f.enable("new_contact");
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    let a = (await f.act()).page[0];
    await expect(
      f.c("sales").mutation(api.automation.changeAction, {
        id: a._id,
        updated_at: a.updated_at,
        op: "snooze",
        days: 999,
        reason: "Fictional delay",
      }),
    ).rejects.toThrow();
    await f.c("sales").mutation(api.automation.changeAction, {
      id: a._id,
      updated_at: a.updated_at,
      op: "snooze",
      days: 2,
      reason: "Fictional delay",
    });
    await f.t.run((ctx) =>
      ctx.db.patch(a._id, { created_at: Date.now() - 15 * 86400000 }),
    );
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    a = (await f.act()).page[0];
    expect(a.level).toBe(0);
  });
  it("archived assignee falls back to an active Admin", async () => {
    const f = await fixture();
    await f.enable("new_contact");
    await f.t.run(async (ctx) => {
      const p = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", f.who("sales").id))
        .unique();
      await ctx.db.patch(p!._id, { deleted_at: new Date().toISOString() });
    });
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    expect((await f.act()).page[0].assigned_to).toBe(f.who("admin").id);
  });
  it("changed source due date resolves stale automation", async () => {
    const f = await fixture();
    await f.enable("new_contact");
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    await f.t.run((ctx) =>
      ctx.db.patch(f.oid, { created_at: "2099-01-01T00:00:00Z" }),
    );
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    expect((await f.act()).page).toHaveLength(0);
    expect(
      (
        await f.c("owner").query(api.automation.history, { paginationOpts })
      ).page.some((e) => e.status === "resolved"),
    ).toBe(true);
  });
  it("duplicate repair keeps the shared canonical task alive", async () => {
    const f = await fixture();
    await f.enable("new_contact");
    await f.c("owner").mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.oid,
    });
    const a = (await f.act()).page[0];
    await f.t.run(async (ctx) => {
      const r = (await ctx.db.get(a._id))!;
      const { _id, _creationTime, ...value } = r;
      void _id;
      void _creationTime;
      await ctx.db.insert("automation_actions", value);
    });
    expect(
      (
        await f.c("owner").query(api.automation.preview, {
          table: "opportunities",
          entity_id: f.oid,
        })
      ).find((g) => g.family === "contact")?.drift,
    ).toBe("duplicate");
    await f.c("owner").mutation(api.automation.repair, {
      table: "opportunities",
      entity_id: f.oid,
    });
    expect((await f.act()).page).toHaveLength(1);
    expect((await f.act()).page[0].task?.status).toBe("open");
  });
  it("bounded enrollment and scheduler resume a 120-record load", async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const row = (await ctx.db.get(f.oid))!;
      const { _id, _creationTime, ...value } = row;
      void _id;
      void _creationTime;
      for (let n = 0; n < 120; n++) await ctx.db.insert("opportunities", value);
    });
    let enrolled = 0,
      done = false;
    for (let n = 0; n < 40; n++) {
      const b = await f.c("owner").mutation(api.automation.scanBatch, {});
      expect(b.count).toBeLessThanOrEqual(20);
      enrolled += b.count;
      if (b.done) {
        done = true;
        break;
      }
    }
    expect(done).toBe(true);
    expect(enrolled).toBeGreaterThanOrEqual(120);
    const first = await f.t.action(internal.automation.tick, {});
    expect(first.evaluated).toBeLessThanOrEqual(100);
    expect(first.evaluated).toBe(100);
    await f.t.action(internal.automation.tick, {});
    expect(await f.t.query(internal.automation.pending, {})).toHaveLength(0);
    expect((await f.act()).page).toHaveLength(0);
  });
});
