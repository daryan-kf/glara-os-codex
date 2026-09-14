import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { operationsClient, wonFixture } from "./operations-fixture";
import { credentials } from "./identities";
import { day } from "../../src/lib/operations/model";
const results: { name: string; passed: boolean }[] = [];
async function check(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, passed: false });
    throw e;
  }
}
async function main() {
  const { client: c } = await operationsClient(),
    { client: admin } = await operationsClient("admin");
  const f = await wonFixture(c),
    g = await wonFixture(c),
    project = (await c.mutation(api.operations.create, f.createArgs)).id,
    other = (await c.mutation(api.operations.create, g.createArgs)).id;
  const bill = {
    type: "seller",
    name: `Fictional integrity ${f.suffix}`,
    contact: "",
    email: "integrity@accounts.example.test",
    phone: "",
    address: "Fictional original billing address",
    company: "",
  };
  const customer = await c.mutation(api.commercial.saveCustomer, {
    version: 0,
    input: JSON.stringify(bill),
  });
  const terms = {
    effective_date: day(),
    staging_start_date: day(),
    package_end_date: "2099-12-31",
    description: "Fictional staging",
    scope: "Fictional living room",
    subtotal: "5000",
    discount: "0",
    taxes: [{ name: "Original tax", basis_points: 500 }],
    deposit_type: "percentage",
    deposit_value: "50",
    payment_terms: "Original terms",
    extension_terms: "Original extension terms",
    cancellation_terms: "Original cancellation",
    liability_terms: "Original liability",
    special_terms: "",
    override_reason: "",
  };
  const evidence = JSON.stringify({
    name: "Fictional Seller",
    email: "",
    method: "manual_record",
    reference: "Fictional original acceptance",
  });
  const save = (project_id = project, source_quote_id = f.quote) =>
    c.mutation(
      api.commercial.saveAgreement,
      {
        project_id,
        customer_id: customer,
        source_quote_id,
        version: 0,
        input: JSON.stringify(terms),
      },
      { skipQueue: true },
    );
  let agreement!: Id<"agreements">, otherAgreement!: Id<"agreements">;
  await check(
    "source quote from a different project opportunity is rejected",
    () => assert.rejects(save(project, g.quote)),
  );
  await check(
    "simultaneous agreement creation has unique independent numbers",
    async () => {
      [agreement, otherAgreement] = await Promise.all([
        save(),
        save(other, g.quote),
      ]);
      const rows = await Promise.all(
        [agreement, otherAgreement].map((id) =>
          c.query(api.commercial.agreement, { id }),
        ),
      );
      assert.notEqual(rows[0].number, rows[1].number);
    },
  );
  const accept = async (id: Id<"agreements">) => {
    await c.mutation(api.commercial.agreementAction, {
      id,
      version: 1,
      action: "send",
      reason: "Fictional issue",
    });
    await c.mutation(api.commercial.agreementAction, {
      id,
      version: 2,
      action: "accept",
      reason: "Fictional acceptance",
      evidence,
    });
  };
  await accept(agreement);
  await accept(otherAgreement);
  await check(
    "accepted agreement edits and forged acceptance actor are rejected",
    async () => {
      await assert.rejects(
        c.mutation(api.commercial.saveAgreement, {
          id: agreement,
          project_id: project,
          customer_id: customer,
          source_quote_id: f.quote,
          version: 3,
          input: JSON.stringify({
            ...terms,
            subtotal: "1",
            override_reason: "Forbidden accepted edit",
          }),
        }),
      );
      const forged = {
        id: agreement,
        version: 3,
        action: "cancel" as const,
        reason: "Forged actor",
        actor_id: credentials("sales").id,
      };
      await assert.rejects(c.mutation(api.commercial.agreementAction, forged));
    },
  );
  const draftInput = {
    issue_date: day(),
    due_date: day(),
    notes: "Fictional draft",
    items: [
      {
        description: "Exact decimal service",
        quantity: 3,
        unit_amount: "33.35",
        discount: "0.05",
        taxes: [{ name: "Invoice tax", basis_points: 500 }],
      },
    ],
  };
  const manual = () =>
    c.mutation(
      api.commercial.saveInvoice,
      {
        project_id: project,
        customer_id: customer,
        version: 0,
        input: JSON.stringify(draftInput),
      },
      { skipQueue: true },
    );
  let invoice!: Id<"invoices">, spare!: Id<"invoices">;
  await check(
    "simultaneous invoice creation has unique numbers and exact cents",
    async () => {
      [invoice, spare] = await Promise.all([manual(), manual()]);
      const a = await c.query(api.commercial.invoice, { id: invoice }),
        b = await c.query(api.commercial.invoice, { id: spare });
      assert.notEqual(a.number, b.number);
      assert.equal(a.subtotal_cents, "10005");
      assert.equal(a.discount_cents, "5");
      assert.equal(a.tax_cents, "500");
      assert.equal(a.total_cents, "10500");
    },
  );
  await check(
    "Admin edits draft then issues; issued terms cannot be rewritten",
    async () => {
      await admin.mutation(api.commercial.saveInvoice, {
        id: invoice,
        version: 1,
        project_id: project,
        customer_id: customer,
        input: JSON.stringify({
          ...draftInput,
          notes: "Admin approved final draft",
        }),
      });
      await admin.mutation(api.commercial.invoiceAction, {
        id: invoice,
        version: 2,
        action: "issue",
        reason: "Admin issuance",
      });
      await assert.rejects(
        admin.mutation(api.commercial.saveInvoice, {
          id: invoice,
          version: 3,
          project_id: project,
          customer_id: customer,
          input: JSON.stringify({
            ...draftInput,
            notes: "Forbidden issued rewrite",
          }),
        }),
      );
      assert.equal(
        (await c.query(api.commercial.invoice, { id: invoice })).notes,
        "Admin approved final draft",
      );
    },
  );
  await check(
    "void retains items and original number, blocks payments on void",
    async () => {
      const before = await c.query(api.commercial.invoice, { id: spare });
      await c.mutation(api.commercial.invoiceAction, {
        id: spare,
        version: 1,
        action: "void",
        reason: "Fictional duplicate draft",
      });
      const after = await c.query(api.commercial.invoice, { id: spare });
      assert.equal(after.number, before.number);
      assert.deepEqual(after.items, before.items);
      await assert.rejects(
        c.mutation(api.commercial.recordPayment, {
          project_id: project,
          customer_id: customer,
          amount: "1",
          method: "cash",
          received_date: day(),
          external_reference: "",
          notes: "",
          request_key: randomUUID(),
          allocations: [{ invoice_id: spare, amount: "1" }],
        }),
      );
    },
  );
  const agreementBefore = await c.query(api.commercial.agreement, {
      id: agreement,
    }),
    invoiceBefore = await c.query(api.commercial.invoice, { id: invoice });
  await check(
    "upstream Realtor Property customer tax defaults and assignments do not change historical snapshots",
    async () => {
      await c.mutation(api.crm.write, {
        input: JSON.stringify({
          op: "realtor_update",
          id: f.realtor.id,
          version: 1,
          data: {
            first_name: "Fictional renamed",
            last_name: f.suffix,
            relationship_status: "active_partner",
            assigned_to: credentials("sales").id,
          },
        }),
      });
      await c.mutation(api.sales.saveProperty, {
        id: f.property,
        version: 1,
        input: JSON.stringify({
          address_line_1: `Changed fictional ${f.suffix} Avenue`,
          city: "Burnaby",
          province: "BC",
          property_type: "detached",
          occupancy_status: "vacant",
          realtor_id: f.realtor.id,
        }),
      });
      await c.mutation(api.commercial.saveCustomer, {
        id: customer,
        version: 1,
        input: JSON.stringify({
          ...bill,
          name: "Fictional changed billing name",
          address: "Fictional changed billing address",
        }),
      });
      const old = (await c.query(api.commercial.configuration, {})).settings;
      try {
        await c.mutation(api.commercial.saveSettings, {
          version: old.version,
          input: JSON.stringify({
            taxes: [{ name: "Changed fictional tax", basis_points: 1700 }],
            payment_terms: "Changed fictional policy",
            extension_terms: "Changed fictional extension",
            deposit_type: "percentage",
            deposit_value: "75",
          }),
        });
        const p = await c.query(api.operations.get, { id: project });
        await c.mutation(api.operations.setTeam, {
          id: project,
          version: p.version,
          project_manager_id: f.createArgs.project_manager_id,
          designer_id: credentials("owner").id as Id<"users">,
          staging_lead_id: f.createArgs.staging_lead_id,
          additional: [
            {
              user_id: credentials("designer").id as Id<"users">,
              role: "designer",
            },
          ],
        });
        assert.deepEqual(
          await c.query(api.commercial.agreement, { id: agreement }),
          agreementBefore,
        );
        assert.deepEqual(
          await c.query(api.commercial.invoice, { id: invoice }),
          invoiceBefore,
        );
      } finally {
        const current = (await c.query(api.commercial.configuration, {}))
          .settings;
        await c.mutation(api.commercial.saveSettings, {
          version: current.version,
          input: JSON.stringify({
            taxes: old.taxes,
            payment_terms: old.payment_terms,
            extension_terms: old.extension_terms,
            deposit_type: old.deposit_type,
            deposit_value: old.deposit_value,
          }),
        });
      }
    },
  );
  await check(
    "replacement supersedes accepted agreement while retaining its original terms",
    async () => {
      const id = await c.mutation(api.commercial.saveAgreement, {
        project_id: other,
        customer_id: customer,
        replaces_id: otherAgreement,
        source_quote_id: g.quote,
        version: 0,
        input: JSON.stringify({
          ...terms,
          subtotal: "5100",
          override_reason: "Fictional approved scope change",
        }),
      });
      await accept(id);
      const old = await c.query(api.commercial.agreement, {
        id: otherAgreement,
      });
      assert.equal(old.status, "superseded");
      assert.equal(old.total_cents, "525000");
      assert.equal(
        (await c.query(api.commercial.agreement, { id })).total_cents,
        "535500",
      );
    },
  );
  const pay = (
    amount: string,
    allocations: { invoice_id: Id<"invoices">; amount: string }[] = [],
  ) =>
    admin.mutation(
      api.commercial.recordPayment,
      {
        project_id: project,
        customer_id: customer,
        amount,
        method: "cash",
        received_date: day(),
        external_reference: "Fictional receipt",
        notes: "",
        request_key: randomUUID(),
        allocations,
      },
      { skipQueue: true },
    );
  await check(
    "payment numbering concurrency and authenticated Admin actor",
    async () => {
      const ids = await Promise.all([pay("10"), pay("20")]);
      const rows = await Promise.all(
        ids.map((id) => c.query(api.commercial.payment, { id })),
      );
      assert.notEqual(rows[0].number, rows[1].number);
      assert(rows.every((r) => r.recorded_by === credentials("admin").id));
    },
  );
  await check(
    "partial payment status and over-allocation denial preserve balance",
    async () => {
      await pay("25", [{ invoice_id: invoice, amount: "25" }]);
      let row = await c.query(api.commercial.invoice, { id: invoice });
      assert.equal(row.effective_status, "partially_paid");
      assert.equal(row.balance_cents, "8000");
      await assert.rejects(
        pay("100", [{ invoice_id: invoice, amount: "80.01" }]),
      );
      row = await c.query(api.commercial.invoice, { id: invoice });
      assert.equal(row.balance_cents, "8000");
    },
  );
  await check(
    "concurrent credits preserve immutable total and cannot exceed invoice amount",
    async () => {
      const args = {
        invoice_id: invoice,
        amount: "75",
        reason: "Fictional correction",
      };
      const r = await Promise.allSettled([
        c.mutation(api.commercial.creditInvoice, args, { skipQueue: true }),
        c.mutation(api.commercial.creditInvoice, args, { skipQueue: true }),
      ]);
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
      const row = await c.query(api.commercial.invoice, { id: invoice });
      assert.equal(row.total_cents, "10500");
      assert.equal(row.balance_cents, "500");
    },
  );
  await check(
    "simultaneous overlapping extension proposals accept only one original period",
    async () => {
      const p = await c.query(api.operations.get, { id: project }),
        args = {
          agreement_id: agreement,
          project_version: p.version,
          input: JSON.stringify({
            new_end_date: "2100-01-31",
            type: "monthly",
            rate: "55.55",
            quantity: 2,
            taxes: [],
            reason: "Fictional same period",
          }),
        };
      const r = await Promise.allSettled([
        c.mutation(api.commercial.createExtension, args, { skipQueue: true }),
        c.mutation(api.commercial.createExtension, args, { skipQueue: true }),
      ]);
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
    },
  );
  await check(
    "operational projections never include commercial values or Bill-To",
    async () => {
      for (const role of ["designer", "staging_crew"]) {
        const { client } = await operationsClient(role);
        const p = await client.query(api.operations.get, { id: project }),
          i = await client.query(api.inventory.projectInventory, {
            project_id: project,
          });
        assert.doesNotMatch(
          JSON.stringify([p, i]),
          /bill_to|deposit_cents|amount_cents|Original liability|Fictional original billing/,
        );
      }
      const { client: marketing } = await operationsClient("marketing");
      await assert.rejects(
        marketing.query(api.commercial.invoice, { id: invoice }),
      );
    },
  );
  await check(
    "no-charge decision preserves M4 incident and creates no invoice",
    async () => {
      const room = (await c.query(api.operations.get, { id: other })).rooms[0]
          ._id,
        category = await c.mutation(api.inventory.saveCategory, {
          version: 0,
          name: `Fictional no-charge ${f.suffix}`,
          active: true,
        }),
        location = await c.mutation(api.inventory.saveLocation, {
          version: 0,
          input: JSON.stringify({
            name: `Fictional no-charge ${f.suffix}`,
            type: "warehouse",
            address: "Fictional",
            active: true,
            staging_source: true,
            retail_source: false,
          }),
        }),
        product = await c.mutation(api.inventory.saveProduct, {
          version: 0,
          category_id: category,
          input: JSON.stringify({
            sku: `M5-NO-${f.suffix}`,
            name: "Fictional no-charge chair",
            track_mode: "quantity",
            active: true,
            staging_eligible: true,
            retail_eligible: false,
          }),
        });
      await c.mutation(api.inventory.receive, {
        product_id: product,
        location_id: location,
        quantity: 1,
        condition: "good",
        acquisition_date: day(),
        reason: "Fictional receipt",
      });
      const line = await c.mutation(api.inventory.reserve, {
        project_id: other,
        project_room_id: room,
        product_id: product,
        location_id: location,
        quantity: 1,
        needed_from: day(),
        needed_until: "2099-12-31",
        notes: "",
        planned: false,
      });
      await c.mutation(api.inventory.moveReservation, {
        id: line,
        version: 1,
        action: "damage",
        quantity: 1,
        asset_confirmation: "",
        reason: "Fictional pre-existing wear",
      });
      const damage = (
        await c.query(api.commercial.project, { project_id: other })
      ).unassessed_incidents[0];
      const before = await c.query(api.inventory.projectInventory, {
        project_id: other,
      });
      const id = await c.mutation(api.commercial.createAssessment, {
        project_id: other,
        damage_record_id: damage.id,
      });
      await admin.mutation(api.commercial.decideAssessment, {
        id,
        version: 1,
        decision: "no_charge",
        approved_amount: "0",
        reason: "Fictional normal wear review",
      });
      assert.equal(
        (await c.query(api.commercial.assessment, { id })).customer_responsible,
        false,
      );
      await assert.rejects(
        c.mutation(api.commercial.sourceInvoice, {
          project_id: other,
          customer_id: customer,
          source_type: "assessment",
          assessment_id: id,
          issue_date: day(),
          due_date: day(),
        }),
      );
      assert.deepEqual(
        await c.query(api.inventory.projectInventory, { project_id: other }),
        before,
      );
    },
  );
}
main()
  .catch((e) => {
    console.error(
      "Extended acceptance stopped: " +
        (e instanceof Error ? e.name : "failure"),
    );
    process.exitCode = 1;
  })
  .finally(() =>
    writeFileSync(
      "docs/M5-hosted-integrity-results.json",
      JSON.stringify(
        {
          deployment: "woozy-jaguar-392",
          timestamp: new Date().toISOString(),
          results,
          passed: results.filter((r) => r.passed).length,
          failed: results.filter((r) => !r.passed).length,
          completed: process.exitCode !== 1,
        },
        null,
        2,
      ) + "\n",
    ),
  );
