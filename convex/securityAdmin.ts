import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { invalidateSessions } from "@convex-dev/auth/server";
import { requireRoles, deny } from "./access";
export const prepare = internalMutation({
  args: {
    userId: v.id("users"),
    reason: v.string(),
    incident: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const actor = await requireRoles(ctx, ["owner"]);
    if (
      a.reason.trim().length < 10 ||
      a.reason.length > 500 ||
      (a.incident && !/^(?:INC|DRILL)-[A-Za-z0-9-]{3,60}$/.test(a.incident))
    )
      deny("INVALID_INPUT");
    const profile = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", a.userId))
      .unique();
    if (!profile) deny("UNAVAILABLE");
    if (a.userId === actor.userId) deny("TRUSTED_RECOVERY_REQUIRED");
    const id = await ctx.db.insert("security_revocations", {
      target_id: a.userId,
      actor_id: actor.userId,
      reason: a.reason.trim(),
      incident: a.incident ?? null,
      status: "pending",
      created_at: Date.now(),
    });
    await ctx.db.patch(profile._id, {
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    await ctx.db.insert("audit_logs", {
      actor_id: actor.userId,
      action: "ACCOUNT_CONTAINED",
      entity: "security_revocations",
      entity_id: id,
      old_value: { archived: !!profile.deleted_at },
      new_value: {
        user_id: a.userId,
        archived: true,
        reason: a.reason,
        incident: a.incident ?? null,
      },
      created_at: new Date().toISOString(),
    });
    return id;
  },
});
export const finish = internalMutation({
  args: { id: v.id("security_revocations") },
  handler: async (ctx, a) => {
    const operation = await ctx.db.get(a.id);
    if (!operation || operation.status === "complete") return;
    const sessions = await ctx.db
      .query("authSessions")
      .withIndex("userId", (q) => q.eq("userId", operation.target_id))
      .first();
    if (sessions) deny("REVOCATION_INCOMPLETE");
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) =>
        q.eq("userId", operation.target_id),
      )
      .take(21);
    if (accounts.length > 20) deny("REVOCATION_REVIEW_REQUIRED");
    for (const account of accounts) {
      const codes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id))
        .take(101);
      if (codes.length > 100) deny("REVOCATION_REVIEW_REQUIRED");
      for (const code of codes) await ctx.db.delete(code._id);
    }
    await ctx.db.patch(a.id, { status: "complete", completed_at: Date.now() });
    await ctx.db.insert("audit_logs", {
      actor_id: operation.actor_id,
      action: "ACCOUNT_SESSIONS_REVOKED",
      entity: "security_revocations",
      entity_id: a.id,
      old_value: null,
      new_value: {
        user_id: operation.target_id,
        reason: operation.reason,
        incident: operation.incident,
      },
      created_at: new Date().toISOString(),
    });
  },
});
export const revokeUser = action({
  args: {
    userId: v.id("users"),
    reason: v.string(),
    incident: v.optional(v.string()),
  },
  handler: async (ctx, a): Promise<{ operation_id: string }> => {
    // Archive first so any subsequent failure leaves business access denied. Audit actor is derived in prepare.
    const id = await ctx.runMutation(internal.securityAdmin.prepare, a);
    await invalidateSessions(ctx, { userId: a.userId });
    await ctx.runMutation(internal.securityAdmin.finish, { id });
    return { operation_id: id };
  },
});
