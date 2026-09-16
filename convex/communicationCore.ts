import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import { deny, requireRoles } from "./access";
import { invoiceState, paymentState } from "./commercialCore";
import {
  covers,
  normalizeEmail,
  POLICY_VERSION,
  render,
  content,
} from "../src/lib/communications/model";
type Ctx = QueryCtx | MutationCtx;
export type Source = Doc<"communications">["source"];
export type Recipient = Doc<"communications">["recipient"];
export type Profile = Doc<"profiles">;
export const key = (r: Source | Recipient) => `${r.type}:${r.id}`;
export const isManager = (p: Profile) =>
  p.roles.some((r) => r === "owner" || r === "admin");
export const user = (ctx: Ctx) =>
  requireRoles(ctx, ["owner", "admin", "sales", "marketing"]);
export async function audit(
  ctx: MutationCtx,
  actor: Id<"users"> | null,
  action: string,
  id: string,
  detail: Record<string, string | number | boolean> = {},
) {
  await ctx.db.insert("audit_logs", {
    actor_id: actor,
    action: `communication.${action}`,
    entity: "communications",
    entity_id: id,
    old_value: null,
    new_value: detail,
    created_at: new Date().toISOString(),
  });
}
export function version(row: { version: number }, expected: number) {
  if (row.version !== expected)
    deny("CONFLICT", "This record changed. Refresh and review it again.");
}
export async function settings(ctx: Ctx) {
  return ctx.db
    .query("communication_settings")
    .withIndex("by_key", (q) => q.eq("key", "company"))
    .unique();
}
export async function sourceFacts(
  ctx: Ctx,
  s: Source,
  recipient: Recipient,
  p: Profile,
  category: Doc<"communications">["category"],
  allowInvalidEmail = false,
) {
  if (
    p.deleted_at ||
    !p.roles.some((r) => ["owner", "admin", "sales", "marketing"].includes(r))
  )
    deny();
  const manager = isManager(p);
  if (
    !manager &&
    p.roles.includes("marketing") &&
    (!p.roles.includes("sales") || category === "commercial_marketing") &&
    (s.type !== "realtor" || category !== "commercial_marketing")
  )
    deny();
  if (
    !manager &&
    category === "transactional" &&
    ["project", "invoice", "payment"].includes(s.type)
  )
    deny();
  let realtorId: Id<"realtors"> | undefined;
  let customerId: Id<"commercial_customers"> | undefined;
  let assigned: Id<"users"> | undefined;
  const facts: Record<string, string> = {};
  if (s.type === "realtor") realtorId = s.id;
  else if (
    s.type === "opportunity" ||
    s.type === "quote" ||
    s.type === "consultation"
  ) {
    const oId =
      s.type === "opportunity"
        ? s.id
        : (await ctx.db.get(s.id))?.opportunity_id;
    if (!oId) return deny("UNAVAILABLE");
    const o = await ctx.db.get(oId);
    if (!o || o.deleted_at) return deny("UNAVAILABLE");
    realtorId = o.realtor_id;
    assigned = o.assigned_to;
    facts.opportunity_stage = o.stage;
    facts.opportunity_revision = String(o.version);
    if (s.type === "quote") {
      const q = await ctx.db.get(s.id);
      if (!q || q.deleted_at) return deny("UNAVAILABLE");
      Object.assign(facts, {
        number: q.number,
        total_cents: q.total_cents,
        valid_until: q.valid_until,
        status: q.status,
        revision: String(q.version),
      });
    }
    if (s.type === "consultation") {
      const c = await ctx.db.get(s.id);
      if (!c || c.deleted_at) return deny("UNAVAILABLE");
      Object.assign(facts, {
        scheduled_at: c.scheduled_at,
        status: c.status,
        revision: String(c.version),
      });
    }
  } else {
    if (!manager) deny();
    const projectId =
      s.type === "project" ? s.id : (await ctx.db.get(s.id))?.project_id;
    if (!projectId) return deny("UNAVAILABLE");
    const project = await ctx.db.get(projectId);
    if (!project || project.deleted_at) return deny("UNAVAILABLE");
    realtorId = project.realtor_id;
    Object.assign(facts, {
      project_number: project.project_number,
      project_status: project.status,
      package_end: project.planned_end_date,
      project_revision: String(project.version),
    });
    if (s.type === "project") {
      const events = await ctx.db
        .query("operations_events")
        .withIndex("by_project", (q) =>
          q.eq("project_id", project._id).eq("deleted_at", null),
        )
        .take(101);
      if (events.length > 100) deny("LIMIT");
      for (const kind of ["staging", "destaging"]) {
        const event = events
          .filter((e) => e.event_type === kind && e.status !== "cancelled")
          .sort((a, b) => b.start_at.localeCompare(a.start_at))[0];
        if (event) {
          facts[`${kind}_start`] = event.start_at;
          facts[`${kind}_end`] = event.end_at;
          facts[`${kind}_revision`] = String(event.version);
        }
      }
    }
    if (s.type === "invoice") {
      const i = await ctx.db.get(s.id);
      if (!i || i.deleted_at) return deny("UNAVAILABLE");
      const state = await invoiceState(ctx, i);
      customerId = i.customer_id;
      Object.assign(facts, {
        number: i.number,
        status: i.status,
        due_date: i.due_date,
        balance_cents: state.balance_cents,
        revision: String(i.version),
      });
    }
    if (s.type === "payment") {
      const pay = await ctx.db.get(s.id);
      if (!pay) return deny("UNAVAILABLE");
      const state = await paymentState(ctx, pay);
      customerId = pay.customer_id;
      Object.assign(facts, {
        number: pay.number,
        amount_cents: pay.amount_cents,
        received_date: pay.received_date,
        status: state.status,
      });
    }
  }
  if (
    (s.type === "invoice" || s.type === "payment") &&
    recipient.type !== "customer"
  )
    deny();
  if (!realtorId) return deny("UNAVAILABLE");
  const realtor = await ctx.db.get(realtorId);
  if (!realtor || realtor.deleted_at) return deny("UNAVAILABLE");
  if (
    !manager &&
    category !== "commercial_marketing" &&
    !(
      p.roles.includes("sales") &&
      (assigned === p.userId || realtor.assigned_to === p.userId)
    )
  )
    deny();
  if (
    !manager &&
    category === "commercial_marketing" &&
    !p.roles.includes("marketing")
  )
    deny();
  let email = realtor.email ?? "",
    name = `${realtor.first_name} ${realtor.last_name}`,
    updated = realtor.updated_at;
  if (recipient.type === "customer") {
    if (!manager || customerId !== recipient.id) deny();
    const c = await ctx.db.get(recipient.id);
    if (!c || c.deleted_at) return deny("UNAVAILABLE");
    email = c.bill_to.email;
    name = c.bill_to.name;
    updated = c.updated_at;
  } else if (recipient.id !== realtorId) deny();
  let validEmail = true;
  try {
    email = normalizeEmail(email);
  } catch {
    validEmail = false;
    if (!allowInvalidEmail)
      return deny(
        "INVALID_INPUT",
        "The source recipient needs a valid email address.",
      );
  }
  facts.recipient_name = name;
  return {
    valid_email: validEmail,
    email,
    name,
    facts,
    fingerprint: JSON.stringify({
      source: key(s),
      recipient: key(recipient),
      email,
      name,
      updated,
      facts,
    }),
  };
}
export async function authorized(
  ctx: Ctx,
  id: Id<"communications">,
  p: Profile,
) {
  const row = await ctx.db.get(id);
  if (!row) return deny("UNAVAILABLE");
  if (!isManager(p))
    await sourceFacts(ctx, row.source, row.recipient, p, row.category, true);
  return row;
}
export async function evaluate(
  ctx: Ctx,
  row: Doc<"communications">,
  p: Profile,
) {
  const f = await sourceFacts(
      ctx,
      row.source,
      row.recipient,
      p,
      row.category,
      true,
    ),
    t = Date.now(),
    reasons: string[] = [];
  const policy = await settings(ctx);
  if (!f.valid_email) reasons.push("invalid_recipient_email");
  if (!categoryCompatible(row.source.type, row.category))
    reasons.push("source_purpose_mismatch");
  const consents = await ctx.db
    .query("communication_consents")
    .withIndex("by_recipient", (q) => q.eq("recipient_key", row.recipient_key))
    .order("desc")
    .take(101);
  const preferences = await ctx.db
    .query("communication_preferences")
    .withIndex("by_recipient", (q) => q.eq("recipient_key", row.recipient_key))
    .take(20);
  const suppressions = await ctx.db
    .query("communication_suppressions")
    .withIndex("by_email", (q) => q.eq("email", f.email))
    .order("desc")
    .take(101);
  if (consents.length > 100 || suppressions.length > 100)
    reasons.push("history_requires_review");
  const active = consents.filter(
    (c) =>
      !c.revoked_at &&
      c.observed_at <= t &&
      (!c.expires_at || c.expires_at > t) &&
      covers(c.scope, row.category) &&
      (row.category === "transactional"
        ? (policy?.transactional_basis === "explicit_request_only"
            ? ["recipient_requested"]
            : [
                "transactional_service",
                "recipient_requested",
                "express_consent",
              ]
          ).includes(c.basis)
        : c.basis === "express_consent"),
  );
  if (!active.length) reasons.push("documented_eligibility_required");
  if (
    preferences.some(
      (x) => covers(x.scope, row.category) && x.status === "unsubscribed",
    )
  )
    reasons.push("unsubscribed");
  if (suppressions.some((x) => !x.revoked_at && covers(x.scope, row.category)))
    reasons.push("suppressed");
  if (
    row.source.type === "invoice" &&
    (f.facts.status !== "issued" || BigInt(f.facts.balance_cents) <= 0n)
  )
    reasons.push("invoice_not_outstanding");
  if (row.source.type === "payment" && f.facts.status !== "received")
    reasons.push("payment_reversed");
  if (
    ["cancelled", "void", "declined", "superseded"].includes(
      f.facts.status ?? "",
    )
  )
    reasons.push("source_inactive");
  let subject = row.subject,
    body = row.body;
  if (row.template_version_id) {
    const tv = await ctx.db.get(row.template_version_id),
      template = tv && (await ctx.db.get(tv.template_id));
    if (
      !tv ||
      !template ||
      !template.active ||
      template.category !== row.category ||
      template.current_version_id !== tv._id
    )
      reasons.push("template_changed");
    else {
      try {
        subject = render(tv.subject, f.facts);
        body = render(tv.body, f.facts);
        content.parse({ subject, body });
      } catch {
        reasons.push("invalid_template_fields");
      }
    }
  } else if (row.source.type !== "realtor" && row.source.type !== "opportunity")
    reasons.push("source_template_required");
  const config = await settings(ctx),
    signature = config?.signature ?? "";
  if (!signature.trim()) reasons.push("company_signature_required");
  return {
    ...f,
    subject,
    body,
    signature,
    reasons,
    allowed: reasons.length === 0,
    consent_ids: active.map((c) => c._id),
    preference_ids: preferences.map((c) => c._id),
    suppression_ids: suppressions
      .filter((c) => !c.revoked_at)
      .map((c) => c._id),
    eligibility_basis: active.map((c) => ({
      basis: c.basis,
      observed_at: c.observed_at,
    })),
    policy_version:
      POLICY_VERSION +
      ":" +
      (policy?.transactional_basis ?? "documented_service") +
      ":" +
      (policy?.token_generation ?? 0),
  };
}
export function reviewToken(
  d: Pick<
    Awaited<ReturnType<typeof evaluate>>,
    | "email"
    | "subject"
    | "body"
    | "signature"
    | "fingerprint"
    | "consent_ids"
    | "preference_ids"
    | "suppression_ids"
    | "policy_version"
  >,
) {
  return JSON.stringify({
    email: d.email,
    subject: d.subject,
    body: d.body,
    signature: d.signature,
    source: d.fingerprint,
    consents: d.consent_ids,
    preferences: d.preference_ids,
    suppressions: d.suppression_ids,
    policy: d.policy_version,
  });
}
export async function sourceAccess(ctx: Ctx, s: Source, p: Profile) {
  if (!isManager(p) && ["project", "invoice", "payment"].includes(s.type))
    return false;
  try {
    let recipient: Recipient;
    if (s.type === "realtor") recipient = s;
    else if (s.type === "invoice" || s.type === "payment") {
      const row = await ctx.db.get(s.id);
      if (!row) return false;
      recipient = { type: "customer", id: row.customer_id };
    } else if (s.type === "project" || s.type === "opportunity") {
      const row = await ctx.db.get(s.id);
      if (!row) return false;
      recipient = { type: "realtor", id: row.realtor_id };
    } else {
      const row = await ctx.db.get(s.id);
      if (!row) return false;
      const o = await ctx.db.get(row.opportunity_id);
      if (!o) return false;
      recipient = { type: "realtor", id: o.realtor_id };
    }
    await sourceFacts(
      ctx,
      s,
      recipient,
      p,
      !isManager(p) &&
        p.roles.includes("marketing") &&
        !p.roles.includes("sales")
        ? "commercial_marketing"
        : "sales_relationship",
      true,
    );
    return true;
  } catch {
    return false;
  }
}

export function categoryCompatible(
  source: Source["type"],
  category: Doc<"communications">["category"],
) {
  if (source === "realtor") return category !== "transactional";
  if (source === "opportunity" || source === "quote")
    return category === "sales_relationship";
  return category === "transactional";
}
