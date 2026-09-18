import { describe, it, expect } from "vitest";
import { commercialFixture } from "../support/commercial-unit-fixture";
import { api } from "../../convex/_generated/api";
import { addDays, day, defaultSettings } from "../../src/lib/operations/model";
import type { Role } from "../../src/lib/permissions";
const args = { q: "", paginationOpts: { cursor: null, numItems: 15 } };
describe("payment project suggestions", () => {
  it("opens without a search and derives unpaid, partial, paid and reversed balances", async () => {
    const f = await commercialFixture();
    const invoice = await f.manual("100");
    expect(
      (await f.owner.query(api.commercial.paymentProjects, args)).page,
    ).toHaveLength(0);
    await f.issue(invoice);
    let rows = (await f.owner.query(api.commercial.paymentProjects, args)).page;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: f.project,
      outstanding_cents: "10000",
      partially_paid: false,
    });
    await f.payment("25", [{ invoice_id: invoice, amount: "25" }]);
    rows = (await f.owner.query(api.commercial.paymentProjects, args)).page;
    expect(rows[0]).toMatchObject({
      outstanding_cents: "7500",
      partially_paid: true,
    });
    const payment = await f.payment("75", [
      { invoice_id: invoice, amount: "75" },
    ]);
    expect(
      (await f.owner.query(api.commercial.paymentProjects, args)).page,
    ).toHaveLength(0);
    await f.owner.mutation(api.commercial.reversePayment, {
      id: payment,
      reason: "Correct fictional receipt",
    });
    expect(
      (await f.owner.query(api.commercial.paymentProjects, args)).page[0]
        .outstanding_cents,
    ).toBe("7500");
  });
  it("includes renewal-only projects at the configured boundary, today and expired, but excludes closed or archived projects", async () => {
    const f = await commercialFixture();
    for (const days of [31, 30, 0, -1]) {
      await f.t.run((ctx) =>
        ctx.db.patch(f.project, { planned_end_date: addDays(day(), days) }),
      );
      const rows = (await f.owner.query(api.commercial.paymentProjects, args))
        .page;
      expect(rows.length).toBe(days > 30 ? 0 : 1);
      if (days <= 30)
        expect(rows[0]).toMatchObject({
          outstanding_cents: "0",
          renewal_days: days,
        });
    }
    for (const status of [
      "sold",
      "destaging_scheduled",
      "destaging",
      "completed",
      "cancelled",
    ] as const) {
      await f.t.run((ctx) => ctx.db.patch(f.project, { status }));
      expect(
        (await f.owner.query(api.commercial.paymentProjects, args)).page,
      ).toHaveLength(0);
    }
    await f.t.run((ctx) =>
      ctx.db.patch(f.project, {
        status: "staged",
        deleted_at: new Date().toISOString(),
      }),
    );
    expect(
      (await f.owner.query(api.commercial.paymentProjects, args)).page,
    ).toHaveLength(0);
  });
  it("searches number, address and realtor case-insensitively and retains cursor access beyond a filtered empty page", async () => {
    const f = await commercialFixture();
    await f.t.run(async (ctx) => {
      const p = await ctx.db.get(f.project);
      await ctx.db.patch(f.project, { planned_end_date: day() });
      for (let n = 0; n < 17; n++) {
        const { _id, _creationTime, ...copy } = p!;
        void _id;
        void _creationTime;
        await ctx.db.insert("projects", {
          ...copy,
          project_number: `OTHER-${n}`,
          planned_end_date: "2099-01-01",
        });
      }
    });
    const first = await f.owner.query(api.commercial.paymentProjects, args);
    expect(first.page).toHaveLength(0);
    expect(first.isDone).toBe(false);
    const second = await f.owner.query(api.commercial.paymentProjects, {
      ...args,
      paginationOpts: { cursor: first.continueCursor, numItems: 15 },
    });
    expect(second.page[0].id).toBe(f.project);
    for (const q of [
      "FICTIONAL",
      "Crescent",
      second.page[0].name.split(" · ")[0],
    ]) {
      const found = await f.owner.query(api.commercial.paymentProjects, {
        ...args,
        q,
        paginationOpts: { cursor: first.continueCursor, numItems: 15 },
      });
      expect(found.page[0].id).toBe(f.project);
    }
    expect(
      (
        await f.owner.query(api.commercial.paymentProjects, {
          ...args,
          q: "not-a-project",
        })
      ).page,
    ).toHaveLength(0);
    await expect(
      f.owner.query(api.commercial.paymentProjects, {
        ...args,
        q: "x".repeat(101),
      }),
    ).rejects.toThrow();
  });
  it("honours configured renewal windows and does not list archived debt", async () => {
    const f = await commercialFixture();
    await f.t.run(async (ctx) => {
      const now = new Date().toISOString();
      await ctx.db.insert("operations_settings", {
        ...defaultSettings,
        key: "operations",
        package_alert_days: [7],
        version: 1,
        created_at: now,
        updated_at: now,
        deleted_at: null,
      });
      await ctx.db.patch(f.project, { planned_end_date: addDays(day(), 8) });
    });
    expect(
      (await f.owner.query(api.commercial.paymentProjects, args)).page,
    ).toHaveLength(0);
    await f.t.run((ctx) =>
      ctx.db.patch(f.project, { planned_end_date: addDays(day(), 7) }),
    );
    expect(
      (await f.owner.query(api.commercial.paymentProjects, args)).page[0]
        .renewal_days,
    ).toBe(7);
    const invoice = await f.manual("100");
    await f.issue(invoice);
    await f.t.run((ctx) =>
      ctx.db.patch(f.project, { deleted_at: new Date().toISOString() }),
    );
    expect(
      (await f.owner.query(api.commercial.paymentProjects, args)).page,
    ).toHaveLength(0);
  });
  it("uses credits rather than treating a fully credited invoice as unpaid", async () => {
    const f = await commercialFixture();
    const invoice = await f.manual("100");
    await f.issue(invoice);
    await f.owner.mutation(api.commercial.creditInvoice, {
      invoice_id: invoice,
      amount: "100",
      reason: "Fictional service cancelled",
    });
    expect(
      (await f.owner.query(api.commercial.paymentProjects, args)).page,
    ).toHaveLength(0);
  });
  it.each(["sales", "designer", "staging_crew", "marketing"] as Role[])(
    "denies direct financial lookup by %s",
    async (role) => {
      const f = await commercialFixture();
      await expect(
        f.c(role).query(api.commercial.paymentProjects, args),
      ).rejects.toThrow();
    },
  );
  it("denies anonymous and archived users, permits Admin", async () => {
    const f = await commercialFixture();
    await expect(
      f.t.query(api.commercial.paymentProjects, args),
    ).rejects.toThrow();
    await expect(
      f.c("admin").query(api.commercial.paymentProjects, args),
    ).resolves.toBeDefined();
    await f.t.run(async (ctx) => {
      const profile = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", f.who("owner").id))
        .unique();
      await ctx.db.patch(profile!._id, {
        deleted_at: new Date().toISOString(),
      });
    });
    await expect(
      f.owner.query(api.commercial.paymentProjects, args),
    ).rejects.toThrow();
  });
});
