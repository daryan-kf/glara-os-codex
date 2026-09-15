import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { api } from "../../convex/_generated/api";
import { operationsClient, wonFixture } from "./operations-fixture";
import { day } from "../../src/lib/operations/model";
async function main() {
  assert.equal(process.env.GLARA_M7_ACCEPTANCE, "yes");
  const { client: c } = await operationsClient(),
    base = await wonFixture(c),
    marker = "Fictional M7 clean " + base.suffix;
  const project = (
    await c.mutation(api.operations.create, {
      ...base.createArgs,
      input: JSON.stringify({
        ...JSON.parse(base.createArgs.input),
        internal_notes: marker,
      }),
    })
  ).id;
  const customer = await c.mutation(api.commercial.saveCustomer, {
    version: 0,
    input: JSON.stringify({
      type: "seller",
      name: marker,
      contact: "Fictional",
      email: "m7@accounts.example.test",
      phone: "",
      company: "",
      address: "Fictional address",
    }),
  });
  const agreement = await c.mutation(api.commercial.saveAgreement, {
    project_id: project,
    customer_id: customer,
    source_quote_id: base.quote,
    version: 0,
    input: JSON.stringify({
      effective_date: day(),
      staging_start_date: day(),
      package_end_date: "2099-12-31",
      description: marker,
      scope: "Living room",
      subtotal: "5000",
      discount: "0",
      taxes: [{ name: "Fictional configured tax", basis_points: 500 }],
      deposit_type: "percentage",
      deposit_value: "50",
      payment_terms: marker,
      extension_terms: marker,
      cancellation_terms: marker,
      liability_terms: marker,
      special_terms: "",
      override_reason: marker,
    }),
  });
  await c.mutation(api.commercial.agreementAction, {
    id: agreement,
    version: 1,
    action: "send",
    reason: marker,
  });
  await c.mutation(api.commercial.agreementAction, {
    id: agreement,
    version: 2,
    action: "accept",
    reason: marker,
    evidence: JSON.stringify({
      name: marker,
      email: "m7@accounts.example.test",
      method: "manual_record",
      reference: marker,
    }),
  });
  const category = await c.mutation(api.inventory.saveCategory, {
    version: 0,
    name: marker,
    active: true,
  });
  const location = await c.mutation(api.inventory.saveLocation, {
    version: 0,
    input: JSON.stringify({
      name: marker,
      type: "warehouse",
      address: "Fictional",
      active: true,
      staging_source: true,
      retail_source: false,
    }),
  });
  const product = await c.mutation(api.inventory.saveProduct, {
    category_id: category,
    version: 0,
    input: JSON.stringify({
      sku: "M7C-" + base.suffix,
      name: marker,
      track_mode: "serialized",
      staging_eligible: true,
      retail_eligible: false,
      active: true,
    }),
  });
  const asset = await c.mutation(api.inventory.receive, {
    product_id: product,
    location_id: location,
    quantity: 1,
    condition: "good",
    acquisition_date: day(),
    reason: marker,
  });
  mkdirSync("test-results", { recursive: true });
  writeFileSync(
    "test-results/m7-matrix-fixture.json",
    JSON.stringify({ project, customer, agreement, marker }),
  );
  writeFileSync(
    "test-results/m7-lifecycle-fixture.json",
    JSON.stringify({
      project,
      customer,
      agreement,
      realtor: base.realtor.id,
      asset,
      product,
      location,
      marker,
    }),
  );
  console.log(
    "Fresh fictional M7 operations fixture created through native APIs.",
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Native fixture failed");
  process.exitCode = 1;
});
