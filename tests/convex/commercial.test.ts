import { describe, it, expect } from "vitest";
import {
  commercialFixture as fixture,
  agreementTerms,
  acceptance,
  billing,
} from "../support/commercial-unit-fixture";
import { api } from "../../convex/_generated/api";
import { day } from "../../src/lib/operations/model";
import type { Role } from "../../src/lib/permissions";
describe("M5 commercial transaction and security boundaries", () => {
  it.each(["designer", "staging_crew", "marketing"] as Role[])(
    "denies %s every commercial query and mutation directly",
    async (role) => {
      const f = await fixture(),
        a = await f.agreement(),
        i = await f.manual(),
        p = await f.payment("10"),
        c = f.c(role);
      for (const operation of [
        () => c.query(api.commercial.project, { project_id: f.project }),
        () => c.query(api.commercial.agreement, { id: a }),
        () => c.query(api.commercial.invoice, { id: i }),
        () => c.query(api.commercial.payment, { id: p }),
        () => c.query(api.commercial.dashboard, {}),
        () => c.query(api.commercial.configuration, {}),
        () =>
          c.mutation(api.commercial.saveCustomer, {
            version: 0,
            input: JSON.stringify(billing),
          }),
        () =>
          c.mutation(api.commercial.reversePayment, {
            id: p,
            reason: "Forbidden caller",
          }),
      ])
        await expect(operation()).rejects.toThrow();
    },
  );
  it("allows assigned Sales read only; denies unassigned Sales and archived Owner", async () => {
    const f = await fixture(),
      id = await f.agreement();
    expect(
      (await f.c("sales").query(api.commercial.agreement, { id })).number,
    ).toContain("AGR");
    await expect(
      f.c("sales").mutation(api.commercial.agreementAction, {
        id,
        version: 3,
        action: "cancel",
        reason: "Forbidden",
      }),
    ).rejects.toThrow();
    await f.t.run(async (ctx) => {
      const o = await ctx.db.get(f.createArgs.opportunity_id);
      await ctx.db.patch(o!._id, { assigned_to: f.who("owner").id });
      const project = await ctx.db.get(f.project);
      await ctx.db.patch(project!.realtor_id, {
        assigned_to: f.who("owner").id,
      });
    });
    await expect(
      f.c("sales").query(api.commercial.agreement, { id }),
    ).rejects.toThrow();
    await f.t.run(async (ctx) => {
      const p = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", f.who("owner").id))
        .unique();
      await ctx.db.patch(p!._id, { deleted_at: new Date().toISOString() });
    });
    await expect(
      f.owner.query(api.commercial.agreement, { id }),
    ).rejects.toThrow();
  });
  it("freezes sent terms and bill-to snapshots, rejects stale and forged audit actor", async () => {
    const f = await fixture(),
      id = await f.saveAgreement();
    await f.owner.mutation(api.commercial.agreementAction, {
      id,
      version: 1,
      action: "send",
      reason: "Send snapshot",
    });
    await expect(
      f.owner.mutation(api.commercial.saveAgreement, {
        id,
        project_id: f.project,
        customer_id: f.customer,
        version: 2,
        input: JSON.stringify({ ...agreementTerms, subtotal: "1" }),
      }),
    ).rejects.toThrow();
    await f.owner.mutation(api.commercial.saveCustomer, {
      id: f.customer,
      version: 1,
      input: JSON.stringify({ ...billing, name: "Changed customer" }),
    });
    expect(
      (await f.owner.query(api.commercial.agreement, { id })).bill_to.name,
    ).toBe(billing.name);
    await expect(
      f.owner.mutation(api.commercial.agreementAction, {
        id,
        version: 1,
        action: "accept",
        reason: "Stale revision",
        evidence: acceptance,
      }),
    ).rejects.toThrow();
    const forged = {
      id,
      version: 2,
      action: "accept" as const,
      reason: "Forged identity",
      evidence: acceptance,
      actor_id: f.who("sales").id,
    };
    await expect(
      f.owner.mutation(api.commercial.agreementAction, forged),
    ).rejects.toThrow();
  });
  it("allocates deposit plus balance exactly and blocks duplicate source invoicing", async () => {
    const f = await fixture(),
      a = await f.agreement();
    const make = (source_type: "deposit" | "balance") =>
      f.owner.mutation(api.commercial.sourceInvoice, {
        project_id: f.project,
        customer_id: f.customer,
        agreement_id: a,
        source_type,
        issue_date: day(),
        due_date: day(),
      });
    const deposit = await make("deposit");
    await expect(make("deposit")).rejects.toThrow();
    const balance = await make("balance"),
      rows = await Promise.all([f.invoice(deposit), f.invoice(balance)]);
    expect(rows.reduce((n, i) => n + BigInt(i.total_cents), 0n)).toBe(105000n);
    expect(rows.reduce((n, i) => n + BigInt(i.tax_cents), 0n)).toBe(5000n);
    await expect(make("balance")).rejects.toThrow();
    await f.issue(deposit);
    await expect(
      f.owner.mutation(api.commercial.saveInvoice, {
        id: deposit,
        project_id: f.project,
        customer_id: f.customer,
        version: 2,
        input: JSON.stringify({
          issue_date: day(),
          due_date: day(),
          notes: "edit issued",
          items: [],
        }),
      }),
    ).rejects.toThrow();
  });
  it("serializes duplicate deposit requests and unique independent numbering", async () => {
    const f = await fixture(),
      a = await f.agreement();
    const requests = () =>
      f.owner.mutation(api.commercial.sourceInvoice, {
        project_id: f.project,
        customer_id: f.customer,
        agreement_id: a,
        source_type: "deposit",
        issue_date: day(),
        due_date: day(),
      });
    const results = await Promise.allSettled([requests(), requests()]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const invoices = await Promise.all([f.manual(), f.manual(), f.manual()]);
    const numbers = (await Promise.all(invoices.map(f.invoice))).map(
      (i) => i.number,
    );
    expect(new Set(numbers).size).toBe(3);
    const p = await f.payment("1");
    expect(
      (await f.owner.query(api.commercial.payment, { id: p })).number,
    ).toMatch(/PAY-\d{4}-0001$/);
  });
  it("supports multi-invoice payment, unallocated excess, reversal and paid credits", async () => {
    const f = await fixture(),
      a = await f.manual("100"),
      b = await f.manual("75");
    await f.issue(a);
    await f.issue(b);
    const payment = await f.payment("200", [
      { invoice_id: a, amount: "100" },
      { invoice_id: b, amount: "50" },
    ]);
    expect((await f.invoice(a)).effective_status).toBe("paid");
    expect((await f.invoice(b)).balance_cents).toBe("2500");
    expect(
      (await f.owner.query(api.commercial.payment, { id: payment }))
        .unallocated_cents,
    ).toBe("5000");
    await f.owner.mutation(api.commercial.allocatePayment, {
      id: payment,
      allocations: [{ invoice_id: b, amount: "25" }],
    });
    await f.owner.mutation(api.commercial.creditInvoice, {
      invoice_id: a,
      amount: "10",
      reason: "Partial service credit",
    });
    expect((await f.invoice(a)).credit_balance_cents).toBe("1000");
    await f.owner.mutation(api.commercial.reversePayment, {
      id: payment,
      reason: "Receipt entered incorrectly",
    });
    expect((await f.invoice(a)).balance_cents).toBe("9000");
    expect((await f.invoice(b)).balance_cents).toBe("7500");
    await expect(
      f.owner.mutation(api.commercial.reversePayment, {
        id: payment,
        reason: "Duplicate reversal",
      }),
    ).rejects.toThrow();
    await expect(
      f.owner.mutation(api.commercial.allocatePayment, {
        id: payment,
        allocations: [{ invoice_id: b, amount: "1" }],
      }),
    ).rejects.toThrow();
  });
  it("rejects over-allocation, wrong customer, duplicate allocations and invalid payments atomically", async () => {
    const f = await fixture(),
      i = await f.manual();
    await f.issue(i);
    await expect(
      f.payment("100", [{ invoice_id: i, amount: "100.01" }]),
    ).rejects.toThrow();
    await expect(
      f.payment("100", [
        { invoice_id: i, amount: "50" },
        { invoice_id: i, amount: "50" },
      ]),
    ).rejects.toThrow();
    await expect(f.payment("-1")).rejects.toThrow();
    const other = await f.owner.mutation(api.commercial.saveCustomer, {
      version: 0,
      input: JSON.stringify({ ...billing, name: "Other customer" }),
    });
    await f.t.run((ctx) => ctx.db.patch(i, { customer_id: other }));
    await expect(
      f.payment("10", [{ invoice_id: i, amount: "10" }]),
    ).rejects.toThrow();
    expect(
      await f.t.run((ctx) => ctx.db.query("payments").collect()),
    ).toHaveLength(0);
  });
  it("prevents concurrent invoice overpayment and keeps failed payment out of ledger", async () => {
    const f = await fixture(),
      i = await f.manual();
    await f.issue(i);
    const results = await Promise.allSettled([
      f.payment("75", [{ invoice_id: i, amount: "75" }]),
      f.payment("75", [{ invoice_id: i, amount: "75" }]),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect((await f.invoice(i)).balance_cents).toBe("2500");
  });
  it("preserves void history and blocks void until valid payments reversed", async () => {
    const f = await fixture(),
      i = await f.manual();
    await f.issue(i);
    const p = await f.payment("10", [{ invoice_id: i, amount: "10" }]);
    await expect(
      f.owner.mutation(api.commercial.invoiceAction, {
        id: i,
        version: 2,
        action: "void",
        reason: "Void paid invoice",
      }),
    ).rejects.toThrow();
    await f.owner.mutation(api.commercial.reversePayment, {
      id: p,
      reason: "Incorrect receipt",
    });
    await f.owner.mutation(api.commercial.invoiceAction, {
      id: i,
      version: 2,
      action: "void",
      reason: "Duplicate invoice",
    });
    const row = await f.invoice(i);
    expect(row.status).toBe("void");
    expect(row.items).toHaveLength(1);
    expect(row.total_cents).toBe("10000");
    expect(row.voided_by).toBe(f.who("owner").id);
  });
  it("accepts explicit extension, preserves original terms and blocks direct date override", async () => {
    const f = await fixture(),
      a = await f.agreement(),
      p = await f.get(f.project);
    const id = await f.owner.mutation(api.commercial.createExtension, {
      agreement_id: a,
      project_version: p.version,
      input: JSON.stringify({
        new_end_date: "2099-02-01",
        type: "monthly",
        rate: "100",
        quantity: 1,
        taxes: [],
        reason: "Client extension request",
      }),
    });
    expect((await f.get(f.project)).planned_end_date).toBe("2099-01-01");
    await f.owner.mutation(api.commercial.extensionAction, {
      id,
      version: 1,
      accept: true,
      evidence: acceptance,
    });
    expect((await f.get(f.project)).planned_end_date).toBe("2099-02-01");
    expect(
      (await f.owner.query(api.commercial.agreement, { id: a })).terms
        .package_end_date,
    ).toBe("2099-01-01");
    await expect(
      f.owner.mutation(api.commercial.extensionAction, {
        id,
        version: 1,
        accept: true,
        evidence: acceptance,
      }),
    ).rejects.toThrow();
    const history = await f.owner.query(api.commercial.project, {
      project_id: f.project,
    });
    expect(history.alerts).toContain("Accepted extension awaiting invoice");
  });
  it("does not expose commercial fields through operational or inventory projections", async () => {
    const f = await fixture();
    await f.agreement();
    await f.payment("25");
    for (const role of ["designer", "staging_crew"] as Role[]) {
      const project = await f
          .c(role)
          .query(api.operations.get, { id: f.project }),
        inventory = await f
          .c(role)
          .query(api.inventory.projectInventory, { project_id: f.project });
      const serialized = JSON.stringify([project, inventory]);
      for (const token of [
        "bill_to",
        "deposit_cents",
        "payment_terms",
        "amount_cents",
        "GLA-AGR",
        "GLA-PAY",
      ])
        expect(serialized).not.toContain(token);
    }
  });
});
