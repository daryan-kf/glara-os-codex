import { internalMutation } from "./functions";
import { v } from "convex/values";
import { z } from "zod";
import { campaignInput } from "../src/lib/campaigns/model";

// Deployment-administrator-only, restartable provisioning of the approved campaign.
// This creates an assignment identity, never a login, password, session or invitation.
export const preparePacificWest = internalMutation({
  args: { owner_name: v.string(), owner_email: v.string(), input: v.string() },
  handler: async (ctx, args) => {
    if (
      process.env.GLARA_ENVIRONMENT !== "production" ||
      process.env.GLARA_PUBLIC_CAMPAIGN_ONLY !== "true" ||
      process.env.GLARA_PACIFICWEST_PROVISIONING_APPROVED !== "true" ||
      process.env.GLARA_EXPO_ENABLED !== "false" ||
      [
        "M9_EMAIL_ENABLED",
        "M9_CALENDAR_ENABLED",
        "AUTH_EMAIL_ENABLED",
        "GLARA_AI_SECURITY_APPROVED",
        "GLARA_AUTOMATION_ENABLED",
      ].some((k) => process.env[k] !== "false")
    )
      throw Error("Closed campaign provisioning approval required.");
    if (args.input.length > 40000) throw Error("Campaign input too large.");
    const supplied: unknown = JSON.parse(args.input);
    const approved = campaignInput.parse({
      ...z.record(z.string(), z.unknown()).parse(supplied),
      assigned_to: "pending",
    });
    if (
      approved.slug !== "pacificwest-2026" ||
      approved.starts_at !== 1790607600000 ||
      approved.closes_at !== 1790726400000 ||
      approved.prize_value_cents !== 200000 ||
      approved.expiry_months_after_confirmation !== 6 ||
      approved.eligible_province !== "BC" ||
      !approved.skill_question_required ||
      !approved.legal_approved
    )
      throw Error("Approved PacificWest terms required.");
    const email = z.email().parse(args.owner_email.trim().toLowerCase());
    const name = z.string().trim().min(1).max(120).parse(args.owner_name);
    const existing = await ctx.db
      .query("marketing_campaigns")
      .withIndex("by_slug", (q) => q.eq("slug", approved.slug))
      .unique();
    if (existing) {
      const owner = await ctx.db.get(existing.assigned_to);
      const expected = campaignInput.parse({
        ...approved,
        assigned_to: existing.assigned_to,
      });
      if (
        !owner ||
        owner.email !== email ||
        owner.name !== name ||
        Object.entries(expected).some(
          ([key, value]) =>
            JSON.stringify(existing[key as keyof typeof existing]) !==
            JSON.stringify(value),
        )
      )
        throw Error("Existing campaign differs; operator review required.");
      return existing._id;
    }
    if (
      (await ctx.db.query("users").first()) ||
      (await ctx.db.query("marketing_campaigns").first())
    )
      throw Error("An empty production target is required.");
    const now = Date.now(),
      iso = new Date(now).toISOString();
    const ownerId = await ctx.db.insert("users", { name, email });
    await ctx.db.insert("profiles", {
      userId: ownerId,
      display_name: name,
      roles: ["owner"],
      created_at: iso,
      updated_at: iso,
      deleted_at: null,
    });
    const data = campaignInput.parse({ ...approved, assigned_to: ownerId });
    if (!data.legal_approved || now >= data.starts_at)
      throw Error("Approved pre-opening campaign required.");
    const id = await ctx.db.insert("marketing_campaigns", {
      ...data,
      assigned_to: ownerId,
      type: "realtor_giveaway",
      currency: "CAD",
      timezone: "America/Vancouver",
      status: "scheduled",
      created_by: ownerId,
      created_at: now,
      updated_at: now,
      version: 1,
    });
    await ctx.db.insert("audit_logs", {
      actor_id: null,
      action: "PLATFORM_APPROVED_CAMPAIGN_PROVISIONED",
      entity: "marketing_campaigns",
      entity_id: id,
      old_value: null,
      new_value: {
        slug: data.slug,
        rules_version: data.rules_version,
        owner_id: ownerId,
        assignment_identity_only: true,
      },
      created_at: iso,
    });
    return id;
  },
});

// One-time Owner-approved schedule correction before the first entry. Deployment
// administrator only; optimistic checks and the entry scan share one transaction.
export const openPacificWestNow = internalMutation({
  args: { expected_version: v.number() },
  handler: async (ctx, args) => {
    if (
      process.env.GLARA_ENVIRONMENT !== "production" ||
      process.env.GLARA_PUBLIC_CAMPAIGN_ONLY !== "true" ||
      process.env.GLARA_PACIFICWEST_SCHEDULE_CHANGE_APPROVED !== "true" ||
      [
        "M9_EMAIL_ENABLED",
        "M9_CALENDAR_ENABLED",
        "AUTH_EMAIL_ENABLED",
        "GLARA_AI_SECURITY_APPROVED",
        "GLARA_AUTOMATION_ENABLED",
      ].some((key) => process.env[key] !== "false")
    )
      throw Error("Isolated campaign schedule approval required.");
    const campaign = await ctx.db
      .query("marketing_campaigns")
      .withIndex("by_slug", (q) => q.eq("slug", "pacificwest-2026"))
      .unique();
    if (
      !campaign ||
      campaign.version !== args.expected_version ||
      campaign.starts_at !== 1790607600000 ||
      campaign.closes_at !== 1790726400000 ||
      campaign.rules_version !== "pacificwest-2026-final-1" ||
      campaign.status !== "scheduled" ||
      !campaign.legal_approved ||
      campaign.active_draw_id
    )
      throw Error("Original approved, unchanged campaign required.");
    if (
      (await ctx.db
        .query("campaign_entries")
        .withIndex("by_campaign", (q) => q.eq("campaign_id", campaign._id))
        .first()) ||
      (await ctx.db
        .query("campaign_draws")
        .withIndex("by_campaign", (q) => q.eq("campaign_id", campaign._id))
        .first())
    )
      throw Error(
        "Entries or draws exist; schedule correction requires further review.",
      );
    const now = Date.now();
    const closes = Date.parse("2026-10-03T00:00:00Z");
    if (now < Date.parse("2026-09-28T00:00:00Z") || now >= campaign.starts_at)
      throw Error("Pre-opening schedule correction window has ended.");
    const startLabel =
      new Intl.DateTimeFormat("en-US", {
        timeZone: "America/Vancouver",
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }).format(now) + " Pacific Time";
    const oldStart = "September 28, 2026 at 8:00 AM Pacific Time";
    const oldClose = "September 29, 2026 at 5:00 PM";
    if (
      !campaign.official_rules.includes(oldStart) ||
      !campaign.official_rules.includes(oldClose)
    )
      throw Error("Rules text differs from the approved original.");
    const patch = {
      starts_at: now,
      closes_at: closes,
      status: "open" as const,
      rules_version: "pacificwest-2026-final-2",
      official_rules: campaign.official_rules
        .replace(oldStart, startLabel)
        .replaceAll(oldClose, "October 2, 2026 at 5:00 PM"),
      version: campaign.version + 1,
      updated_at: now,
    };
    await ctx.db.patch(campaign._id, patch);
    await ctx.db.insert("audit_logs", {
      actor_id: null,
      action: "PLATFORM_OWNER_APPROVED_CAMPAIGN_SCHEDULE_CHANGED",
      entity: "marketing_campaigns",
      entity_id: campaign._id,
      old_value: {
        starts_at: campaign.starts_at,
        closes_at: campaign.closes_at,
        rules_version: campaign.rules_version,
        official_rules: campaign.official_rules,
        version: campaign.version,
        status: campaign.status,
      },
      new_value: {
        ...patch,
        reason:
          "Owner requested immediate opening through Friday October 2 at 17:00 America/Vancouver; no entries existed.",
      },
      created_at: new Date(now).toISOString(),
    });
    return { campaign_id: campaign._id, ...patch };
  },
});
