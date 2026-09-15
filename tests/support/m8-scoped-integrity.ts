import assert from "node:assert/strict";
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { z } from "zod";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { operationsClient } from "./operations-fixture";
import { credentials } from "./identities";
async function main() {
  assert.equal(process.env.GLARA_M8_ACCEPTANCE, "yes");
  const { client: c, user } = await operationsClient();
  assert.equal(user.email, "glara-convex-owner@accounts.example.test");
  const d = ".acceptance/m8/resume",
    f = JSON.parse(readFileSync(d + "/fixture.json", "utf8")) as {
      product: Id<"products">;
      invoice: Id<"invoices">;
      location: Id<"inventory_locations">;
    },
    n = JSON.parse(readFileSync(d + "/numerical-fixture.json", "utf8")) as {
      product: Id<"products">;
    };
  const ledger = [];
  for (const product of [f.product, n.product]) {
    const p = await c.query(api.inventory.product, { id: product });
    assert.match(p.name, /^Fictional M8/);
    assert.equal(p.partial, false);
    let cursor: string | null = null,
      count = 0;
    const totals = new Map<string, number>();
    do {
      const h: import("convex/server").FunctionReturnType<
        typeof api.inventory.history
      > = await c.query(api.inventory.history, {
        product_id: product,
        paginationOpts: { cursor, numItems: 20 },
      });
      for (const m of h.page) {
        count++;
        for (const delta of m.stock_deltas) {
          const key = delta.location_id + ":" + delta.bucket;
          totals.set(key, (totals.get(key) ?? 0) + delta.delta);
        }
      }
      cursor = h.isDone ? null : h.continueCursor;
    } while (cursor);
    for (const s of p.stock)
      for (const bucket of [
        "available",
        "inspection",
        "cleaning",
        "repair",
        "damaged",
        "missing",
        "sold",
        "retired",
      ] as const)
        assert.equal(s[bucket], totals.get(s.location_id + ":" + bucket) ?? 0);
    ledger.push({ product, movements: count, bucket_mismatches: 0 });
  }
  const i = await c.query(api.commercial.invoice, { id: f.invoice });
  assert.equal(i.balance_cents, "7704");
  assert.equal(i.allocations.length, 1);
  assert.equal(i.allocations[0].amount_cents, "2311");
  const known = new Set<string>();
  for (const file of readdirSync(d).filter(
    (x) => /^(enabled-|clean-acceptance)/.test(x) && x.endsWith(".json"),
  )) {
    const a = JSON.parse(readFileSync(d + "/" + file, "utf8"));
    for (const record of a.live ?? []) {
      const p = (record.view ?? record).proposal;
      if (p?._id) known.add(p._id);
    }
  }
  const executed = [];
  for (const proposal of known) {
    const audit = await c.query(api.profiles.audit, { entity_id: proposal });
    for (const event of audit.filter(
      (x) => x.action === "AI_PROPOSAL_EXECUTED",
    )) {
      assert.ok(event.actor_id);
      executed.push({
        proposal,
        actor: event.actor_id,
        new_value: event.new_value,
      });
    }
  }
  const browser = [];
  let page = 1,
    total = 0;
  do {
    const listing = z
      .object({
        total: z.number(),
        rows: z.array(
          z
            .object({
              id: z.string(),
              first_name: z.string(),
              last_name: z.string(),
            })
            .passthrough(),
        ),
      })
      .parse(
        await c.query(api.crm.read, {
          input: JSON.stringify({
            op: "list",
            q: "Fictional M8 browser",
            page,
          }),
        }),
      );
    total = listing.total;
    for (const r of listing.rows) {
      assert.equal(r.first_name, "Fictional M8 browser");
      assert.match(r.last_name, /^[a-f0-9]{8}$/);
      const a = z
        .object({
          rows: z.array(
            z
              .object({ id: z.string(), title: z.string(), status: z.string() })
              .passthrough(),
          ),
        })
        .parse(
          await c.query(api.crm.read, {
            input: JSON.stringify({ op: "activities", id: r.id }),
          }),
        );
      const approved = a.rows.filter(
        (x) => x.title === "Fictional browser human approved follow-up",
      );
      assert.ok(approved.length <= 1);
      for (const x of approved) {
        const audit = await c.query(api.profiles.audit, { entity_id: x.id });
        assert.ok(audit.some((e) => e.actor_id === credentials("owner").id));
        browser.push({ realtor: r.id, activity: x.id, duplicates: 0 });
      }
    }
    page++;
  } while ((page - 1) * 25 < total && page < 10);
  assert.ok(browser.length >= 2);
  writeFileSync(
    d + "/final-scoped-integrity.json",
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        ledger,
        invoice_balance_cents: i.balance_cents,
        payment_allocation_cents: i.allocations[0].amount_cents,
        known_proposals: known.size,
        executed,
        browser_approved: browser,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({
      reconciled_M8_products: ledger.length,
      ledger_mismatches: 0,
      invoice_balance_cents: i.balance_cents,
      allocation_count: i.allocations.length,
      known_proposals: known.size,
      executed_known_proposals: executed.length,
      browser_approved: browser.length,
      browser_duplicates: 0,
    }),
  );
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Scoped integrity failed");
  process.exitCode = 1;
});
