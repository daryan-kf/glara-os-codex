import { applicationOrigin } from "../src/lib/security/origin";
import { v } from "convex/values";
import { paginationOptsValidator } from "convex/server";
import {
  query,
  mutation,
  internalMutation,
  type MutationCtx,
  type QueryCtx,
} from "./functions";
import type { Id, Doc } from "./_generated/dataModel";
import { requireRoles, assignee, deny } from "./access";
import {
  campaignInput,
  registrationInput,
  managerRoles,
  campaignRoles,
  intakeEnabled,
  phoneIdentity,
  eventDay,
  campaignEligible,
  sixMonthExpiry,
  priority,
} from "../src/lib/campaigns/model";
import { z } from "zod";
const nowISO = () => new Date().toISOString();
const stamps = () => ({
  created_at: nowISO(),
  updated_at: nowISO(),
  deleted_at: null,
});
async function audit(
  ctx: MutationCtx,
  actor: Id<"users"> | null,
  action: string,
  id: string,
  before: unknown = null,
  after: unknown = null,
) {
  await ctx.db.insert("audit_logs", {
    actor_id: actor,
    action,
    entity: "marketing_campaigns",
    entity_id: id,
    old_value: before,
    new_value: after,
    created_at: nowISO(),
  });
}
function parse<T>(schema: z.ZodType<T>, input: string): T {
  if (input.length > 40000) deny("INVALID_INPUT");
  try {
    return schema.parse(JSON.parse(input));
  } catch {
    return deny("INVALID_INPUT", "Check the campaign form and try again.");
  }
}
async function campaign(
  ctx: QueryCtx | MutationCtx,
  id: Id<"marketing_campaigns">,
) {
  const c = await ctx.db.get(id);
  if (!c) return deny("UNAVAILABLE");
  return c;
}
async function entries(
  ctx: QueryCtx | MutationCtx,
  id: Id<"marketing_campaigns">,
) {
  const rows = await ctx.db
    .query("campaign_entries")
    .withIndex("by_campaign", (q) => q.eq("campaign_id", id))
    .take(5001);
  if (rows.length > 5000)
    deny(
      "CAPACITY",
      "This campaign needs an indexed export review before drawing.",
    );
  return rows;
}
function publicFields(c: Doc<"marketing_campaigns">) {
  return {
    slug: c.slug,
    title: c.public_title,
    description: c.public_description,
    prize: c.prize_name,
    value_cents: c.prize_value_cents,
    currency: c.currency,
    starts_at: c.starts_at,
    closes_at: c.closes_at,
    timezone: c.timezone,
    eligibility_summary: c.eligibility_summary,
    eligible_province: c.eligible_province,
    official_rules: c.official_rules,
    rules_version: c.rules_version,
    privacy_notice: c.privacy_notice,
    consent_text: c.consent_text,
    prize_terms: c.prize_terms,
    skill_question_required: c.skill_question_required,
    state:
      c.status === "open" &&
      Date.now() >= c.starts_at &&
      Date.now() < c.closes_at
        ? "open"
        : Date.now() < c.closes_at &&
            (c.status === "scheduled" ||
              (c.status === "open" && Date.now() < c.starts_at))
          ? "scheduled"
          : "closed",
  };
}
export const publicCampaign = query({
  args: { slug: v.string() },
  handler: async (ctx, a) => {
    if (!intakeEnabled(process.env) || a.slug.length > 80) return null;
    const c = await ctx.db
      .query("marketing_campaigns")
      .withIndex("by_slug", (q) => q.eq("slug", a.slug))
      .unique();
    return c && !["draft", "cancelled"].includes(c.status)
      ? publicFields(c)
      : null;
  },
});
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireRoles(ctx, campaignRoles);
    return await ctx.db.query("marketing_campaigns").order("desc").take(100);
  },
});
export const save = mutation({
  args: {
    id: v.optional(v.id("marketing_campaigns")),
    version: v.number(),
    input: v.string(),
  },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, managerRoles),
      d = parse(campaignInput, a.input);
    const assigned = ctx.db.normalizeId("users", d.assigned_to);
    if (!assigned) return deny("INVALID_INPUT");
    await assignee(ctx, assigned);
    const old = a.id ? await campaign(ctx, a.id) : null;
    if (old && (old.status !== "draft" || old.version !== a.version))
      deny("CONFLICT", "Only an unchanged draft can be edited.");
    const existing = await ctx.db
      .query("marketing_campaigns")
      .withIndex("by_slug", (q) => q.eq("slug", d.slug))
      .unique();
    if (existing && existing._id !== a.id)
      deny("DUPLICATE", "Choose another campaign URL.");
    const data = {
      ...d,
      assigned_to: assigned,
      updated_at: Date.now(),
      version: (old?.version ?? 0) + 1,
    };
    const id = old
      ? old._id
      : await ctx.db.insert("marketing_campaigns", {
          ...data,
          type: "realtor_giveaway",
          status: "draft",
          currency: "CAD",
          timezone: "America/Vancouver",
          created_by: p.userId,
          created_at: Date.now(),
        });
    if (old) await ctx.db.patch(id, data);
    await audit(ctx, p.userId, "campaign_saved", id, old, data);
    return id;
  },
});
export const transition = mutation({
  args: {
    id: v.id("marketing_campaigns"),
    version: v.number(),
    to: v.union(
      v.literal("scheduled"),
      v.literal("open"),
      v.literal("closed"),
      v.literal("cancelled"),
    ),
  },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, managerRoles),
      c = await campaign(ctx, a.id);
    if (c.version !== a.version) deny("CONFLICT");
    const allowed = {
      draft: ["scheduled", "open", "cancelled"],
      scheduled: ["open", "closed", "cancelled"],
      open: ["closed", "cancelled"],
      closed: [],
      drawn: [],
      completed: [],
      cancelled: [],
    } as Record<string, string[]>;
    if (!allowed[c.status].includes(a.to)) deny("INVALID_STATE");
    if (a.to === "open" || a.to === "scheduled") {
      if (
        !intakeEnabled(process.env) ||
        !process.env.GLARA_EXPO_INGRESS_SECRET ||
        process.env.GLARA_EXPO_INGRESS_SECRET.length < 32
      )
        deny(
          "CONFIGURATION",
          "Public intake is disabled or not securely configured.",
        );
      if (
        !c.legal_approved ||
        [
          c.official_rules,
          c.privacy_notice,
          c.prize_terms,
          c.consent_text,
          c.eligibility_summary,
        ].some((x) => x.trim().length < 30)
      )
        deny(
          "REVIEW_REQUIRED",
          "Approve complete rules, prize terms, privacy and consent wording first.",
        );
      if (Date.now() >= c.closes_at)
        deny("INVALID_STATE", "The entry window has ended.");
      await assignee(ctx, c.assigned_to);
    }
    const changes = {
      status: a.to,
      version: c.version + 1,
      updated_at: Date.now(),
      ...(a.to === "closed" ? { closed_at: Date.now() } : {}),
    };
    await ctx.db.patch(c._id, changes);
    await audit(
      ctx,
      p.userId,
      "campaign_" + a.to,
      c._id,
      { status: c.status },
      changes,
    );
  },
});
// Counters are committed even when intake is denied. Shared booth Wi-Fi has a generous hourly allowance.
async function throttle(
  ctx: MutationCtx,
  key: string,
  limit: number,
  span: number,
) {
  const old = await ctx.db
    .query("campaign_rate_windows")
    .withIndex("by_key", (q) => q.eq("key", key))
    .unique();
  const active = old && old.expires_at > Date.now(),
    count = active ? old.count + 1 : 1;
  const data = {
    key,
    count,
    expires_at: active ? old.expires_at : Date.now() + span,
  };
  if (old) await ctx.db.patch(old._id, data);
  else await ctx.db.insert("campaign_rate_windows", data);
  return count <= limit;
}
export const register = internalMutation({
  args: {
    input: v.string(),
    network_key: v.string(),
    identity_key: v.string(),
    phone_identity_key: v.string(),
  },
  handler: async (ctx, a) => {
    if (!intakeEnabled(process.env)) return { status: "unavailable" as const };
    const d = parse(registrationInput, a.input),
      now = Date.now(),
      phone = phoneIdentity(d.phone);
    const c = await ctx.db
      .query("marketing_campaigns")
      .withIndex("by_slug", (q) => q.eq("slug", d.slug))
      .unique();
    if (
      !c ||
      c.status !== "open" ||
      now < c.starts_at ||
      now >= c.closes_at ||
      d.rules_version !== c.rules_version
    )
      return { status: "closed" as const };
    // Expired rate rows have no lasting identity value; bounded cleanup during intake.
    for (const row of await ctx.db
      .query("campaign_rate_windows")
      .withIndex("by_expiry", (q) => q.lt("expires_at", now))
      .take(20))
      await ctx.db.delete(row._id);
    const rate = await Promise.all([
      throttle(ctx, "network:" + a.network_key, 600, 3600000),
      throttle(ctx, "identity:" + a.identity_key, 8, 3600000),
      throttle(ctx, "phone:" + a.phone_identity_key, 8, 3600000),
      throttle(ctx, "campaign:" + c._id, 2000, 3600000),
    ]);
    if (
      rate.some((x) => !x) ||
      d.website ||
      now - d.started_at < 1500 ||
      now - d.started_at > 86400000
    )
      return { status: "retry" as const };
    const eligible = campaignEligible(c, d);
    const dupEmail = await ctx.db
      .query("campaign_entries")
      .withIndex("by_email", (q) =>
        q.eq("campaign_id", c._id).eq("normalized_email", d.email),
      )
      .first();
    const dupPhone = await ctx.db
      .query("campaign_entries")
      .withIndex("by_phone", (q) =>
        q.eq("campaign_id", c._id).eq("normalized_phone", phone),
      )
      .first();
    if (dupEmail || dupPhone)
      return {
        status: eligible ? ("received" as const) : ("ineligible" as const),
      };
    const emailMatches = await ctx.db
      .query("realtors")
      .withIndex("by_email", (q) => q.eq("email", d.email))
      .take(3);
    const phoneMatches = (
      await Promise.all(
        [phone, "1" + phone].map((key) =>
          ctx.db
            .query("realtors")
            .withIndex("by_phone", (q) => q.eq("phone_key", key))
            .take(3),
        ),
      )
    ).flat();
    const matches = [
      ...new Map(
        [...emailMatches, ...phoneMatches].map((r) => [r._id, r]),
      ).values(),
    ];
    const existing = matches.length === 1 ? matches[0] : null;
    const conflict =
      matches.length > 1 ||
      (!!existing &&
        (!!existing.deleted_at ||
          existing.contact_type === "builder" ||
          (!!existing.email && existing.email !== d.email) ||
          (!!existing.phone_key &&
            phoneIdentity(existing.phone_key) !== phone)));
    if (existing && !conflict) {
      const duplicate = await ctx.db
        .query("campaign_entries")
        .withIndex("by_realtor_campaign", (q) =>
          q.eq("realtor_id", existing._id).eq("campaign_id", c._id),
        )
        .first();
      if (duplicate)
        return {
          status: eligible ? ("received" as const) : ("ineligible" as const),
        };
    }
    await assignee(ctx, c.assigned_to);
    if ((await entries(ctx, c._id)).length >= 5000)
      return { status: "unavailable" as const };
    let rid = conflict ? null : (existing?._id ?? null);
    if (!rid && !conflict) {
      let source = await ctx.db
        .query("lead_sources")
        .withIndex("by_name", (q) => q.eq("name", "Trade Show / Expo"))
        .first();
      if (!source || source.deleted_at) {
        const id = await ctx.db.insert("lead_sources", {
          ...stamps(),
          name: "Trade Show / Expo",
        });
        source = await ctx.db.get(id);
      }
      const b = await ctx.db
        .query("brokerages")
        .withIndex("by_name", (q) => q.eq("name", d.brokerage))
        .first();
      const bid =
        b && !b.deleted_at
          ? b._id
          : await ctx.db.insert("brokerages", {
              ...stamps(),
              name: d.brokerage,
              office_name: null,
              website: null,
              phone: null,
              address: null,
              city: null,
              province: "BC",
              postal_code: null,
              notes: null,
              version: 1,
            });
      rid = await ctx.db.insert("realtors", {
        ...stamps(),
        first_name: d.first_name,
        last_name: d.last_name,
        contact_type: "realtor",
        email: d.email,
        phone: d.phone,
        phone_key: d.phone,
        instagram: null,
        website: null,
        brokerage_id: bid,
        primary_city: d.city,
        primary_area: null,
        secondary_areas: [],
        luxury_agent: false,
        relationship_status: "prospect",
        lead_source_id: source!._id,
        assigned_to: c.assigned_to,
        version: 1,
        sales_search_text: [d.first_name, d.last_name, d.email, d.phone].join(
          " ",
        ),
      });
      await ctx.db.insert("realtor_private", {
        ...stamps(),
        realtor_id: rid,
        notes: null,
        estimated_listings_per_year: null,
        average_listing_price: null,
        relationship_score: null,
        lead_score: null,
      });
      await audit(ctx, null, "public_expo_realtor_created", rid, null, {
        campaign_id: c._id,
      });
    }
    const id = await ctx.db.insert("campaign_entries", {
      campaign_id: c._id,
      realtor_id: rid,
      normalized_email: d.email,
      normalized_phone: phone,
      ...(conflict
        ? {
            pending_contact: {
              first_name: d.first_name,
              last_name: d.last_name,
              brokerage: d.brokerage,
              city: d.city,
            },
          }
        : {}),
      entered_at: now,
      source: d.source,
      source_detail: JSON.stringify({
        utm_source: d.utm_source,
        utm_medium: d.utm_medium,
        utm_campaign: d.utm_campaign,
      }),
      event_day: eventDay(c.starts_at, now),
      rules_version: c.rules_version,
      rules_accepted_at: now,
      marketing_consent: d.marketing_consent,
      ...(d.marketing_consent ? { marketing_consent_at: now } : {}),
      annual_listings: d.annual_listings,
      licensed_realtor: d.licensed_realtor,
      ...(d.licensed_in_bc !== undefined
        ? { licensed_in_bc: d.licensed_in_bc }
        : {}),
      city_at_entry: d.city,
      crm_origin: conflict ? "review" : existing ? "existing" : "new",
      eligibility_status: conflict
        ? "pending"
        : eligible
          ? "eligible"
          : "ineligible",
      eligibility_reason: conflict
        ? "identity_review"
        : eligible
          ? "self_declared_eligible"
          : !d.licensed_realtor
            ? "not_licensed"
            : "outside_region",
      draw_status: "not_selected",
      created_at: now,
      updated_at: now,
      version: 1,
    });
    if (rid) {
      const r = await ctx.db.get(rid);
      const owner = r!.assigned_to;
      const base = {
        ...stamps(),
        realtor_id: rid,
        assigned_to: owner,
        created_by: c.created_by,
        actor_kind: "system" as const,
        replaces_activity_id: null,
        description:
          "Public registration · " +
          c.name +
          " · rules " +
          c.rules_version +
          " · marketing opt-in: " +
          (d.marketing_consent ? "yes" : "no"),
        priority: "normal" as const,
      };
      const activity = await ctx.db.insert("activities", {
        ...base,
        type: "note",
        title: "Expo registration: " + c.name,
        status: "completed",
        due_at: null,
        completed_at: nowISO(),
      });
      await audit(ctx, null, "public_expo_activity", activity, null, {
        entry_id: id,
      });
      if (
        r!.relationship_status === "prospect" &&
        !(await ctx.db
          .query("activities")
          .withIndex("by_realtor_due", (q) =>
            q
              .eq("realtor_id", rid!)
              .eq("deleted_at", null)
              .eq("status", "open")
              .gt("due_at", null),
          )
          .first())
      ) {
        await ctx.db.insert("activities", {
          ...base,
          type: "follow_up",
          title: "Review expo registration and permitted follow-up",
          status: "open",
          due_at: new Date(now + 86400000).toISOString(),
          completed_at: null,
        });
      }
      // Preserve withdrawals and suppression: consent evidence is recorded without changing either.
      if (d.marketing_consent)
        await ctx.db.insert("communication_consents", {
          recipient_key: "realtor:" + rid,
          scope: "commercial_marketing",
          basis: "express_consent",
          evidence: c.consent_text,
          source: "public_expo:" + id,
          observed_at: now,
          created_at: now,
          actor_kind: "public_registration",
        });
    }
    await audit(ctx, null, "public_expo_entry_received", id, null, {
      campaign_id: c._id,
      rules_version: c.rules_version,
      marketing_consent: d.marketing_consent,
    });
    return {
      status: eligible ? ("received" as const) : ("ineligible" as const),
    };
  },
});
export const detail = query({
  args: { id: v.id("marketing_campaigns") },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, campaignRoles),
      c = await campaign(ctx, a.id),
      rows = await entries(ctx, c._id),
      manage = p.roles.some((r) => managerRoles.some((m) => m === r));
    const counts = {
      total: rows.length,
      eligible: rows.filter((e) =>
        [
          "eligible",
          "selected_pending_verification",
          "confirmed_winner",
        ].includes(e.eligibility_status),
      ).length,
      pending: rows.filter((e) => e.eligibility_status === "pending").length,
      new: rows.filter((e) => e.crm_origin === "new").length,
      existing: rows.filter((e) => e.crm_origin === "existing").length,
      opt_ins: rows.filter((e) => e.marketing_consent).length,
      day_1: rows.filter((e) => e.event_day === "day_1").length,
      day_2: rows.filter((e) => e.event_day === "day_2").length,
      high_priority: rows.filter((e) => priority(e.annual_listings) === "High")
        .length,
    };
    let publicUrl: string | null = null;
    try {
      publicUrl =
        applicationOrigin(process.env.SITE_URL, process.env.GLARA_ENVIRONMENT) +
        "/giveaway/" +
        c.slug +
        "?source=booth";
    } catch {}
    return {
      public_url: publicUrl,
      campaign: c,
      counts,
      manage,
      draws: manage
        ? await ctx.db
            .query("campaign_draws")
            .withIndex("by_campaign", (q) => q.eq("campaign_id", c._id))
            .collect()
        : [],
      awards: manage
        ? await ctx.db
            .query("campaign_awards")
            .withIndex("by_campaign", (q) => q.eq("campaign_id", c._id))
            .collect()
        : [],
    };
  },
});
export const entryList = query({
  args: {
    id: v.id("marketing_campaigns"),
    q: v.string(),
    filter: v.string(),
    paginationOpts: paginationOptsValidator,
  },
  handler: async (ctx, a) => {
    await requireRoles(ctx, campaignRoles);
    if (
      a.q.length > 100 ||
      !Number.isInteger(a.paginationOpts.numItems) ||
      a.paginationOpts.numItems < 1 ||
      a.paginationOpts.numItems > 50
    )
      deny("INVALID_INPUT");
    const page = await ctx.db
      .query("campaign_entries")
      .withIndex("by_campaign", (q) => q.eq("campaign_id", a.id))
      .order("desc")
      .paginate(a.paginationOpts);
    const rows = await Promise.all(
      page.page.map(async (e) => {
        const r = e.realtor_id ? await ctx.db.get(e.realtor_id) : null,
          b = r?.brokerage_id ? await ctx.db.get(r.brokerage_id) : null;
        const contact = e.pending_contact ?? {
          first_name: r?.first_name ?? "Unavailable",
          last_name: r?.last_name ?? "",
          brokerage: b?.name ?? "",
          city: e.city_at_entry,
        };
        const contacted = r
          ? await ctx.db
              .query("activities")
              .withIndex("by_realtor_completed", (q) =>
                q.eq("realtor_id", r._id),
              )
              .filter((q) =>
                q.and(
                  q.neq(q.field("actor_kind"), "system"),
                  q.eq(q.field("deleted_at"), null),
                  q.eq(q.field("status"), "completed"),
                  q.gte(
                    q.field("completed_at"),
                    new Date(e.entered_at).toISOString(),
                  ),
                  q.neq(q.field("type"), "note"),
                ),
              )
              .first()
          : null;
        return {
          id: e._id,
          realtor_id: r && !r.deleted_at ? r._id : null,
          ...contact,
          email: e.normalized_email,
          phone: e.normalized_phone,
          entered_at: e.entered_at,
          marketing_consent: e.marketing_consent,
          eligibility: e.eligibility_status,
          reason: e.eligibility_reason,
          draw_status: e.draw_status,
          origin: e.crm_origin,
          event_day: e.event_day,
          source: e.source,
          annual_listings: e.annual_listings,
          priority: priority(e.annual_listings),
          contacted: !!contacted,
          version: e.version,
        };
      }),
    );
    return {
      ...page,
      page: rows.filter(
        (e) =>
          [e.first_name, e.last_name, e.brokerage, e.city, e.email]
            .join(" ")
            .toLowerCase()
            .includes(a.q.toLowerCase()) &&
          (!a.filter ||
            a.filter === e.eligibility ||
            a.filter === e.origin ||
            a.filter === e.event_day ||
            a.filter === e.priority ||
            (a.filter === "opt_in" && e.marketing_consent) ||
            (a.filter === "not_contacted" && !e.contacted)),
      ),
    };
  },
});
export const realtorHistory = query({
  args: { id: v.id("realtors") },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, [...campaignRoles, "sales"]),
      r = await ctx.db.get(a.id);
    if (
      !r ||
      r.deleted_at ||
      (!p.roles.some((x) => campaignRoles.some((y) => y === x)) &&
        r.assigned_to !== p.userId)
    )
      deny();
    const rows = await ctx.db
      .query("campaign_entries")
      .withIndex("by_realtor_campaign", (q) => q.eq("realtor_id", a.id))
      .take(100);
    return await Promise.all(
      rows.map(async (e) => ({
        id: e._id,
        name: (await ctx.db.get(e.campaign_id))?.name ?? "Campaign",
        entered_at: e.entered_at,
        marketing_consent: e.marketing_consent,
        eligibility: e.eligibility_status,
      })),
    );
  },
});
export const reviewEligibility = mutation({
  args: {
    id: v.id("campaign_entries"),
    version: v.number(),
    eligible: v.boolean(),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, managerRoles),
      e = await ctx.db.get(a.id);
    if (!e) deny("UNAVAILABLE");
    const c = await campaign(ctx, e.campaign_id);
    if (
      e.version !== a.version ||
      !["open", "scheduled", "closed"].includes(c.status) ||
      c.active_draw_id ||
      (a.eligible && (c.status === "closed" || Date.now() >= c.closes_at))
    )
      deny("CONFLICT", "Eligibility is frozen when intake closes.");
    if (
      a.reason.trim().length < 10 ||
      a.reason.length > 1000 ||
      (a.eligible &&
        (!e.realtor_id ||
          !campaignEligible(c, { ...e, city: e.city_at_entry })))
    )
      deny(
        "INVALID_INPUT",
        "Resolve identity and confirm the published eligibility requirements first.",
      );
    await ctx.db.patch(e._id, {
      eligibility_status: a.eligible ? "eligible" : "ineligible",
      eligibility_reason: a.reason,
      version: e.version + 1,
      updated_at: Date.now(),
    });
    await audit(
      ctx,
      p.userId,
      "entry_eligibility_review",
      e._id,
      { status: e.eligibility_status },
      { eligible: a.eligible, reason: a.reason },
    );
  },
});
export const freezeDraw = internalMutation({
  args: {
    id: v.id("marketing_campaigns"),
    redraw: v.boolean(),
    reason: v.string(),
  },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, managerRoles),
      c = await campaign(ctx, a.id);
    const previous = c.active_draw_id
      ? await ctx.db.get(c.active_draw_id)
      : null;
    if (previous && !a.redraw) return previous;
    if (previous && !previous.selected_entry_id) return previous;
    if (a.redraw) {
      const selected = previous?.selected_entry_id
        ? await ctx.db.get(previous.selected_entry_id)
        : null;
      if (
        !selected ||
        selected.eligibility_status !== "disqualified" ||
        a.reason.trim().length < 10
      )
        deny(
          "INVALID_STATE",
          "A redraw requires a disqualified selection and a recorded reason.",
        );
    }
    if (!["closed", "drawn"].includes(c.status) || !c.closed_at)
      deny("INVALID_STATE", "Close the campaign before drawing.");
    const pool = await entries(ctx, c._id);
    if (pool.some((e) => e.eligibility_status === "pending"))
      deny("REVIEW_REQUIRED", "Unresolved entries block the draw.");
    const eligible = pool
      .filter((e) => e.eligibility_status === "eligible")
      .sort((a, b) => a._id.localeCompare(b._id));
    if (!eligible.length) deny("EMPTY_POOL");
    const id = await ctx.db.insert("campaign_draws", {
      campaign_id: c._id,
      rules_version: c.rules_version,
      closed_at: c.closed_at,
      entry_ids: eligible.map((e) => e._id),
      eligible_count: eligible.length,
      operator_id: p.userId,
      created_at: Date.now(),
      algorithm: "node-crypto-randomInt-v1",
      reason: a.redraw ? a.reason : "Initial draw",
      ...(previous ? { previous_draw_id: previous._id } : {}),
    });
    await ctx.db.patch(c._id, {
      active_draw_id: id,
      version: c.version + 1,
      updated_at: Date.now(),
    });
    await audit(ctx, p.userId, "draw_pool_frozen", c._id, null, {
      draw_id: id,
      eligible_count: eligible.length,
    });
    return (await ctx.db.get(id))!;
  },
});
export const finishDraw = internalMutation({
  args: { id: v.id("campaign_draws"), index: v.number() },
  handler: async (ctx, a) => {
    const operator = await requireRoles(ctx, managerRoles);
    const d = await ctx.db.get(a.id);
    if (!d) deny("UNAVAILABLE");
    if (d.selected_entry_id) return d.selected_entry_id;
    const c = await campaign(ctx, d.campaign_id);
    if (
      c.active_draw_id !== d._id ||
      !Number.isInteger(a.index) ||
      a.index < 0 ||
      a.index >= d.eligible_count
    )
      deny("CONFLICT");
    const selected = d.entry_ids[a.index],
      e = await ctx.db.get(selected);
    if (!e || e.eligibility_status !== "eligible") deny("CONFLICT");
    await ctx.db.patch(d._id, {
      selected_entry_id: selected,
      completed_at: Date.now(),
    });
    await ctx.db.patch(selected, {
      eligibility_status: "selected_pending_verification",
      draw_status: "selected",
      selected_at: Date.now(),
      updated_at: Date.now(),
      version: e.version + 1,
    });
    await ctx.db.patch(c._id, {
      status: "drawn",
      draw_completed_at: Date.now(),
      updated_at: Date.now(),
      version: c.version + 1,
    });
    await audit(ctx, operator.userId, "draw_selection", c._id, null, {
      draw_id: d._id,
      entry_id: selected,
      algorithm: d.algorithm,
    });
    return selected;
  },
});
export const verifyWinner = mutation({
  args: {
    id: v.id("campaign_entries"),
    version: v.number(),
    decision: v.union(v.literal("confirm"), v.literal("disqualify")),
    identity_verified: v.boolean(),
    license_verified: v.boolean(),
    rules_verified: v.boolean(),
    skill_question_passed: v.boolean(),
    note: v.string(),
  },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, managerRoles),
      e = await ctx.db.get(a.id);
    if (!e) deny("UNAVAILABLE");
    const c = await campaign(ctx, e.campaign_id);
    if (
      e.version !== a.version ||
      e.eligibility_status !== "selected_pending_verification" ||
      c.status !== "drawn"
    )
      deny("CONFLICT");
    if (a.note.trim().length < 10 || a.note.length > 1000)
      deny(
        "INVALID_INPUT",
        "Record a short verification reference or disqualification reason. Do not upload identity documents.",
      );
    if (a.decision === "confirm") {
      if (
        !a.identity_verified ||
        !a.license_verified ||
        !a.rules_verified ||
        (c.skill_question_required && !a.skill_question_passed)
      )
        deny("VERIFICATION_REQUIRED");
      const confirmedAt = Date.now();
      const expiresAt =
        c.expiry_months_after_confirmation === 6
          ? sixMonthExpiry(confirmedAt)
          : c.prize_expires_at;
      if (!expiresAt || expiresAt <= confirmedAt)
        deny("INVALID_INPUT", "Prize expiry must be after confirmation.");
      await ctx.db.insert("campaign_awards", {
        campaign_id: c._id,
        entry_id: e._id,
        original_cents: c.prize_value_cents,
        remaining_cents: c.prize_value_cents,
        currency: "CAD",
        issued_at: confirmedAt,
        expires_at: expiresAt,
        terms_version: c.prize_terms_version,
        terms: c.prize_terms,
        status: "issued_unapplied",
        issued_by: p.userId,
      });
      await ctx.db.patch(e._id, {
        eligibility_status: "confirmed_winner",
        draw_status: "confirmed",
        confirmed_at: confirmedAt,
        confirmed_by: p.userId,
        verification_note: a.note,
        updated_at: Date.now(),
        version: e.version + 1,
      });
      await ctx.db.patch(c._id, {
        status: "completed",
        updated_at: Date.now(),
        version: c.version + 1,
      });
    } else
      await ctx.db.patch(e._id, {
        eligibility_status: "disqualified",
        draw_status: "disqualified",
        disqualified_at: Date.now(),
        disqualification_reason: a.note,
        updated_at: Date.now(),
        version: e.version + 1,
      });
    await audit(ctx, p.userId, "winner_" + a.decision, c._id, null, {
      entry_id: e._id,
      note: a.note,
      identity_verified: a.identity_verified,
      license_verified: a.license_verified,
      rules_verified: a.rules_verified,
      skill_question_passed: a.skill_question_passed,
    });
  },
});

export const identityCandidates = query({
  args: { id: v.id("campaign_entries") },
  handler: async (ctx, a) => {
    await requireRoles(ctx, managerRoles);
    const e = await ctx.db.get(a.id);
    if (!e || !e.pending_contact) return [];
    const email = await ctx.db
      .query("realtors")
      .withIndex("by_email", (q) => q.eq("email", e.normalized_email))
      .take(10);
    const phone = (
      await Promise.all(
        [e.normalized_phone, "1" + e.normalized_phone].map((key) =>
          ctx.db
            .query("realtors")
            .withIndex("by_phone", (q) => q.eq("phone_key", key))
            .take(10),
        ),
      )
    ).flat();
    return [...new Map([...email, ...phone].map((r) => [r._id, r])).values()]
      .filter((r) => !r.deleted_at && r.contact_type !== "builder")
      .map((r) => ({
        id: r._id,
        name: r.first_name + " " + r.last_name,
        email: r.email,
        phone: r.phone,
      }));
  },
});
export const resolveIdentity = mutation({
  args: {
    id: v.id("campaign_entries"),
    version: v.number(),
    realtor_id: v.id("realtors"),
    note: v.string(),
  },
  handler: async (ctx, a) => {
    const p = await requireRoles(ctx, managerRoles),
      e = await ctx.db.get(a.id);
    if (!e) deny("UNAVAILABLE");
    const c = await campaign(ctx, e.campaign_id),
      r = await ctx.db.get(a.realtor_id);
    if (
      e.version !== a.version ||
      !e.pending_contact ||
      e.eligibility_status !== "pending" ||
      c.status !== "open" ||
      Date.now() >= c.closes_at
    )
      deny("CONFLICT");
    if (
      !r ||
      r.deleted_at ||
      r.contact_type === "builder" ||
      !(
        r.email === e.normalized_email ||
        (r.phone_key && phoneIdentity(r.phone_key) === e.normalized_phone)
      ) ||
      a.note.trim().length < 10 ||
      a.note.length > 1000
    )
      deny(
        "INVALID_INPUT",
        "Verify an active matching Realtor before linking the entry.",
      );
    await assignee(ctx, r.assigned_to);
    const duplicate = await ctx.db
      .query("campaign_entries")
      .withIndex("by_realtor_campaign", (q) =>
        q.eq("realtor_id", r._id).eq("campaign_id", c._id),
      )
      .first();
    if (duplicate)
      deny(
        "DUPLICATE",
        "This Realtor already has a campaign entry. Mark the pending duplicate ineligible instead.",
      );
    const eligible = campaignEligible(c, { ...e, city: e.city_at_entry });
    await ctx.db.patch(e._id, {
      realtor_id: r._id,
      pending_contact: undefined,
      eligibility_status: eligible ? "eligible" : "ineligible",
      eligibility_reason: "identity_verified: " + a.note,
      crm_origin: "existing",
      version: e.version + 1,
      updated_at: Date.now(),
    });
    await ctx.db.insert("activities", {
      ...stamps(),
      realtor_id: r._id,
      assigned_to: r.assigned_to,
      created_by: p.userId,
      replaces_activity_id: null,
      type: "note",
      title: "Expo registration verified: " + c.name,
      description: "Verified campaign entry linked after identity review.",
      priority: "normal",
      status: "completed",
      due_at: null,
      completed_at: nowISO(),
    });
    if (
      r.relationship_status === "prospect" &&
      !(await ctx.db
        .query("activities")
        .withIndex("by_realtor_due", (q) =>
          q
            .eq("realtor_id", r._id)
            .eq("deleted_at", null)
            .eq("status", "open")
            .gt("due_at", null),
        )
        .first())
    )
      await ctx.db.insert("activities", {
        ...stamps(),
        realtor_id: r._id,
        assigned_to: r.assigned_to,
        created_by: p.userId,
        replaces_activity_id: null,
        type: "follow_up",
        title: "Review verified expo registration",
        description: null,
        priority: "normal",
        status: "open",
        due_at: new Date(Date.now() + 86400000).toISOString(),
        completed_at: null,
      });
    if (e.marketing_consent)
      await ctx.db.insert("communication_consents", {
        recipient_key: "realtor:" + r._id,
        scope: "commercial_marketing",
        basis: "express_consent",
        evidence: c.consent_text,
        source: "public_expo:" + e._id,
        observed_at: e.marketing_consent_at!,
        created_at: Date.now(),
        recorded_by: p.userId,
      });
    await audit(
      ctx,
      p.userId,
      "entry_identity_verified",
      e._id,
      { realtor_id: null },
      { realtor_id: r._id, note: a.note },
    );
  },
});
