import { describe, it, expect } from "vitest";
import {
  commercialFixture as fixture,
  agreementTerms,
  acceptance,
} from "../support/commercial-unit-fixture";
import { api } from "../../convex/_generated/api";
import { day } from "../../src/lib/operations/model";
describe("M5 boundary, concurrency and scale regressions", () => {
  it.each(["designer", "staging_crew"] as const)(
    "preserves assigned Sales read scope when also assigned as %s",
    async (role) => {
      const f = await fixture(),
        id = await f.agreement();
      await f.t.run(async (ctx) => {
        const profile = await ctx.db
          .query("profiles")
          .withIndex("by_user", (q) => q.eq("userId", f.who("sales").id))
          .unique();
        await ctx.db.patch(profile!._id, { roles: ["sales", role] });
        await ctx.db.patch(
          f.project,
          role === "designer"
            ? { designer_id: f.who("sales").id }
            : { staging_lead_id: f.who("sales").id },
        );
      });
      expect(
        (await f.c("sales").query(api.commercial.agreement, { id })).manage,
      ).toBe(false);
      await expect(
        f.c("sales").mutation(api.commercial.agreementAction, {
          id,
          version: 3,
          action: "cancel",
          reason: "Must remain read only",
        }),
      ).rejects.toThrow();
      await f.t.run(async (ctx) => {
        await ctx.db.patch(f.oid, { assigned_to: f.who("owner").id });
        const p = await ctx.db.get(f.project);
        await ctx.db.patch(p!.realtor_id, { assigned_to: f.who("owner").id });
      });
      await expect(
        f.c("sales").query(api.commercial.agreement, { id }),
      ).rejects.toThrow();
    },
  );
  it("reconciles tiny multi-tax deposits without negative subtotals", async () => {
    const f = await fixture(),
      taxes = Array.from({ length: 5 }, (_, i) => ({
        name: "Tax " + i,
        basis_points: 10000,
      })),
      a = await f.saveAgreement({
        ...agreementTerms,
        subtotal: "0.01",
        taxes,
        deposit_type: "fixed",
        deposit_value: "0.01",
      });
    await f.owner.mutation(api.commercial.agreementAction, {
      id: a,
      version: 1,
      action: "send",
      reason: "Fictional penny test",
    });
    await f.owner.mutation(api.commercial.agreementAction, {
      id: a,
      version: 2,
      action: "accept",
      reason: "Fictional penny acceptance",
      evidence: acceptance,
    });
    const rows = [];
    for (const source_type of ["deposit", "balance"] as const) {
      const id = await f.owner.mutation(api.commercial.sourceInvoice, {
        project_id: f.project,
        customer_id: f.customer,
        agreement_id: a,
        source_type,
        issue_date: day(),
        due_date: day(),
      });
      rows.push(await f.invoice(id));
    }
    expect(rows.every((r) => BigInt(r.subtotal_cents) >= 0n)).toBe(true);
    expect(rows.reduce((n, r) => n + BigInt(r.total_cents), 0n)).toBe(6n);
    expect(rows.reduce((n, r) => n + BigInt(r.tax_cents), 0n)).toBe(5n);
  });
  it("rejects agreement acceptance after operational completion", async () => {
    const f = await fixture(),
      id = await f.saveAgreement();
    await f.owner.mutation(api.commercial.agreementAction, {
      id,
      version: 1,
      action: "send",
      reason: "Sent for acceptance",
    });
    await f.stage("completed");
    await expect(
      f.owner.mutation(api.commercial.agreementAction, {
        id,
        version: 2,
        action: "accept",
        reason: "Too late",
        evidence: acceptance,
      }),
    ).rejects.toThrow();
  });
  it("prevents direct M3 overwrite and concurrent extensions of the same period", async () => {
    const f = await fixture(),
      agreement = await f.agreement(),
      p = await f.get(f.project);
    await expect(
      f.owner.mutation(api.operations.update, {
        id: f.project,
        version: p.version,
        input: JSON.stringify({
          package_type: p.package_type,
          planned_end_date: "2099-02-01",
          priority: p.priority,
          internal_notes: "",
        }),
      }),
    ).rejects.toThrow();
    const make = () =>
      f.owner.mutation(api.commercial.createExtension, {
        agreement_id: agreement,
        project_version: p.version,
        input: JSON.stringify({
          new_end_date: "2099-02-01",
          type: "monthly",
          rate: "50",
          quantity: 1,
          taxes: [],
          reason: "New client period",
        }),
      });
    const result = await Promise.allSettled([make(), make()]);
    expect(result.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("rejects concurrent credit amounts that exceed the remaining collectible value", async () => {
    const f = await fixture(),
      id = await f.manual("100");
    await f.issue(id);
    const make = () =>
      f.owner.mutation(api.commercial.creditInvoice, {
        invoice_id: id,
        amount: "75",
        reason: "Concurrent credit",
      });
    const results = await Promise.allSettled([make(), make()]);
    expect(results.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((await f.invoice(id)).balance_cents).toBe("2500");
  });
  it("retains old agreement snapshots after a controlled replacement", async () => {
    const f = await fixture(),
      old = await f.agreement();
    const id = await f.owner.mutation(api.commercial.saveAgreement, {
      project_id: f.project,
      customer_id: f.customer,
      replaces_id: old,
      version: 0,
      input: JSON.stringify({ ...agreementTerms, subtotal: "1200" }),
    });
    await f.owner.mutation(api.commercial.agreementAction, {
      id,
      version: 1,
      action: "send",
      reason: "Replacement terms",
    });
    await f.owner.mutation(api.commercial.agreementAction, {
      id,
      version: 2,
      action: "accept",
      reason: "Replacement accepted",
      evidence: acceptance,
    });
    expect(
      await f.owner.query(api.commercial.agreement, { id: old }),
    ).toMatchObject({ status: "superseded", total_cents: "105000" });
    expect(
      (await f.owner.query(api.commercial.agreement, { id })).total_cents,
    ).toBe("126000");
  });
  it("keeps source defaults separate from accepted documents", async () => {
    const f = await fixture(),
      a = await f.agreement();
    await f.owner.mutation(api.commercial.saveSettings, {
      version: 0,
      input: JSON.stringify({
        taxes: [{ name: "New tax", basis_points: 1200 }],
        payment_terms: "New policy",
        extension_terms: "New rate",
        deposit_type: "percentage",
        deposit_value: "75",
      }),
    });
    expect(
      await f.owner.query(api.commercial.agreement, { id: a }),
    ).toMatchObject({
      deposit_cents: "52500",
      tax_cents: "5000",
      terms: { payment_terms: "Due on receipt" },
    });
  });
  it("returns exact indexed balances at representative project volume and paginates without dropping records", async () => {
    const f = await fixture();
    for (let n = 0; n < 30; n++) {
      const id = await f.manual("100.05");
      await f.issue(id);
      await f.payment("25.01", [{ invoice_id: id, amount: "25.01" }]);
    }
    expect(
      (await f.owner.query(api.commercial.project, { project_id: f.project }))
        .outstanding_cents,
    ).toBe("225120");
    expect(
      (await f.owner.query(api.commercial.dashboard, {})).outstanding_cents,
    ).toBe("225120");
    const first = await f.owner.query(api.commercial.receivables, {
      paginationOpts: { cursor: null, numItems: 20 },
      project_id: f.project,
      status: "unpaid",
      from: "",
      until: "",
    });
    expect(first.page.length).toBe(20);
    const next = await f.owner.query(api.commercial.receivables, {
      paginationOpts: { cursor: first.continueCursor, numItems: 20 },
      project_id: f.project,
      status: "unpaid",
      from: "",
      until: "",
    });
    expect(new Set([...first.page, ...next.page].map((i) => i._id)).size).toBe(
      30,
    );
    expect(next.isDone).toBe(true);
  });
  it("counts accepted deposits even before creating a deposit invoice", async () => {
    const f = await fixture();
    await f.agreement();
    expect(
      (await f.owner.query(api.commercial.dashboard, {})).deposit_unpaid,
    ).toBe(1);
  });
  it("restricts commercial audit and review queues to financial administrators", async () => {
    const f = await fixture(),
      id = await f.agreement();
    for (const role of [
      "sales",
      "designer",
      "staging_crew",
      "marketing",
    ] as const) {
      await expect(
        f.c(role).query(api.commercial.history, {
          id,
          paginationOpts: { cursor: null, numItems: 20 },
        }),
      ).rejects.toThrow();
      await expect(
        f.c(role).query(api.commercial.reviewQueue, {}),
      ).rejects.toThrow();
    }
  });
});
