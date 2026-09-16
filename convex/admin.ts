import { internalAction, internalMutation } from "./functions";
import { createAccount, invalidateSessions } from "@convex-dev/auth/server";
import { internal, api } from "./_generated/api";
import { roleValue } from "./schema";
import { v } from "convex/values";
import { z } from "zod";
const profileArgs = {
  userId: v.id("users"),
  name: v.string(),
  roles: v.array(roleValue),
  archived: v.boolean(),
};
// Platform-only containment precedes supported invalidation; a failed action stays archived.
export const beginProfileChange = internalMutation({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const old = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const lock = crypto.randomUUID();
    if (old) {
      await ctx.db.patch(old._id, {
        deleted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        pending_change_token: lock,
      });
      await ctx.db.insert("audit_logs", {
        actor_id: null,
        action: "PLATFORM_PROFILE_CONTAINED",
        entity: "profiles",
        entity_id: userId,
        old_value: old,
        new_value: { archived: true },
        created_at: new Date().toISOString(),
      });
    } else {
      const now = new Date().toISOString();
      await ctx.db.insert("profiles", {
        userId,
        display_name: "Pending operator provisioning",
        roles: [],
        deleted_at: now,
        created_at: now,
        updated_at: new Date().toISOString(),
        pending_change_token: lock,
      });
    }
    return lock;
  },
});
export const finishProfileChange = internalMutation({
  args: { ...profileArgs, lock: v.string() },
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (!old || old.pending_change_token !== args.lock || !old.deleted_at)
      throw Error("Profile change requires operator review.");
    if (
      await ctx.db
        .query("authSessions")
        .withIndex("userId", (q) => q.eq("userId", args.userId))
        .first()
    )
      throw Error("Session invalidation incomplete.");
    const accounts = await ctx.db
      .query("authAccounts")
      .withIndex("userIdAndProvider", (q) => q.eq("userId", args.userId))
      .take(21);
    if (accounts.length > 20) throw Error("Account review required.");
    for (const account of accounts) {
      const codes = await ctx.db
        .query("authVerificationCodes")
        .withIndex("accountId", (q) => q.eq("accountId", account._id))
        .take(101);
      if (codes.length > 100) throw Error("Recovery review required.");
      for (const code of codes) await ctx.db.delete(code._id);
    }
    const now = new Date().toISOString();
    const value = {
      userId: args.userId,
      display_name: args.name,
      roles: args.roles,
      deleted_at: args.archived ? now : null,
      updated_at: now,
      pending_change_token: undefined,
    };
    await ctx.db.patch(old._id, value);
    await ctx.db.insert("audit_logs", {
      actor_id: null,
      action: "PLATFORM_PROFILE_CHANGED_SESSIONS_REVOKED",
      entity: "profiles",
      entity_id: args.userId,
      old_value: old,
      new_value: value,
      created_at: now,
    });
  },
});
export const setProfile = internalAction({
  args: profileArgs,
  handler: async (ctx, args): Promise<null> => {
    z.string().trim().min(1).max(120).parse(args.name);
    if (new Set(args.roles).size !== args.roles.length)
      throw Error("Duplicate roles.");
    const lock = await ctx.runMutation(internal.admin.beginProfileChange, {
      userId: args.userId,
    });
    await invalidateSessions(ctx, { userId: args.userId });
    await ctx.runMutation(internal.admin.finishProfileChange, {
      ...args,
      lock,
    });
    return null;
  },
});
// Internal actions are callable only by trusted deployment administration, never by browser clients.
export const provision = internalAction({
  args: {
    email: v.string(),
    name: v.string(),
    roles: v.array(roleValue),
    password: v.optional(v.string()),
    sendInvitation: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<string> => {
    if (
      await ctx.runQuery(internal.emergency.blocked, {
        capability: "onboarding",
      })
    )
      throw Error("Onboarding is restricted.");
    const email = z.email().max(254).parse(args.email.trim().toLowerCase());
    if (
      args.password &&
      (!email.endsWith("@accounts.example.test") ||
        process.env.GLARA_ACCEPTANCE_MODE !== "true" ||
        process.env.GLARA_ENVIRONMENT === "production")
    )
      throw new Error(
        "Direct password provisioning is restricted to disposable acceptance accounts.",
      );
    const password = args.password ?? crypto.randomUUID() + crypto.randomUUID();
    z.string().min(12).max(128).parse(password);
    const { user } = await createAccount(ctx, {
      provider: "password",
      account: { id: email, secret: password },
      profile: { email, name: args.name },
      shouldLinkViaEmail: false,
      shouldLinkViaPhone: false,
    });
    await ctx.runAction(internal.admin.setProfile, {
      userId: user._id,
      name: args.name,
      roles: args.roles,
      archived: false,
    });
    if (args.sendInvitation)
      await ctx.runAction(api.auth.signIn, {
        provider: "password",
        params: { email, flow: "reset" },
      });
    return user._id;
  },
});

export const provisionAcceptance = internalAction({
  args: {
    role: v.union(roleValue, v.literal("unassigned"), v.literal("archived")),
  },
  handler: async (ctx, { role }): Promise<string> => {
    if (
      process.env.GLARA_ACCEPTANCE_MODE !== "true" ||
      process.env.GLARA_ENVIRONMENT === "production"
    )
      throw new Error("Disposable acceptance is disabled.");
    const passwords: Record<string, string> = JSON.parse(
      process.env.GLARA_ACCEPTANCE_PASSWORDS ?? "{}",
    );
    if (!passwords[role])
      throw new Error("Acceptance credentials unavailable.");
    const userId = await ctx.runAction(internal.admin.provision, {
      email: "glara-convex-" + role + "@accounts.example.test",
      name: "Fictional " + role,
      roles:
        role === "unassigned" ? [] : [role === "archived" ? "sales" : role],
      password: passwords[role],
    });
    if (role === "archived")
      await ctx.runAction(internal.admin.setProfile, {
        userId: userId as import("./_generated/dataModel").Id<"users">,
        name: "Fictional archived",
        roles: ["sales"],
        archived: true,
      });
    return userId;
  },
});

export const initializeSources = internalMutation({
  args: {},
  handler: async (ctx) => {
    for (const name of [
      "Instagram",
      "Referral",
      "Website",
      "Google",
      "Cold outreach",
      "Open house",
      "Networking",
      "Repeat client",
      "Brokerage partnership",
      "Signage",
      "Other",
      "Unknown",
    ]) {
      if (
        !(await ctx.db
          .query("lead_sources")
          .withIndex("by_name", (q) => q.eq("name", name))
          .first())
      ) {
        const now = new Date().toISOString();
        const id = await ctx.db.insert("lead_sources", {
          name,
          created_at: now,
          updated_at: now,
          deleted_at: null,
        });
        await ctx.db.insert("audit_logs", {
          actor_id: null,
          action: "INSERT",
          entity: "lead_sources",
          entity_id: id,
          old_value: null,
          new_value: { name },
          created_at: now,
        });
      }
    }
  },
});

// Additive, restartable M2 search backfill. No business values or audit history are rewritten.
export const backfillSalesSearch = internalMutation({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (ctx, { cursor }) => {
    const page = await ctx.db
      .query("realtors")
      .paginate({ numItems: 100, cursor });
    for (const r of page.page)
      if (r.sales_search_text === undefined)
        await ctx.db.patch(r._id, {
          sales_search_text: [
            r.first_name,
            r.last_name,
            r.email ?? "",
            r.phone ?? "",
          ].join(" "),
        });
    return { cursor: page.continueCursor, done: page.isDone };
  },
});
