import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { credentials } from "./identities";
export async function operationsClient(role = "owner") {
  const user = credentials(role),
    url = readFileSync(".env.local", "utf8")
      .match(/^NEXT_PUBLIC_CONVEX_URL=(.+)$/m)![1]
      .trim();
  if (!url.startsWith("https://woozy-jaguar-392."))
    throw Error("Only the authorized development deployment is allowed");
  const client = new ConvexHttpClient(url, { logger: false }),
    auth = await client.action(api.auth.signIn, {
      provider: "password",
      params: { email: user.email, password: user.password, flow: "signIn" },
    });
  if (!auth.tokens?.token) throw Error("Fictional sign-in failed");
  client.setAuth(auth.tokens.token);
  return { client, user, url };
}
export async function wonFixture(client: ConvexHttpClient) {
  const suffix = randomUUID().slice(0, 8),
    sales = credentials("sales"),
    realtor = await client.mutation(api.crm.write, {
      input: JSON.stringify({
        op: "realtor_create",
        data: {
          first_name: "FictionalM3",
          last_name: suffix,
          assigned_to: sales.id,
          relationship_status: "active_partner",
        },
      }),
    });
  const address = `Fictional ${suffix} Crescent`,
    property = await client.mutation(api.sales.saveProperty, {
      version: 0,
      input: JSON.stringify({
        address_line_1: address,
        city: "Vancouver",
        province: "BC",
        property_type: "detached",
        occupancy_status: "vacant",
        realtor_id: realtor.id,
        seller_name: "PRIVATE SELLER",
        notes: "PRIVATE COMMERCIAL",
      }),
    });
  const opportunity = await client.mutation(api.sales.saveOpportunity, {
    version: 0,
    input: JSON.stringify({
      property_id: property,
      assigned_to: sales.id,
      estimated_value: "5000",
      probability: 40,
      next_action_title: "Fictional handoff",
      next_action_date: "2099-01-01T18:00:00Z",
      notes: "PRIVATE NEGOTIATION",
    }),
  });
  const quote = await client.mutation(api.sales.saveQuote, {
    version: 0,
    input: JSON.stringify({
      opportunity_id: opportunity,
      items: [
        { description: "Fictional staging", quantity: 1, unit_price: "5000" },
      ],
      discount: "0",
      tax_rate: "5",
      valid_until: "2099-12-31",
    }),
  });
  await client.mutation(api.sales.quoteStatus, {
    id: quote,
    version: 1,
    status: "sent",
  });
  await client.mutation(api.sales.quoteStatus, {
    id: quote,
    version: 2,
    status: "accepted",
  });
  for (const stage of [
    "contacted",
    "interested",
    "consultation",
    "quote_sent",
    "negotiation",
    "won",
  ]) {
    const o = await client.query(api.sales.getOpportunity, { id: opportunity });
    await client.mutation(api.sales.transition, {
      id: opportunity,
      version: o!.opportunity.version,
      input: JSON.stringify({ stage }),
    });
  }
  const createArgs = {
    opportunity_id: opportunity,
    source_quote_id: quote,
    project_manager_id: credentials("admin").id as Id<"users">,
    designer_id: credentials("designer").id as Id<"users">,
    staging_lead_id: credentials("staging_crew").id as Id<"users">,
    input: JSON.stringify({
      package_type: "standard",
      planned_end_date: "2099-12-31",
      priority: "normal",
      internal_notes: "PRIVATE MANAGER NOTES",
    }),
    rooms: [
      JSON.stringify({
        room_type: "living_room",
        room_name: "Living room",
        staging_scope: "full",
        style_direction: "Calm",
        notes: "",
        status: "design_ready",
        sort_order: 0,
      }),
    ],
  };
  return { opportunity, property, quote, realtor, address, suffix, createArgs };
}
