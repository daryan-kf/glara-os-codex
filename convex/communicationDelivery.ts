import { internalMutation, internalQuery } from "./functions";
import { v } from "convex/values";
import * as core from "./communicationCore";
import { deliveryState } from "../src/lib/communications/model";
export const due = internalQuery({
  args: {},
  handler: async (ctx) =>
    (
      await ctx.db
        .query("communication_outbox")
        .withIndex("by_due", (q) =>
          q.eq("status", "ready").lte("next_attempt_at", Date.now()),
        )
        .take(10)
    ).map((j) => j._id),
});
export const claim = internalMutation({
  args: {
    id: v.id("communication_outbox"),
    token_hash: v.string(),
    unsubscribe_url: v.string(),
  },
  handler: async (ctx, a) => {
    if (
      process.env.M9_EMAIL_ENABLED !== "true" ||
      !process.env.M9_EMAIL_TEST_ALLOWLIST ||
      process.env.M9_EMAIL_VERIFIED !== "true"
    )
      return null;
    const config = await core.settings(ctx);
    if (!config || config.paused) return null;
    const job = await ctx.db.get(a.id);
    if (
      !job ||
      job.status !== "ready" ||
      job.next_attempt_at > Date.now() ||
      job.attempts >= 3
    )
      return null;
    const row = await ctx.db.get(job.communication_id);
    if (!row || row.status !== "queued" || !row.snapshot || !row.approved_by)
      return null;
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", row.approved_by!))
      .unique();
    let invalid = "";
    if (!p || p.deleted_at) invalid = "approver_access_revoked";
    else {
      try {
        const d = await core.evaluate(ctx, row, p),
          prior = row.decision_id && (await ctx.db.get(row.decision_id));
        if (
          !d.allowed ||
          d.fingerprint !== row.snapshot.source_fingerprint ||
          d.subject !== row.snapshot.subject ||
          d.body !== row.snapshot.body ||
          d.signature !== row.snapshot.signature ||
          !prior ||
          JSON.stringify(prior.consent_ids) !== JSON.stringify(d.consent_ids) ||
          JSON.stringify(prior.preference_ids) !==
            JSON.stringify(d.preference_ids)
        )
          invalid = "eligibility_or_source_changed";
        await ctx.db.insert("communication_eligibility_decisions", {
          communication_id: row._id,
          phase: "dispatch",
          allowed: !invalid,
          reasons: invalid ? [...d.reasons, invalid] : [],
          consent_ids: d.consent_ids,
          preference_ids: d.preference_ids,
          suppression_ids: d.suppression_ids,
          recipient_email: d.email,
          source_fingerprint: d.fingerprint,
          policy_version: d.policy_version,
          actor_id: p.userId,
          created_at: Date.now(),
        });
      } catch {
        invalid = "source_access_revoked";
      }
    }
    if (invalid) {
      await ctx.db.patch(row._id, {
        status: "needs_review",
        version: row.version + 1,
        updated_at: Date.now(),
      });
      await ctx.db.patch(job._id, {
        status: "cancelled",
        last_code: invalid,
        version: job.version + 1,
        updated_at: Date.now(),
      });
      await core.audit(ctx, p?.userId ?? null, "dispatch_blocked", row._id, {
        code: invalid,
      });
      return null;
    }
    const allowed = process.env.M9_EMAIL_TEST_ALLOWLIST.split(",").map((x) =>
      x.trim().toLowerCase(),
    );
    if (!allowed.includes(row.snapshot.email)) {
      await ctx.db.patch(job._id, {
        status: "cancelled",
        last_code: "development_recipient_not_authorized",
        version: job.version + 1,
        updated_at: Date.now(),
      });
      await ctx.db.patch(row._id, {
        status: "needs_review",
        version: row.version + 1,
        updated_at: Date.now(),
      });
      await core.audit(ctx, null, "development_recipient_blocked", row._id);
      return null;
    }
    if (job.attempts === 0) {
      const window = Math.floor(Date.now() / 86400000),
        limits = [
          { key: `user:${row.approved_by}`, limit: 50 },
          { key: `recipient:${row.snapshot.email}`, limit: 3 },
          { key: `category:${row.category}`, limit: 100 },
        ];
      for (const limit of limits) {
        const bucket = await ctx.db
          .query("communication_rate_buckets")
          .withIndex("by_key", (q) => q.eq("key", limit.key))
          .unique();
        if (bucket?.window === window && bucket.count >= limit.limit) {
          await ctx.db.patch(job._id, {
            next_attempt_at: (window + 1) * 86400000,
            last_code: "daily_limit",
            version: job.version + 1,
            updated_at: Date.now(),
          });
          return null;
        }
      }
      for (const limit of limits) {
        const bucket = await ctx.db
          .query("communication_rate_buckets")
          .withIndex("by_key", (q) => q.eq("key", limit.key))
          .unique();
        if (bucket)
          await ctx.db.patch(bucket._id, {
            window,
            count: bucket.window === window ? bucket.count + 1 : 1,
          });
        else
          await ctx.db.insert("communication_rate_buckets", {
            key: limit.key,
            window,
            count: 1,
          });
      }
    }
    const priorToken = await ctx.db
      .query("communication_unsubscribe_tokens")
      .withIndex("by_hash", (q) => q.eq("token_hash", a.token_hash))
      .unique();
    if (row.category !== "transactional" && !job.payload && !priorToken)
      await ctx.db.insert("communication_unsubscribe_tokens", {
        token_hash: a.token_hash,
        recipient_key: row.recipient_key,
        scope: "all_optional",
        expires_at: Date.now() + 365 * 86400000,
        created_at: Date.now(),
      });
    const payload = job.payload ?? {
      body:
        row.snapshot.body +
        "\n\n" +
        row.snapshot.signature +
        (row.category !== "transactional"
          ? "\n\nUnsubscribe from optional messages: " + a.unsubscribe_url
          : ""),
      from: process.env.M9_EMAIL_FROM ?? "Support@glarahome.com",
      reply_to: process.env.M9_EMAIL_REPLY_TO ?? "Support@glarahome.com",
    };
    await ctx.db.patch(job._id, {
      status: "claimed",
      payload,
      attempts: job.attempts + 1,
      claimed_at: Date.now(),
      lease_until: Date.now() + 120000,
      version: job.version + 1,
      updated_at: Date.now(),
    });
    await core.audit(ctx, p!.userId, "dispatch_claimed", row._id);
    return {
      id: job._id,
      communication_id: row._id,
      send_key: row.send_key,
      email: row.snapshot.email,
      subject: row.snapshot.subject,
      body: payload.body,
      from: payload.from,
      reply_to: payload.reply_to,
    };
  },
});
export const outcome = internalMutation({
  args: {
    id: v.id("communication_outbox"),
    result: v.union(
      v.literal("accepted"),
      v.literal("unknown"),
      v.literal("retryable"),
      v.literal("rejected"),
    ),
    provider_id: v.optional(v.string()),
    code: v.string(),
  },
  handler: async (ctx, a) => {
    const job = await ctx.db.get(a.id);
    if (!job || !["claimed", "unknown"].includes(job.status)) return;
    const row = await ctx.db.get(job.communication_id);
    if (!row) return;
    if (a.result === "accepted" && a.provider_id) {
      const mapping = await ctx.db
        .query("communication_provider_messages")
        .withIndex("by_provider", (q) =>
          q.eq("provider", "resend").eq("provider_id", a.provider_id!),
        )
        .unique();
      if (mapping && mapping.communication_id !== row._id) {
        await core.audit(ctx, null, "provider_mapping_conflict", row._id);
        return;
      }
      if (!mapping)
        await ctx.db.insert("communication_provider_messages", {
          communication_id: row._id,
          provider: "resend",
          provider_id: a.provider_id,
          send_key: job.send_key,
          created_at: Date.now(),
        });
      await ctx.db.patch(job._id, {
        status: "complete",
        last_code: "accepted",
        version: job.version + 1,
        updated_at: Date.now(),
      });
      let state = deliveryState(row.status, "accepted");
      const pending = await ctx.db
        .query("communication_delivery_events")
        .withIndex("by_provider", (q) => q.eq("provider_id", a.provider_id!))
        .take(100);
      for (const e of pending) {
        state = deliveryState(state, e.kind);
        await ctx.db.patch(e._id, { communication_id: row._id });
        if (e.kind === "hard_bounce" || e.kind === "complaint")
          await suppression(ctx, row.snapshot!.email, e.kind);
      }
      await ctx.db.patch(row._id, {
        status: state,
        version: row.version + 1,
        updated_at: Date.now(),
      });
    } else {
      const retry = a.result === "retryable" && job.attempts < 3;
      await ctx.db.patch(job._id, {
        status: retry ? "ready" : a.result === "unknown" ? "unknown" : "failed",
        next_attempt_at:
          Date.now() + Math.min(3600000, 60000 * 2 ** job.attempts),
        last_code: a.code.slice(0, 80),
        version: job.version + 1,
        updated_at: Date.now(),
      });
      await ctx.db.patch(row._id, {
        status: retry
          ? "queued"
          : a.result === "unknown"
            ? "delivery_unknown"
            : "failed",
        version: row.version + 1,
        updated_at: Date.now(),
      });
      if (a.code === "configuration_rejected") {
        const config = await core.settings(ctx);
        if (config)
          await ctx.db.patch(config._id, {
            paused: true,
            version: config.version + 1,
            updated_at: Date.now(),
          });
      }
    }
    await core.audit(ctx, null, "provider_outcome", row._id, {
      result: a.result,
      code: a.code,
    });
  },
});
async function suppression(
  ctx: Parameters<typeof core.audit>[0],
  email: string,
  reason: string,
) {
  const old = await ctx.db
    .query("communication_suppressions")
    .withIndex("by_email", (q) => q.eq("email", email))
    .order("desc")
    .take(100);
  if (
    !old.some((x) => !x.revoked_at && x.scope === "all" && x.reason === reason)
  ) {
    const id = await ctx.db.insert("communication_suppressions", {
      email,
      scope: "all",
      reason,
      created_at: Date.now(),
    });
    await core.audit(ctx, null, "provider_suppression", id);
  }
}
export const delivery = internalMutation({
  args: {
    event_id: v.string(),
    provider_id: v.string(),
    kind: v.union(
      v.literal("accepted"),
      v.literal("delivered"),
      v.literal("hard_bounce"),
      v.literal("soft_bounce"),
      v.literal("complaint"),
      v.literal("failed"),
    ),
    occurred_at: v.number(),
  },
  handler: async (ctx, a) => {
    if (
      a.event_id.length > 200 ||
      a.provider_id.length > 200 ||
      !Number.isFinite(a.occurred_at)
    )
      return;
    const prior = await ctx.db
      .query("communication_delivery_events")
      .withIndex("by_event", (q) => q.eq("event_id", a.event_id))
      .unique();
    if (prior) return;
    const mapping = await ctx.db
      .query("communication_provider_messages")
      .withIndex("by_provider", (q) =>
        q.eq("provider", "resend").eq("provider_id", a.provider_id),
      )
      .unique();
    await ctx.db.insert("communication_delivery_events", {
      ...a,
      communication_id: mapping?.communication_id,
      created_at: Date.now(),
    });
    if (!mapping) return;
    const row = await ctx.db.get(mapping.communication_id);
    if (!row || !row.snapshot) return;
    await ctx.db.patch(row._id, {
      status: deliveryState(row.status, a.kind),
      version: row.version + 1,
      updated_at: Date.now(),
    });
    if (a.kind === "hard_bounce" || a.kind === "complaint") {
      await suppression(ctx, row.snapshot.email, a.kind);
      if (row.activity_id) {
        const task = await ctx.db.get(row.activity_id);
        if (task && !task.deleted_at && task.status !== "open")
          await ctx.db.patch(task._id, {
            status: "open",
            completed_at: null,
            completed_by: undefined,
            due_at: new Date().toISOString(),
            version: (task.version ?? 0) + 1,
            updated_at: new Date().toISOString(),
          });
      }
    }
    await core.audit(ctx, null, "delivery_event", row._id, { kind: a.kind });
  },
});
export const sweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const jobs = await ctx.db
      .query("communication_outbox")
      .withIndex("by_due", (q) => q.eq("status", "claimed"))
      .take(100);
    let expired = 0;
    for (const job of jobs)
      if ((job.lease_until ?? 0) < Date.now()) {
        await ctx.db.patch(job._id, {
          status: "unknown",
          last_code: "lease_expired",
          version: job.version + 1,
          updated_at: Date.now(),
        });
        const row = await ctx.db.get(job.communication_id);
        if (row)
          await ctx.db.patch(row._id, {
            status: "delivery_unknown",
            version: row.version + 1,
            updated_at: Date.now(),
          });
        await core.audit(ctx, null, "lease_expired", job.communication_id);
        expired++;
      }
    return expired;
  },
});
export const unsubscribe = internalMutation({
  args: { token_hash: v.string() },
  handler: async (ctx, a) => {
    const token = await ctx.db
      .query("communication_unsubscribe_tokens")
      .withIndex("by_hash", (q) => q.eq("token_hash", a.token_hash))
      .unique();
    if (
      !token ||
      token.revoked_at ||
      token.expires_at < Date.now() ||
      token.used_at
    )
      return;
    const old = await ctx.db
      .query("communication_preferences")
      .withIndex("by_recipient", (q) =>
        q
          .eq("recipient_key", token.recipient_key)
          .eq("channel", "email")
          .eq("scope", token.scope),
      )
      .unique();
    const data = {
      recipient_key: token.recipient_key,
      channel: "email" as const,
      scope: token.scope,
      status: "unsubscribed" as const,
      reason: "Recipient unsubscribe",
      version: (old?.version ?? 0) + 1,
      updated_at: Date.now(),
    };
    if (old) await ctx.db.patch(old._id, data);
    else
      await ctx.db.insert("communication_preferences", {
        ...data,
        created_at: Date.now(),
      });
    await ctx.db.patch(token._id, { used_at: Date.now() });
    await core.audit(ctx, null, "recipient_unsubscribed", token._id);
  },
});
export const mapping = internalQuery({
  args: { id: v.id("communications") },
  handler: async (ctx, a) =>
    ctx.db
      .query("communication_provider_messages")
      .withIndex("by_communication", (q) => q.eq("communication_id", a.id))
      .unique(),
});
export const publicLimit = internalMutation({
  args: {},
  handler: async (ctx) => {
    const window = Math.floor(Date.now() / 60000),
      old = await ctx.db
        .query("communication_public_limits")
        .withIndex("by_key", (q) => q.eq("key", "unsubscribe"))
        .unique();
    if (old?.window === window && old.count >= 120) return false;
    if (old)
      await ctx.db.patch(old._id, {
        window,
        count: old.window === window ? old.count + 1 : 1,
      });
    else
      await ctx.db.insert("communication_public_limits", {
        key: "unsubscribe",
        window,
        count: 1,
      });
    return true;
  },
});
export const reconcileVerified = internalMutation({
  args: {
    id: v.id("communications"),
    provider_id: v.string(),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const actor = await core.user(ctx);
    if (!core.isManager(actor)) return;
    const row = await core.authorized(ctx, a.id, actor);
    const job = await ctx.db
      .query("communication_outbox")
      .withIndex("by_communication", (q) => q.eq("communication_id", row._id))
      .unique();
    if (!job || job.status !== "unknown" || row.status !== "delivery_unknown")
      return;
    const existing = await ctx.db
      .query("communication_provider_messages")
      .withIndex("by_provider", (q) =>
        q.eq("provider", "resend").eq("provider_id", a.provider_id),
      )
      .unique();
    if (existing && existing.communication_id !== row._id) return;
    if (!existing)
      await ctx.db.insert("communication_provider_messages", {
        communication_id: row._id,
        provider: "resend",
        provider_id: a.provider_id,
        send_key: row.send_key,
        created_at: Date.now(),
      });
    await ctx.db.patch(job._id, {
      status: "complete",
      last_code: "verified_reconciliation",
      version: job.version + 1,
      updated_at: Date.now(),
    });
    await ctx.db.patch(row._id, {
      status: "sent",
      version: row.version + 1,
      updated_at: Date.now(),
    });
    await core.audit(ctx, actor.userId, "unknown_reconciled", row._id, {
      reason: a.reason,
    });
    return true;
  },
});
