"use node";
import { internalAction, action } from "./_generated/server";
import { internal, api } from "./_generated/api";
import { createHash, createHmac } from "node:crypto";
import { Webhook } from "svix";
import { z } from "zod";
import { v } from "convex/values";
import {
  ResendProvider,
  providerEvent,
  eventKind,
} from "../src/lib/communications/provider";
const provider = () =>
  new ResendProvider({
    key: process.env.M9_RESEND_KEY ?? "",
    from: process.env.M9_EMAIL_FROM ?? "Support@glarahome.com",
    replyTo: process.env.M9_EMAIL_REPLY_TO ?? "Support@glarahome.com",
  });
export const tick = internalAction({
  args: {},
  handler: async (ctx) => {
    await ctx.runMutation(internal.communicationDelivery.sweep, {});
    if (
      process.env.M9_EMAIL_ENABLED !== "true" ||
      process.env.M9_EMAIL_VERIFIED !== "true" ||
      !process.env.M9_UNSUBSCRIBE_SECRET ||
      !process.env.M9_PUBLIC_HTTP_ORIGIN ||
      !provider().verifyConfiguration()
    )
      return;
    const origin = new URL(process.env.M9_PUBLIC_HTTP_ORIGIN);
    if (
      origin.protocol !== "https:" ||
      !origin.hostname.endsWith(".convex.site")
    )
      return;
    const jobs = await ctx.runQuery(internal.communicationDelivery.due, {});
    for (const id of jobs) {
      const token = createHmac("sha256", process.env.M9_UNSUBSCRIBE_SECRET)
          .update(id)
          .digest("hex"),
        hash = createHash("sha256").update(token).digest("hex");
      const data = await ctx.runMutation(internal.communicationDelivery.claim, {
        id,
        token_hash: hash,
        unsubscribe_url: `${origin.origin}/m9/unsubscribe?token=${token}`,
      });
      if (!data) continue;
      const sender = new ResendProvider({
        key: process.env.M9_RESEND_KEY ?? "",
        from: data.from,
        replyTo: data.reply_to,
      });
      const result = await sender.sendEmail({
        key: data.send_key,
        to: data.email,
        subject: data.subject,
        text: data.body,
      });
      await ctx.runMutation(internal.communicationDelivery.outcome, {
        id,
        ...result,
      });
    }
  },
});
export const verifyEvent = internalAction({
  args: {
    payload: v.string(),
    id: v.string(),
    timestamp: v.string(),
    signature: v.string(),
  },
  handler: async (ctx, a) => {
    if (a.payload.length > 65536) return false;
    const secrets = [
      process.env.M9_RESEND_WEBHOOK_SECRET,
      process.env.M9_RESEND_WEBHOOK_SECRET_PREVIOUS,
    ].filter((s): s is string => !!s);
    for (const secret of secrets) {
      try {
        new Webhook(secret).verify(a.payload, {
          "svix-id": a.id,
          "svix-timestamp": a.timestamp,
          "svix-signature": a.signature,
        });
        const parsed = providerEvent.safeParse(JSON.parse(a.payload));
        if (!parsed.success) return false;
        const kind = eventKind(parsed.data.type);
        if (!kind) return true;
        await ctx.runMutation(internal.communicationDelivery.delivery, {
          event_id: a.id,
          provider_id: parsed.data.data.email_id,
          kind,
          occurred_at: Date.parse(parsed.data.created_at),
        });
        return true;
      } catch {
        /* Rotation accepts either current or previous signature, never unsigned payloads. */
      }
    }
    return false;
  },
});
export const unsubscribe = internalAction({
  args: { token: v.string() },
  handler: async (ctx, a) => {
    if (!/^[a-f0-9]{64}$/.test(a.token)) return;
    await ctx.runMutation(internal.communicationDelivery.unsubscribe, {
      token_hash: createHash("sha256").update(a.token).digest("hex"),
    });
  },
});
export const reconcile = action({
  args: { id: v.id("communications") },
  handler: async (ctx, a) => {
    const config = await ctx.runQuery(api.communications.configuration, {});
    if (!config.manager) throw new Error("Access denied");
    const mapping = await ctx.runQuery(internal.communicationDelivery.mapping, {
      id: a.id,
    });
    if (!mapping) return { status: "manual_provider_investigation_required" };
    const result = await provider().getDeliveryStatus(mapping.provider_id);
    if (!result || result.id !== mapping.provider_id)
      return { status: "provider_unavailable" };
    const kind = eventKind(`email.${result.status}`);
    if (kind)
      await ctx.runMutation(internal.communicationDelivery.delivery, {
        event_id: `reconcile:${mapping.provider_id}:${result.status}`,
        provider_id: mapping.provider_id,
        kind,
        occurred_at: Date.now(),
      });
    return { status: result.status };
  },
});
export const reconcileUnknown = action({
  args: {
    id: v.id("communications"),
    provider_id: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, a): Promise<{ status: string }> => {
    if (
      a.reason.trim().length < 8 ||
      a.reason.length > 500 ||
      !/^[A-Za-z0-9_-]{8,200}$/.test(a.provider_id)
    )
      throw new Error("Invalid review evidence");
    const { row, job } = await ctx.runQuery(api.communications.unknownReview, {
      id: a.id,
    });
    const response = await fetch(
      `https://api.resend.com/emails/${encodeURIComponent(a.provider_id)}`,
      {
        headers: { Authorization: `Bearer ${process.env.M9_RESEND_KEY ?? ""}` },
        signal: AbortSignal.timeout(15000),
      },
    );
    if (!response.ok) return { status: "provider_unavailable" };
    const remote = z
      .object({
        id: z.string(),
        to: z.array(z.string()),
        from: z.string(),
        subject: z.string(),
        text: z.string(),
        created_at: z.string().refine((s) => Number.isFinite(Date.parse(s))),
      })
      .safeParse(await response.json());
    if (
      !remote.success ||
      remote.data.id !== a.provider_id ||
      remote.data.to.length !== 1 ||
      remote.data.to[0].toLowerCase() !== row.snapshot!.email ||
      remote.data.subject !== row.snapshot!.subject ||
      remote.data.text !== job.payload!.body ||
      remote.data.from !== `Glara Home Staging <${job.payload!.from}>` ||
      Math.abs(Date.parse(remote.data.created_at) - (job.claimed_at ?? 0)) >
        300000
    )
      return { status: "evidence_mismatch" };
    const applied = await ctx.runMutation(
      internal.communicationDelivery.reconcileVerified,
      { id: row._id, provider_id: remote.data.id, reason: a.reason },
    );
    return {
      status: applied
        ? "verified_provider_acceptance"
        : "reconciliation_conflict",
    };
  },
});
