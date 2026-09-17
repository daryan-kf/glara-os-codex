import { convexTest } from "convex-test";
import { it, expect, describe } from "vitest";
import schema from "../../convex/schema";
import { api } from "../../convex/_generated/api";
import type { Role } from "../../src/lib/permissions";
const modules = import.meta.glob("../../convex/**/*.ts");
async function fixture() {
  const t = convexTest(schema, modules);
  const identities = await t.run(async (ctx) => {
    const rows = [];
    for (const role of ["owner", "sales", "marketing", "designer"] as Role[]) {
      const user = await ctx.db.insert("users", {
        email: role + "@accounts.example.test",
      });
      await ctx.db.insert("profiles", {
        userId: user,
        display_name: role,
        roles: [role],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        deleted_at: null,
      });
      const session = await ctx.db.insert("authSessions", {
        userId: user,
        expirationTime: Date.now() + 86400000,
      });
      rows.push({ role, user, subject: user + "|" + session });
    }
    return rows;
  });
  const who = (r: Role) => identities.find((u) => u.role === r)!;
  const c = (r: Role) => t.withIdentity({ subject: who(r).subject });
  const realtor = await c("sales").mutation(api.crm.write, {
    input: JSON.stringify({
      op: "realtor_create",
      data: {
        first_name: "Sales",
        last_name: "Fictional",
        assigned_to: who("sales").user,
        relationship_status: "active_partner",
      },
    }),
  });
  const pid = await c("sales").mutation(api.sales.saveProperty, {
    version: 0,
    input: JSON.stringify({
      address_line_1: "100 Fictional Lane",
      city: "Vancouver",
      province: "BC",
      property_type: "detached",
      occupancy_status: "vacant",
      realtor_id: realtor.id,
      seller_name: "Private seller",
      notes: "",
    }),
  });
  const oid = await c("sales").mutation(api.sales.saveOpportunity, {
    version: 0,
    input: JSON.stringify({
      property_id: pid,
      assigned_to: who("sales").user,
      estimated_value: "5000.01",
      probability: 20,
      next_action_title: "Call agent",
      next_action_date: "2099-01-01T18:00:00Z",
      notes: "",
    }),
  });
  const product = await t.run(async (ctx) => {
    const stamps = {
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      deleted_at: null,
    };
    const category = await ctx.db.insert("inventory_categories", {
      name: "Chairs",
      name_key: "chairs",
      active: true,
      version: 1,
      ...stamps,
    });
    return await ctx.db.insert("products", {
      sku: "TEST-SOFA",
      name: "Fictional sofa",
      category_id: category,
      brand: "",
      collection: "",
      description: "",
      color: "",
      material: "",
      dimensions: "",
      weight: "",
      track_mode: "quantity",
      purchase_price_cents: "40000",
      rental_price_cents: "10000",
      sale_price_cents: "75000",
      staging_eligible: true,
      retail_eligible: true,
      active: true,
      search_text: "TEST-SOFA Fictional sofa",
      version: 1,
      ...stamps,
    });
  });
  return { t, c, who, oid, product };
}
describe("staging, rental and sale quotes", () => {
  it("multiplies monthly lines by the rental period and stores type, period and product links", async () => {
    const f = await fixture();
    await f.c("owner").mutation(api.sales.setDiscountSettings, {
      version: 0,
      sales_bps: 1000,
      admin_bps: 2000,
    });
    const id = await f.c("sales").mutation(api.sales.saveQuote, {
      version: 0,
      input: JSON.stringify({
        opportunity_id: f.oid,
        quote_type: "staging",
        rental_months: 3,
        items: [
          {
            description: "Fictional sofa (TEST-SOFA)",
            quantity: 1,
            unit_price: "100.00",
            kind: "monthly",
            product_id: f.product,
          },
          { description: "Staging service", quantity: 1, unit_price: "500.00" },
          {
            description: "Delivery, packing & return",
            quantity: 1,
            unit_price: "200.00",
          },
        ],
        discount: "50.00",
        tax_rate: "5.00",
        valid_until: "2099-01-01",
      }),
    });
    const q = (await f.c("sales").query(api.sales.getQuote, { id }))!;
    expect(q.quote.quote_type).toBe("staging");
    expect(q.quote.rental_months).toBe(3);
    // 100×3 + 500 + 200 = 1000; minus 50 discount, plus 5% tax half-up.
    expect(q.quote.subtotal_cents).toBe("100000");
    expect(q.quote.discount_cents).toBe("5000");
    expect(q.quote.total_cents).toBe("99750");
    const monthly = q.items.find((i) => i.kind === "monthly")!;
    expect(monthly.total_cents).toBe("30000");
    expect(monthly.product_id).toBe(f.product);
  });
  it("issues sale quotes once per line and refuses monthly billing on them", async () => {
    const f = await fixture();
    const priced = await f
      .c("sales")
      .query(api.sales.quoteProducts, { search: "sofa", pricing: "sale" });
    expect(priced[0].price_cents).toBe("75000");
    expect(priced[0]).not.toHaveProperty("purchase_price_cents");
    const rental = await f
      .c("sales")
      .query(api.sales.quoteProducts, { search: "", pricing: "rental" });
    expect(rental[0].price_cents).toBe("10000");
    await expect(
      f.c("sales").mutation(api.sales.saveQuote, {
        version: 0,
        input: JSON.stringify({
          opportunity_id: f.oid,
          quote_type: "sale",
          rental_months: 2,
          items: [
            {
              description: "Fictional sofa (TEST-SOFA)",
              quantity: 1,
              unit_price: "750.00",
              kind: "monthly",
              product_id: f.product,
            },
          ],
          discount: "0.00",
          tax_rate: "5.00",
          valid_until: "2099-01-01",
        }),
      }),
    ).rejects.toThrow();
    const id = await f.c("sales").mutation(api.sales.saveQuote, {
      version: 0,
      input: JSON.stringify({
        opportunity_id: f.oid,
        quote_type: "sale",
        items: [
          {
            description: "Fictional sofa (TEST-SOFA)",
            quantity: 2,
            unit_price: "750.00",
            kind: "item",
            product_id: f.product,
          },
        ],
        discount: "0.00",
        tax_rate: "5.00",
        valid_until: "2099-01-01",
      }),
    });
    const q = (await f.c("sales").query(api.sales.getQuote, { id }))!;
    expect(q.quote.quote_type).toBe("sale");
    expect(q.quote.subtotal_cents).toBe("150000");
  });
  it("keeps quote product pricing away from non-sales roles and unknown products out of quotes", async () => {
    const f = await fixture();
    for (const client of [f.t, f.c("marketing"), f.c("designer")])
      await expect(
        client.query(api.sales.quoteProducts, {
          search: "",
          pricing: "rental",
        }),
      ).rejects.toThrow();
    await expect(
      f.c("sales").mutation(api.sales.saveQuote, {
        version: 0,
        input: JSON.stringify({
          opportunity_id: f.oid,
          quote_type: "rental",
          rental_months: 1,
          items: [
            {
              description: "Ghost product",
              quantity: 1,
              unit_price: "10.00",
              kind: "monthly",
              product_id: "a".repeat(32),
            },
          ],
          discount: "0.00",
          tax_rate: "0.00",
          valid_until: "2099-01-01",
        }),
      }),
    ).rejects.toThrow();
  });
});
