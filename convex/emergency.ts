import { query, mutation, internalQuery } from "./_generated/server";
import { v } from "convex/values";
import { requireRoles, deny } from "./access";
import { capabilities, capabilityValue } from "./emergencyModel";
import { frozen } from "./emergencyCore";
export const state = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner", "admin"]);
    return Promise.all(
      capabilities.map(async (capability) => {
        const row = await ctx.db
          .query("emergency_controls")
          .withIndex("by_capability", (q) => q.eq("capability", capability))
          .unique();
        return {
          capability,
          frozen: await frozen(ctx, capability),
          version: row?.version ?? 0,
          recovery_mode: process.env.GLARA_RECOVERY_MODE === "true",
        };
      }),
    );
  },
});
export const change = mutation({
  args: {
    changes: v.array(
      v.object({
        capability: capabilityValue,
        frozen: v.boolean(),
        version: v.number(),
      }),
    ),
    reason: v.string(),
    incident: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const actor = await requireRoles(ctx, ["owner"]);
    if (
      !a.changes.length ||
      a.changes.length > capabilities.length ||
      new Set(a.changes.map((x) => x.capability)).size !== a.changes.length ||
      a.reason.trim().length < 10 ||
      a.reason.length > 500 ||
      (a.incident && !/^(?:INC|DRILL)-[A-Za-z0-9-]{3,60}$/.test(a.incident))
    )
      deny("INVALID_INPUT");
    if (
      process.env.GLARA_RECOVERY_MODE === "true" &&
      a.changes.some((x) => !x.frozen)
    )
      deny("RECOVERY_MODE");
    for (const change of a.changes) {
      const old = await ctx.db
        .query("emergency_controls")
        .withIndex("by_capability", (q) =>
          q.eq("capability", change.capability),
        )
        .unique();
      if (
        !Number.isSafeInteger(change.version) ||
        change.version !== (old?.version ?? 0)
      )
        deny("CONFLICT");
      const value = {
        capability: change.capability,
        frozen: change.frozen,
        version: change.version + 1,
        changed_by: actor.userId,
        reason: a.reason.trim(),
        incident: a.incident ?? null,
        updated_at: Date.now(),
      };
      const id = old?._id ?? (await ctx.db.insert("emergency_controls", value));
      if (old) await ctx.db.patch(id, value);
      await ctx.db.insert("audit_logs", {
        actor_id: actor.userId,
        action: "EMERGENCY_CONTROL_CHANGED",
        entity: "emergency_controls",
        entity_id: id,
        old_value: { frozen: old?.frozen ?? false, version: old?.version ?? 0 },
        new_value: value,
        created_at: new Date().toISOString(),
      });
    }
  },
});
export const blocked = internalQuery({
  args: { capability: capabilityValue },
  handler: (ctx, a) => frozen(ctx, a.capability),
});
