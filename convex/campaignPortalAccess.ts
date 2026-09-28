import { getAuthUserId, getAuthSessionId } from "@convex-dev/auth/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { campaignPortalEnabled } from "../src/lib/campaigns/portal";

export async function portalOwner(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  if (
    !campaignPortalEnabled(process.env) ||
    userId !== process.env.GLARA_EXPO_ADMIN_USER_ID
  )
    return null;
  const profile = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (
    !profile ||
    profile.deleted_at ||
    profile.pending_change_token ||
    !profile.roles.includes("owner")
  )
    return null;
  return profile;
}

export async function portalSession(ctx: QueryCtx | MutationCtx) {
  const userId = await getAuthUserId(ctx),
    sessionId = await getAuthSessionId(ctx);
  if (!userId || !sessionId) return null;
  const session = await ctx.db.get(sessionId);
  if (
    !session ||
    session.userId !== userId ||
    session.expirationTime <= Date.now()
  )
    return null;
  const profile = await portalOwner(ctx, userId);
  return profile ? { profile, sessionId } : null;
}
