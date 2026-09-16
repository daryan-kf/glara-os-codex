import { requireCapability } from "./emergencyCore";
import { v } from "convex/values";
import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id, Doc } from "./_generated/dataModel";
import { requireRoles, deny } from "./access";
import { roles } from "../src/lib/permissions";
import {
  authorize,
  buildContext,
  evidenceAllowed,
  profileStamp,
  normalize,
} from "./aiContext";
import {
  requestSchema,
  configSchema,
  defaults,
  scopeSchema,
  router,
  sanitizeText,
  proposalPayload,
  insightSchema,
  validateInsight,
  costMicros,
  safeError,
  type Context,
  type Scope,
  type Insight,
  type Config,
  type Evidence,
} from "../src/lib/ai/model";
import { day } from "../src/lib/operations/model";
import { z } from "zod";
type Ctx = QueryCtx | MutationCtx;
const parse = <T>(schema: z.ZodType<T>, input: string): T => {
  try {
    return schema.parse(JSON.parse(input));
  } catch {
    return deny("INVALID_INPUT");
  }
};
async function config(ctx: Ctx): Promise<{ value: Config; version: number }> {
  const row = await ctx.db
    .query("ai_settings")
    .withIndex("by_key", (q) => q.eq("key", "main"))
    .unique();
  return {
    value: row ? configSchema.parse(JSON.parse(row.config)) : defaults,
    version: row?.version ?? 0,
  };
}
function providerReady() {
  return (
    !!process.env.OPENAI_API_KEY &&
    !!process.env.GLARA_AI_MODEL &&
    process.env.GLARA_AI_SECURITY_APPROVED === "true"
  );
}
async function audit(
  ctx: MutationCtx,
  user: Id<"users"> | null,
  id: string,
  action: string,
  data: Record<string, unknown> = {},
) {
  await ctx.db.insert("audit_logs", {
    actor_id: user,
    entity: "ai",
    entity_id: id,
    action: `AI_${action}`,
    old_value: null,
    new_value: data,
    created_at: new Date().toISOString(),
  });
}
function rollout(c: Config, u: Doc<"profiles">) {
  return (
    (c.allowed_user_ids === null || c.allowed_user_ids.includes(u.userId)) &&
    u.roles.some((r) => c.enabled_roles.includes(r))
  );
}
function retained(t: Doc<"ai_conversations">, c: Config) {
  return !t.purged && t.updated_at > Date.now() - c.retention_days * 86400000;
}
async function owns(ctx: Ctx, id: Id<"ai_requests">) {
  const u = await requireRoles(ctx, roles),
    r = await ctx.db.get(id);
  if (!r || r.user_id !== u.userId) deny();
  const thread = await ctx.db.get(r.conversation_id);
  if (!thread || !retained(thread, (await config(ctx)).value)) deny();
  await authorize(ctx, scopeSchema.parse(r.scope));
  if (profileStamp(u) !== r.role_stamp) deny();
  return { u, r };
}
async function visible(ctx: Ctx, r: Doc<"ai_requests">) {
  const evidence = JSON.parse(r.evidence) as Evidence[];
  for (const e of evidence)
    await evidenceAllowed(ctx, e, scopeSchema.parse(r.scope));
  return evidence;
}
async function usage(ctx: Ctx, key: string) {
  return ctx.db
    .query("ai_usage")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
}
async function increment(
  ctx: MutationCtx,
  key: string,
  delta: Partial<
    Record<
      | "requests"
      | "reserved_micros"
      | "charged_micros"
      | "input_tokens"
      | "output_tokens"
      | "latency_ms"
      | "failures"
      | "invalid_outputs",
      number
    >
  >,
) {
  const row = await usage(ctx, key),
    next = {
      requests: 0,
      reserved_micros: 0,
      charged_micros: 0,
      input_tokens: 0,
      output_tokens: 0,
      latency_ms: 0,
      failures: 0,
      invalid_outputs: 0,
    };
  for (const k of Object.keys(next) as (keyof typeof next)[])
    next[k] = (row?.[k] ?? 0) + (delta[k] ?? 0);
  if (row) await ctx.db.patch(row._id, next);
  else await ctx.db.insert("ai_usage", { key, ...next });
}
const usageKeys = (
  r: Pick<Doc<"ai_requests">, "user_id" | "day" | "month" | "scope" | "model">,
) => [
  `company:day:${r.day}`,
  `company:month:${r.month}`,
  `user:${r.day}:${r.user_id}`,
  `feature:${r.day}:${r.scope.feature}`,
  `model:${r.day}:${r.model}`,
];
export const settings = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireRoles(ctx, roles),
      c = await config(ctx),
      owner = u.roles.includes("owner");
    return {
      enabled:
        c.value.enabled &&
        providerReady() &&
        c.value.retention_acknowledged &&
        rollout(c.value, u),
      features: c.value.features,
      proposals: c.value.proposals,
      owner,
      admin: u.roles.some((x) => x === "owner" || x === "admin"),
      version: c.version,
      config: owner ? c.value : null,
      provider: owner ? "openai" : null,
      model: owner ? (process.env.GLARA_AI_MODEL ?? "Not configured") : null,
      secret_configured: owner ? !!process.env.OPENAI_API_KEY : null,
      security_approved: owner
        ? process.env.GLARA_AI_SECURITY_APPROVED === "true"
        : null,
    };
  },
});
export const saveSettings = mutation({
  args: { version: v.number(), input: v.string() },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, ["owner"]),
      value = parse(configSchema, a.input),
      old = await config(ctx);
    if (old.version !== a.version) deny("CONFLICT");
    if (value.enabled && (!providerReady() || !value.retention_acknowledged))
      deny("AI_UNAVAILABLE");
    const row = await ctx.db
      .query("ai_settings")
      .withIndex("by_key", (q) => q.eq("key", "main"))
      .unique();
    const data = {
      key: "main" as const,
      config: JSON.stringify(value),
      version: old.version + 1,
      updated_by: u.userId,
      updated_at: Date.now(),
    };
    if (row) await ctx.db.patch(row._id, data);
    else await ctx.db.insert("ai_settings", data);
    await audit(ctx, u.userId, "settings", "SETTINGS_CHANGED", {
      version: data.version,
      enabled: value.enabled,
    });
  },
});
export const request = mutation({
  args: { input: v.string() },
  handler: async (ctx, a): Promise<Id<"ai_requests">> => {
    await requireCapability(ctx, "ai");
    const data = parse(requestSchema, a.input),
      scope = router(data.question, data.scope),
      { u } = await authorize(ctx, scope);
    if (
      /system prompt|hidden (?:instructions|reasoning)|(?:show|reveal|export).*(?:password|auth token|api key|credentials)/i.test(
        data.question,
      )
    )
      deny("FORBIDDEN");
    if (
      !u.roles.some((r) => r === "owner" || r === "admin") &&
      !["commercial", "navigation"].includes(scope.feature) &&
      /(?:all|company|owner|highest).{0,60}(?:invoice|receivable|payment|balance)|(?:invoice|receivable|payment|balance).{0,60}(?:all|company|owner)/i.test(
        data.question,
      )
    )
      deny("FORBIDDEN");
    const prior = await ctx.db
      .query("ai_requests")
      .withIndex("by_key", (q) =>
        q.eq("user_id", u.userId).eq("request_key", data.request_key),
      )
      .unique();
    if (prior) {
      await owns(ctx, prior._id);
      if (
        prior.question !== sanitizeText(data.question, 2000) ||
        JSON.stringify(scopeSchema.parse(prior.scope)) !== JSON.stringify(scope)
      )
        deny("CONFLICT");
      return prior._id;
    }
    const cfg = (await config(ctx)).value;
    if (
      scope.feature !== "navigation" &&
      (!cfg.enabled ||
        !cfg.features.includes(scope.feature) ||
        !rollout(cfg, u) ||
        !providerReady() ||
        !cfg.retention_acknowledged)
    )
      deny("AI_UNAVAILABLE");
    const now = Date.now(),
      minute = `minute:${u.userId}:${Math.floor(now / 60000)}`;
    if (((await usage(ctx, minute))?.requests ?? 0) >= cfg.per_minute)
      deny("AI_RATE_LIMITED");
    await increment(ctx, minute, { requests: 1 });
    const context = await buildContext(ctx, scope);
    if (!context.evidence.length) deny("AMBIGUOUS_ENTITY");
    let conversation = data.conversation_id
      ? ctx.db.normalizeId("ai_conversations", data.conversation_id)
      : null;
    if (data.conversation_id && !conversation) deny();
    if (conversation) {
      const t = await ctx.db.get(conversation);
      if (
        !t ||
        t.user_id !== u.userId ||
        t.archived ||
        !retained(t, cfg) ||
        JSON.stringify(scopeSchema.parse(t.scope)) !== JSON.stringify(scope)
      )
        deny();
      if (t.turns >= 30) deny("AI_RATE_LIMITED");
      await ctx.db.patch(t._id, {
        turns: t.turns + 1,
        updated_at: now,
        role_stamp: profileStamp(u),
        ...(t.role_stamp && t.role_stamp !== profileStamp(u)
          ? { title: scope.feature + " conversation" }
          : {}),
      });
    } else {
      const list = await ctx.db
        .query("ai_conversations")
        .withIndex("by_user", (q) =>
          q.eq("user_id", u.userId).eq("archived", false),
        )
        .take(61);
      if (list.length >= 60) deny("AI_RATE_LIMITED");
      conversation = await ctx.db.insert("ai_conversations", {
        user_id: u.userId,
        scope,
        title: `${scope.feature} conversation`,
        role_stamp: profileStamp(u),
        turns: 1,
        created_at: now,
        updated_at: now,
        archived: false,
        purged: false,
      });
    }
    const id = await ctx.db.insert("ai_requests", {
      user_id: u.userId,
      conversation_id: conversation,
      request_key: data.request_key,
      scope,
      question: sanitizeText(data.question, 2000),
      role_stamp: profileStamp(u),
      context_digest: context.revision,
      evidence: JSON.stringify(
        context.evidence.map(({ data, ...e }) => {
          void data;
          return e;
        }),
      ),
      status: "queued",
      output: null,
      error: null,
      created_at: now,
      started_at: null,
      completed_at: null,
      retrieval_ms: 0,
      provider_ms: 0,
      input_tokens: 0,
      output_tokens: 0,
      reserved_micros: 0,
      charged_micros: 0,
      provider: scope.feature === "navigation" ? "deterministic" : "openai",
      model:
        scope.feature === "navigation"
          ? "navigation"
          : process.env.GLARA_AI_MODEL!,
      config: JSON.stringify(cfg),
      day: day(),
      month: day().slice(0, 7),
      feedback: null,
      feedback_reason: null,
    });
    await audit(ctx, u.userId, id, "REQUESTED", {
      feature: scope.feature,
      evidence_count: context.evidence.length,
    });
    await ctx.scheduler.runAfter(120000, internal.ai.expire, { id });
    return id;
  },
});
export const begin = internalMutation({
  args: { id: v.id("ai_requests") },
  handler: async (
    ctx,
    a,
  ): Promise<{
    context: Context;
    question: string;
    config: Config;
    model: string;
    history: { question: string; answer: string }[];
  } | null> => {
    await requireCapability(ctx, "ai");
    const { r, u } = await owns(ctx, a.id);
    if (r.status !== "queued") return null;
    if (Date.now() >= r.created_at + 120000) deny("AI_TIMEOUT");
    const c = (await config(ctx)).value;
    if (
      r.provider !== "deterministic" &&
      (!c.enabled ||
        !c.features.includes(r.scope.feature as Scope["feature"]) ||
        !rollout(c, u) ||
        !providerReady())
    )
      deny("AI_UNAVAILABLE");
    const start = Date.now(),
      context = await buildContext(ctx, scopeSchema.parse(r.scope));
    if (context.revision !== r.context_digest) deny("STALE_PROPOSAL");
    const reserve =
      r.provider === "deterministic"
        ? 0
        : 2 * costMicros(32768, c.max_output_tokens, c);
    const accounting = { ...r, day: day(), month: day().slice(0, 7) };
    const keys = usageKeys(accounting),
      [daily, monthly, personal] = await Promise.all(
        keys.slice(0, 3).map((key) => usage(ctx, key)),
      );
    if ((personal?.requests ?? 0) >= c.daily_requests) deny("AI_RATE_LIMITED");
    if (
      (daily?.charged_micros ?? 0) + (daily?.reserved_micros ?? 0) + reserve >
        c.daily_budget_micros ||
      (monthly?.charged_micros ?? 0) +
        (monthly?.reserved_micros ?? 0) +
        reserve >
        c.monthly_budget_micros
    )
      deny("AI_BUDGET_EXCEEDED");
    for (const key of keys)
      await increment(ctx, key, { requests: 1, reserved_micros: reserve });
    await ctx.db.patch(r._id, {
      status: "running",
      day: accounting.day,
      month: accounting.month,
      started_at: Date.now(),
      retrieval_ms: Date.now() - start,
      reserved_micros: reserve,
      config: JSON.stringify(c),
    });
    const previous = await ctx.db
      .query("ai_requests")
      .withIndex("by_conversation", (q) =>
        q.eq("conversation_id", r.conversation_id),
      )
      .order("desc")
      .take(4);
    const history = previous
      .filter(
        (x) =>
          x._id !== r._id &&
          x.status === "completed" &&
          x.role_stamp === r.role_stamp &&
          x.context_digest === context.revision &&
          x.output,
      )
      .slice(0, 2)
      .reverse()
      .map((x) => ({
        question: sanitizeText(x.question, 700),
        answer: sanitizeText(
          insightSchema.parse(JSON.parse(x.output!)).answer,
          1000,
        ),
      }));
    return {
      context,
      question: r.question,
      config: c,
      model: r.model,
      history,
    };
  },
});
export const finish = internalMutation({
  args: {
    id: v.id("ai_requests"),
    output: v.union(v.string(), v.null()),
    error: v.union(v.string(), v.null()),
    input_tokens: v.number(),
    output_tokens: v.number(),
    provider_ms: v.number(),
    retrieval_ms: v.number(),
    usage_known: v.boolean(),
  },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r || r.completed_at) return;
    let error = a.error ? safeError(Error(a.error)) : null,
      result: Insight | null = null;
    try {
      await requireCapability(ctx, "ai");
      const { u } = await owns(ctx, a.id);
      const liveConfig = (await config(ctx)).value;
      if (
        r.provider !== "deterministic" &&
        (!liveConfig.enabled ||
          !liveConfig.features.includes(r.scope.feature as Scope["feature"]) ||
          !rollout(liveConfig, u) ||
          !providerReady())
      )
        throw Error("AI_UNAVAILABLE");
      const context = await buildContext(ctx, scopeSchema.parse(r.scope));
      if (context.revision !== r.context_digest) throw Error("STALE_PROPOSAL");
      if (a.output && !error)
        result = validateInsight(JSON.parse(a.output), context);
      if (result?.proposal) {
        const cfg = (await config(ctx)).value;
        if (!cfg.proposals) throw Error("FORBIDDEN");
        const p = result.proposal;
        proposalPayload.parse({
          title: p.title,
          description: p.description,
          due_at: p.due_at,
          priority: p.priority,
          assigned_to: context.assignee_id,
        });
      }
    } catch (e) {
      error = safeError(e);
      result = null;
    }
    const cfg = configSchema.parse(JSON.parse(r.config)),
      input =
        Number.isSafeInteger(a.input_tokens) && a.input_tokens >= 0
          ? a.input_tokens
          : 0,
      output =
        Number.isSafeInteger(a.output_tokens) && a.output_tokens >= 0
          ? a.output_tokens
          : 0;
    const charge = a.usage_known
      ? costMicros(input, output, cfg)
      : r.reserved_micros;
    for (const key of usageKeys(r))
      await increment(ctx, key, {
        reserved_micros: -r.reserved_micros,
        charged_micros: charge,
        input_tokens: input,
        output_tokens: output,
        latency_ms: a.provider_ms,
        failures: error ? 1 : 0,
        invalid_outputs: error === "INVALID_AI_OUTPUT" ? 1 : 0,
      });
    const cancelled = r.status === "cancelled";
    await ctx.db.patch(r._id, {
      status: cancelled ? "cancelled" : error ? "failed" : "completed",
      output: !cancelled && result ? JSON.stringify(result) : null,
      error,
      completed_at: Date.now(),
      provider_ms: a.provider_ms,
      retrieval_ms: a.retrieval_ms,
      input_tokens: input,
      output_tokens: output,
      charged_micros: charge,
    });
    if (!cancelled && result?.proposal && !error) {
      const p = result.proposal,
        payload = proposalPayload.parse({
          title: p.title,
          description: p.description,
          due_at: p.due_at,
          priority: p.priority,
          assigned_to: r.user_id,
        });
      await ctx.db.insert("ai_action_proposals", {
        request_id: r._id,
        user_id: r.user_id,
        scope: r.scope,
        type: "create_activity",
        payload: JSON.stringify(payload),
        original_payload: JSON.stringify(payload),
        rationale: result.why,
        evidence_keys: [p.evidence_id],
        context_digest: r.context_digest,
        role_stamp: r.role_stamp,
        status: "proposed",
        created_at: Date.now(),
        expires_at: Date.now() + 86400000,
        executed_at: null,
        executed_by: null,
        result_id: null,
        edited: false,
      });
    }
    await audit(ctx, r.user_id, r._id, "FINISHED", {
      status: cancelled ? "cancelled" : (error ?? "completed"),
      input_tokens: input,
      output_tokens: output,
    });
  },
});
// A crashed action must not leave a request running or release unconfirmed spend.
export const expire = internalMutation({
  args: { id: v.id("ai_requests") },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r || r.completed_at || Date.now() < r.created_at + 120000) return;
    if (r.started_at !== null) {
      for (const key of usageKeys(r))
        await increment(ctx, key, {
          reserved_micros: -r.reserved_micros,
          charged_micros: r.reserved_micros,
          failures: 1,
        });
    }
    await ctx.db.patch(r._id, {
      status: r.status === "cancelled" ? "cancelled" : "failed",
      error: "AI_TIMEOUT",
      completed_at: Date.now(),
      output: null,
      charged_micros: r.reserved_micros,
    });
    await audit(ctx, r.user_id, r._id, "EXPIRED");
  },
});
export const result = query({
  args: { id: v.id("ai_requests") },
  handler: async (ctx, a) => {
    const { r } = await owns(ctx, a.id),
      evidence = await visible(ctx, r),
      fresh =
        (await buildContext(ctx, scopeSchema.parse(r.scope))).revision ===
        r.context_digest,
      proposal = await ctx.db
        .query("ai_action_proposals")
        .withIndex("by_request", (q) => q.eq("request_id", r._id))
        .unique();
    return {
      id: r._id,
      conversation_id: r.conversation_id,
      question: r.question,
      status: r.status,
      error: r.error,
      stale: !fresh,
      output:
        r.output && fresh ? insightSchema.parse(JSON.parse(r.output)) : null,
      evidence: fresh ? evidence : [],
      created_at: r.created_at,
      captured_at: r.started_at ?? r.created_at,
      scope: r.scope,
      completed_at: r.completed_at,
      proposal:
        proposal && (fresh || proposal.status === "executed")
          ? {
              ...proposal,
              payload: proposalPayload.parse(JSON.parse(proposal.payload)),
            }
          : null,
    };
  },
});
export const history = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireRoles(ctx, roles);
    const rows = await ctx.db
      .query("ai_conversations")
      .withIndex("by_user", (q) =>
        q.eq("user_id", u.userId).eq("archived", false),
      )
      .order("desc")
      .take(30);
    const cfg = (await config(ctx)).value;
    const safe = [];
    for (const r of rows) {
      if (
        !retained(r, cfg) ||
        (r.role_stamp && r.role_stamp !== profileStamp(u))
      )
        continue;
      try {
        await authorize(ctx, scopeSchema.parse(r.scope));
        safe.push({
          id: r._id,
          title: r.title,
          scope: r.scope,
          updated_at: r.updated_at,
        });
      } catch {}
    }
    return safe;
  },
});
export const conversation = query({
  args: { id: v.id("ai_conversations") },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, roles),
      t = await ctx.db.get(a.id);
    if (
      !t ||
      t.user_id !== u.userId ||
      t.archived ||
      !retained(t, (await config(ctx)).value)
    )
      deny();
    await authorize(ctx, scopeSchema.parse(t.scope));
    const rows = await ctx.db
      .query("ai_requests")
      .withIndex("by_conversation", (q) => q.eq("conversation_id", t._id))
      .order("desc")
      .take(30);
    return rows
      .filter((x) => x.role_stamp === profileStamp(u))
      .map((x) => ({ id: x._id, status: x.status, created_at: x.created_at }));
  },
});
export const archive = mutation({
  args: { id: v.id("ai_conversations") },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, roles),
      t = await ctx.db.get(a.id);
    if (!t || t.user_id !== u.userId || t.purged) deny();
    await ctx.db.patch(t._id, { archived: true });
    await audit(ctx, u.userId, t._id, "CONVERSATION_ARCHIVED");
  },
});
export const cancel = mutation({
  args: { id: v.id("ai_requests") },
  handler: async (ctx, a) => {
    const { r, u } = await owns(ctx, a.id);
    if (!["queued", "running"].includes(r.status)) return;
    await ctx.db.patch(r._id, { status: "cancelled" });
    await audit(ctx, u.userId, r._id, "CANCELLED");
  },
});
export const feedback = mutation({
  args: { id: v.id("ai_requests"), kind: v.string(), reason: v.string() },
  handler: async (ctx, a) => {
    const { r, u } = await owns(ctx, a.id);
    await visible(ctx, r);
    if (
      ![
        "helpful",
        "not_helpful",
        "incorrect_data",
        "missing_context",
        "bad_recommendation",
        "unsafe_suggestion",
      ].includes(a.kind) ||
      a.reason.length > 500
    )
      deny("INVALID_INPUT");
    await ctx.db.patch(r._id, {
      feedback: a.kind,
      feedback_reason: sanitizeText(a.reason, 500),
    });
    await audit(ctx, u.userId, r._id, "FEEDBACK", { kind: a.kind });
  },
});
export const decide = mutation({
  args: {
    id: v.id("ai_action_proposals"),
    decision: v.union(v.literal("approve"), v.literal("reject")),
    input: v.optional(v.string()),
  },
  handler: async (
    ctx,
    a,
  ): Promise<{ status: string; result_id: string | null }> => {
    await requireCapability(ctx, "ai");
    const u = await requireRoles(ctx, roles),
      p = await ctx.db.get(a.id);
    if (!p || p.user_id !== u.userId || p.role_stamp !== profileStamp(u))
      deny();
    const parent = await ctx.db.get(p.request_id);
    const thread = parent ? await ctx.db.get(parent.conversation_id) : null;
    if (
      p.status !== "executed" &&
      (!thread || !retained(thread, (await config(ctx)).value))
    )
      deny();
    const scope = scopeSchema.parse(p.scope);
    await authorize(ctx, scope);
    if (p.status === "executed")
      return { status: p.status, result_id: p.result_id };
    if (p.status !== "proposed") deny("CONFLICT");
    if (a.decision === "reject") {
      await ctx.db.patch(p._id, { status: "rejected" });
      await audit(ctx, u.userId, p._id, "PROPOSAL_REJECTED");
      return { status: "rejected", result_id: null };
    }
    if (p.expires_at <= Date.now()) deny("STALE_PROPOSAL");
    const cfg = (await config(ctx)).value;
    if (
      !cfg.enabled ||
      !cfg.proposals ||
      !cfg.features.includes(scope.feature) ||
      !rollout(cfg, u) ||
      !providerReady()
    )
      deny();
    const context = await buildContext(ctx, scope);
    if (
      context.revision !== p.context_digest ||
      !context.can_propose ||
      context.existing_task_ids.length
    )
      deny("STALE_PROPOSAL");
    const payload = parse(proposalPayload, a.input ?? p.payload);
    if (
      Date.parse(payload.due_at) <= Date.now() ||
      Date.parse(payload.due_at) > Date.now() + 366 * 86400000
    )
      deny("INVALID_INPUT");
    const assignee = ctx.db.normalizeId("users", payload.assigned_to);
    if (!assignee) deny("INVALID_INPUT");
    let result: string;
    if (scope.feature === "realtor") {
      const r = await ctx.runMutation(api.crm.write, {
        input: JSON.stringify({
          op: "activity_create",
          data: {
            realtor_id: scope.entity_id,
            type: "follow_up",
            title: payload.title,
            description: payload.description,
            status: "open",
            completed_at: "",
            due_at: payload.due_at,
            priority: payload.priority,
            assigned_to: assignee,
          },
        }),
      });
      result = r.id;
    } else if (scope.feature === "opportunity") {
      if (payload.priority !== "normal") deny("INVALID_INPUT");
      result = await ctx.runMutation(api.sales.saveAction, {
        input: JSON.stringify({
          opportunity_id: scope.entity_id,
          property_id: "",
          title: payload.title,
          description: payload.description,
          due_at: payload.due_at,
          assigned_to: assignee,
        }),
      });
    } else if (scope.feature === "project") {
      if (payload.priority !== "normal") deny("INVALID_INPUT");
      result = await ctx.runMutation(api.operations.saveTask, {
        project_id: normalize(ctx, "projects", scope.entity_id),
        version: 0,
        title: payload.title,
        description: payload.description,
        due_at: payload.due_at,
        assigned_to: assignee,
        status: "open",
      });
    } else deny();
    await ctx.db.patch(p._id, {
      status: "executed",
      payload: JSON.stringify(payload),
      edited: JSON.stringify(payload) !== p.original_payload,
      executed_at: Date.now(),
      executed_by: u.userId,
      result_id: result,
    });
    await audit(ctx, u.userId, p._id, "PROPOSAL_EXECUTED", {
      payload,
      edited: JSON.stringify(payload) !== p.original_payload,
      result_id: result,
    });
    return { status: "executed", result_id: result };
  },
});
export const health = query({
  args: {},
  handler: async (ctx) => {
    const u = await requireRoles(ctx, ["owner", "admin"]),
      owner = u.roles.includes("owner");
    const recent = await ctx.db
      .query("ai_requests")
      .withIndex("by_status", (q) => q.eq("status", "failed"))
      .order("desc")
      .take(20);
    const counters = owner
      ? await ctx.db
          .query("ai_usage")
          .withIndex("by_key", (q) =>
            q.gte("key", `feature:${day()}`).lt("key", `feature:${day()}~`),
          )
          .take(20)
      : [];
    return {
      provider_ready: providerReady(),
      recent_failures: recent.map((x) => ({
        id: x._id,
        feature: x.scope.feature,
        error: x.error,
        provider_ms: x.provider_ms,
        created_at: x.created_at,
      })),
      day: owner ? await usage(ctx, `company:day:${day()}`) : null,
      month: owner
        ? await usage(ctx, `company:month:${day().slice(0, 7)}`)
        : null,
      features: counters,
      models: owner
        ? await ctx.db
            .query("ai_usage")
            .withIndex("by_key", (q) =>
              q.gte("key", "model:" + day()).lt("key", "model:" + day() + "~"),
            )
            .take(20)
        : [],
      users: owner
        ? await ctx.db
            .query("ai_usage")
            .withIndex("by_key", (q) =>
              q.gte("key", "user:" + day()).lt("key", "user:" + day() + "~"),
            )
            .take(100)
        : [],
    };
  },
});
export const search = query({
  args: { feature: v.string(), term: v.string() },
  handler: async (ctx, a): Promise<{ id: string; label: string }[]> => {
    const feature = scopeSchema.shape.feature.parse(a.feature),
      scope = scopeSchema.parse({ feature }),
      { u, manager } = await authorize(ctx, scope),
      term = a.term.trim().slice(0, 100);
    if (term.length < 2) return [];
    const rows: { id: string; label: string }[] = [];
    if (feature === "realtor") {
      const records = await ctx.db
        .query("realtors")
        .withSearchIndex("by_sales_name", (q) =>
          q.search("sales_search_text", term).eq("deleted_at", null),
        )
        .take(20);
      for (const r of records)
        if (manager || r.assigned_to === u.userId)
          rows.push({ id: r._id, label: `${r.first_name} ${r.last_name}` });
    }
    if (feature === "opportunity") {
      for (const r of await ctx.runQuery(api.sales.globalSearch, { q: term }))
        if (r.type === "Opportunity") {
          try {
            await authorize(ctx, { ...scope, entity_id: r.id });
            rows.push({ id: r.id, label: r.title });
          } catch {}
        }
    }
    if (feature === "project" || feature === "marketing") {
      for (const r of await ctx.runQuery(api.operations.search, { q: term })) {
        try {
          await authorize(ctx, { ...scope, entity_id: r.id });
          const p = await ctx.runQuery(api.operations.get, { id: r.id });
          rows.push({
            id: r.id,
            label:
              feature === "marketing"
                ? `${p.project_number} · ${p.city}`
                : r.name,
          });
        } catch {}
      }
    }
    if (feature === "inventory" || feature === "asset") {
      for (const r of await ctx.runQuery(api.inventory.search, { q: term }))
        if (r.kind === (feature === "asset" ? "Asset" : "Product"))
          rows.push({ id: r.id, label: r.name });
    }
    if (feature === "commercial") {
      const i = await ctx.db
        .query("invoices")
        .withIndex("by_number", (q) => q.eq("number", term.toUpperCase()))
        .unique();
      if (i) {
        await authorize(ctx, { ...scope, entity_id: i._id });
        rows.push({ id: i._id, label: i.number });
      }
    }
    return rows.slice(0, 12);
  },
});

export const renameThread = mutation({
  args: { id: v.id("ai_conversations"), title: v.string() },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, roles),
      t = await ctx.db.get(a.id);
    if (!t || t.user_id !== u.userId || !retained(t, (await config(ctx)).value))
      deny();
    await authorize(ctx, scopeSchema.parse(t.scope));
    const title = sanitizeText(a.title.trim(), 80);
    if (!title || a.title.length > 80) deny("INVALID_INPUT");
    await ctx.db.patch(t._id, { title, role_stamp: profileStamp(u) });
    await audit(ctx, u.userId, t._id, "THREAD_RENAMED");
  },
});
async function purgeThread(
  ctx: MutationCtx,
  t: Doc<"ai_conversations">,
  actor: Id<"users"> | null,
) {
  if (t.purged) return;
  const requests = await ctx.db
    .query("ai_requests")
    .withIndex("by_conversation", (q) => q.eq("conversation_id", t._id))
    .take(31);
  if (requests.length > 30) deny("CONFLICT");
  for (const r of requests) {
    await ctx.db.patch(r._id, {
      question: "",
      output: null,
      evidence: "[]",
      feedback_reason: null,
      ...(["running", "queued"].includes(r.status)
        ? { status: "cancelled" as const }
        : {}),
    });
    const proposal = await ctx.db
      .query("ai_action_proposals")
      .withIndex("by_request", (q) => q.eq("request_id", r._id))
      .unique();
    if (proposal && proposal.status !== "executed") {
      const erased = JSON.stringify({
        title: "Deleted proposal",
        description: "",
        due_at: "1970-01-01T00:00:00.000Z",
        priority: "normal",
        assigned_to: proposal.user_id,
      });
      await ctx.db.patch(proposal._id, {
        status: "expired",
        payload: erased,
        original_payload: erased,
        rationale: "Conversation deleted",
        evidence_keys: [],
      });
    }
  }
  await ctx.db.patch(t._id, {
    title: "Deleted conversation",
    archived: true,
    purged: true,
    purged_at: Date.now(),
  });
  await audit(
    ctx,
    actor,
    t._id,
    actor ? "THREAD_DELETED" : "THREAD_RETENTION_PURGED",
    { requests: requests.length },
  );
}
export const deleteThread = mutation({
  args: { id: v.id("ai_conversations") },
  handler: async (ctx, a) => {
    const u = await requireRoles(ctx, roles),
      t = await ctx.db.get(a.id);
    if (!t || t.user_id !== u.userId) deny();
    await purgeThread(ctx, t, u.userId);
  },
});
export const retentionSweep = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff =
      Date.now() - (await config(ctx)).value.retention_days * 86400000;
    const batches = await Promise.all(
      [false, undefined].map((purged) =>
        ctx.db
          .query("ai_conversations")
          .withIndex("by_retention", (q) =>
            q.eq("purged", purged).lte("updated_at", cutoff),
          )
          .take(5),
      ),
    );
    for (const t of batches.flat()) await purgeThread(ctx, t, null);
    return { purged: batches.flat().length };
  },
});
export const inspectScope = query({
  args: { scope: v.string(), refresh: v.optional(v.number()) },
  handler: async (ctx, a) => {
    const scope = parse(scopeSchema, a.scope);
    await authorize(ctx, scope);
    try {
      const context = await buildContext(ctx, scope);
      return {
        label: context.evidence[0]?.label ?? scope.feature,
        sources: context.evidence.map(({ data, ...ref }) => {
          void data;
          return ref;
        }),
        captured_at: Date.now(),
        error: null,
      };
    } catch (e) {
      return {
        label: scope.feature,
        sources: [],
        captured_at: Date.now(),
        error: safeError(e),
      };
    }
  },
});
export const resolveReference = query({
  args: { id: v.id("ai_requests"), ordinal: v.number() },
  handler: async (ctx, a) => {
    const { r } = await owns(ctx, a.id);
    if (
      !Number.isInteger(a.ordinal) ||
      a.ordinal < 1 ||
      a.ordinal > 20 ||
      !r.output
    )
      deny("INVALID_INPUT");
    const context = await buildContext(ctx, scopeSchema.parse(r.scope));
    if (context.revision !== r.context_digest) deny("STALE_PROPOSAL");
    const out = insightSchema.parse(JSON.parse(r.output)),
      refs = JSON.parse(r.evidence) as Evidence[];
    const e = refs.find((x) => x.key === out.evidence_ids[a.ordinal - 1]);
    if (!e) deny("AMBIGUOUS_ENTITY");
    const map: Record<string, Scope["feature"]> = {
      realtors: "realtor",
      opportunities: "opportunity",
      projects: r.scope.feature === "marketing" ? "marketing" : "project",
      products: "inventory",
      inventory_assets: "asset",
      invoices: "commercial",
      automation_actions: "automation",
    };
    const feature = map[e.entity_type];
    if (!feature) deny("AMBIGUOUS_ENTITY");
    const scope = scopeSchema.parse({ feature, entity_id: e.entity_id });
    await authorize(ctx, scope);
    return { scope, label: e.label };
  },
});
export const quality = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, ["owner", "admin"]);
    const rows = await ctx.db
        .query("ai_requests")
        .withIndex("by_created", (q) =>
          q.gte("created_at", Date.now() - 30 * 86400000),
        )
        .order("desc")
        .take(201),
      sample = rows.slice(0, 200);
    const count = (check: (r: Doc<"ai_requests">) => boolean) =>
      sample.filter(check).length;
    const rated = count((r) => r.feedback !== null),
      helpful = count((r) => r.feedback === "helpful");
    return {
      sample: sample.length,
      partial: rows.length > 200,
      rated,
      helpful,
      helpful_rate: rated ? Math.round((helpful * 10000) / rated) : null,
      incorrect_data: count((r) => r.feedback === "incorrect_data"),
      unsafe: count((r) => r.feedback === "unsafe_suggestion"),
      insufficient: count(
        (r) =>
          r.error === "INSUFFICIENT_EVIDENCE" ||
          (!!r.output &&
            insightSchema.parse(JSON.parse(r.output)).evidence_state ===
              "insufficient"),
      ),
      failures: count((r) => r.status === "failed"),
      invalid_outputs: count((r) => r.error === "INVALID_AI_OUTPUT"),
    };
  },
});

export const providerFailure = internalMutation({
  args: { id: v.id("ai_requests"), status: v.number(), code: v.string() },
  handler: async (ctx, a) => {
    const r = await ctx.db.get(a.id);
    if (!r || r.completed_at) return;
    await audit(ctx, r.user_id, r._id, "PROVIDER_REJECTED", {
      http_status: a.status,
      provider_code: a.code,
    });
  },
});
