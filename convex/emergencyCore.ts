import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Capability } from "./emergencyModel";
import { deny } from "./access";
export async function frozen(
  ctx: QueryCtx | MutationCtx,
  capability: Capability,
) {
  if (process.env.GLARA_RECOVERY_MODE === "true") return true;
  const row = await ctx.db
    .query("emergency_controls")
    .withIndex("by_capability", (q) => q.eq("capability", capability))
    .unique();
  return row?.frozen ?? false;
}
export async function requireCapability(
  ctx: QueryCtx | MutationCtx,
  capability: Capability,
) {
  if (await frozen(ctx, capability))
    deny("CAPABILITY_FROZEN", "This operation is temporarily restricted.");
}
