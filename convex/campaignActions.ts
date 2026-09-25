"use node";
import { createHmac, timingSafeEqual, randomInt } from "node:crypto";
import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  intakeEnabled,
  registrationInput,
  phoneIdentity,
} from "../src/lib/campaigns/model";
export const submit = action({
  args: {
    input: v.string(),
    network_key: v.string(),
    timestamp: v.number(),
    signature: v.string(),
  },
  handler: async (ctx, a): Promise<{ status: string }> => {
    const secret = process.env.GLARA_EXPO_INGRESS_SECRET;
    if (
      !intakeEnabled(process.env) ||
      !secret ||
      secret.length < 32 ||
      a.input.length > 6000 ||
      !Number.isSafeInteger(a.timestamp) ||
      Math.abs(Date.now() - a.timestamp) > 60000 ||
      !/^[a-f0-9]{64}$/.test(a.network_key) ||
      !/^[a-f0-9]{64}$/.test(a.signature)
    )
      return { status: "unavailable" };
    const expected = createHmac("sha256", secret)
      .update(JSON.stringify([a.timestamp, a.network_key, a.input]))
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(a.signature, "hex")))
      return { status: "unavailable" };
    let raw: unknown;
    try {
      raw = JSON.parse(a.input);
    } catch {
      return { status: "invalid" };
    }
    const parsed = registrationInput.safeParse(raw);
    if (!parsed.success) return { status: "invalid" };
    // No client can supply a trusted network bucket or invoke the internal writer directly.
    const identity = createHmac("sha256", secret)
      .update("email:" + parsed.data.email)
      .digest("hex");
    return await ctx.runMutation(internal.campaigns.register, {
      input: a.input,
      network_key: a.network_key,
      identity_key: identity,
      phone_identity_key: createHmac("sha256", secret)
        .update("phone:" + phoneIdentity(parsed.data.phone))
        .digest("hex"),
    });
  },
});
export const draw = action({
  args: {
    id: v.id("marketing_campaigns"),
    redraw: v.boolean(),
    reason: v.string(),
  },
  handler: async (ctx, a): Promise<Id<"campaign_entries">> => {
    if (a.reason.length > 1000) throw new Error("Invalid draw request");
    // runMutation retains authenticated identity; both phases recheck the server-side session and role.
    const pool = await ctx.runMutation(internal.campaigns.freezeDraw, a);
    if (pool.selected_entry_id) return pool.selected_entry_id;
    return await ctx.runMutation(internal.campaigns.finishDraw, {
      id: pool._id,
      index: randomInt(pool.eligible_count),
    });
  },
});
