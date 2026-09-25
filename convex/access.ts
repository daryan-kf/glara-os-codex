import { getAuthUserId, getAuthSessionId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import type { Role } from "../src/lib/permissions";
export const operational: readonly Role[] = ["owner", "sales", "admin"];
export function deny(code = "FORBIDDEN", message = "Access denied"): never {
  throw new ConvexError({ code, message });
}
export async function currentProfile(ctx: QueryCtx | MutationCtx) {
  if (process.env.GLARA_PUBLIC_CAMPAIGN_ONLY === "true") return null;
  const userId = await getAuthUserId(ctx);
  if (!userId) return null;
  const sessionId = await getAuthSessionId(ctx);
  if (!sessionId) return null;
  const session = await ctx.db.get(sessionId);
  if (
    !session ||
    session.userId !== userId ||
    session.expirationTime <= Date.now()
  )
    return null;
  return await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
}
export async function requireRoles(
  ctx: QueryCtx | MutationCtx,
  allowed: readonly Role[],
) {
  const profile = await currentProfile(ctx);
  if (
    !profile ||
    profile.deleted_at ||
    !profile.roles.some((r) => allowed.includes(r))
  )
    return deny();
  return profile;
}
export async function assignee(
  ctx: QueryCtx | MutationCtx,
  userId: Id<"users">,
) {
  const row = await ctx.db
    .query("profiles")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (!row || row.deleted_at || !row.roles.some((r) => operational.includes(r)))
    deny("INVALID_INPUT", "Select an active CRM team member.");
}
