import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { operationsClient, wonFixture } from "./operations-fixture";
import { day } from "../../src/lib/operations/model";
const results: { name: string; passed: boolean }[] = [];
async function check(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (error) {
    results.push({ name, passed: false });
    throw error;
  }
}
async function main() {
  if (process.env.GLARA_CONVEX_ACCEPTANCE !== "yes")
    throw Error("Fictional hosted acceptance opt-in required");
  const { client: c, url } = await operationsClient(),
    f = await wonFixture(c),
    project = (await c.mutation(api.operations.create, f.createArgs)).id;
  const get = () => c.query(api.operations.get, { id: project }),
    room = (await get()).rooms[0]._id;
  const eventDay = process.env.GLARA_M5_EVENT_DAY ?? "2026-07-15";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDay) || eventDay > day())
    throw Error("Invalid event day");
  const customer = await c.mutation(api.commercial.saveCustomer, {
    version: 0,
    input: JSON.stringify({
      type: "seller",
      name: `Fictional M5 ${f.suffix}`,
      contact: "Fictional Seller",
      email: "m5@accounts.example.test",
      phone: "",
      address: "100 Fictional Avenue, Vancouver BC",
      company: "",
    }),
  });
  const evidence = JSON.stringify({
    name: "Fictional Seller",
    email: "m5@accounts.example.test",
    method: "manual_record",
    reference: "Fictional hosted acknowledgement",
  });
  const agreement = await c.mutation(api.commercial.saveAgreement, {
    project_id: project,
    customer_id: customer,
    source_quote_id: f.quote,
    version: 0,
    input: JSON.stringify({
      effective_date: eventDay,
      staging_start_date: eventDay,
      package_end_date: "2099-12-31",
      description: "Fictional full staging",
      scope: "Living room",
      subtotal: "5000",
      discount: "0",
      taxes: [{ name: "Configured staging tax", basis_points: 500 }],
      deposit_type: "percentage",
      deposit_value: "50",
      payment_terms: "Due on receipt",
      extension_terms: "Explicit approval",
      cancellation_terms: "Fictional cancellation",
      liability_terms: "Proven customer-caused loss only",
      special_terms: "",
      override_reason: "",
    }),
  });
  await c.mutation(api.commercial.agreementAction, {
    id: agreement,
    version: 1,
    action: "send",
    reason: "Fictional terms sent",
  });
  await c.mutation(api.commercial.agreementAction, {
    id: agreement,
    version: 2,
    action: "accept",
    reason: "Fictional acceptance recorded",
    evidence,
  });
  const invoice = (id: Id<"invoices">) =>
    c.query(api.commercial.invoice, { id });
  const issue = async (id: Id<"invoices">) =>
    c.mutation(api.commercial.invoiceAction, {
      id,
      version: (await invoice(id)).version,
      action: "issue",
      reason: "Issue fictional document",
    });
  const pay = (
    amount: string,
    allocations: { invoice_id: Id<"invoices">; amount: string }[] = [],
  ) =>
    c.mutation(api.commercial.recordPayment, {
      project_id: project,
      customer_id: customer,
      amount,
      method: "e_transfer",
      received_date: day(),
      external_reference: "Fictional hosted receipt",
      notes: "",
      request_key: randomUUID(),
      allocations,
    });
  const source = (source_type: "deposit" | "balance") =>
    c.mutation(api.commercial.sourceInvoice, {
      project_id: project,
      customer_id: customer,
      source_type,
      agreement_id: agreement,
      issue_date: day(),
      due_date: day(),
    });
  let deposit!: Id<"invoices">, balance!: Id<"invoices">;
  await check(
    "hosted concurrent deposit requests produce one document",
    async () => {
      const r = await Promise.allSettled([
        source("deposit"),
        source("deposit"),
      ]);
      const ok = r.filter(
        (x): x is PromiseFulfilledResult<Id<"invoices">> =>
          x.status === "fulfilled",
      );
      assert.equal(ok.length, 1);
      deposit = ok[0].value;
      balance = await source("balance");
      assert.equal(
        BigInt((await invoice(deposit)).total_cents) +
          BigInt((await invoice(balance)).total_cents),
        525000n,
      );
    },
  );
  await issue(deposit);
  await issue(balance);
  await check(
    "hosted multi-invoice allocations and visible unallocated excess",
    async () => {
      const id = await pay("3000", [
        { invoice_id: deposit, amount: "2625" },
        { invoice_id: balance, amount: "100" },
      ]);
      assert.equal((await invoice(deposit)).effective_status, "paid");
      assert.equal((await invoice(balance)).balance_cents, "252500");
      assert.equal(
        (await c.query(api.commercial.payment, { id })).unallocated_cents,
        "27500",
      );
    },
  );
  await check(
    "hosted concurrent allocation cannot overpay an invoice",
    async () => {
      const r = await Promise.allSettled([
        pay("2000", [{ invoice_id: balance, amount: "2000" }]),
        pay("2000", [{ invoice_id: balance, amount: "2000" }]),
      ]);
      assert.equal(r.filter((x) => x.status === "fulfilled").length, 1);
      assert.equal((await invoice(balance)).balance_cents, "52500");
    },
  );
  await check(
    "hosted reversal retains evidence and restores balance",
    async () => {
      const id = await pay("1", [{ invoice_id: balance, amount: "1" }]);
      await c.mutation(api.commercial.reversePayment, {
        id,
        reason: "Fictional reversal acceptance",
      });
      assert.equal((await invoice(balance)).balance_cents, "52500");
      assert.equal(
        (await c.query(api.commercial.payment, { id })).status,
        "reversed",
      );
    },
  );
  await check(
    "hosted accepted agreement blocks a direct M3 package-date overwrite",
    async () => {
      const p = await get();
      await assert.rejects(
        c.mutation(api.operations.update, {
          id: project,
          version: p.version,
          input: JSON.stringify({
            package_type: p.package_type,
            planned_end_date: "2098-01-01",
            priority: p.priority,
            internal_notes: "",
          }),
        }),
      );
    },
  );
  await check(
    "hosted extension is explicit, preserves original agreement and invoices once",
    async () => {
      const x = await c.mutation(api.commercial.createExtension, {
        agreement_id: agreement,
        project_version: (await get()).version,
        input: JSON.stringify({
          new_end_date: "2100-01-31",
          type: "monthly",
          rate: "100",
          quantity: 1,
          taxes: [{ name: "Extension tax", basis_points: 500 }],
          reason: "Fictional extension",
        }),
      });
      assert.equal((await get()).planned_end_date, "2099-12-31");
      await c.mutation(api.commercial.extensionAction, {
        id: x,
        version: 1,
        accept: true,
        evidence,
      });
      assert.equal((await get()).planned_end_date, "2100-01-31");
      assert.equal(
        (await c.query(api.commercial.agreement, { id: agreement })).terms
          .package_end_date,
        "2099-12-31",
      );
      const args = {
        project_id: project,
        customer_id: customer,
        source_type: "extension" as const,
        extension_id: x,
        issue_date: day(),
        due_date: day(),
      };
      await issue(await c.mutation(api.commercial.sourceInvoice, args));
      await assert.rejects(c.mutation(api.commercial.sourceInvoice, args));
    },
  );
  await check(
    "hosted unauthenticated and restricted roles cannot read commercial data",
    async () => {
      await assert.rejects(
        new ConvexHttpClient(url, { logger: false }).query(
          api.commercial.agreement,
          { id: agreement },
        ),
      );
      for (const role of [
        "designer",
        "staging_crew",
        "marketing",
        "archived",
        "unassigned",
      ]) {
        const { client } = await operationsClient(role);
        await assert.rejects(
          client.query(api.commercial.project, { project_id: project }),
        );
        await assert.rejects(
          client.query(api.commercial.invoice, { id: deposit }),
        );
        await assert.rejects(
          client.mutation(api.commercial.recordPayment, {
            project_id: project,
            customer_id: customer,
            amount: "1",
            method: "cash",
            received_date: day(),
            external_reference: "",
            notes: "",
            request_key: randomUUID(),
            allocations: [],
          }),
        );
      }
      const { client: sales } = await operationsClient("sales");
      assert.equal(
        (await sales.query(api.commercial.agreement, { id: agreement })).manage,
        false,
      );
      await assert.rejects(sales.query(api.commercial.dashboard, {}));
    },
  );
  const category = await c.mutation(api.inventory.saveCategory, {
      version: 0,
      name: `Fictional M5 ${f.suffix}`,
      active: true,
    }),
    location = await c.mutation(api.inventory.saveLocation, {
      version: 0,
      input: JSON.stringify({
        name: `M5 warehouse ${f.suffix}`,
        type: "warehouse",
        address: "Fictional",
        active: true,
        staging_source: true,
        retail_source: false,
      }),
    });
  const assets: {
    product: Id<"products">;
    asset: Id<"inventory_assets">;
    line: Id<"inventory_reservations">;
  }[] = [];
  for (let n = 0; n < 3; n++) {
    const product = await c.mutation(api.inventory.saveProduct, {
      version: 0,
      category_id: category,
      input: JSON.stringify({
        sku: `M5-${f.suffix}-${n}`,
        name: `Fictional M5 chair ${n} ${f.suffix}`,
        track_mode: "serialized",
        active: true,
        staging_eligible: true,
        retail_eligible: false,
      }),
    });
    const asset = (await c.mutation(api.inventory.receive, {
      product_id: product,
      location_id: location,
      quantity: 1,
      condition: "good",
      acquisition_date: eventDay,
      reason: "Fictional M5 receipt",
    }))!;
    const line = await c.mutation(api.inventory.reserve, {
      project_id: project,
      project_room_id: room,
      product_id: product,
      asset_id: asset,
      location_id: location,
      quantity: 1,
      needed_from: eventDay,
      needed_until: "2100-02-01",
      notes: "",
      planned: false,
    });
    assets.push({ product, asset, line });
  }
  const lines = () =>
    c.query(api.inventory.projectInventory, { project_id: project });
  const row = async (id: Id<"inventory_reservations">) =>
    (await lines()).lines.find((r) => r._id === id)!;
  const move = async (
    line: Id<"inventory_reservations">,
    action: "pick" | "install" | "destage" | "return" | "missing" | "found",
  ) => {
    const r = await row(line);
    return c.mutation(api.inventory.moveReservation, {
      id: line,
      version: r.version,
      action,
      quantity: 1,
      asset_confirmation: r.asset_number!,
      location_id: location,
      reason: "Fictional M5 movement",
      return_outcome: action === "return" ? "damaged" : undefined,
    });
  };
  const transition = async (
    status: Parameters<
      typeof c.mutation<typeof api.operations.transition>
    >[1]["status"],
    date?: string,
  ) =>
    c.mutation(api.operations.transition, {
      id: project,
      version: (await get()).version,
      status,
      date,
    });
  const complete = async (category: string) => {
    for (const item of (await get()).checklist.filter(
      (x) => x.category === category && x.required && x.status !== "completed",
    ))
      await c.mutation(api.operations.checklist, {
        id: item._id,
        version: item.version,
        status: "completed",
      });
  };
  const schedule = async (event_type: "staging" | "destaging", hour: number) =>
    c.mutation(api.operations.schedule, {
      project_id: project,
      project_version: (await get()).version,
      version: 0,
      event_type,
      title: "Fictional M5 " + event_type,
      description: "",
      location_note: "",
      start_at: `${eventDay}T${hour}:00:00Z`,
      end_at: `${eventDay}T${hour + 1}:00:00Z`,
      assigned_lead_id: f.createArgs.staging_lead_id!,
    });
  await transition("designing");
  await complete("pre_staging");
  await transition("ready_to_schedule");
  await schedule("staging", 15);
  await transition("staging");
  for (const a of assets) {
    await move(a.line, "pick");
    await move(a.line, "install");
  }
  await complete("staging");
  await transition("staged");
  await transition("listing_live", eventDay);
  await transition("sold", eventDay);
  await schedule("destaging", 18);
  await complete("destaging");
  await transition("destaging");
  for (const a of assets.slice(0, 2)) {
    await move(a.line, "destage");
    await move(a.line, "return");
  }
  await move(assets[2].line, "missing");
  const incidentRows = (
    await c.query(api.commercial.project, { project_id: project })
  ).unassessed_incidents;
  const ids: Id<"damage_charge_assessments">[] = [];
  await check(
    "hosted returned damage and missing inventory do not automatically create charges",
    async () => {
      assert.equal(incidentRows.length, 3);
      assert.equal(
        (await c.query(api.commercial.project, { project_id: project }))
          .assessments.length,
        0,
      );
    },
  );
  for (const a of assets) {
    const asset = await c.query(api.inventory.asset, { id: a.asset });
    const incident = incidentRows.find(
      (d) => d.asset_number === asset.asset_number,
    )!;
    ids.push(
      await c.mutation(api.commercial.createAssessment, {
        project_id: project,
        damage_record_id: incident.id,
        agreement_id: agreement,
      }),
    );
  }
  const assess = (id: Id<"damage_charge_assessments">) =>
    c.query(api.commercial.assessment, { id });
  const review = async (id: Id<"damage_charge_assessments">) =>
    c.mutation(api.commercial.reviewAssessment, {
      id,
      version: (await assess(id)).version,
      input: JSON.stringify({
        liability_basis: "client_damage",
        valuation_basis: "repair_cost",
        notes: "Fictional evidence review",
        description: "Fictional approved damage charge",
        proposed_amount: "125",
        taxes: [{ name: "Damage-specific tax", basis_points: 500 }],
      }),
    });
  const approve = async (id: Id<"damage_charge_assessments">) =>
    c.mutation(api.commercial.decideAssessment, {
      id,
      version: (await assess(id)).version,
      decision: "approve",
      approved_amount: "100",
      reason: "Fictional liability approved",
    });
  const charge = (id: Id<"damage_charge_assessments">) =>
    c.mutation(api.commercial.sourceInvoice, {
      project_id: project,
      customer_id: customer,
      source_type: "assessment",
      assessment_id: id,
      issue_date: day(),
      due_date: day(),
    });
  await check(
    "hosted waiver creates no invoice and preserves the damage incident",
    async () => {
      await review(ids[1]);
      await c.mutation(api.commercial.decideAssessment, {
        id: ids[1],
        version: 2,
        decision: "waive",
        approved_amount: "0",
        reason: "Fictional goodwill waiver",
      });
      await assert.rejects(charge(ids[1]));
      assert.equal((await row(assets[1].line)).state, "inspection");
      assert.equal((await assess(ids[1])).status, "waived");
    },
  );
  let damageInvoice!: Id<"invoices">, missingInvoice!: Id<"invoices">;
  await check(
    "hosted approved damage is billed once under concurrent requests",
    async () => {
      await review(ids[0]);
      await approve(ids[0]);
      const r = await Promise.allSettled([charge(ids[0]), charge(ids[0])]);
      const ok = r.filter(
        (x): x is PromiseFulfilledResult<Id<"invoices">> =>
          x.status === "fulfilled",
      );
      assert.equal(ok.length, 1);
      damageInvoice = ok[0].value;
      await issue(damageInvoice);
    },
  );
  await check("hosted damage payment leaves asset in repair", async () => {
    const a = assets[0],
      r = await row(a.line);
    await c.mutation(api.inventory.inspect, {
      reservation_id: a.line,
      asset_id: a.asset,
      product_id: a.product,
      location_id: location,
      version: r.version,
      quantity: 1,
      from_state: "inspection",
      result: "repair",
      condition: "damaged",
      notes: "Fictional repair assessment",
    });
    await pay("105", [{ invoice_id: damageInvoice, amount: "105" }]);
    assert.equal((await assess(ids[0])).effective_status, "paid");
    assert.equal(
      (await c.query(api.inventory.asset, { id: a.asset })).status,
      "repair",
    );
  });
  await check(
    "hosted partial credit retains paid invoice and surfaces refund review",
    async () => {
      await c.mutation(api.commercial.creditInvoice, {
        invoice_id: damageInvoice,
        amount: "5",
        reason: "Fictional partial charge correction",
      });
      assert.equal((await invoice(damageInvoice)).total_cents, "10500");
      assert.equal((await invoice(damageInvoice)).credit_balance_cents, "500");
    },
  );
  await check(
    "hosted missing recovery requires inspection and financial correction",
    async () => {
      await review(ids[2]);
      await approve(ids[2]);
      missingInvoice = await charge(ids[2]);
      await issue(missingInvoice);
      await move(assets[2].line, "found");
      assert.equal((await row(assets[2].line)).state, "inspection");
      assert.equal((await assess(ids[2])).recovered_conflict, true);
      assert.equal((await invoice(missingInvoice)).total_cents, "10500");
      await c.mutation(api.commercial.creditInvoice, {
        invoice_id: missingInvoice,
        amount: "105",
        reason: "Recovered missing item full credit",
      });
      assert.equal(
        (await invoice(missingInvoice)).effective_status,
        "credited",
      );
    },
  );
  await check(
    "hosted financial actions retain authenticated audit identity",
    async () => {
      const logs = await c.query(api.commercial.history, {
        id: ids[0],
        paginationOpts: { cursor: null, numItems: 20 },
      });
      assert(logs.page.length >= 3);
      const viewer = await c.query(api.profiles.viewer, {});
      assert(logs.page.every((l) => l.actor_id === viewer!.id));
    },
  );
  await check(
    "hosted M4 reconciliation still controls completion with unpaid commercial warning",
    async () => {
      await assert.rejects(transition("completed"));
      for (const a of assets) {
        const r = await row(a.line);
        await c.mutation(api.inventory.inspect, {
          reservation_id: a.line,
          asset_id: a.asset,
          product_id: a.product,
          location_id: location,
          version: r.version,
          quantity: 1,
          from_state: r.state as "repair" | "inspection",
          result: "available",
          condition: "good",
          notes: "Fictional final physical reconciliation",
        });
      }
      await transition("completed");
      assert(
        (
          await c.query(api.commercial.project, { project_id: project })
        ).alerts.includes("COMMERCIAL BALANCE OUTSTANDING"),
      );
    },
  );
  writeFileSync(
    "docs/M5-hosted-fixture.json",
    JSON.stringify(
      {
        project,
        agreement,
        deposit,
        balance,
        damageInvoice,
        missingInvoice,
        assessments: ids,
        fictional: true,
      },
      null,
      2,
    ) + "\n",
  );
}
main()
  .catch((error) => {
    console.error(
      "M5 hosted acceptance stopped: " +
        (error instanceof Error ? error.name : "failure"),
    );
    process.exitCode = 1;
  })
  .finally(() => {
    writeFileSync(
      "docs/M5-hosted-api-results.json",
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
    );
  });
