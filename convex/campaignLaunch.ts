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
