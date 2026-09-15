/** Temporary, authenticated development acceptance inspection. Remove before final deployment. */
import { query, mutation } from "../../convex/functions";
import { requireRoles } from "../../convex/access";
import { buildContext } from "../../convex/aiContext";
import { scopeSchema } from "../../src/lib/ai/model";
import { roles } from "../../src/lib/permissions";
import { v } from "convex/values";
import { internal } from "../../convex/_generated/api";
import { sourceTables } from "../../convex/analyticsSources";
import type { QueryCtx } from "../../convex/_generated/server";
async function guard(ctx: QueryCtx, owner = false) {
  if (
    process.env.CONVEX_CLOUD_URL !==
    "https://woozy-jaguar-392.eu-west-1.convex.cloud"
  )
    throw Error("Development only");
  const p = await requireRoles(ctx, owner ? ["owner"] : roles);
  const u = await ctx.db.get(p.userId);
  if (
    !u?.email?.match(
      /^glara-convex-(owner|admin|sales|designer|staging_crew|marketing)@accounts\.example\.test$/,
    )
  )
    throw Error("Reserved fictional identity required");
  return p;
}
export const context = query({
  args: { scope: v.string() },
  handler: async (ctx, a) => {
    await guard(ctx);
    return buildContext(ctx, scopeSchema.parse(JSON.parse(a.scope)));
  },
});
export const inspect = query({
  args: { id: v.id("ai_requests") },
  handler: async (ctx, a) => {
    await guard(ctx, true);
    const r = await ctx.db.get(a.id);
    if (!r) throw Error("Missing request");
    const u = await ctx.db.get(r.user_id);
    if (!u?.email?.endsWith("@accounts.example.test"))
      throw Error("Fictional request only");
    const audits = await ctx.db
      .query("audit_logs")
      .withIndex("by_entity", (q) => q.eq("entity_id", a.id))
      .collect();
    return {
      status: r.status,
      input_tokens: r.input_tokens,
      output_tokens: r.output_tokens,
      charged_micros: r.charged_micros,
      provider_ms: r.provider_ms,
      retrieval_ms: r.retrieval_ms,
      model: r.model,
      audits,
    };
  },
});
export const role = mutation({
  args: { revoke: v.boolean() },
  handler: async (ctx, a) => {
    const actor = await guard(ctx, true);
    const user = await ctx.db
      .query("users")
      .filter((q) =>
        q.eq(q.field("email"), "glara-convex-sales@accounts.example.test"),
      )
      .unique();
    if (!user) throw Error("Missing fictional sales");
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .unique();
    if (!p) throw Error("Missing profile");
    if (
      JSON.stringify(p.roles) !==
      JSON.stringify(a.revoke ? ["sales"] : ["marketing"])
    )
      throw Error("Unexpected role; do not overwrite");
    await ctx.db.patch(p._id, {
      roles: a.revoke ? ["marketing"] : ["sales"],
      updated_at: new Date().toISOString(),
    });
    await ctx.db.insert("audit_logs", {
      actor_id: actor.userId,
      entity: "profiles",
      entity_id: p._id,
      action: "M8_FICTIONAL_ROLE_ACCEPTANCE",
      old_value: { roles: p.roles },
      new_value: { roles: a.revoke ? ["marketing"] : ["sales"] },
      created_at: new Date().toISOString(),
    });
  },
});
export const expireProposal = mutation({
  args: { id: v.id("ai_action_proposals") },
  handler: async (ctx, a) => {
    await guard(ctx, true);
    const p = await ctx.db.get(a.id);
    if (!p || p.status !== "proposed") throw Error("Proposed fixture required");
    const u = await ctx.db.get(p.user_id);
    if (u?.email !== "glara-convex-owner@accounts.example.test")
      throw Error("Fictional Owner only");
    await ctx.db.patch(p._id, { expires_at: Date.now() - 1 });
  },
});
export const provenance = query({
  args: {},
  handler: async (ctx) => {
    await guard(ctx, true);
    const realtors = await ctx.db.query("realtors").take(2000),
      properties = await ctx.db.query("properties").take(2000),
      products = await ctx.db.query("products").take(2000),
      customers = await ctx.db.query("commercial_customers").take(2000);
    return {
      realtors: realtors.map((x) => ({
        id: x._id,
        label: x.first_name + " " + x.last_name,
      })),
      properties: properties.map((x) => ({
        id: x._id,
        label: x.address_line_1,
      })),
      products: products.map((x) => ({ id: x._id, label: x.name })),
      customers: customers.map((x) => ({ id: x._id, label: x.bill_to.name })),
    };
  },
});

export const dataset = query({
  args: {},
  handler: async (ctx) => {
    await guard(ctx, true);
    const rows: Record<string, unknown>[] = [];
    const counts: Record<string, number> = {};
    for (const table of [...sourceTables, "commercial_customers"] as const) {
      const data = await ctx.db.query(table).take(2001);
      if (data.length > 2000) throw Error("Bounded provenance exceeded");
      counts[table] = data.length;
      rows.push(...data.map((r) => ({ ...r, _table: table })));
    }
    const proven = new Set<string>();
    for (const r of rows) {
      const id = String(r._id),
        bill = r.bill_to as { name?: string } | undefined;
      const label = [
        r.first_name,
        r.last_name,
        r.address_line_1,
        r.name,
        bill?.name,
      ]
        .filter(Boolean)
        .join(" ");
      if (
        /fictional/i.test(label) ||
        /^Sarah(?:desktop|mobile)[a-f0-9]{8} Chen$/.test(label)
      )
        proven.add(id);
    }
    const links = [
      "realtor_id",
      "property_id",
      "opportunity_id",
      "project_id",
      "customer_id",
      "product_id",
      "asset_id",
      "invoice_id",
      "payment_id",
      "reservation_id",
      "damage_id",
      "agreement_id",
      "inspection_id",
    ];
    const automation = await ctx.db.query("automation_actions").take(2001);
    if (automation.length > 2000) throw Error("Automation provenance bound");
    for (let pass = 0; pass < 10; pass++) {
      let added = 0;
      for (const a of automation)
        if (proven.has(a.entity_id) && !proven.has(a.activity_id)) {
          proven.add(a.activity_id);
          added++;
        }
      for (const r of rows)
        if (
          !proven.has(String(r._id)) &&
          links.some(
            (k) => typeof r[k] === "string" && proven.has(r[k] as string),
          )
        ) {
          proven.add(String(r._id));
          added++;
        }
      if (!added) break;
    }
    return {
      counts,
      source_count: rows.length,
      verified: proven.size,
      unknown_ids: rows
        .filter((r) => !proven.has(String(r._id)))
        .map((r) => String(r._id)),
      projects: (await ctx.db.query("projects").take(1000)).map((p) => ({
        id: p._id,
        status: p.status,
        property_id: p.property_id,
      })),
      unknown_details: rows
        .filter((r) => !proven.has(String(r._id)))
        .map((r) => ({
          table: r._table,
          keys: Object.keys(r),
          label: r.title ?? r.reason ?? null,
        })),
      snapshot_at: Date.now(),
    };
  },
});

export const expireRequest = mutation({
  args: { id: v.id("ai_requests") },
  handler: async (ctx, a) => {
    const actor = await guard(ctx, true);
    const r = await ctx.db.get(a.id);
    if (!r || r.user_id !== actor.userId || r.status !== "queued")
      throw Error("Own queued fixture required");
    await ctx.db.patch(r._id, { created_at: Date.now() - 120001 });
    await ctx.runMutation(internal.ai.expire, a);
  },
});
