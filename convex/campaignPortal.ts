import { query, mutation } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";
import { deny } from "./access";
import { portalSession } from "./campaignPortalAccess";

async function currentCampaign(ctx: Parameters<typeof portalSession>[0]) {
  if (!(await portalSession(ctx))) deny();
  return ctx.db
    .query("marketing_campaigns")
    .withIndex("by_slug", (q) => q.eq("slug", "pacificwest-2026"))
    .unique();
}
export const viewer = query({
  args: { check: v.number() },
  handler: async (ctx) => {
    const session = await portalSession(ctx);
    return session ? { name: session.profile.display_name } : null;
  },
});
export const summary = query({
  args: { check: v.number() },
  handler: async (ctx) => {
    const campaign = await currentCampaign(ctx);
    if (!campaign) return null;
    const entries = await ctx.db
      .query("campaign_entries")
      .withIndex("by_campaign", (q) => q.eq("campaign_id", campaign._id))
      .take(5001);
    if (entries.length > 5000)
      deny(
        "UNAVAILABLE",
        "The participant summary is temporarily unavailable.",
      );
    return {
      name: campaign.name,
      total: entries.length,
      eligible: entries.filter((e) => e.eligibility_status === "eligible")
        .length,
      review: entries.filter(
        (e) => e.crm_origin === "review" || e.eligibility_status === "pending",
      ).length,
      optedIn: entries.filter((e) => e.marketing_consent).length,
    };
  },
});
export const registrations = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.string(),
    check: v.number(),
  },
  handler: async (ctx, args) => {
    const campaign = await currentCampaign(ctx);
    if (!campaign) deny("UNAVAILABLE", "Campaign is unavailable.");
    if (
      args.search.length > 100 ||
      !Number.isInteger(args.paginationOpts.numItems) ||
      args.paginationOpts.numItems < 1 ||
      args.paginationOpts.numItems > 50
    )
      deny("INVALID_INPUT");
    const page = await ctx.db
      .query("campaign_entries")
      .withIndex("by_campaign", (q) => q.eq("campaign_id", campaign._id))
      .order("desc")
      .paginate(args.paginationOpts);
    const rows = await Promise.all(
      page.page.map(async (entry) => {
        const realtor = entry.realtor_id
          ? await ctx.db.get(entry.realtor_id)
          : null;
        const brokerage = realtor?.brokerage_id
          ? await ctx.db.get(realtor.brokerage_id)
          : null;
        const contact = entry.pending_contact ?? {
          first_name: realtor?.first_name ?? "Unavailable",
          last_name: realtor?.last_name ?? "",
          brokerage: brokerage?.name ?? "",
          city: entry.city_at_entry,
        };
        const receipt = await ctx.db
          .query("campaign_receipts")
          .withIndex("by_key", (q) => q.eq("key", `expo-receipt:${entry._id}`))
          .unique();
        return {
          id: entry._id,
          ...contact,
          email: entry.normalized_email,
          phone: entry.normalized_phone,
          entered_at: entry.entered_at,
          eligibility: entry.eligibility_status,
          crm_origin: entry.crm_origin,
          marketing_consent: entry.marketing_consent,
          licensed_realtor: entry.licensed_realtor,
          licensed_in_bc: entry.licensed_in_bc ?? null,
          annual_listings: entry.annual_listings,
          event_day: entry.event_day,
          receipt_status:
            receipt &&
            !receipt.test &&
            receipt.entry_id === entry._id &&
            receipt.campaign_id === campaign._id
              ? receipt.status
              : "not_queued",
        };
      }),
    );
    const search = args.search.trim().toLowerCase();
    return {
      ...page,
      page: rows.filter((row) =>
        [
          row.first_name,
          row.last_name,
          row.email,
          row.phone,
          row.brokerage,
          row.city,
        ]
          .join(" ")
          .toLowerCase()
          .includes(search),
      ),
    };
  },
});
// Record access without storing contact details; actor is always the verified session.
export const recordAccess = mutation({
  args: {},
  handler: async (ctx) => {
    const session = await portalSession(ctx);
    if (!session) deny();
    const recent = await ctx.db
      .query("audit_logs")
      .withIndex("by_entity", (q) =>
        q.eq("entity_id", String(session.sessionId)),
      )
      .order("desc")
      .first();
    if (
      recent?.action === "CAMPAIGN_PORTAL_VIEWED" &&
      Date.now() - Date.parse(recent.created_at) < 300000
    )
      return null;
    await ctx.db.insert("audit_logs", {
      actor_id: session.profile.userId,
      action: "CAMPAIGN_PORTAL_VIEWED",
      entity: "campaign_portal",
      entity_id: String(session.sessionId),
      old_value: null,
      new_value: { scope: "pacificwest-2026:read" },
      created_at: new Date().toISOString(),
    });
    return null;
  },
});
