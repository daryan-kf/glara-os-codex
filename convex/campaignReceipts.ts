import { v } from "convex/values";
import { internalMutation, internalQuery, type MutationCtx } from "./functions";
import type { Id, Doc } from "./_generated/dataModel";
import { frozen } from "./emergencyCore";
import {
  receiptConfigured,
  receiptContent,
  receiptVersion,
} from "../src/lib/campaigns/receipt";

async function audit(
  ctx: MutationCtx,
  id: string,
  action: string,
  state: string,
) {
  await ctx.db.insert("audit_logs", {
    actor_id: null,
    action,
    entity: "campaign_receipts",
    entity_id: id,
    old_value: null,
    new_value: { status: state },
    created_at: new Date().toISOString(),
  });
}
export async function enqueueReceipt(
  ctx: MutationCtx,
  entryId: Id<"campaign_entries">,
) {
  if (
    process.env.GLARA_EXPO_RECEIPTS_MODE !== "live" ||
    !receiptConfigured(process.env) ||
    (await frozen(ctx, "email"))
  )
    return;
  const entry = await ctx.db.get(entryId);
  if (
    !entry ||
    entry.eligibility_status !== "eligible" ||
    !entry.realtor_id ||
    entry.crm_origin === "review"
  )
    return;
  const c = await ctx.db.get(entry.campaign_id);
  if (!c || c.slug !== "pacificwest-2026" || !c.legal_approved) return;
  const key = `expo-receipt:${entryId}`;
  if (
    await ctx.db
      .query("campaign_receipts")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique()
  )
    return;
  const id = await ctx.db.insert("campaign_receipts", {
    entry_id: entryId,
    campaign_id: c._id,
    key,
    email: entry.normalized_email,
    ...receiptContent(c.closes_at),
    rules_version: entry.rules_version,
    template_version: receiptVersion,
    test: false,
    status: "ready",
    attempts: 0,
    next_at: Date.now(),
    created_at: Date.now(),
    updated_at: Date.now(),
  });
  await audit(ctx, id, "expo_receipt_queued", "ready");
}
async function allowed(
  ctx: Parameters<typeof frozen>[0],
  row: Doc<"campaign_receipts">,
) {
  if (!receiptConfigured(process.env) || (await frozen(ctx, "email")))
    return false;
  if (row.test || process.env.GLARA_ENVIRONMENT !== "production") {
    if (
      row.email !==
      process.env.GLARA_EXPO_RECEIPT_TEST_INBOX?.trim().toLowerCase()
    )
      return false;
  }
  const c = await ctx.db.get(row.campaign_id);
  if (
    !c ||
    c.slug !== "pacificwest-2026" ||
    !c.legal_approved ||
    c.status === "cancelled" ||
    c.rules_version !== row.rules_version
  )
    return false;
  if (Date.now() - row.created_at > 86400000) return false;
  const suppressions = await ctx.db
    .query("communication_suppressions")
    .withIndex("by_email", (q) => q.eq("email", row.email))
    .take(101);
  if (
    suppressions.length > 100 ||
    suppressions.some(
      (s) =>
        !s.revoked_at &&
        (s.scope === "all" ||
          s.scope === "transactional" ||
          ["hard_bounce", "complaint"].includes(s.reason)),
    )
  )
    return false;
  if (!row.test) {
    if (process.env.GLARA_EXPO_RECEIPTS_MODE !== "live") return false;
    if (!row.entry_id) return false;
    const entry = await ctx.db.get(row.entry_id);
    if (
      !entry ||
      entry.campaign_id !== c._id ||
      entry.normalized_email !== row.email ||
      entry.eligibility_status !== "eligible" ||
      !entry.realtor_id ||
      entry.crm_origin === "review"
    )
      return false;
    const realtor = await ctx.db.get(entry.realtor_id);
    if (!realtor || realtor.deleted_at) return false;
    const preferences = await ctx.db
      .query("communication_preferences")
      .withIndex("by_recipient", (q) =>
        q
          .eq("recipient_key", "realtor:" + entry.realtor_id)
          .eq("channel", "email"),
      )
      .take(101);
    if (
      preferences.length > 100 ||
      preferences.some(
        (p) =>
          p.status === "unsubscribed" &&
          ["all", "transactional"].includes(p.scope),
      )
    )
      return false;
  }
  return true;
}
export const due = internalQuery({
  args: {},
  handler: async (ctx) => {
    if (!receiptConfigured(process.env) || (await frozen(ctx, "email")))
      return [];
    return (
      await ctx.db
        .query("campaign_receipts")
        .withIndex("by_due", (q) =>
          q.eq("status", "ready").lte("next_at", Date.now()),
        )
        .take(5)
    ).map((r) => r._id);
  },
});
export const claim = internalMutation({
  args: { id: v.id("campaign_receipts") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    if (!r || r.status !== "ready" || r.next_at > Date.now()) return null;
    // Disabled configuration pauses the queue instead of throwing away pending receipts.
    if (!receiptConfigured(process.env) || (await frozen(ctx, "email")))
      return null;
    if (!(await allowed(ctx, r)) || r.attempts >= 3) {
      await ctx.db.patch(id, {
        status: "blocked",
        updated_at: Date.now(),
        last_code: "eligibility_blocked",
      });
      await audit(ctx, id, "expo_receipt_blocked", "blocked");
      return null;
    }
    await ctx.db.patch(id, {
      status: "sending",
      attempts: r.attempts + 1,
      next_at: Date.now() + 300000,
      updated_at: Date.now(),
    });
    await audit(ctx, id, "expo_receipt_dispatch_claimed", "sending");
    return r;
  },
});
export const dispatchAllowed = internalQuery({
  args: { id: v.id("campaign_receipts") },
  handler: async (ctx, { id }) => {
    const r = await ctx.db.get(id);
    return !!r && r.status === "sending" && (await allowed(ctx, r));
  },
});
async function applyDelivery(
  ctx: MutationCtx,
  row: Doc<"campaign_receipts">,
  kind: string,
) {
  const ranks: Record<string, number> = {
    accepted: 1,
    delivered: 2,
    failed: 3,
    hard_bounce: 4,
    complaint: 5,
  };
  if ((ranks[kind] ?? 0) <= (ranks[row.status] ?? 0)) return;
  const status = kind as
    "accepted" | "delivered" | "failed" | "hard_bounce" | "complaint";
  await ctx.db.patch(row._id, { status, updated_at: Date.now() });
  if (kind === "hard_bounce" || kind === "complaint") {
    const existing = await ctx.db
      .query("communication_suppressions")
      .withIndex("by_email", (q) => q.eq("email", row.email))
      .take(101);
    if (!existing.some((s) => !s.revoked_at && s.scope === "all"))
      await ctx.db.insert("communication_suppressions", {
        email: row.email,
        scope: "all",
        reason: kind,
        created_at: Date.now(),
      });
  }
  await audit(ctx, row._id, "expo_receipt_delivery", status);
}
export const delivery = internalMutation({
  args: { provider_id: v.string() },
  handler: async (ctx, { provider_id }) => {
    let row = await ctx.db
      .query("campaign_receipts")
      .withIndex("by_provider", (q) => q.eq("provider_id", provider_id))
      .unique();
    if (!row) return;
    const events = await ctx.db
      .query("communication_delivery_events")
      .withIndex("by_provider", (q) => q.eq("provider_id", provider_id))
      .take(100);
    for (const e of events) {
      await applyDelivery(ctx, row, e.kind);
      row = (await ctx.db.get(row._id))!;
    }
  },
});
export const outcome = internalMutation({
  args: {
    id: v.id("campaign_receipts"),
    result: v.union(
      v.literal("accepted"),
      v.literal("unknown"),
      v.literal("retryable"),
      v.literal("rejected"),
    ),
    code: v.string(),
    provider_id: v.optional(v.string()),
  },
  handler: async (ctx, a) => {
    const row = await ctx.db.get(a.id);
    if (!row || !["sending", "unknown"].includes(row.status)) return;
    const status =
      a.result === "accepted" && a.provider_id
        ? "accepted"
        : a.result === "retryable" && row.attempts < 3
          ? "ready"
          : a.result === "rejected" || a.result === "retryable"
            ? "failed"
            : "unknown";
    await ctx.db.patch(row._id, {
      status,
      last_code: a.code,
      ...(a.provider_id ? { provider_id: a.provider_id } : {}),
      next_at: Date.now() + 60000,
      updated_at: Date.now(),
    });
    await audit(ctx, row._id, "expo_receipt_provider_outcome", status);
    if (a.provider_id) {
      const events = await ctx.db
        .query("communication_delivery_events")
        .withIndex("by_provider", (q) => q.eq("provider_id", a.provider_id!))
        .take(100);
      for (const event of events)
        await applyDelivery(ctx, (await ctx.db.get(row._id))!, event.kind);
    }
  },
});
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const expired = await ctx.db
      .query("campaign_receipts")
      .withIndex("by_due", (q) =>
        q.eq("status", "sending").lt("next_at", Date.now()),
      )
      .take(100);
    for (const row of expired) {
      await ctx.db.patch(row._id, {
        status: "unknown",
        last_code: "dispatch_lease_expired",
        updated_at: Date.now(),
      });
      await audit(ctx, row._id, "expo_receipt_unknown", "unknown");
    }
  },
});
// Administrator-only, fixed preview receipt. It never creates an entry or CRM customer.
export const queueTest = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (
      process.env.GLARA_EXPO_RECEIPT_TEST_APPROVED !== "true" ||
      !process.env.GLARA_EXPO_RECEIPT_TEST_INBOX ||
      !receiptConfigured(process.env) ||
      (await frozen(ctx, "email"))
    )
      throw Error("Receipt test approval required");
    const c = await ctx.db
      .query("marketing_campaigns")
      .withIndex("by_slug", (q) => q.eq("slug", "pacificwest-2026"))
      .unique();
    if (!c) throw Error("Campaign required");
    const key = "expo-receipt-owner-test-v1";
    const old = await ctx.db
      .query("campaign_receipts")
      .withIndex("by_key", (q) => q.eq("key", key))
      .unique();
    if (old) return old._id;
    const content = receiptContent(c.closes_at);
    return await ctx.db.insert("campaign_receipts", {
      campaign_id: c._id,
      key,
      email: process.env.GLARA_EXPO_RECEIPT_TEST_INBOX.trim().toLowerCase(),
      ...content,
      subject: "[TEST] " + content.subject,
      body:
        "CONTROLLED OWNER TEST — no giveaway entry was created.\n\n" +
        content.body,
      template_version: receiptVersion,
      rules_version: c.rules_version,
      test: true,
      status: "ready",
      attempts: 0,
      next_at: Date.now(),
      created_at: Date.now(),
      updated_at: Date.now(),
    });
  },
});
