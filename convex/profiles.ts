import { query } from "./_generated/server";
import { currentProfile, requireRoles } from "./access";
import { v } from "convex/values";
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const profile = await currentProfile(ctx);
    if (!profile) return null;
    const user = await ctx.db.get(profile.userId);
    return {
      ai_version: 1,
      analytics_version: 1,
      automation_version: 1,
      id: profile.userId,
      name: profile.display_name,
      email: user?.email ?? "",
      roles: profile.roles,
      deleted_at: profile.deleted_at,
    };
  },
});
export const audit = query({
  args: { entity_id: v.string() },
  handler: async (ctx, args) => {
    await requireRoles(ctx, ["owner"]);
    return await ctx.db
      .query("audit_logs")
      .withIndex("by_entity", (q) => q.eq("entity_id", args.entity_id))
      .order("desc")
      .take(100);
  },
});
