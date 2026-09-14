import { inventoryFixture } from "./inventory-unit-fixture";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { day } from "../../src/lib/operations/model";
export const billing = {
  type: "seller",
  name: "M5 Fictional Seller",
  contact: "Fictional",
  email: "billing@accounts.example.test",
  phone: "",
  company: "",
  address: "100 Fictional Avenue, Vancouver BC",
};
export const agreementTerms = {
  effective_date: day(),
  staging_start_date: day(),
  package_end_date: "2099-01-01",
  description: "Fictional staging",
  scope: "Living room",
  subtotal: "1000",
  discount: "0",
  taxes: [{ name: "Configured tax", basis_points: 500 }],
  deposit_type: "percentage",
  deposit_value: "50",
  payment_terms: "Due on receipt",
  extension_terms: "Explicit acceptance required",
  cancellation_terms: "Fictional terms",
  liability_terms: "Customer liable for proven damage only",
  special_terms: "",
  override_reason: "",
};
export const acceptance = JSON.stringify({
  name: "Fictional Seller",
  email: "billing@accounts.example.test",
  method: "manual_record",
  reference: "Fictional recorded acknowledgement",
});
export async function commercialFixture(
  mode: "quantity" | "serialized" = "serialized",
) {
  const f = await inventoryFixture(mode),
    c = f.owner;
  const customer = await c.mutation(api.commercial.saveCustomer, {
    version: 0,
    input: JSON.stringify(billing),
  });
  const saveAgreement = (input = agreementTerms) =>
    c.mutation(api.commercial.saveAgreement, {
      project_id: f.project,
      customer_id: customer,
      version: 0,
      input: JSON.stringify(input),
    });
  const agreement = async () => {
    const id = await saveAgreement();
    await c.mutation(api.commercial.agreementAction, {
      id,
      version: 1,
      action: "send",
      reason: "Send fictional terms",
    });
    await c.mutation(api.commercial.agreementAction, {
      id,
      version: 2,
      action: "accept",
      reason: "Accepted fictional terms",
      evidence: acceptance,
    });
    return id;
  };
  const manual = async (
    amount = "100",
    taxes: { name: string; basis_points: number }[] = [],
  ) =>
    c.mutation(api.commercial.saveInvoice, {
      project_id: f.project,
      customer_id: customer,
      version: 0,
      input: JSON.stringify({
        issue_date: day(),
        due_date: day(),
        notes: "Fictional",
        items: [
          {
            description: "Fictional service",
            quantity: 1,
            unit_amount: amount,
            discount: "0",
            taxes,
          },
        ],
      }),
    });
  const issue = async (id: Id<"invoices">) =>
    c.mutation(api.commercial.invoiceAction, {
      id,
      version: (await invoice(id)).version,
      action: "issue",
      reason: "Issue fictional invoice",
    });
  const invoice = (id: Id<"invoices">) =>
    c.query(api.commercial.invoice, { id });
  const payment = (
    amount: string,
    allocations: { invoice_id: Id<"invoices">; amount: string }[] = [],
  ) =>
    c.mutation(api.commercial.recordPayment, {
      project_id: f.project,
      customer_id: customer,
      amount,
      method: "e_transfer",
      received_date: day(),
      external_reference: "Fictional receipt",
      notes: "",
      request_key: crypto.randomUUID(),
      allocations,
    });
  const incident = async (type: "damage" | "missing" = "damage") => {
    const line = await f.reserve(1);
    await f.stage("scheduled");
    await f.move(line, "pick");
    await f.stage("staging");
    await f.move(line, "install");
    await f.move(line, type);
    const d = await f.t.run((ctx) =>
      ctx.db
        .query("inventory_damage")
        .withIndex("by_project", (q) => q.eq("project_id", f.project))
        .order("desc")
        .first(),
    );
    return { line, damage: d! };
  };
  const assessment = (
    damage: Id<"inventory_damage">,
    agreementId?: Id<"agreements">,
  ) =>
    c.mutation(api.commercial.createAssessment, {
      project_id: f.project,
      damage_record_id: damage,
      agreement_id: agreementId,
    });
  const getAssessment = (id: Id<"damage_charge_assessments">) =>
    c.query(api.commercial.assessment, { id });
  const review = async (
    id: Id<"damage_charge_assessments">,
    amount = "125.25",
  ) =>
    c.mutation(api.commercial.reviewAssessment, {
      id,
      version: (await getAssessment(id)).version,
      input: JSON.stringify({
        liability_basis: "client_damage",
        valuation_basis: "repair_cost",
        notes: "Reviewed fictional evidence",
        description: "Fictional charge",
        proposed_amount: amount,
        taxes: [{ name: "Explicit charge tax", basis_points: 500 }],
      }),
    });
  const approve = async (id: Id<"damage_charge_assessments">, amount = "100") =>
    c.mutation(api.commercial.decideAssessment, {
      id,
      version: (await getAssessment(id)).version,
      decision: "approve",
      approved_amount: amount,
      reason: "Approved after evidence review",
    });
  const charge = (id: Id<"damage_charge_assessments">) =>
    c.mutation(api.commercial.sourceInvoice, {
      project_id: f.project,
      customer_id: customer,
      source_type: "assessment",
      assessment_id: id,
      issue_date: day(),
      due_date: day(),
    });
  return {
    ...f,
    customer,
    saveAgreement,
    agreement,
    manual,
    issue,
    invoice,
    payment,
    incident,
    assessment,
    getAssessment,
    review,
    approve,
    charge,
  };
}
