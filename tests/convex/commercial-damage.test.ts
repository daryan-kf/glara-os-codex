import { describe, it, expect } from "vitest";
import { commercialFixture as fixture } from "../support/commercial-unit-fixture";
import { api } from "../../convex/_generated/api";
import type { Role } from "../../src/lib/permissions";
import type { Id } from "../../convex/_generated/dataModel";
async function prepared(type: "damage" | "missing" = "damage") {
  const f = await fixture(),
    agreement = await f.agreement(),
    incident = await f.incident(type),
    id = await f.assessment(incident.damage._id, agreement);
  return { ...f, ...incident, id, agreementId: agreement };
}
async function approved(type: "damage" | "missing" = "damage") {
  const f = await prepared(type);
  await f.review(f.id);
  await f.approve(f.id);
  return f;
}
async function physical(f: Awaited<ReturnType<typeof fixture>>) {
  return f.t.run(async (ctx) => ({
    assets: await ctx.db.query("inventory_assets").collect(),
    stock: await ctx.db.query("inventory_stock").collect(),
    lines: await ctx.db.query("inventory_reservations").collect(),
    movements: await ctx.db.query("inventory_movements").collect(),
    damage: await ctx.db.query("inventory_damage").collect(),
  }));
}
describe("M5 damage and missing-item commercial acceptance", () => {
  it("creates valid damage assessment with unresolved responsibility and snapshots", async () => {
    const f = await prepared();
    expect(await f.getAssessment(f.id)).toMatchObject({
      status: "review_required",
      customer_responsible: null,
      liability_basis: "unknown",
      approved_amount_cents: "0",
      liability_terms: "Customer liable for proven damage only",
      evidence: { product_name: "Fictional chair" },
    });
  });
  it("supports a distinct missing-item assessment", async () => {
    const f = await prepared("missing");
    expect((await f.getAssessment(f.id)).assessment_type).toBe("missing");
  });
  it("rejects mismatched project on a real incident", async () => {
    const f = await prepared();
    const other = await f.t.run(async (ctx) => {
      const p = await ctx.db.get(f.project);
      const { _id, _creationTime, ...fields } = p!;
      void _id;
      void _creationTime;
      return ctx.db.insert("projects", {
        ...fields,
        project_number: "GLS-2099-FAKE",
      });
    });
    await expect(
      f.owner.mutation(api.commercial.createAssessment, {
        project_id: other,
        damage_record_id: f.damage._id,
      }),
    ).rejects.toThrow();
  });
  it("rejects forged physical asset on inconsistent incident", async () => {
    const f = await fixture(),
      { damage } = await f.incident();
    await f.t.run((ctx) => ctx.db.patch(damage._id, { asset_id: null }));
    await expect(f.assessment(damage._id)).rejects.toThrow();
  });
  it("rejects a forged room or product relationship", async () => {
    const f = await fixture(),
      { damage } = await f.incident();
    await f.t.run((ctx) => ctx.db.patch(damage._id, { project_room_id: null }));
    await expect(f.assessment(damage._id)).rejects.toThrow();
  });
  it("does not create assessments or invoices automatically from an incident", async () => {
    const f = await fixture();
    await f.incident();
    expect(
      await f.t.run((ctx) =>
        ctx.db.query("damage_charge_assessments").collect(),
      ),
    ).toHaveLength(0);
    expect(
      await f.t.run((ctx) => ctx.db.query("invoices").collect()),
    ).toHaveLength(0);
    expect(
      (await f.owner.query(api.commercial.project, { project_id: f.project }))
        .unassessed_incidents,
    ).toHaveLength(1);
  });
  it.each(["sales", "designer", "staging_crew", "marketing"] as Role[])(
    "prevents %s from approving or creating charges",
    async (role) => {
      const f = await prepared();
      await expect(
        f.c(role).mutation(api.commercial.decideAssessment, {
          id: f.id,
          version: 1,
          decision: "approve",
          approved_amount: "10",
          reason: "Unauthorized approval",
        }),
      ).rejects.toThrow();
      await expect(
        f.c(role).mutation(api.commercial.createAssessment, {
          project_id: f.project,
          damage_record_id: f.damage._id,
        }),
      ).rejects.toThrow();
      if (role !== "sales")
        await expect(
          f.c(role).query(api.commercial.assessment, { id: f.id }),
        ).rejects.toThrow();
    },
  );
  it("permits assigned sales to read a minimal commercial evidence projection", async () => {
    const f = await prepared();
    const a = await f.c("sales").query(api.commercial.assessment, { id: f.id });
    expect(a.manage).toBe(false);
    expect(JSON.stringify(a.incident)).not.toContain("description");
  });
  it("records no-charge without changing M4", async () => {
    const f = await prepared(),
      before = await physical(f);
    await f.owner.mutation(api.commercial.decideAssessment, {
      id: f.id,
      version: 1,
      decision: "no_charge",
      approved_amount: "0",
      reason: "Normal wear and tear",
    });
    expect(await f.getAssessment(f.id)).toMatchObject({
      status: "no_charge",
      customer_responsible: false,
      decided_by: f.who("owner").id,
    });
    expect(await physical(f)).toEqual(before);
    await expect(f.charge(f.id)).rejects.toThrow();
  });
  it("records a reasoned waiver and preserves proposed value", async () => {
    const f = await prepared();
    await f.review(f.id);
    await f.owner.mutation(api.commercial.decideAssessment, {
      id: f.id,
      version: 2,
      decision: "waive",
      approved_amount: "0",
      reason: "Goodwill commercial waiver",
    });
    expect(await f.getAssessment(f.id)).toMatchObject({
      status: "waived",
      proposed_amount_cents: "12525",
      decision_reason: "Goodwill commercial waiver",
    });
    await expect(f.charge(f.id)).rejects.toThrow();
  });
  it("keeps proposal distinct from approved amount with explicit charge taxes", async () => {
    const f = await approved();
    const a = await f.getAssessment(f.id);
    expect(a.proposed_amount_cents).toBe("12525");
    expect(a.approved_amount_cents).toBe("10000");
    const invoice = await f.invoice(await f.charge(f.id));
    expect(invoice.total_cents).toBe("10500");
    expect(invoice.tax_lines[0].name).toBe("Explicit charge tax");
  });
  it("rejects zero and negative approval amounts", async () => {
    const f = await prepared();
    await f.review(f.id);
    await expect(f.approve(f.id, "0")).rejects.toThrow();
    await expect(f.approve(f.id, "-10")).rejects.toThrow();
  });
  it("requires reviewed responsibility before approval and approval before invoicing", async () => {
    const f = await prepared();
    await expect(f.approve(f.id)).rejects.toThrow();
    await expect(f.charge(f.id)).rejects.toThrow();
    await f.review(f.id);
    await expect(f.charge(f.id)).rejects.toThrow();
  });
  it("prevents duplicate incident assessments concurrently", async () => {
    const f = await fixture(),
      { damage } = await f.incident();
    const results = await Promise.allSettled([
      f.assessment(damage._id),
      f.assessment(damage._id),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("prevents duplicate charge invoices concurrently", async () => {
    const f = await approved();
    const results = await Promise.allSettled([f.charge(f.id), f.charge(f.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("does not rewrite issued evidence when M4 incident or product changes", async () => {
    const f = await approved(),
      id = await f.charge(f.id);
    await f.issue(id);
    const before = await f.invoice(id);
    await f.t.run(async (ctx) => {
      await ctx.db.patch(f.product, { name: "Renamed after issuance" });
      await ctx.db.patch(f.damage._id, {
        description: "Later inventory note",
        status: "resolved",
      });
    });
    const after = await f.invoice(id);
    expect(after.items).toEqual(before.items);
    expect(after.total_cents).toBe(before.total_cents);
  });
  it("requires void before controlled re-invoicing; preserves original source history", async () => {
    const f = await approved(),
      id = await f.charge(f.id);
    await f.issue(id);
    await f.owner.mutation(api.commercial.invoiceAction, {
      id,
      version: 2,
      action: "void",
      reason: "Correct document issue date",
    });
    const next = await f.charge(f.id);
    expect(next).not.toBe(id);
    expect((await f.invoice(id)).status).toBe("void");
    expect((await f.invoice(next)).source_id).toBe(f.id);
  });
  it("allocates charge payments normally without releasing physical damaged inventory", async () => {
    const f = await approved(),
      id = await f.charge(f.id);
    await f.issue(id);
    const before = await physical(f);
    await f.payment("105", [{ invoice_id: id, amount: "105" }]);
    expect((await f.getAssessment(f.id)).effective_status).toBe("paid");
    expect(await physical(f)).toEqual(before);
  });
  it("preserves paid charge invoices when partially credited", async () => {
    const f = await approved(),
      id = await f.charge(f.id);
    await f.issue(id);
    await f.payment("105", [{ invoice_id: id, amount: "105" }]);
    await f.owner.mutation(api.commercial.creditInvoice, {
      invoice_id: id,
      amount: "25",
      reason: "Partial damage adjustment",
    });
    const i = await f.invoice(id);
    expect(i.total_cents).toBe("10500");
    expect(i.credit_balance_cents).toBe("2500");
    await expect(
      f.owner.mutation(api.commercial.decideAssessment, {
        id: f.id,
        version: 3,
        decision: "waive",
        approved_amount: "0",
        reason: "Attempt silent rewrite",
      }),
    ).rejects.toThrow();
  });
  it("flags actual missing recovery, keeps invoice immutable and requires credit review", async () => {
    const f = await approved("missing"),
      id = await f.charge(f.id);
    await f.issue(id);
    const before = await f.invoice(id);
    await f.move(f.line, "found");
    expect((await f.getAssessment(f.id)).recovered_conflict).toBe(true);
    expect((await f.getLine(f.line)).state).toBe("inspection");
    expect((await f.invoice(id)).total_cents).toBe(before.total_cents);
  });
  it("does not label missing write-off as a recovered item", async () => {
    const f = await approved("missing");
    await f.charge(f.id);
    await f.move(f.line, "write_off");
    expect((await f.getAssessment(f.id)).recovered_conflict).toBe(false);
  });
  it("rejects stale concurrent assessment decisions", async () => {
    const f = await prepared();
    await f.review(f.id);
    const results = await Promise.allSettled([
      f.owner.mutation(api.commercial.decideAssessment, {
        id: f.id,
        version: 2,
        decision: "approve",
        approved_amount: "100",
        reason: "First decision",
      }),
      f.owner.mutation(api.commercial.decideAssessment, {
        id: f.id,
        version: 2,
        decision: "waive",
        approved_amount: "0",
        reason: "Concurrent waiver",
      }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("derives approval and audit actor from authenticated identity", async () => {
    const f = await approved();
    const a = await f.getAssessment(f.id);
    expect(a.approved_by).toBe(f.who("owner").id);
    const logs = await f.t.run((ctx) =>
      ctx.db
        .query("audit_logs")
        .withIndex("by_entity", (q) => q.eq("entity_id", f.id))
        .collect(),
    );
    expect(logs.length).toBeGreaterThanOrEqual(3);
    expect(logs.every((l) => l.actor_id === f.who("owner").id)).toBe(true);
    const args = {
      id: f.id,
      version: 3,
      decision: "waive" as const,
      approved_amount: "0",
      reason: "Spoofed actor",
      actor_id: "fake" as Id<"users">,
    };
    await expect(
      f.owner.mutation(api.commercial.decideAssessment, args),
    ).rejects.toThrow();
  });
});
