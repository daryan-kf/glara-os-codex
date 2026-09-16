import { internalAction, internalMutation } from "./functions";
import { createAccount } from "@convex-dev/auth/server";
import { internal, api } from "./_generated/api";
import { roleValue } from "./schema";
import { v } from "convex/values";
import { z } from "zod";
export const setProfile = internalMutation({
  args: {
    userId: v.id("users"),
    name: v.string(),
    roles: v.array(roleValue),
    archived: v.boolean(),
  },
  handler: async (ctx, args) => {
    const old = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    const now = new Date().toISOString();
    const value = {
      userId: args.userId,
      display_name: args.name,
      roles: args.roles,
      deleted_at: args.archived ? now : null,
      updated_at: now,
    };
    if (old) await ctx.db.patch(old._id, value);
    else await ctx.db.insert("profiles", { ...value, created_at: now });
    await ctx.db.insert("audit_logs", {
      actor_id: null,
      action: old ? "UPDATE" : "INSERT",
      entity: "profiles",
      entity_id: args.userId,
      old_value: old ?? null,
      new_value: value,
      created_at: now,
    });
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
        process.env.GLARA_ACCEPTANCE_MODE !== "true")
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
    await ctx.runMutation(internal.admin.setProfile, {
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
    if (process.env.GLARA_ACCEPTANCE_MODE !== "true")
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
      await ctx.runMutation(internal.admin.setProfile, {
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
