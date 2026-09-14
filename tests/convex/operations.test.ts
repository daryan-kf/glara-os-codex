import { describe, it, expect } from "vitest";
import { api } from "../../convex/_generated/api";
import type { Role } from "../../src/lib/permissions";
import {
  day,
  defaultSettings,
  defaultItems,
} from "../../src/lib/operations/model";
import { operationsFixture as fixture } from "../support/operations-unit-fixture";
describe("M3 native operations security and integrity", () => {
  it("requires won handoff, derives references, returns duplicate identifier atomically", async () => {
    const f = await fixture();
    await expect(
      f.c("owner").mutation(api.operations.create, f.createArgs),
    ).rejects.toThrow();
    await f.won();
    const [a, b] = await Promise.all([
      f.c("owner").mutation(api.operations.create, f.createArgs),
      f.c("owner").mutation(api.operations.create, f.createArgs),
    ]);
    expect(a.id).toBe(b.id);
    expect([a.existing, b.existing]).toContain(true);
    const p = await f.get(a.id);
    expect(p.source?.property_id).toBe(f.pid);
    expect(p.source?.realtor_id).toBe(f.r.id);
    expect(p.project_number).toMatch(/^GLS-\d{4}-\d{4}$/);
  });
  it("allocates distinct project numbers for concurrent independent won opportunities", async () => {
    const f = await fixture();
    await f.won();
    const oid2 = await f.t.run(async (ctx) => {
      const o = (await ctx.db.get(f.oid))!;
      const { _id, _creationTime, ...data } = o;
      void _id;
      void _creationTime;
      return ctx.db.insert("opportunities", data);
    });
    const out = await Promise.all([
      f.c("owner").mutation(api.operations.create, f.createArgs),
      f.c("owner").mutation(api.operations.create, {
        ...f.createArgs,
        opportunity_id: oid2,
      }),
    ]);
    expect((await f.get(out[0].id)).project_number).not.toBe(
      (await f.get(out[1].id)).project_number,
    );
  });
  it("rejects wrong source quote, archived staff and forged actor fields", async () => {
    const f = await fixture();
    const q = await f.c("owner").mutation(api.sales.saveQuote, {
      version: 0,
      input: JSON.stringify({
        opportunity_id: f.oid,
        items: [{ description: "Staging", quantity: 1, unit_price: "5000" }],
        discount: "0",
        tax_rate: "5",
        valid_until: "2099-01-01",
      }),
    });
    await f.won();
    await expect(
      f.c("owner").mutation(api.operations.create, {
        ...f.createArgs,
        source_quote_id: q,
      }),
    ).rejects.toThrow();
    await f.t.run(async (ctx) => {
      const p = await ctx.db
        .query("profiles")
        .withIndex("by_user", (x) => x.eq("userId", f.who("designer").id))
        .unique();
      await ctx.db.patch(p!._id, { deleted_at: new Date().toISOString() });
    });
    await expect(
      f.c("owner").mutation(api.operations.create, f.createArgs),
    ).rejects.toThrow();
    await expect(
      f.c("sales").mutation(api.operations.create, f.createArgs),
    ).rejects.toThrow();
  });
  it("enforces assignment access and safely projects marketing, sales, designers and crew", async () => {
    const f = await fixture(),
      id = await f.create();
    await expect(f.t.query(api.operations.get, { id })).rejects.toThrow();
    await expect(
      f.c("marketing").query(api.operations.get, { id }),
    ).rejects.toThrow();
    for (const role of ["sales", "designer", "staging_crew"] as Role[]) {
      const result = JSON.stringify(
        await f.c(role).query(api.operations.get, { id }),
      );
      expect(result).not.toMatch(
        /PRIVATE|estimated_value|discount|seller_name/,
      );
    }
    await f.t.run(async (ctx) =>
      ctx.db.patch(id, {
        status: "staged",
        designer_id: null,
        staging_lead_id: null,
      }),
    );
    for (const role of ["designer", "staging_crew"] as Role[])
      await expect(
        f.c(role).query(api.operations.get, { id }),
      ).rejects.toThrow();
    const m = await f.c("marketing").query(api.operations.get, { id });
    expect(m.checklist).toEqual([]);
    expect(m.source).toBeNull();
    expect(m.team).toBeNull();
    expect(JSON.stringify(m)).not.toContain("PRIVATE");
  });
  it("keeps access codes out of generic responses, search and audit; revokes archived users", async () => {
    const f = await fixture(),
      id = await f.create();
    await f.c("owner").mutation(api.operations.saveAccess, {
      id,
      version: 0,
      input: JSON.stringify({
        access_type: "lockbox",
        instructions: "Use concierge",
        sensitive_access_code: "SECRET-LOCKBOX",
      }),
    });
    expect(
      (await f.c("staging_crew").query(api.operations.accessDetails, { id }))
        ?.sensitive_access_code,
    ).toBe("SECRET-LOCKBOX");
    for (const role of ["sales", "designer", "marketing"] as Role[])
      await expect(
        f.c(role).query(api.operations.accessDetails, { id }),
      ).rejects.toThrow();
    expect(JSON.stringify(await f.get(id))).not.toContain("SECRET-LOCKBOX");
    expect(
      JSON.stringify(
        await f.t.run((ctx) => ctx.db.query("audit_logs").collect()),
      ),
    ).not.toContain("SECRET-LOCKBOX");
    expect(
      JSON.stringify(
        await f.c("owner").query(api.operations.search, { q: "SECRET" }),
      ),
    ).not.toContain("SECRET-LOCKBOX");
    await f.t.run(async (ctx) => {
      const p = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", f.who("staging_crew").id))
        .unique();
      await ctx.db.patch(p!._id, { deleted_at: new Date().toISOString() });
    });
    await expect(
      f.c("staging_crew").query(api.operations.accessDetails, { id }),
    ).rejects.toThrow();
  });
  it("copies template instances and never rewrites their historical text", async () => {
    const f = await fixture(),
      id = await f.create(),
      before = await f.get(id),
      template = await f.c("owner").query(api.operations.template, {});
    await f.c("owner").mutation(api.operations.saveTemplate, {
      id: template.id!,
      version: template.version,
      name: template.name,
      description: "Revised",
      items: JSON.stringify(
        defaultItems.map((item, i) => ({
          ...item,
          title: i === 0 ? "New wording" : item.title,
        })),
      ),
    });
    expect((await f.get(id)).checklist.map((x) => x.title)).toEqual(
      before.checklist.map((x) => x.title),
    );
  });
  it("blocks missing planning and critical checklist, handles concurrent completion and locks passed gates", async () => {
    const f = await fixture(),
      id = await f.create();
    await f.advance(id, "designing");
    await expect(f.advance(id, "ready_to_schedule")).rejects.toThrow();
    const item = (await f.get(id)).checklist[0];
    const result = await Promise.allSettled(
      [1, 2].map(() =>
        f.c("owner").mutation(api.operations.checklist, {
          id: item._id,
          version: item.version,
          status: "completed",
        }),
      ),
    );
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    await f.complete(id, "pre_staging");
    await f.advance(id, "ready_to_schedule");
    await f.schedule(id);
    const required = (await f.get(id)).checklist.find(
      (x) => x.category === "pre_staging" && x.required,
    )!;
    await expect(
      f.c("owner").mutation(api.operations.checklist, {
        id: required._id,
        version: required.version,
        status: "pending",
      }),
    ).rejects.toThrow();
    await f.advance(id, "staging");
    await expect(f.advance(id, "staged")).rejects.toThrow();
  });
  it("rejects cross-project rooms and protects open task dependencies", async () => {
    const f = await fixture(),
      id = await f.create(),
      p = await f.get(id);
    const room = p.rooms[0];
    await f.c("owner").mutation(api.operations.saveTask, {
      project_id: id,
      version: 0,
      room_id: room._id,
      title: "Call concierge",
      description: "",
      due_at: "2099-01-01T18:00:00Z",
      assigned_to: f.who("admin").id,
      status: "open",
    });
    await expect(
      f.c("owner").mutation(api.operations.saveRoom, {
        project_id: id,
        id: room._id,
        version: room.version,
        archive: true,
        input: JSON.stringify({
          room_type: room.room_type,
          room_name: room.room_name,
          staging_scope: room.staging_scope,
          style_direction: "",
          notes: "",
          status: room.status,
          sort_order: 0,
        }),
      }),
    ).rejects.toThrow();
    const activity = await f.t.run((ctx) =>
      ctx.db
        .query("activities")
        .withIndex("by_project", (q) => q.eq("project_id", id))
        .first(),
    );
    expect(activity?.realtor_id).toBeUndefined();
    expect(activity?.property_id).toBeUndefined();
    expect(activity?.opportunity_id).toBeUndefined();
    await expect(
      f.c("sales").mutation(api.sales.finishAction, {
        id: activity!._id,
        status: "completed",
      }),
    ).rejects.toThrow();
  });
  it("detects overlapping project/lead events and derives daily capacity without counters", async () => {
    const f = await fixture(),
      id = await f.create();
    await f.ready(id);
    const event = await f.schedule(id);
    const p = await f.get(id);
    await expect(
      f.c("owner").mutation(api.operations.schedule, {
        project_id: id,
        project_version: p.version,
        version: 0,
        event_type: "walkthrough",
        title: "Conflict",
        description: "",
        location_note: "",
        start_at: day() + "T16:30:00Z",
        end_at: day() + "T17:30:00Z",
        assigned_lead_id: f.who("staging_crew").id,
      }),
    ).rejects.toThrow();
    expect(
      (await f.c("owner").query(api.operations.capacity, { date: day() }))
        .stagings,
    ).toBe(1);
    await f.c("owner").mutation(api.operations.eventState, {
      id: event,
      version: 1,
      status: "cancelled",
      reason: "Weather",
    });
    expect(
      (await f.c("owner").query(api.operations.capacity, { date: day() }))
        .stagings,
    ).toBe(0);
    expect((await f.get(id)).status).toBe("ready_to_schedule");
  });
  it("runs the gated lifecycle through sold and destaging, freezes completion and preserves M2", async () => {
    const f = await fixture(),
      id = await f.create();
    const before = await f.t.run((ctx) => ctx.db.get(f.oid));
    await f.ready(id);
    await f.schedule(id);
    await f.advance(id, "staging");
    await f.complete(id, "staging");
    await f.advance(id, "staged");
    await f.advance(id, "sold", day());
    expect((await f.get(id)).attention_reasons).toContain(
      "Destaging needs to be scheduled",
    );
    await f.schedule(id, "destaging", 18);
    await f.complete(id, "destaging");
    await f.advance(id, "destaging");
    await f.advance(id, "completed");
    await expect(
      f.c("owner").mutation(api.operations.update, {
        id,
        version: (await f.get(id)).version,
        input: f.createArgs.input,
      }),
    ).rejects.toThrow();
    expect(await f.t.run((ctx) => ctx.db.get(f.oid))).toEqual(before);
    await f.c("owner").mutation(api.operations.archive, {
      id,
      version: (await f.get(id)).version,
      restore: false,
    });
    expect((await f.get(id)).deleted_at).toBeTruthy();
  });
  it("requires cancellation reason, disallows active archive and audits no rejected mutation", async () => {
    const f = await fixture(),
      id = await f.create(),
      p = await f.get(id);
    const count = () =>
      f.t.run(
        async (ctx) => (await ctx.db.query("audit_logs").collect()).length,
      );
    const before = await count();
    await expect(
      f.c("owner").mutation(api.operations.archive, {
        id,
        version: p.version,
        restore: false,
      }),
    ).rejects.toThrow();
    await expect(
      f.c("owner").mutation(api.operations.transition, {
        id,
        version: p.version,
        status: "cancelled",
      }),
    ).rejects.toThrow();
    expect(await count()).toBe(before);
    await f.c("owner").mutation(api.operations.transition, {
      id,
      version: p.version,
      status: "cancelled",
      reason: "Client cancelled",
    });
    expect((await f.get(id)).status).toBe("cancelled");
    expect(
      (await f.c("owner").mutation(api.operations.create, f.createArgs)).id,
    ).toBe(id);
  });
  it("blocks direct backend role bypasses and retains commercial source records", async () => {
    const f = await fixture(),
      id = await f.create();
    for (const role of ["marketing", "designer", "staging_crew"] as Role[]) {
      await expect(
        f.c(role).mutation(api.operations.saveSettings, {
          version: 0,
          input: JSON.stringify(defaultSettings),
        }),
      ).rejects.toThrow();
      await expect(
        f.c(role).mutation(api.operations.create, f.createArgs),
      ).rejects.toThrow();
      await expect(
        f.c(role).query(api.sales.getOpportunity, { id: f.oid }),
      ).rejects.toThrow();
    }
    await expect(
      f.c("owner").mutation(api.sales.archive, {
        id: f.oid,
        kind: "opportunities",
        version: 1,
        restore: false,
      }),
    ).rejects.toThrow();
    await expect(
      f.c("sales").mutation(api.operations.update, {
        id,
        version: (await f.get(id)).version,
        input: f.createArgs.input,
      }),
    ).rejects.toThrow();
  });
});

describe("M3 adversarial relationships and concurrency", () => {
  async function second(f: Awaited<ReturnType<typeof fixture>>) {
    await f.won();
    const oid = await f.t.run(async (ctx) => {
      const original = (await ctx.db.get(f.oid))!;
      const { _id, _creationTime, ...row } = original;
      void _id;
      void _creationTime;
      return ctx.db.insert("opportunities", row);
    });
    return (
      await f.c("owner").mutation(api.operations.create, {
        ...f.createArgs,
        opportunity_id: oid,
      })
    ).id;
  }
  it("rejects accepted quotes from a different opportunity and client actor spoofing", async () => {
    const f = await fixture();
    const quote = await f.c("owner").mutation(api.sales.saveQuote, {
      version: 0,
      input: JSON.stringify({
        opportunity_id: f.oid,
        items: [{ description: "Fictional", quantity: 1, unit_price: "100" }],
        discount: "0",
        tax_rate: "5",
        valid_until: "2099-01-01",
      }),
    });
    await f.c("owner").mutation(api.sales.quoteStatus, {
      id: quote,
      version: 1,
      status: "sent",
    });
    await f.c("owner").mutation(api.sales.quoteStatus, {
      id: quote,
      version: 2,
      status: "accepted",
    });
    await f.won();
    const oid = await f.t.run(async (ctx) => {
      const original = (await ctx.db.get(f.oid))!;
      const { _id, _creationTime, ...row } = original;
      void _id;
      void _creationTime;
      return ctx.db.insert("opportunities", row);
    });
    await expect(
      f.c("owner").mutation(api.operations.create, {
        ...f.createArgs,
        opportunity_id: oid,
        source_quote_id: quote,
      }),
    ).rejects.toThrow();
    const forged = { ...f.createArgs, actor_id: f.who("sales").id };
    await expect(
      f.c("owner").mutation(api.operations.create, forged),
    ).rejects.toThrow();
  });
  it("rejects cross-project room/task references and stale room edits", async () => {
    const f = await fixture(),
      first = await f.create(),
      other = await second(f),
      room = (await f.get(first)).rooms[0],
      input = f.createArgs.rooms[0];
    await expect(
      f.c("owner").mutation(api.operations.saveRoom, {
        project_id: other,
        id: room._id,
        version: 1,
        input,
      }),
    ).rejects.toThrow();
    await expect(
      f.c("owner").mutation(api.operations.saveTask, {
        project_id: other,
        version: 0,
        room_id: room._id,
        title: "Cross-parent",
        description: "",
        due_at: "2099-01-01T18:00:00Z",
        assigned_to: f.who("admin").id,
        status: "open",
      }),
    ).rejects.toThrow();
    await f.c("owner").mutation(api.operations.saveRoom, {
      project_id: first,
      id: room._id,
      version: 1,
      input,
    });
    await expect(
      f.c("owner").mutation(api.operations.saveRoom, {
        project_id: first,
        id: room._id,
        version: 1,
        input,
      }),
    ).rejects.toThrow();
  });
  it("limits crew to assigned checklist and preserves authoritative completion metadata", async () => {
    const f = await fixture(),
      id = await f.create(),
      p = await f.get(id),
      prep = p.checklist.find((c) => c.category === "pre_staging")!,
      staging = p.checklist.find(
        (c) => c.category === "staging" && c.required,
      )!;
    await expect(
      f.c("staging_crew").mutation(api.operations.checklist, {
        id: prep._id,
        version: prep.version,
        status: "completed",
      }),
    ).rejects.toThrow();
    await expect(
      f.c("staging_crew").mutation(api.operations.checklist, {
        id: staging._id,
        version: staging.version,
        status: "skipped",
      }),
    ).rejects.toThrow();
    await expect(
      f.c("staging_crew").mutation(api.operations.checklist, {
        id: staging._id,
        version: staging.version,
        status: "completed",
        required: false,
        reason: "Bypass",
      }),
    ).rejects.toThrow();
    await f.c("staging_crew").mutation(api.operations.checklist, {
      id: staging._id,
      version: staging.version,
      status: "completed",
    });
    const done = (await f.get(id)).checklist.find(
      (c) => c._id === staging._id,
    )!;
    expect(done.completed_by).toBe(f.who("staging_crew").id);
    expect(done.completed_at).toBeTruthy();
  });
  it("additional membership grants and revokes access transactionally without exposing other projects", async () => {
    const f = await fixture(),
      id = await f.create();
    await f.t.run((ctx) => ctx.db.patch(id, { staging_lead_id: null }));
    await expect(
      f.c("staging_crew").query(api.operations.get, { id }),
    ).rejects.toThrow();
    let p = await f.get(id);
    await f.c("owner").mutation(api.operations.setTeam, {
      id,
      version: p.version,
      project_manager_id: f.who("admin").id,
      designer_id: f.who("designer").id,
      staging_lead_id: null,
      additional: [{ user_id: f.who("staging_crew").id, role: "crew" }],
    });
    expect(
      (await f.c("staging_crew").query(api.operations.get, { id })).id,
    ).toBe(id);
    p = await f.get(id);
    for (const item of p.checklist.filter(
      (c) => c.assigned_to === f.who("staging_crew").id,
    ))
      await f.c("owner").mutation(api.operations.checklist, {
        id: item._id,
        version: item.version,
        status: item.status,
        assigned_to: f.who("admin").id,
      });
    p = await f.get(id);
    await f.c("owner").mutation(api.operations.setTeam, {
      id,
      version: p.version,
      project_manager_id: f.who("admin").id,
      designer_id: f.who("designer").id,
      staging_lead_id: null,
      additional: [],
    });
    await expect(
      f.c("staging_crew").query(api.operations.get, { id }),
    ).rejects.toThrow();
  });
  it("daily capacity blocks a second booking and concurrent rescheduling has one winner", async () => {
    const f = await fixture(),
      a = await f.create(),
      b = await second(f);
    await f.ready(a);
    await f.ready(b);
    await f.c("owner").mutation(api.operations.saveSettings, {
      version: 0,
      input: JSON.stringify({ ...defaultSettings, max_stagings_per_day: 1 }),
    });
    const event = await f.schedule(a);
    await expect(f.schedule(b, "staging", 18)).rejects.toThrow();
    const p = await f.get(a),
      args = {
        project_id: a,
        project_version: p.version,
        id: event,
        version: 1,
        event_type: "staging" as const,
        title: "Rescheduled",
        description: "",
        location_note: "",
        start_at: day() + "T19:00:00Z",
        end_at: day() + "T20:00:00Z",
        assigned_lead_id: f.who("staging_crew").id,
      };
    const attempts = await Promise.allSettled(
      [1, 2].map(() => f.c("owner").mutation(api.operations.schedule, args)),
    );
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await f.get(a)).staging_date).toBe(day() + "T19:00:00.000Z");
  });
  it("unrelated sales cannot see projects, notes, agenda or search results", async () => {
    const f = await fixture(),
      id = await f.create();
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.oid, { assigned_to: f.who("owner").id });
      const project = (await ctx.db.get(id))!;
      await ctx.db.patch(project.realtor_id, {
        assigned_to: f.who("owner").id,
      });
    });
    await expect(
      f.c("sales").query(api.operations.get, { id }),
    ).rejects.toThrow();
    expect(
      (
        await f.c("sales").query(api.operations.list, {
          paginationOpts: { cursor: null, numItems: 25 },
        })
      ).page,
    ).toEqual([]);
    expect(
      await f.c("sales").query(api.operations.search, { q: "Fictional" }),
    ).toEqual([]);
    await expect(
      f.c("sales").query(api.operations.timeline, {
        id,
        kind: "notes",
        paginationOpts: { cursor: null, numItems: 10 },
      }),
    ).rejects.toThrow();
  });
});

it("combines project filters and keeps archived history out of active candidate pages", async () => {
  const f = await fixture(),
    id = await f.create();
  const paginationOpts = { cursor: null, numItems: 25 };
  expect(
    (
      await f.c("owner").query(api.operations.list, {
        paginationOpts,
        manager: f.who("admin").id,
        designer: f.who("owner").id,
      })
    ).page,
  ).toHaveLength(0);
  expect(
    (
      await f.c("owner").query(api.operations.list, {
        paginationOpts,
        manager: f.who("admin").id,
        designer: f.who("designer").id,
        property: f.pid,
      })
    ).page.map((p) => p.id),
  ).toEqual([id]);
  await f.c("owner").mutation(api.operations.transition, {
    id,
    version: (await f.get(id)).version,
    status: "cancelled",
    reason: "Fictional cancelled",
  });
  await f.c("owner").mutation(api.operations.archive, {
    id,
    version: (await f.get(id)).version,
    restore: false,
  });
  expect(
    (
      await f.c("owner").query(api.operations.list, {
        paginationOpts,
        archived: true,
        status: "cancelled",
      })
    ).page.map((p) => p.id),
  ).toEqual([id]);
  const fresh = await f
    .c("owner")
    .mutation(api.operations.create, f.createArgs);
  expect(
    (
      await f.c("owner").query(api.operations.list, { paginationOpts })
    ).page.map((p) => p.id),
  ).toEqual([fresh.id]);
});
