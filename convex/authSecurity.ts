import { internalMutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
export const attempt = internalMutation({
  args: { key: v.string(), recovery: v.boolean() },
  handler: async (ctx, args) => {
    if (process.env.GLARA_PUBLIC_CAMPAIGN_ONLY === "true") return false;
    if (!/^[a-f0-9]{64}$/.test(args.key)) return false;
    const now = Date.now();
    const expired = await ctx.db
      .query("auth_attempt_windows")
      .withIndex("by_expiry", (q) => q.lt("expires_at", now))
      .take(20);
    for (const row of expired) await ctx.db.delete(row._id);
    for (const [key, limit] of [
      ["global", 500],
      [
        (args.recovery ? "recovery:" : "auth:") + args.key,
        args.recovery ? 5 : 50,
      ],
    ] as const) {
      const row = await ctx.db
        .query("auth_attempt_windows")
        .withIndex("by_key", (q) => q.eq("key", key))
        .unique();
      if (row && row.expires_at > now && row.count >= limit) return false;
      const value = {
        key,
        count: row && row.expires_at > now ? row.count + 1 : 1,
        expires_at:
          row && row.expires_at > now ? row.expires_at : now + 3600000,
      };
      if (row) await ctx.db.patch(row._id, value);
      else await ctx.db.insert("auth_attempt_windows", value);
    }
    return true;
  },
});
export const eligible = internalQuery({
  args: { email: v.string() },
  handler: async (ctx, { email }) => {
    if (process.env.GLARA_PUBLIC_CAMPAIGN_ONLY === "true") return false;
    const account = await ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (q) =>
        q.eq("provider", "password").eq("providerAccountId", email),
      )
      .unique();
    if (!account) return false;
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", account.userId))
      .unique();
    return Boolean(profile && !profile.deleted_at && profile.roles.length);
  },
});
