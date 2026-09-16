import type { Id } from "./_generated/dataModel";
import { profileStamp, buildContext } from "./aiContext";
import { scopeSchema } from "../src/lib/ai/model";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import { deny, requireRoles } from "./access";
import * as core from "./communicationCore";
import {
  categoryValue,
  recipientValue,
  sourceValue,
  scopeValue,
} from "./communicationSchema";
import {
  bases,
  covers,
  content,
  editable,
  normalizeEmail,
  states,
} from "../src/lib/communications/model";
export const list = query({
  args: {
    paginationOpts: paginationOptsValidator,
    search: v.optional(v.string()),
    recipient: v.optional(recipientValue),
    category: v.optional(categoryValue),
    from: v.optional(v.number()),
    until: v.optional(v.number()),
    status: v.optional(v.union(...states.map(v.literal))),
    source: v.optional(sourceValue),
  },
  handler: async (ctx, a) => {
    const p = await core.user(ctx);
    if (a.paginationOpts.numItems < 1 || a.paginationOpts.numItems > 50)
      deny("INVALID_INPUT");
    if (a.source && !(await core.sourceAccess(ctx, a.source, p)))
      return { page: [], isDone: true, continueCursor: "" };
    if (
      (a.search && a.search.length > 100) ||
      (a.from !== undefined && !Number.isFinite(a.from)) ||
      (a.until !== undefined && !Number.isFinite(a.until))
    )
      deny("INVALID_INPUT");
    const result = a.search?.trim()
      ? await ctx.db
          .query("communications")
          .withSearchIndex("search_subject", (q) => {
            let f = q.search("subject", a.search!.trim());
            if (!core.isManager(p)) f = f.eq("requested_by", p.userId);
            if (a.source) f = f.eq("source_key", core.key(a.source));
            if (a.recipient) f = f.eq("recipient_key", core.key(a.recipient));
            if (a.category) f = f.eq("category", a.category);
            if (a.status) f = f.eq("status", a.status);
            return f;
          })
          .paginate(a.paginationOpts)
      : await (
          a.recipient
            ? ctx.db
                .query("communications")
                .withIndex("by_recipient", (q) =>
                  q.eq("recipient_key", core.key(a.recipient!)),
                )
            : a.source
              ? ctx.db
                  .query("communications")
                  .withIndex("by_source", (q) =>
                    q.eq("source_key", core.key(a.source!)),
                  )
              : a.status
                ? core.isManager(p)
                  ? ctx.db
                      .query("communications")
                      .withIndex("by_status", (q) => q.eq("status", a.status!))
                  : ctx.db
                      .query("communications")
                      .withIndex("by_requester_status", (q) =>
                        q.eq("requested_by", p.userId).eq("status", a.status!),
                      )
                : core.isManager(p)
                  ? ctx.db.query("communications")
                  : ctx.db
                      .query("communications")
                      .withIndex("by_requester", (q) =>
                        q.eq("requested_by", p.userId),
                      )
        )
          .order("desc")
          .paginate(a.paginationOpts);
    const page = [];
    for (const row of result.page) {
      if (
        row.deleted_at ||
        (a.status && row.status !== a.status) ||
        (a.category && row.category !== a.category) ||
        (a.from !== undefined && row.created_at < a.from) ||
        (a.until !== undefined && row.created_at >= a.until) ||
        (a.source && row.source_key !== core.key(a.source))
      )
        continue;
      try {
        await core.authorized(ctx, row._id, p);
        page.push(row);
      } catch {
        /* Revoked source access hides historical content too. */
      }
    }
    return { ...result, page };
  },
});
export const get = query({
  args: { id: v.id("communications") },
  handler: async (ctx, a) => {
    const p = await core.user(ctx),
      row = await core.authorized(ctx, a.id, p);
    const events = await ctx.db
      .query("communication_delivery_events")
      .withIndex("by_communication", (q) => q.eq("communication_id", a.id))
      .order("desc")
      .take(100);
    const decisions = await ctx.db
      .query("communication_eligibility_decisions")
      .withIndex("by_communication", (q) => q.eq("communication_id", a.id))
      .order("desc")
      .take(30);
    const eligibility = await core.evaluate(ctx, row, p).catch(() => ({
      email: row.snapshot?.email ?? "",
      subject: row.snapshot?.subject ?? row.subject,
      body: row.snapshot?.body ?? row.body,
      signature: row.snapshot?.signature ?? "",
      fingerprint: "unavailable",
      consent_ids: [],
      preference_ids: [],
      suppression_ids: [],
      policy_version: "unavailable",
      reasons: ["source_unavailable_for_sending"],
      allowed: false,
      eligibility_basis: [],
    }));
    return {
      row,
      events,
      decisions,
      eligibility: {
        review_token: core.reviewToken(eligibility),
        allowed: eligibility.allowed,
        reasons: eligibility.reasons,
        email: eligibility.email,
        subject: eligibility.subject,
        body: eligibility.body,
        signature: eligibility.signature,
        basis: eligibility.eligibility_basis,
      },
    };
  },
});
export const create = mutation({
  args: {
    recipient: recipientValue,
    source: sourceValue,
    category: categoryValue,
    subject: v.string(),
    body: v.string(),
    request_key: v.string(),
    template_version_id: v.optional(v.id("communication_template_versions")),
    activity_id: v.optional(v.id("activities")),
    ai_draft_id: v.optional(v.id("ai_requests")),
  },
  handler: async (ctx, a) => {
    const p = await core.user(ctx);
    await core.sourceFacts(ctx, a.source, a.recipient, p, a.category);
    if (!core.categoryCompatible(a.source.type, a.category))
      deny(
        "INVALID_INPUT",
        "This source does not support that message purpose.",
      );
    if (!/^[A-Za-z0-9_-]{16,100}$/.test(a.request_key)) deny("INVALID_INPUT");
    const parsed = content.safeParse({ subject: a.subject, body: a.body });
    if (!parsed.success)
      return deny("INVALID_INPUT", "Check the subject and message length.");
    const sendKey = `${p.userId}:${a.request_key}`;
    const existing = await ctx.db
      .query("communications")
      .withIndex("by_send_key", (q) => q.eq("send_key", sendKey))
      .unique();
    if (existing) {
      await core.authorized(ctx, existing._id, p);
      return existing._id;
    }
    if (a.activity_id) {
      const activity = await ctx.db.get(a.activity_id);
      if (
        !activity ||
        activity.deleted_at ||
        activity.status !== "open" ||
        (activity.assigned_to !== p.userId && !core.isManager(p)) ||
        !(
          (a.source.type === "realtor" &&
            activity.realtor_id === a.source.id) ||
          (a.source.type === "opportunity" &&
            activity.opportunity_id === a.source.id) ||
          (a.source.type === "project" && activity.project_id === a.source.id)
        )
      )
        deny();
    }
    if (a.activity_id) {
      const drafts = await ctx.db
        .query("communications")
        .withIndex("by_activity", (q) => q.eq("activity_id", a.activity_id!))
        .order("desc")
        .take(101);
      if (drafts.length > 100)
        deny(
          "LIMIT",
          "Review this follow-up's existing communication history.",
        );
      const duplicate = drafts.find(
        (r) =>
          !r.deleted_at &&
          r.source_key === core.key(a.source) &&
          r.recipient_key === core.key(a.recipient) &&
          r.category === a.category &&
          !["cancelled", "sent", "delivered", "bounced", "failed"].includes(
            r.status,
          ),
      );
      if (duplicate) {
        await core.authorized(ctx, duplicate._id, p);
        return duplicate._id;
      }
    }
    if (a.ai_draft_id) {
      const request = await ctx.db.get(a.ai_draft_id);
      if (
        !request ||
        request.user_id !== p.userId ||
        request.status !== "completed" ||
        request.scope.entity_id !== a.source.id ||
        request.role_stamp !== profileStamp(p)
      )
        deny();
      if (
        (await buildContext(ctx, scopeSchema.parse(request!.scope)))
          .revision !== request!.context_digest
      )
        deny("CONFLICT");
    }
    const { request_key: unused, ...fields } = a;
    void unused;
    const id = await ctx.db.insert("communications", {
      ...fields,
      kind:
        a.source.type === "quote"
          ? "quote_followup"
          : a.source.type === "consultation"
            ? "consultation_confirmation"
            : a.source.type === "project"
              ? "project_update"
              : a.source.type === "invoice"
                ? "invoice_reminder"
                : a.source.type === "payment"
                  ? "payment_acknowledgement"
                  : "realtor_followup",
      ...parsed.data,
      recipient_key: core.key(a.recipient),
      source_key: core.key(a.source),
      requested_by: p.userId,
      send_key: sendKey,
      status: "draft",
      scheduled_at: Date.now(),
      created_at: Date.now(),
      updated_at: Date.now(),
      version: 1,
    });
    await core.audit(
      ctx,
      p.userId,
      a.ai_draft_id
        ? "ai_draft_imported"
        : a.activity_id
          ? "activity_draft_created"
          : "draft_created",
      id,
    );
    return id;
  },
});
export const edit = mutation({
  args: {
    id: v.id("communications"),
    version: v.number(),
    subject: v.string(),
    body: v.string(),
    template_version_id: v.optional(v.id("communication_template_versions")),
  },
  handler: async (ctx, a) => {
    const p = await core.user(ctx),
      row = await core.authorized(ctx, a.id, p);
    core.version(row, a.version);
    if (!editable(row.status) || row.deleted_at) deny("CONFLICT");
    const dispatched = await ctx.db
      .query("communication_outbox")
      .withIndex("by_communication", (q) => q.eq("communication_id", row._id))
      .unique();
    if (dispatched?.attempts)
      deny(
        "CONFLICT",
        "A dispatched snapshot is immutable. Create a new reviewed communication.",
      );
    const data = content.safeParse({ subject: a.subject, body: a.body });
    if (!data.success) return deny("INVALID_INPUT");
    await ctx.db.patch(row._id, {
      ...data.data,
      template_version_id: a.template_version_id,
      status: "draft",
      snapshot: undefined,
      decision_id: undefined,
      approved_by: undefined,
      version: row.version + 1,
      updated_at: Date.now(),
    });
    await core.audit(ctx, p.userId, "draft_updated", row._id);
  },
});
export const approve = mutation({
  args: {
    id: v.id("communications"),
    version: v.number(),
    review_token: v.string(),
    scheduled_at: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const p = await core.user(ctx),
      row = await core.authorized(ctx, a.id, p);
    core.version(row, a.version);
    if (!editable(row.status) || row.deleted_at) deny("CONFLICT");
    const dispatched = await ctx.db
      .query("communication_outbox")
      .withIndex("by_communication", (q) => q.eq("communication_id", row._id))
      .unique();
    if (dispatched?.attempts)
      deny(
        "CONFLICT",
        "A dispatched snapshot is immutable. Create a new reviewed communication.",
      );
    const config = await core.settings(ctx);
    if (config?.secondary_approval && p.userId === row.requested_by)
      deny("SECOND_REVIEW_REQUIRED");
    const d = await core.evaluate(ctx, row, p);
    if (a.review_token !== core.reviewToken(d))
      deny(
        "CONFLICT",
        "Source facts or eligibility changed. Review the refreshed message.",
      );
    const decision = await ctx.db.insert(
      "communication_eligibility_decisions",
      {
        communication_id: row._id,
        phase: "approval",
        allowed: d.allowed,
        reasons: d.reasons,
        consent_ids: d.consent_ids,
        preference_ids: d.preference_ids,
        suppression_ids: d.suppression_ids,
        recipient_email: d.email,
        source_fingerprint: d.fingerprint,
        policy_version: d.policy_version,
        actor_id: p.userId,
        created_at: Date.now(),
      },
    );
    const at = a.scheduled_at ?? Date.now();
    if (
      !Number.isFinite(at) ||
      at < Date.now() - 60000 ||
      at > Date.now() + 30 * 86400000
    )
      deny("INVALID_INPUT");
    await ctx.db.patch(row._id, {
      status: d.allowed ? "approved" : "ineligible",
      decision_id: decision,
      approved_by: d.allowed ? p.userId : undefined,
      snapshot: d.allowed
        ? {
            email: d.email,
            name: d.name,
            subject: d.subject,
            body: d.body,
            source_fingerprint: d.fingerprint,
            signature: d.signature,
            template_version_id: row.template_version_id,
          }
        : undefined,
      scheduled_at: at,
      version: row.version + 1,
      updated_at: Date.now(),
    });
    await core.audit(
      ctx,
      p.userId,
      d.allowed ? "approved" : "ineligible",
      row._id,
    );
    return { allowed: d.allowed, reasons: d.reasons };
  },
});
export const enqueue = mutation({
  args: { id: v.id("communications"), version: v.number() },
  handler: async (ctx, a) => {
    const p = await core.user(ctx),
      row = await core.authorized(ctx, a.id, p);
    const existing = await ctx.db
      .query("communication_outbox")
      .withIndex("by_communication", (q) => q.eq("communication_id", row._id))
      .unique();
    if (existing) {
      if (
        existing.status === "cancelled" &&
        existing.attempts === 0 &&
        row.status === "approved"
      ) {
        core.version(row, a.version);
        await ctx.db.patch(existing._id, {
          status: "ready",
          next_attempt_at: row.scheduled_at,
          version: existing.version + 1,
          updated_at: Date.now(),
        });
        await ctx.db.patch(row._id, {
          status: "queued",
          version: row.version + 1,
          updated_at: Date.now(),
        });
        await core.audit(ctx, p.userId, "requeued_after_review", row._id);
      }
      return existing._id;
    }
    core.version(row, a.version);
    if (row.status !== "approved" || !row.snapshot || row.deleted_at)
      deny("CONFLICT");
    const recent = await ctx.db
      .query("communications")
      .withIndex("by_recipient", (q) =>
        q.eq("recipient_key", row.recipient_key),
      )
      .order("desc")
      .take(101);
    if (
      recent.some(
        (r) =>
          r._id !== row._id &&
          r.category === row.category &&
          row.category !== "transactional" &&
          r.updated_at > Date.now() - 3600000 &&
          ["queued", "sent", "delivered", "delivery_unknown"].includes(
            r.status,
          ),
      )
    )
      deny("RATE_LIMIT", "Recent contact requires review. Try again later.");
    const mine = await ctx.db
      .query("communications")
      .withIndex("by_requester", (q) =>
        q.eq("requested_by", p.userId).gte("created_at", Date.now() - 86400000),
      )
      .take(51);
    if (mine.length > 50) deny("RATE_LIMIT");
    const id = await ctx.db.insert("communication_outbox", {
      communication_id: row._id,
      send_key: row.send_key,
      status: "ready",
      attempts: 0,
      next_attempt_at: row.scheduled_at,
      created_at: Date.now(),
      updated_at: Date.now(),
      version: 1,
    });
    await ctx.db.patch(row._id, {
      status: "queued",
      version: row.version + 1,
      updated_at: Date.now(),
    });
    await core.audit(ctx, p.userId, "queued", row._id);
    return id;
  },
});
export const cancel = mutation({
  args: {
    id: v.id("communications"),
    version: v.number(),
    archive: v.optional(v.boolean()),
  },
  handler: async (ctx, a) => {
    const p = await core.user(ctx),
      row = await core.authorized(ctx, a.id, p);
    core.version(row, a.version);
    const job = await ctx.db
      .query("communication_outbox")
      .withIndex("by_communication", (q) => q.eq("communication_id", row._id))
      .unique();
    if (
      (job && job.status !== "ready") ||
      ![
        "draft",
        "pending_approval",
        "approved",
        "queued",
        "needs_review",
        "ineligible",
        "suppressed",
      ].includes(row.status)
    )
      deny(
        "CONFLICT",
        "Dispatch has started. This message cannot be recalled.",
      );
    if (job)
      await ctx.db.patch(job._id, {
        status: "cancelled",
        version: job.version + 1,
        updated_at: Date.now(),
      });
    await ctx.db.patch(row._id, {
      status: "cancelled",
      deleted_at: a.archive ? Date.now() : undefined,
      version: row.version + 1,
      updated_at: Date.now(),
    });
    await core.audit(
      ctx,
      p.userId,
      a.archive ? "draft_archived" : "cancelled",
      row._id,
    );
  },
});
export const templates = query({
  args: {},
  handler: async (ctx) => {
    const p = await core.user(ctx);
    const rows = await ctx.db
      .query("communication_templates")
      .withIndex("by_active", (q) => q.eq("active", true))
      .take(100);
    return Promise.all(
      rows
        .filter(
          (r) =>
            core.isManager(p) ||
            (p.roles.includes("sales") &&
              r.category !== "commercial_marketing") ||
            (p.roles.includes("marketing") &&
              r.category === "commercial_marketing"),
        )
        .map(async (r) => ({
          ...r,
          current: r.current_version_id
            ? await ctx.db.get(r.current_version_id)
            : null,
        })),
    );
  },
});
export const saveTemplate = mutation({
  args: {
    key: v.string(),
    name: v.string(),
    category: categoryValue,
    subject: v.string(),
    body: v.string(),
    version: v.number(),
    active: v.boolean(),
  },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, ["owner", "admin"]),
      parsed = content.safeParse({ subject: a.subject, body: a.body });
    if (
      !parsed.success ||
      !/^[a-z0-9_-]{3,60}$/.test(a.key) ||
      a.name.length > 100
    )
      deny("INVALID_INPUT");
    const old = await ctx.db
      .query("communication_templates")
      .withIndex("by_key", (q) => q.eq("key", a.key))
      .unique();
    if (old) core.version(old, a.version);
    else if (a.version !== 0) deny("CONFLICT");
    const at = Date.now(),
      revision = (old?.version ?? 0) + 1;
    const id =
      old?._id ??
      (await ctx.db.insert("communication_templates", {
        key: a.key,
        name: a.name,
        category: a.category,
        active: a.active,
        version: revision,
        created_at: at,
        updated_at: at,
      }));
    const vid = await ctx.db.insert("communication_template_versions", {
      template_id: id,
      revision,
      subject: a.subject,
      body: a.body,
      created_by: p.userId,
      created_at: at,
    });
    await ctx.db.patch(id, {
      name: a.name,
      category: a.category,
      active: a.active,
      current_version_id: vid,
      version: revision,
      updated_at: at,
    });
    await core.audit(ctx, p.userId, "template_version_created", id);
    return vid;
  },
});
export const recordConsent = mutation({
  args: {
    source: sourceValue,
    recipient: recipientValue,
    category: categoryValue,
    scope: scopeValue,
    basis: v.union(...bases.map(v.literal)),
    evidence: v.string(),
    evidence_source: v.string(),
    observed_at: v.number(),
    expires_at: v.optional(v.number()),
  },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, ["owner", "admin"]);
    await core.sourceFacts(ctx, a.source, a.recipient, p, a.category);
    if (!core.categoryCompatible(a.source.type, a.category))
      deny(
        "INVALID_INPUT",
        "This source does not support that message purpose.",
      );
    if (
      a.evidence.trim().length < 8 ||
      a.evidence.length > 2000 ||
      !a.evidence_source.trim() ||
      a.evidence_source.length > 200 ||
      !Number.isFinite(a.observed_at) ||
      a.observed_at > Date.now() ||
      (a.expires_at !== undefined &&
        (!Number.isFinite(a.expires_at) || a.expires_at <= a.observed_at))
    )
      deny("INVALID_INPUT");
    const id = await ctx.db.insert("communication_consents", {
      recipient_key: core.key(a.recipient),
      scope: a.scope,
      basis: a.basis,
      evidence: a.evidence,
      source: a.evidence_source,
      observed_at: a.observed_at,
      expires_at: a.expires_at,
      recorded_by: p.userId,
      created_at: Date.now(),
    });
    await core.audit(ctx, p.userId, "consent_recorded", id);
    return id;
  },
});
export const revokeConsent = mutation({
  args: { id: v.id("communication_consents"), reason: v.string() },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, ["owner", "admin"]);
    if (a.reason.trim().length < 8 || a.reason.length > 500)
      deny("INVALID_INPUT");
    const row = await ctx.db.get(a.id);
    if (!row) deny("UNAVAILABLE");
    if (!row!.revoked_at) {
      await ctx.db.patch(a.id, { revoked_at: Date.now() });
      await core.audit(ctx, p.userId, "consent_revoked", a.id, {
        reason: a.reason,
      });
    }
  },
});
export const preference = mutation({
  args: {
    source: sourceValue,
    recipient: recipientValue,
    category: categoryValue,
    scope: scopeValue,
    status: v.union(
      v.literal("allowed"),
      v.literal("unsubscribed"),
      v.literal("unknown"),
    ),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, ["owner", "admin"]);
    await core.sourceFacts(ctx, a.source, a.recipient, p, a.category);
    if (!core.categoryCompatible(a.source.type, a.category))
      deny(
        "INVALID_INPUT",
        "This source does not support that message purpose.",
      );
    if (a.reason.trim().length < 8 || a.reason.length > 500)
      deny("INVALID_INPUT");
    const recipient_key = core.key(a.recipient),
      old = await ctx.db
        .query("communication_preferences")
        .withIndex("by_recipient", (q) =>
          q
            .eq("recipient_key", recipient_key)
            .eq("channel", "email")
            .eq("scope", a.scope),
        )
        .unique();
    const data = {
      recipient_key,
      channel: "email" as const,
      scope: a.scope,
      status: a.status,
      reason: a.reason,
      recorded_by: p.userId,
      updated_at: Date.now(),
      version: (old?.version ?? 0) + 1,
    };
    if (old) {
      await core.audit(ctx, p.userId, "preference_changed", old._id, {
        old_status: old.status,
        new_status: a.status,
        reason: a.reason,
      });
      await ctx.db.patch(old._id, data);
    } else {
      const id = await ctx.db.insert("communication_preferences", {
        ...data,
        created_at: Date.now(),
      });
      await core.audit(ctx, p.userId, "preference_created", id);
    }
  },
});
export const suppress = mutation({
  args: { email: v.string(), scope: scopeValue, reason: v.string() },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, ["owner", "admin"]);
    let email: string;
    try {
      email = normalizeEmail(a.email);
    } catch {
      return deny("INVALID_INPUT");
    }
    if (a.reason.trim().length < 8 || a.reason.length > 500)
      deny("INVALID_INPUT");
    const id = await ctx.db.insert("communication_suppressions", {
      email,
      scope: a.scope,
      reason: a.reason,
      recorded_by: p.userId,
      created_at: Date.now(),
    });
    await core.audit(ctx, p.userId, "suppressed", id);
    return id;
  },
});
export const revokeSuppression = mutation({
  args: { id: v.id("communication_suppressions"), reason: v.string() },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, ["owner", "admin"]);
    if (a.reason.trim().length < 8 || a.reason.length > 500)
      deny("INVALID_INPUT");
    const row = await ctx.db.get(a.id);
    if (!row) deny("UNAVAILABLE");
    if (row!.reason === "hard_bounce" || row!.reason === "complaint")
      deny(
        "INVALID_INPUT",
        "Provider suppression cannot be overridden. Correct a bounced address; keep complaint preferences in force.",
      );
    await ctx.db.patch(a.id, {
      revoked_at: Date.now(),
      revoked_by: p.userId,
      revoke_reason: a.reason,
    });
    await core.audit(ctx, p.userId, "suppression_revoked", a.id, {
      reason: a.reason,
    });
  },
});
export const configuration = query({
  args: {},
  handler: async (ctx) => {
    const p = await core.user(ctx),
      config = await core.settings(ctx);
    return {
      manager: core.isManager(p),
      default_category:
        !core.isManager(p) &&
        p.roles.includes("marketing") &&
        !p.roles.includes("sales")
          ? ("commercial_marketing" as const)
          : ("sales_relationship" as const),
      config: core.isManager(p) ? config : null,
      enabled: process.env.M9_EMAIL_ENABLED === "true",
      sender: process.env.M9_EMAIL_FROM ?? "Support@glarahome.com",
      provider: "resend",
      live_acceptance: "PENDING_EXTERNAL_ACTION",
    };
  },
});
export const saveSettings = mutation({
  args: {
    version: v.number(),
    signature: v.string(),
    secondary_approval: v.boolean(),
    paused: v.boolean(),
    queue_lag_minutes: v.optional(v.number()),
    transactional_basis: v.optional(
      v.union(
        v.literal("documented_service"),
        v.literal("explicit_request_only"),
      ),
    ),
  },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, ["owner", "admin"]);
    if (
      a.signature.trim().length < 20 ||
      a.signature.length > 1000 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(a.signature)
    )
      deny("INVALID_INPUT");
    if (
      a.queue_lag_minutes !== undefined &&
      (!Number.isInteger(a.queue_lag_minutes) ||
        a.queue_lag_minutes < 1 ||
        a.queue_lag_minutes > 1440)
    )
      deny("INVALID_INPUT");
    const old = await core.settings(ctx);
    if (old) core.version(old, a.version);
    else if (a.version !== 0) deny("CONFLICT");
    const data = {
      key: "company" as const,
      signature: a.signature,
      secondary_approval: a.secondary_approval,
      paused: a.paused,
      queue_lag_minutes: a.queue_lag_minutes ?? old?.queue_lag_minutes ?? 15,
      transactional_basis:
        a.transactional_basis ??
        old?.transactional_basis ??
        "documented_service",
      consecutive_failures: a.paused ? (old?.consecutive_failures ?? 0) : 0,
      circuit_reason: a.paused ? old?.circuit_reason : undefined,
      version: a.version + 1,
      updated_at: Date.now(),
    };
    const id =
      old?._id ??
      (await ctx.db.insert("communication_settings", {
        ...data,
        created_at: Date.now(),
      }));
    if (old) await ctx.db.patch(id, data);
    await core.audit(ctx, p.userId, "settings_changed", id);
  },
});
export const compliance = query({
  args: {
    source: sourceValue,
    recipient: recipientValue,
    category: categoryValue,
  },
  handler: async (ctx, a) => {
    const p = await core.user(ctx),
      f = await core.sourceFacts(ctx, a.source, a.recipient, p, a.category),
      recipient_key = core.key(a.recipient);
    if (!core.isManager(p)) deny();
    return {
      email: f.email,
      consents: await ctx.db
        .query("communication_consents")
        .withIndex("by_recipient", (q) => q.eq("recipient_key", recipient_key))
        .order("desc")
        .take(100),
      preferences: await ctx.db
        .query("communication_preferences")
        .withIndex("by_recipient", (q) => q.eq("recipient_key", recipient_key))
        .take(20),
      suppressions: await ctx.db
        .query("communication_suppressions")
        .withIndex("by_email", (q) => q.eq("email", f.email))
        .order("desc")
        .take(100),
    };
  },
});
export const sources = query({
  args: { category: categoryValue },
  handler: async (ctx, a) => {
    const p = await core.user(ctx),
      rows: {
        source: core.Source;
        recipient: core.Recipient;
        label: string;
      }[] = [];
    const realtors = await ctx.db
      .query("realtors")
      .withIndex("by_archived", (q) => q.eq("deleted_at", null))
      .take(100);
    for (const r of realtors) {
      const source = { type: "realtor" as const, id: r._id };
      try {
        await core.sourceFacts(ctx, source, source, p, a.category);
        rows.push({
          source,
          recipient: source,
          label: `${r.first_name} ${r.last_name}`,
        });
      } catch {
        continue;
      }
    }
    if (a.category !== "commercial_marketing") {
      const opportunities = await ctx.db
        .query("opportunities")
        .order("desc")
        .take(50);
      for (const o of opportunities) {
        const source = { type: "opportunity" as const, id: o._id },
          recipient = { type: "realtor" as const, id: o.realtor_id };
        try {
          const f = await core.sourceFacts(
            ctx,
            source,
            recipient,
            p,
            a.category,
          );
          rows.push({
            source,
            recipient,
            label: `Opportunity · ${f.name} · ${o.stage}`,
          });
        } catch {
          continue;
        }
      }
      const quotes = await ctx.db.query("quotes").order("desc").take(50);
      for (const q of quotes) {
        const o = await ctx.db.get(q.opportunity_id);
        if (!o) continue;
        const source = { type: "quote" as const, id: q._id },
          recipient = { type: "realtor" as const, id: o.realtor_id };
        try {
          await core.sourceFacts(ctx, source, recipient, p, a.category);
          rows.push({ source, recipient, label: `Quote ${q.number}` });
        } catch {
          continue;
        }
      }
      if (core.isManager(p)) {
        const projects = await ctx.db
          .query("projects")
          .withIndex("by_archived", (q) => q.eq("deleted_at", null))
          .take(50);
        for (const project of projects)
          rows.push({
            source: { type: "project", id: project._id },
            recipient: { type: "realtor", id: project.realtor_id },
            label: project.project_number,
          });
        const invoices = await ctx.db
          .query("invoices")
          .withIndex("by_status_due", (q) => q.eq("status", "issued"))
          .take(50);
        for (const i of invoices)
          if (!i.deleted_at)
            rows.push({
              source: { type: "invoice", id: i._id },
              recipient: { type: "customer", id: i.customer_id },
              label: `Invoice ${i.number}`,
            });
        const payments = await ctx.db
          .query("payments")
          .withIndex("by_received")
          .order("desc")
          .take(50);
        for (const pay of payments)
          rows.push({
            source: { type: "payment", id: pay._id },
            recipient: { type: "customer", id: pay.customer_id },
            label: `Payment ${pay.number}`,
          });
      }
    }
    if (a.category === "transactional") {
      const consultations = await ctx.db
        .query("consultations")
        .order("desc")
        .take(50);
      for (const c of consultations) {
        const o = await ctx.db.get(c.opportunity_id);
        if (!o) continue;
        const source = { type: "consultation" as const, id: c._id },
          recipient = { type: "realtor" as const, id: o.realtor_id };
        try {
          await core.sourceFacts(ctx, source, recipient, p, a.category);
          rows.push({
            source,
            recipient,
            label: `Consultation · ${c.scheduled_at}`,
          });
        } catch {
          /* Current source access required. */
        }
      }
    }
    return {
      rows: rows.filter((r) =>
        core.categoryCompatible(r.source.type, a.category),
      ),
      limited: true,
    };
  },
});
export const queueHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner", "admin"]);
    const result = [];
    for (const state of ["ready", "claimed", "unknown", "failed"] as const) {
      const rows = await ctx.db
        .query("communication_outbox")
        .withIndex("by_due", (q) => q.eq("status", state))
        .take(101);
      result.push({
        state,
        count: Math.min(rows.length, 100),
        partial: rows.length > 100,
      });
    }
    return result;
  },
});
export const activityDraft = query({
  args: { id: v.id("activities") },
  handler: async (ctx, a) => {
    const p = await core.user(ctx),
      activity = await ctx.db.get(a.id);
    if (
      !activity ||
      activity.deleted_at ||
      activity.status !== "open" ||
      (activity.assigned_to !== p.userId && !core.isManager(p))
    )
      return deny();
    let source: core.Source;
    let realtor: Id<"realtors"> | undefined = activity.realtor_id;
    if (activity.opportunity_id) {
      source = { type: "opportunity", id: activity.opportunity_id };
      realtor = (await ctx.db.get(activity.opportunity_id))?.realtor_id;
    } else if (activity.project_id) {
      source = { type: "project", id: activity.project_id };
      realtor = (await ctx.db.get(activity.project_id))?.realtor_id;
    } else if (realtor) source = { type: "realtor", id: realtor };
    else return deny("UNAVAILABLE");
    if (!realtor) return deny("UNAVAILABLE");
    const recipient = { type: "realtor" as const, id: realtor },
      category =
        source.type === "project"
          ? ("transactional" as const)
          : ("sales_relationship" as const);
    const facts = await core.sourceFacts(ctx, source, recipient, p, category);
    return { source, recipient, category, label: facts.name };
  },
});
export const unknownReview = query({
  args: { id: v.id("communications") },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, ["owner", "admin"]),
      row = await core.authorized(ctx, a.id, p);
    const job = await ctx.db
      .query("communication_outbox")
      .withIndex("by_communication", (q) => q.eq("communication_id", row._id))
      .unique();
    if (
      row.status !== "delivery_unknown" ||
      !job ||
      job.status !== "unknown" ||
      !job.payload ||
      !row.snapshot
    )
      return deny("CONFLICT");
    return { row, job };
  },
});
export const revokeUnsubscribeToken = mutation({
  args: { id: v.id("communication_unsubscribe_tokens"), reason: v.string() },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, ["owner", "admin"]);
    if (a.reason.trim().length < 8 || a.reason.length > 500)
      deny("INVALID_INPUT");
    await ctx.db.patch(a.id, { revoked_at: Date.now() });
    await core.audit(ctx, p.userId, "unsubscribe_token_revoked", a.id, {
      reason: a.reason,
    });
  },
});
export const requestReview = mutation({
  args: { id: v.id("communications"), version: v.number() },
  handler: async (ctx, a) => {
    const p = await core.user(ctx),
      row = await core.authorized(ctx, a.id, p);
    core.version(row, a.version);
    if (!editable(row.status)) deny("CONFLICT");
    await ctx.db.patch(row._id, {
      status: "pending_approval",
      version: row.version + 1,
      updated_at: Date.now(),
    });
    await core.audit(ctx, p.userId, "review_requested", row._id);
  },
});
export const deliveryHistory = query({
  args: { id: v.id("communications"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await core.authorized(ctx, a.id, await core.user(ctx));
    if (a.paginationOpts.numItems < 1 || a.paginationOpts.numItems > 50)
      deny("INVALID_INPUT");
    return ctx.db
      .query("communication_delivery_events")
      .withIndex("by_communication", (q) => q.eq("communication_id", a.id))
      .order("desc")
      .paginate(a.paginationOpts);
  },
});
export const operationsHealth = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner", "admin"]);
    const config = await core.settings(ctx),
      now = Date.now();
    const ready = await ctx.db
      .query("communication_outbox")
      .withIndex("by_due", (q) => q.eq("status", "ready"))
      .take(101);
    const oldest = ready
      .filter((j) => j.next_attempt_at <= now)
      .reduce((age, j) => Math.max(age, now - j.next_attempt_at), 0);
    const recent = await ctx.db
      .query("communication_outbox")
      .order("desc")
      .take(100);
    return {
      lag_minutes: Math.floor(oldest / 60000),
      lag_warning: oldest > (config?.queue_lag_minutes ?? 15) * 60000,
      retry_waiting: ready.filter(
        (j) => j.attempts > 0 && j.next_attempt_at > now,
      ).length,
      partial: ready.length > 100,
      paused: config?.paused ?? true,
      circuit_reason: config?.circuit_reason,
      consecutive_failures: config?.consecutive_failures ?? 0,
      webhook_failures: config?.webhook_failures ?? 0,
      problems: recent
        .filter((j) => ["unknown", "failed"].includes(j.status))
        .map((j) => ({
          id: j.communication_id,
          status: j.status,
          code: j.last_code,
        })),
      provider_configured:
        !!process.env.M9_RESEND_KEY && process.env.M9_EMAIL_VERIFIED === "true",
      enabled: process.env.M9_EMAIL_ENABLED === "true",
    };
  },
});
export const rotateUnsubscribeGeneration = mutation({
  args: { version: v.number(), reason: v.string() },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, ["owner", "admin"]),
      config = await core.settings(ctx);
    if (!config) return deny("UNAVAILABLE");
    core.version(config, a.version);
    if (a.reason.trim().length < 8 || a.reason.length > 500)
      deny("INVALID_INPUT");
    await ctx.db.patch(config._id, {
      token_generation: (config.token_generation ?? 0) + 1,
      version: config.version + 1,
      updated_at: Date.now(),
    });
    await core.audit(
      ctx,
      p.userId,
      "unsubscribe_generation_revoked",
      config._id,
      { reason: a.reason },
    );
  },
});
export const setTemplateActive = mutation({
  args: {
    id: v.id("communication_templates"),
    version: v.number(),
    active: v.boolean(),
  },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, ["owner", "admin"]),
      row = await ctx.db.get(a.id);
    if (!row) return deny("UNAVAILABLE");
    core.version(row, a.version);
    await ctx.db.patch(row._id, {
      active: a.active,
      version: row.version + 1,
      updated_at: Date.now(),
    });
    await core.audit(
      ctx,
      p.userId,
      a.active ? "template_enabled" : "template_disabled",
      row._id,
    );
  },
});
// Bounded independent reconciliation. Callers aggregate every page; partial pages never prove a clean database.
export const reconcilePage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin"]);
    if (a.paginationOpts.numItems < 1 || a.paginationOpts.numItems > 25)
      deny("INVALID_INPUT");
    const page = await ctx.db
      .query("communications")
      .paginate(a.paginationOpts);
    const findings: { id: Id<"communications">; issues: string[] }[] = [];
    for (const row of page.page) {
      const issues: string[] = [];
      if (row.source_key !== core.key(row.source))
        issues.push("source_key_mismatch");
      if (row.recipient_key !== core.key(row.recipient))
        issues.push("recipient_key_mismatch");
      if (["approved", "queued"].includes(row.status)) {
        if (!row.snapshot || !row.approved_by)
          issues.push("approval_snapshot_missing");
        const decision = row.decision_id && (await ctx.db.get(row.decision_id));
        if (
          !decision ||
          !decision.allowed ||
          decision.phase !== "approval" ||
          decision.communication_id !== row._id
        )
          issues.push("approval_evidence_missing");
        if (row.category !== "transactional") {
          const preferences = await ctx.db
            .query("communication_preferences")
            .withIndex("by_recipient", (q) =>
              q.eq("recipient_key", core.key(row.recipient)),
            )
            .take(21);
          if (preferences.length > 20)
            issues.push("preference_history_requires_review");
          if (
            preferences.some(
              (p) =>
                p.status === "unsubscribed" && covers(p.scope, row.category),
            )
          )
            issues.push("active_optional_unsubscribed");
        }
      }
      const jobs = await ctx.db
        .query("communication_outbox")
        .withIndex("by_communication", (q) => q.eq("communication_id", row._id))
        .take(2);
      const duplicates = await ctx.db
        .query("communications")
        .withIndex("by_send_key", (q) => q.eq("send_key", row.send_key))
        .take(2);
      const mappings = await ctx.db
        .query("communication_provider_messages")
        .withIndex("by_communication", (q) => q.eq("communication_id", row._id))
        .take(2);
      if (duplicates.length > 1 || jobs.length > 1 || mappings.length > 1)
        issues.push("duplicate_identity");
      const job = jobs[0],
        mapping = mappings[0];
      if (row.status === "queued" && !job) issues.push("missing_outbox");
      if (job && job.send_key !== row.send_key)
        issues.push("outbox_key_mismatch");
      if (mapping && mapping.send_key !== row.send_key)
        issues.push("provider_key_mismatch");
      if (["sent", "delivered", "bounced"].includes(row.status) && !mapping)
        issues.push("missing_provider_evidence");
      if (row.status === "delivery_unknown")
        issues.push("unknown_requires_investigation");
      if (
        job?.status === "ready" &&
        (row.status !== "queued" ||
          job.attempts >= 3 ||
          (job.attempts > 0 &&
            job.last_code !== "rate_limited" &&
            !(
              job.last_code === "unused_claim_recovered" &&
              !job.dispatch_started_at
            )))
      )
        issues.push("unsafe_retry_state");
      if (
        row.status === "queued" &&
        job &&
        !["ready", "claimed"].includes(job.status)
      )
        issues.push("queue_job_state_mismatch");
      if (
        mapping &&
        (!job ||
          job.status !== "complete" ||
          !job.dispatch_started_at ||
          !row.snapshot)
      )
        issues.push("provider_dispatch_provenance_missing");
      if (mapping) {
        const events = await Promise.all(
          (["delivered", "hard_bounce", "complaint", "failed"] as const).map(
            (kind) =>
              ctx.db
                .query("communication_delivery_events")
                .withIndex("by_provider_kind", (q) =>
                  q.eq("provider_id", mapping.provider_id).eq("kind", kind),
                )
                .first(),
          ),
        );
        if (row.status === "delivered" && !events[0])
          issues.push("delivered_without_event");
        if (events[0] && !["delivered", "bounced"].includes(row.status))
          issues.push("delivery_status_mismatch");
        if (
          events[3] &&
          !events[0] &&
          !events[1] &&
          !events[2] &&
          row.status !== "failed"
        )
          issues.push("failure_status_mismatch");
        if (!["sent", "delivered", "bounced", "failed"].includes(row.status))
          issues.push("provider_status_mismatch");
        if ((events[1] || events[2]) && row.status !== "bounced")
          issues.push("bounce_status_mismatch");
        if ((events[1] || events[2]) && row.snapshot) {
          const suppressions = await ctx.db
            .query("communication_suppressions")
            .withIndex("by_email", (q) => q.eq("email", row.snapshot!.email))
            .order("desc")
            .take(101);
          if (suppressions.length > 100)
            issues.push("suppression_history_requires_review");
          if (
            events[1] &&
            !suppressions.some(
              (s) =>
                !s.revoked_at &&
                s.scope === "all" &&
                s.reason === "hard_bounce",
            )
          )
            issues.push("hard_bounce_suppression_missing");
          if (
            events[2] &&
            !suppressions.some(
              (s) =>
                !s.revoked_at &&
                s.scope === "all_optional" &&
                s.reason === "complaint",
            )
          )
            issues.push("complaint_suppression_missing");
        }
      }
      findings.push({ id: row._id, issues });
    }
    return { ...page, page: findings };
  },
});
export const outboxReconcilePage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin"]);
    if (a.paginationOpts.numItems < 1 || a.paginationOpts.numItems > 50)
      deny("INVALID_INPUT");
    const page = await ctx.db
      .query("communication_outbox")
      .paginate(a.paginationOpts);
    return {
      ...page,
      page: await Promise.all(
        page.page.map(async (j) => {
          const row = await ctx.db.get(j.communication_id);
          const sameKey = await ctx.db
            .query("communication_outbox")
            .withIndex("by_send_key", (q) => q.eq("send_key", j.send_key))
            .take(2);
          const issues: string[] = [];
          if (!row) issues.push("orphan_job");
          if (sameKey.length > 1) issues.push("duplicate_send_key");
          if (row && row.send_key !== j.send_key)
            issues.push("communication_key_mismatch");
          if (j.status === "unknown")
            issues.push("unknown_requires_investigation");
          if (j.status === "claimed" && (j.lease_until ?? 0) < Date.now())
            issues.push("expired_lease_requires_recovery");
          return { id: j._id, orphan: !row, issues };
        }),
      ),
    };
  },
});
export const eventReconcilePage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin"]);
    if (a.paginationOpts.numItems < 1 || a.paginationOpts.numItems > 50)
      deny("INVALID_INPUT");
    const page = await ctx.db
      .query("communication_delivery_events")
      .paginate(a.paginationOpts);
    const rows = [];
    for (const event of page.page) {
      const mappings = await ctx.db
        .query("communication_provider_messages")
        .withIndex("by_provider", (q) =>
          q.eq("provider", "resend").eq("provider_id", event.provider_id),
        )
        .take(2);
      rows.push({
        id: event._id,
        mismatch:
          mappings.length !== 1 ||
          mappings[0].communication_id !== event.communication_id ||
          !(await ctx.db.get(mappings[0].communication_id)),
      });
    }
    return { ...page, page: rows };
  },
});

export const providerReconcilePage = query({
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, a) => {
    await requireRoles(ctx, ["owner", "admin"]);
    if (a.paginationOpts.numItems < 1 || a.paginationOpts.numItems > 25)
      deny("INVALID_INPUT");
    const page = await ctx.db
      .query("communication_provider_messages")
      .paginate(a.paginationOpts);
    const rows = [];
    for (const mapping of page.page) {
      const issues: string[] = [];
      const row = await ctx.db.get(mapping.communication_id);
      const sameProvider = await ctx.db
        .query("communication_provider_messages")
        .withIndex("by_provider", (q) =>
          q
            .eq("provider", mapping.provider)
            .eq("provider_id", mapping.provider_id),
        )
        .take(2);
      const sameCommunication = await ctx.db
        .query("communication_provider_messages")
        .withIndex("by_communication", (q) =>
          q.eq("communication_id", mapping.communication_id),
        )
        .take(2);
      if (!row) issues.push("orphan_provider_mapping");
      if (row && row.send_key !== mapping.send_key)
        issues.push("provider_key_mismatch");
      if (sameProvider.length > 1 || sameCommunication.length > 1)
        issues.push("duplicate_provider_mapping");
      rows.push({ id: mapping._id, issues });
    }
    return { ...page, page: rows };
  },
});
