import { query } from "./_generated/server";
import { mutation, internalMutation, action, internalQuery } from "./functions";
import { currentProfile, requireRoles, deny } from "./access";
import {
  retrieveAccount,
  modifyAccountCredentials,
  invalidateSessions,
} from "@convex-dev/auth/server";
import { internal } from "./_generated/api";
import { v, ConvexError } from "convex/values";
import { z } from "zod";
export const viewer = query({
  args: {},
  handler: async (ctx) => {
    const profile = await currentProfile(ctx);
    if (!profile) return null;
    const user = await ctx.db.get(profile.userId);
    return {
      communications_version: 1,
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
// Self-service scope is limited to display name; roles and archival stay a
// trusted deployment operation in admin.setProfile.
export const updateName = mutation({
  args: { name: v.string() },
  handler: async (ctx, args) => {
    const profile = await currentProfile(ctx);
    if (!profile || profile.deleted_at || !profile.roles.length) deny();
    const parsed = z.string().trim().min(1).max(120).safeParse(args.name);
    if (!parsed.success)
      deny("INVALID_INPUT", "Enter a display name of 1 to 120 characters.");
    const display_name = parsed.data;
    if (display_name === profile.display_name) return null;
    const now = new Date().toISOString();
    await ctx.db.patch(profile._id, { display_name, updated_at: now });
    await ctx.db.insert("audit_logs", {
      actor_id: profile.userId,
      action: "PROFILE_NAME_CHANGED",
      entity: "profiles",
      entity_id: profile.userId,
      old_value: { display_name: profile.display_name },
      new_value: { display_name },
      created_at: now,
    });
    return null;
  },
});
export const selfCredentialContext = internalQuery({
  args: {},
  handler: async (ctx) => {
    const profile = await currentProfile(ctx);
    if (!profile || profile.deleted_at || !profile.roles.length) return null;
    const user = await ctx.db.get(profile.userId);
    return user?.email ? { userId: profile.userId, email: user.email } : null;
  },
});
export const recordPasswordChange = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, args) => {
    await ctx.db.insert("audit_logs", {
      actor_id: args.userId,
      action: "PASSWORD_CHANGED",
      entity: "profiles",
      entity_id: args.userId,
      old_value: null,
      new_value: null,
      created_at: new Date().toISOString(),
    });
  },
});
export const changePassword = action({
  args: { currentPassword: v.string(), newPassword: v.string() },
  handler: async (ctx, args): Promise<null> => {
    const failure = () =>
      new ConvexError({
        code: "AUTHENTICATION_FAILED",
        message:
          "Unable to change the password. Check your current password or try again later.",
      });
    if (
      await ctx.runQuery(internal.emergency.blocked, {
        capability: "onboarding",
      })
    )
      throw new ConvexError({
        code: "CAPABILITY_FROZEN",
        message: "Account maintenance is restricted.",
      });
    if (
      !z.string().min(12).max(128).safeParse(args.newPassword).success ||
      args.newPassword === args.currentPassword
    )
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Choose a new password with 12 to 128 characters.",
      });
    const self = await ctx.runQuery(
      internal.profiles.selfCredentialContext,
      {},
    );
    if (!self) throw failure();
    // The shared per-account window also covers current-password guesses here.
    const digest = Array.from(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(self.email),
        ),
      ),
    )
      .map((x) => x.toString(16).padStart(2, "0"))
      .join("");
    if (
      !(await ctx.runMutation(internal.authSecurity.attempt, {
        key: digest,
        recovery: false,
      }))
    )
      throw failure();
    try {
      await retrieveAccount(ctx, {
        provider: "password",
        account: { id: self.email, secret: args.currentPassword },
      });
    } catch {
      throw failure();
    }
    await modifyAccountCredentials(ctx, {
      provider: "password",
      account: { id: self.email, secret: args.newPassword },
    });
    await ctx.runMutation(internal.profiles.recordPasswordChange, {
      userId: self.userId,
    });
    // Every session, including the caller's, must re-authenticate with the new password.
    await invalidateSessions(ctx, { userId: self.userId });
    return null;
  },
});
