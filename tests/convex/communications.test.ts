import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { operationsFixture } from "../support/operations-unit-fixture";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  deliveryState,
  covers,
  content,
} from "../../src/lib/communications/model";
import {
  calendarPayload,
  matchesProjection,
} from "../../src/lib/communications/calendar-provider";
import { ResendProvider } from "../../src/lib/communications/provider";
async function fixture() {
  const f = await operationsFixture(),
    source = { type: "realtor" as const, id: f.r.id as Id<"realtors"> };
  await f.t.run(async (ctx) => {
    await ctx.db.patch(source.id, { email: "m9-fictional@example.test" });
  });
  await f.c("owner").mutation(api.communications.saveSettings, {
    version: 0,
    signature: "Fictional Glara test identity — not a production sender",
    secondary_approval: false,
    paused: false,
  });
  const create = (extra: Record<string, unknown> = {}) =>
    f.c("sales").mutation(api.communications.create, {
      source,
      recipient: source,
      category: "sales_relationship",
      subject: "Fictional follow-up",
      body: "A fictional local test message.",
      request_key: crypto.randomUUID(),
      ...extra,
    });
  const consent = () =>
    f.c("owner").mutation(api.communications.recordConsent, {
      source,
      recipient: source,
      category: "sales_relationship",
      scope: "sales_relationship",
      basis: "express_consent",
      evidence: "Fictional explicit consent for local testing only",
      evidence_source: "Local acceptance fixture",
      observed_at: Date.now(),
    });
  const get = (id: Id<"communications">) =>
    f.c("sales").query(api.communications.get, { id });
  const approve = async (id: Id<"communications">) =>
    f.c("sales").mutation(api.communications.approve, {
      id,
      version: (await get(id)).row.version,
      review_token: (await get(id)).eligibility.review_token,
    });
  const queue = async (id: Id<"communications">) =>
    f.c("sales").mutation(api.communications.enqueue, {
      id,
      version: (await get(id)).row.version,
    });
  const claim = (id: Id<"communication_outbox">) =>
    f.t.mutation(internal.communicationDelivery.claim, {
      id,
      token_hash: "a".repeat(64),
      unsubscribe_url: "https://example.test/unsubscribe?token=fictional",
    });
  return { ...f, source, create, consent, get, approve, queue, claim };
}
beforeEach(() => {
  vi.stubEnv("M9_EMAIL_ENABLED", "true");
  vi.stubEnv("M9_EMAIL_VERIFIED", "true");
  vi.stubEnv("M9_EMAIL_TEST_ALLOWLIST", "m9-fictional@example.test");
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
describe("M9 communication boundaries", () => {
  it("requires consent; preserving an ineligible approval decision", async () => {
    const f = await fixture(),
      id = await f.create();
    expect((await f.approve(id)).allowed).toBe(false);
    expect((await f.get(id)).decisions).toHaveLength(1);
  });
  it("double-click create and enqueue produce one aggregate and one job", async () => {
    const f = await fixture();
    await f.consent();
    const request_key = crypto.randomUUID(),
      id = await f.create({ request_key });
    expect(await f.create({ request_key })).toBe(id);
    await f.approve(id);
    const job = await f.queue(id);
    expect(await f.queue(id)).toBe(job);
  });
  it.each(["designer", "staging_crew"] as const)(
    "denies %s direct backend calls",
    async (role) => {
      const f = await fixture();
      await expect(
        f.c(role).query(api.communications.sources, {
          category: "sales_relationship",
        }),
      ).rejects.toThrow();
      await expect(
        f.c(role).mutation(api.communications.create, {
          source: f.source,
          recipient: f.source,
          category: "sales_relationship",
          subject: "Hello",
          body: "Fictional",
          request_key: crypto.randomUUID(),
        }),
      ).rejects.toThrow();
    },
  );
  it("denies anonymous access", async () => {
    const f = await fixture();
    await expect(
      f.t.query(api.communications.configuration, {}),
    ).rejects.toThrow();
  });
  it("Marketing cannot read private relationship communication by ID", async () => {
    const f = await fixture(),
      id = await f.create();
    await expect(
      f.c("marketing").query(api.communications.get, { id }),
    ).rejects.toThrow();
  });
  it("Marketing can create an optional draft without exposing private source data", async () => {
    const f = await fixture(),
      id = await f.c("marketing").mutation(api.communications.create, {
        source: f.source,
        recipient: f.source,
        category: "commercial_marketing",
        subject: "Fictional update",
        body: "Fictional public update",
        request_key: crypto.randomUUID(),
      });
    const data = await f.c("marketing").query(api.communications.get, { id });
    expect(data.eligibility.allowed).toBe(false);
    expect(JSON.stringify(data)).not.toContain("PRIVATE NEGOTIATION");
  });
  it("archived users lose historical reads", async () => {
    const f = await fixture(),
      id = await f.create();
    await f.t.run(async (ctx) => {
      const p = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", f.who("sales").id))
        .unique();
      await ctx.db.patch(p!._id, { deleted_at: new Date().toISOString() });
    });
    await expect(f.get(id)).rejects.toThrow();
  });
  it("reassignment removes source and old-message access", async () => {
    const f = await fixture(),
      id = await f.create();
    await f.t.run((ctx) =>
      ctx.db.patch(f.source.id, { assigned_to: f.who("owner").id }),
    );
    await expect(f.get(id)).rejects.toThrow();
  });
  it("client cannot supply audit identity", async () => {
    const f = await fixture();
    const id = await f.create();
    const audit = await f.t.run((ctx) =>
      ctx.db
        .query("audit_logs")
        .withIndex("by_entity", (q) => q.eq("entity_id", id))
        .collect(),
    );
    expect(audit[0].actor_id).toBe(f.who("sales").id);
  });
  it("changed recipient blocks dispatch, preserving the approved address", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.t.run((ctx) =>
      ctx.db.patch(f.source.id, { email: "changed@example.test" }),
    );
    expect(await f.claim(job)).toBe(null);
    const data = await f.get(id);
    expect(data.row.status).toBe("needs_review");
    expect(data.row.snapshot?.email).toBe("m9-fictional@example.test");
  });
  it("revoking consent blocks an already queued message", async () => {
    const f = await fixture(),
      consent = await f.consent(),
      id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.c("owner").mutation(api.communications.revokeConsent, {
      id: consent,
      reason: "Fictional recipient withdrew consent",
    });
    expect(await f.claim(job)).toBe(null);
    expect((await f.get(id)).row.status).toBe("needs_review");
  });
  it("suppression added after approval blocks dispatch", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.c("owner").mutation(api.communications.suppress, {
      email: "m9-fictional@example.test",
      scope: "all",
      reason: "Fictional hard bounce",
    });
    expect(await f.claim(job)).toBe(null);
  });
  it("only one worker can claim a queued send", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    expect(await f.claim(job)).not.toBe(null);
    expect(await f.claim(job)).toBe(null);
  });
  it("unknown outcomes never automatically return to the ready queue", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.claim(job);
    await f.t.mutation(internal.communicationDelivery.outcome, {
      id: job,
      result: "unknown",
      code: "transport_uncertain",
    });
    expect((await f.get(id)).row.status).toBe("delivery_unknown");
    expect(await f.claim(job)).toBe(null);
  });
  it("expired claims become unknown, not retries", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.claim(job);
    await f.t.run((ctx) => ctx.db.patch(job, { lease_until: 0 }));
    expect(await f.t.mutation(internal.communicationDelivery.sweep, {})).toBe(
      1,
    );
    expect((await f.get(id)).row.status).toBe("delivery_unknown");
  });
  it("disabled provider and non-allowlisted destinations cannot be claimed", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    vi.stubEnv("M9_EMAIL_ENABLED", "false");
    expect(await f.claim(job)).toBe(null);
    vi.stubEnv("M9_EMAIL_ENABLED", "true");
    vi.stubEnv("M9_EMAIL_TEST_ALLOWLIST", "different@example.test");
    expect(await f.claim(job)).toBe(null);
  });
  it("accepted messages are immutable and cannot be recalled", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.claim(job);
    await f.t.mutation(internal.communicationDelivery.outcome, {
      id: job,
      result: "accepted",
      provider_id: "fictional-provider-1",
      code: "accepted",
    });
    const data = await f.get(id);
    expect(data.row.status).toBe("sent");
    await expect(
      f.c("sales").mutation(api.communications.edit, {
        id,
        version: data.row.version,
        subject: "Changed",
        body: "Changed",
      }),
    ).rejects.toThrow();
    await expect(
      f
        .c("sales")
        .mutation(api.communications.cancel, { id, version: data.row.version }),
    ).rejects.toThrow();
  });
  it("delivery events deduplicate, retain delivered state and apply hard-bounce suppression", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.claim(job);
    await f.t.mutation(internal.communicationDelivery.outcome, {
      id: job,
      result: "accepted",
      provider_id: "provider-event-test",
      code: "accepted",
    });
    const event = {
      event_id: "evt-1",
      provider_id: "provider-event-test",
      kind: "delivered" as const,
      occurred_at: Date.now(),
    };
    await f.t.mutation(internal.communicationDelivery.delivery, event);
    await f.t.mutation(internal.communicationDelivery.delivery, event);
    await f.t.mutation(internal.communicationDelivery.delivery, {
      ...event,
      event_id: "evt-2",
      kind: "accepted",
    });
    expect((await f.get(id)).row.status).toBe("delivered");
    expect((await f.get(id)).events).toHaveLength(2);
    await f.t.mutation(internal.communicationDelivery.delivery, {
      ...event,
      event_id: "evt-3",
      kind: "hard_bounce",
    });
    expect((await f.get(id)).row.status).toBe("bounced");
    expect((await f.get(id)).eligibility.reasons).toContain("suppressed");
  });
  it("a webhook arriving before the provider response is linked later", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.claim(job);
    await f.t.mutation(internal.communicationDelivery.delivery, {
      event_id: "early",
      provider_id: "early-id",
      kind: "delivered",
      occurred_at: Date.now(),
    });
    await f.t.mutation(internal.communicationDelivery.outcome, {
      id: job,
      result: "accepted",
      provider_id: "early-id",
      code: "accepted",
    });
    expect((await f.get(id)).row.status).toBe("delivered");
  });
  it("unmatched provider events cannot target a communication by user-supplied ID", async () => {
    const f = await fixture(),
      id = await f.create();
    await f.t.mutation(internal.communicationDelivery.delivery, {
      event_id: "unmatched",
      provider_id: id,
      kind: "delivered",
      occurred_at: Date.now(),
    });
    expect((await f.get(id)).row.status).toBe("draft");
  });
  it("cancellation before claim prevents sending", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.c("sales").mutation(api.communications.cancel, {
      id,
      version: (await f.get(id)).row.version,
    });
    expect(await f.claim(job)).toBe(null);
  });
  it("stale draft versions reject changes", async () => {
    const f = await fixture(),
      id = await f.create();
    await expect(
      f.c("sales").mutation(api.communications.edit, {
        id,
        version: 0,
        subject: "Changed",
        body: "Changed",
      }),
    ).rejects.toThrow();
  });
  it("second-review policy cannot be self-approved", async () => {
    const f = await fixture();
    await f.consent();
    await f.c("owner").mutation(api.communications.saveSettings, {
      version: 1,
      signature: "Fictional Glara company test identity",
      secondary_approval: true,
      paused: false,
    });
    const id = await f.create();
    await expect(f.approve(id)).rejects.toThrow();
    expect(
      (
        await f.c("owner").mutation(api.communications.approve, {
          id,
          version: 1,
          review_token: (await f.get(id)).eligibility.review_token,
        })
      ).allowed,
    ).toBe(true);
  });
  it("unsubscribe is idempotent and excludes essential transactional scope", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.claim(job);
    await f.t.mutation(internal.communicationDelivery.unsubscribe, {
      token_hash: "a".repeat(64),
    });
    await f.t.mutation(internal.communicationDelivery.unsubscribe, {
      token_hash: "a".repeat(64),
    });
    expect((await f.get(id)).eligibility.reasons).toContain("unsubscribed");
    const prefs = await f.t.run((ctx) =>
      ctx.db.query("communication_preferences").collect(),
    );
    expect(prefs).toHaveLength(1);
    expect(covers(prefs[0].scope, "transactional")).toBe(false);
  });
  it("template changes invalidate existing approval and preserve the old version", async () => {
    const f = await fixture();
    await f.consent();
    const template = await f
      .c("owner")
      .mutation(api.communications.saveTemplate, {
        key: "followup",
        name: "Follow-up",
        category: "sales_relationship",
        subject: "Hello {{recipient_name}}",
        body: "Fictional first version",
        version: 0,
        active: true,
      });
    const id = await f.create({ template_version_id: template });
    await f.approve(id);
    const job = await f.queue(id);
    await f.c("owner").mutation(api.communications.saveTemplate, {
      key: "followup",
      name: "Follow-up",
      category: "sales_relationship",
      subject: "New subject",
      body: "Fictional second version",
      version: 1,
      active: true,
    });
    expect(await f.claim(job)).toBe(null);
    expect((await f.get(id)).row.snapshot?.body).toBe(
      "Fictional first version",
    );
  });
});
describe("M9 provider contracts", () => {
  it("rejects header injection", () => {
    expect(
      content.safeParse({
        subject: "Hello\r\nBcc: nobody@example.test",
        body: "test",
      }).success,
    ).toBe(false);
  });
  it("late sent cannot downgrade delivered; complaint remains terminal", () => {
    expect(deliveryState("delivered", "accepted")).toBe("delivered");
    expect(deliveryState("bounced", "delivered")).toBe("bounced");
  });
  it("timeout is an uncertain outcome", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));
    const p = new ResendProvider({
      key: "fictional-test-key",
      from: "sender@example.test",
      replyTo: "reply@example.test",
    });
    expect(
      (
        await p.sendEmail({
          key: "fictional-key",
          to: "recipient@example.test",
          subject: "Test",
          text: "Test",
        })
      ).result,
    ).toBe("unknown");
  });
  it("429 allows bounded queue retry while 500 does not assume rejection", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response("", { status: 429 }))
      .mockResolvedValueOnce(new Response("", { status: 500 }));
    vi.stubGlobal("fetch", request);
    const p = new ResendProvider({
        key: "fictional-test-key",
        from: "sender@example.test",
        replyTo: "reply@example.test",
      }),
      input = {
        key: "fictional-key",
        to: "recipient@example.test",
        subject: "Test",
        text: "Test",
      };
    expect((await p.sendEmail(input)).result).toBe("retryable");
    expect((await p.sendEmail(input)).result).toBe("unknown");
  });
  it("calendar projection has no attendees, private notes or financial fields", () => {
    const payload = calendarPayload(
      {
        title: "GLS-TEST staging",
        location: "Fictional street",
        start: "2026-11-01T09:00:00Z",
        end: "2026-11-01T10:00:00Z",
        cancelled: false,
        revision: 1,
      },
      "fictional-id",
    );
    expect(payload.start).toEqual({
      dateTime: "2026-11-01T09:00:00Z",
      timeZone: "America/Vancouver",
    });
    expect(payload).not.toHaveProperty("attendees");
  });
  it("all-day dates stay date-only across DST", () => {
    const payload = calendarPayload(
      {
        title: "Fictional",
        location: "",
        start: "2026-11-01",
        end: "2026-11-02",
        cancelled: false,
        revision: 1,
      },
      "fictional-id",
    );
    expect(payload.start).toEqual({ date: "2026-11-01" });
    expect(payload.end).toEqual({ date: "2026-11-02" });
  });
  it("provider date-time offset representation compares as the same instant", () => {
    expect(
      matchesProjection(
        {
          id: "fictional",
          etag: "fictional",
          summary: "Test",
          start: { dateTime: "2026-11-01T01:00:00-08:00" },
          end: { dateTime: "2026-11-01T02:00:00-08:00" },
          extendedProperties: { private: { glara: "m9" } },
        },
        {
          title: "Test",
          location: "",
          start: "2026-11-01T09:00:00Z",
          end: "2026-11-01T10:00:00Z",
          cancelled: false,
          revision: 1,
        },
      ),
    ).toBe(true);
  });
});
describe("M9 calendar projection boundaries", () => {
  it("repeated sync reuses one mapping and conflicts never mutate the business event", async () => {
    vi.stubEnv("M9_GOOGLE_CALENDAR_ID", "fictional-calendar@example.test");
    vi.stubEnv("M9_CALENDAR_ENABLED", "true");
    const f = await operationsFixture(),
      project = await f.create();
    await f.ready(project);
    await f.schedule(project);
    const event = await f.t.run((ctx) =>
      ctx.db
        .query("operations_events")
        .withIndex("by_project", (q) => q.eq("project_id", project))
        .first(),
    );
    const source = { type: "operations_event" as const, id: event!._id };
    await f
      .c("owner")
      .mutation(api.calendarSync.configure, { enabled: true, version: 0 });
    const first = await f
      .c("owner")
      .mutation(api.calendarSync.prepare, { source });
    await expect(
      f.c("owner").mutation(api.calendarSync.prepare, { source }),
    ).rejects.toThrow();
    await f.t.mutation(internal.calendarSync.finish, {
      id: first.id,
      version: first.revision,
      actor_id: f.who("owner").id,
      external_id: "fictional-external",
      status: "synced",
      etag: "revision-a",
      code: "synced",
    });
    const second = await f
      .c("owner")
      .mutation(api.calendarSync.prepare, { source });
    expect(second.id).toBe(first.id);
    await f.t.mutation(internal.calendarSync.finish, {
      id: second.id,
      version: second.revision,
      actor_id: f.who("owner").id,
      external_id: "fictional-external",
      status: "conflict",
      etag: "revision-b",
      code: "external_event_changed",
    });
    expect(await f.t.run((ctx) => ctx.db.get(event!._id))).toEqual(event);
    const projections = (await f.c("owner").query(api.calendarSync.list, {}))
      .projections;
    expect(projections).toHaveLength(1);
    expect(projections[0].status).toBe("conflict");
    await f.c("owner").mutation(api.calendarSync.resolve, {
      id: first.id,
      version: projections[0].version,
      resolution: "keep_glara",
    });
    expect(
      (await f.c("owner").mutation(api.calendarSync.prepare, { source })).etag,
    ).toBe("revision-b");
  });
  it.each(["sales", "marketing", "designer", "staging_crew"] as const)(
    "%s cannot access the administrative external calendar",
    async (role) => {
      const f = await operationsFixture();
      await expect(
        f.c(role).query(api.calendarSync.list, {}),
      ).rejects.toThrow();
    },
  );
  it("cannot configure a personal primary calendar", async () => {
    vi.stubEnv("M9_GOOGLE_CALENDAR_ID", "primary");
    const f = await operationsFixture();
    await expect(
      f
        .c("owner")
        .mutation(api.calendarSync.configure, { enabled: true, version: 0 }),
    ).rejects.toThrow();
  });
});
describe("M9 additional release safeguards", () => {
  it("a draft does not complete an M7-linked activity", async () => {
    const f = await fixture();
    const activity = await f.t.run((ctx) =>
      ctx.db
        .query("activities")
        .withIndex("by_opportunity", (q) => q.eq("opportunity_id", f.oid))
        .first(),
    );
    const source = { type: "opportunity" as const, id: f.oid };
    await f.create({ source, activity_id: activity!._id });
    expect((await f.t.run((ctx) => ctx.db.get(activity!._id)))?.status).toBe(
      "open",
    );
  });
  it("a late accepted event cannot reuse another communication provider mapping", async () => {
    const f = await fixture();
    await f.consent();
    const first = await f.create();
    await f.approve(first);
    const firstJob = await f.queue(first);
    await f.claim(firstJob);
    await f.t.mutation(internal.communicationDelivery.outcome, {
      id: firstJob,
      result: "accepted",
      provider_id: "unique-provider",
      code: "accepted",
    });
    await f.t.run((ctx) => ctx.db.patch(first, { updated_at: 0 }));
    const second = await f.create();
    await f.approve(second);
    const secondJob = await f.queue(second);
    await f.claim(secondJob);
    await f.t.mutation(internal.communicationDelivery.outcome, {
      id: secondJob,
      result: "accepted",
      provider_id: "unique-provider",
      code: "accepted",
    });
    expect((await f.get(second)).row.status).toBe("queued");
  });
  it("safe rate-limit retries reuse exact text and one unsubscribe token", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id),
      first = await f.claim(job);
    await f.t.mutation(internal.communicationDelivery.outcome, {
      id: job,
      result: "retryable",
      code: "rate_limited",
    });
    await f.t.run((ctx) => ctx.db.patch(job, { next_attempt_at: 0 }));
    const second = await f.t.mutation(internal.communicationDelivery.claim, {
      id: job,
      token_hash: "b".repeat(64),
      unsubscribe_url: "https://example.test/changed",
    });
    expect(second?.body).toBe(first?.body);
    expect(
      await f.t.run((ctx) =>
        ctx.db.query("communication_unsubscribe_tokens").collect(),
      ),
    ).toHaveLength(1);
  });
  it("suppression revocation preserves evidence and records the actor", async () => {
    const f = await fixture();
    const id = await f.c("owner").mutation(api.communications.suppress, {
      email: "m9-fictional@example.test",
      scope: "all_optional",
      reason: "Fictional compliance review",
    });
    await f.c("owner").mutation(api.communications.revokeSuppression, {
      id,
      reason: "Fictional verified correction",
    });
    const row = await f.t.run((ctx) => ctx.db.get(id));
    expect(row?.reason).toBe("Fictional compliance review");
    expect(row?.revoked_by).toBe(f.who("owner").id);
  });
  it("scheduled sends wait for their due time", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.c("sales").mutation(api.communications.approve, {
      id,
      version: 1,
      review_token: (await f.get(id)).eligibility.review_token,
      scheduled_at: Date.now() + 86400000,
    });
    expect(await f.claim(await f.queue(id))).toBe(null);
  });
  it("invalid unsubscribe tokens cannot create preferences", async () => {
    const f = await fixture();
    await f.t.mutation(internal.communicationDelivery.unsubscribe, {
      token_hash: "invalid",
    });
    expect(
      await f.t.run((ctx) =>
        ctx.db.query("communication_preferences").collect(),
      ),
    ).toHaveLength(0);
  });
  it("public unsubscribe mutation work is bounded by a global rate limit", async () => {
    const f = await fixture();
    await f.t.run((ctx) =>
      ctx.db.insert("communication_public_limits", {
        key: "unsubscribe",
        window: Math.floor(Date.now() / 60000),
        count: 120,
      }),
    );
    expect(
      await f.t.mutation(internal.communicationDelivery.publicLimit, {}),
    ).toBe(false);
  });
});
import { createHmac } from "node:crypto";
describe("M9 webhook verification", () => {
  it("accepts signed events and rejects invalid signatures and expired timestamps", async () => {
    const f = await fixture(),
      secretBytes = Buffer.from("fictional-webhook-signing-fixture-32"),
      secret = "whsec_" + secretBytes.toString("base64");
    vi.stubEnv("M9_RESEND_WEBHOOK_SECRET", secret);
    const payload = JSON.stringify({
        type: "email.delivered",
        created_at: new Date().toISOString(),
        data: { email_id: "fictional-signed-email" },
      }),
      id = "fictional-signed-event",
      timestamp = String(Math.floor(Date.now() / 1000));
    const signature =
      "v1," +
      createHmac("sha256", secretBytes)
        .update(`${id}.${timestamp}.${payload}`)
        .digest("base64");
    expect(
      await f.t.action(internal.communicationProvider.verifyEvent, {
        id,
        timestamp,
        payload,
        signature,
      }),
    ).toBe(true);
    expect(
      await f.t.action(internal.communicationProvider.verifyEvent, {
        id,
        timestamp,
        payload,
        signature: "v1,invalid",
      }),
    ).toBe(false);
    const old = String(Number(timestamp) - 600),
      oldSignature =
        "v1," +
        createHmac("sha256", secretBytes)
          .update(`${id}.${old}.${payload}`)
          .digest("base64");
    expect(
      await f.t.action(internal.communicationProvider.verifyEvent, {
        id,
        timestamp: old,
        payload,
        signature: oldSignature,
      }),
    ).toBe(false);
    expect(
      await f.t.run((ctx) =>
        ctx.db.query("communication_delivery_events").collect(),
      ),
    ).toHaveLength(1);
  });
});
import { commercialFixture } from "../support/commercial-unit-fixture";
describe("M9 authoritative financial source", () => {
  it("an invoice paid after approval cannot dispatch a stale reminder", async () => {
    const f = await commercialFixture(),
      invoice = await f.manual("100");
    await f.issue(invoice);
    await f.t.run((ctx) =>
      ctx.db.patch(f.r.id as Id<"realtors">, { email: "realtor@example.test" }),
    );
    const source = { type: "invoice" as const, id: invoice },
      recipient = { type: "customer" as const, id: f.customer };
    await f.owner.mutation(api.communications.saveSettings, {
      version: 0,
      signature: "Fictional test sender, full local identity",
      secondary_approval: false,
      paused: false,
    });
    await f.owner.mutation(api.communications.recordConsent, {
      source,
      recipient,
      category: "transactional",
      scope: "transactional",
      basis: "transactional_service",
      evidence: "Fictional accepted service agreement",
      evidence_source: "Local test fixture",
      observed_at: Date.now(),
    });
    const template = await f.owner.mutation(api.communications.saveTemplate, {
      key: "invoice_reminder",
      name: "Invoice reminder",
      category: "transactional",
      subject: "Invoice {{number}}",
      body: "Balance: {{balance_cents}} cents. Due: {{due_date}}",
      version: 0,
      active: true,
    });
    const id = await f.owner.mutation(api.communications.create, {
      source,
      recipient,
      category: "transactional",
      subject: "Working reminder",
      body: "Working content",
      template_version_id: template,
      request_key: crypto.randomUUID(),
    });
    expect(
      (
        await f.owner.mutation(api.communications.approve, {
          id,
          version: 1,
          review_token: (await f.owner.query(api.communications.get, { id }))
            .eligibility.review_token,
        })
      ).allowed,
    ).toBe(true);
    const job = await f.owner.mutation(api.communications.enqueue, {
      id,
      version: 2,
    });
    await f.payment("100", [{ invoice_id: invoice, amount: "100" }]);
    expect(
      await f.t.mutation(internal.communicationDelivery.claim, {
        id: job,
        token_hash: "c".repeat(64),
        unsubscribe_url: "https://example.test/unsubscribe",
      }),
    ).toBe(null);
    const data = await f.owner.query(api.communications.get, { id });
    expect(data.row.status).toBe("needs_review");
    expect(data.eligibility.reasons).toContain("invoice_not_outstanding");
    expect(data.row.snapshot?.body).toContain("10000 cents");
  });
});
it("approval rejects a source change after the human review snapshot", async () => {
  const f = await fixture();
  await f.consent();
  const id = await f.create(),
    review = (await f.get(id)).eligibility.review_token;
  await f.t.run((ctx) =>
    ctx.db.patch(f.source.id, { email: "changed@example.test" }),
  );
  await expect(
    f.c("sales").mutation(api.communications.approve, {
      id,
      version: 1,
      review_token: review,
    }),
  ).rejects.toThrow();
  expect((await f.get(id)).row.status).toBe("draft");
});
it("read history survives clearing a contact email while new sending is blocked", async () => {
  const f = await fixture();
  await f.consent();
  const id = await f.create();
  await f.approve(id);
  const job = await f.queue(id);
  await f.claim(job);
  await f.t.mutation(internal.communicationDelivery.outcome, {
    id: job,
    result: "accepted",
    provider_id: "historical-email",
    code: "accepted",
  });
  await f.t.run((ctx) => ctx.db.patch(f.source.id, { email: null }));
  const data = await f.get(id);
  expect(data.row.snapshot?.email).toBe("m9-fictional@example.test");
  expect(data.eligibility.reasons).toContain("invalid_recipient_email");
});
it("source history does not disclose pagination metadata for denied sources", async () => {
  const f = await fixture();
  await f.create();
  await f.t.run((ctx) =>
    ctx.db.patch(f.source.id, { assigned_to: f.who("owner").id }),
  );
  const result = await f.c("sales").query(api.communications.list, {
    source: f.source,
    paginationOpts: { numItems: 1, cursor: null },
  });
  expect(result.page).toHaveLength(0);
  expect(result.isDone).toBe(true);
  expect(result.continueCursor).toBe("");
});
it("a client-supplied audit actor is rejected by the native function validator", async () => {
  const f = await fixture();
  await expect(f.create({ actor_id: f.who("owner").id })).rejects.toThrow();
});
it("unknown-delivery reconciliation validates provider content before recording acceptance", async () => {
  const f = await fixture();
  await f.consent();
  const id = await f.create();
  await f.approve(id);
  const job = await f.queue(id),
    claimed = await f.claim(job);
  await f.t.mutation(internal.communicationDelivery.outcome, {
    id: job,
    result: "unknown",
    code: "transport_uncertain",
  });
  const current = await f.t.run((ctx) => ctx.db.get(job));
  const remote = {
    id: "verified-provider-id",
    to: ["wrong@example.test"],
    from: `Glara Home Staging <${claimed!.from}>`,
    subject: claimed!.subject,
    text: claimed!.body,
    created_at: new Date(current!.claimed_at!).toISOString(),
  };
  const fetcher = vi
    .fn()
    .mockResolvedValueOnce(Response.json(remote))
    .mockResolvedValueOnce(
      Response.json({ ...remote, to: ["m9-fictional@example.test"] }),
    );
  vi.stubGlobal("fetch", fetcher);
  const args = {
    id,
    provider_id: remote.id,
    reason: "Fictional provider dashboard investigation",
  };
  expect(
    (
      await f
        .c("owner")
        .action(api.communicationProvider.reconcileUnknown, args)
    ).status,
  ).toBe("evidence_mismatch");
  expect((await f.get(id)).row.status).toBe("delivery_unknown");
  expect(
    (
      await f
        .c("owner")
        .action(api.communicationProvider.reconcileUnknown, args)
    ).status,
  ).toBe("verified_provider_acceptance");
  expect((await f.get(id)).row.status).toBe("sent");
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it("indexed search returns only authorized matching messages", async () => {
  const f = await fixture();
  const id = await f.create();
  const query = {
    search: "Fictional",
    paginationOpts: { numItems: 10, cursor: null },
  };
  expect(
    (await f.c("sales").query(api.communications.list, query)).page.map(
      (r) => r._id,
    ),
  ).toEqual([id]);
  expect(
    (await f.c("marketing").query(api.communications.list, query)).page,
  ).toHaveLength(0);
});
it("an exhausted recipient daily budget defers dispatch atomically", async () => {
  const f = await fixture();
  await f.consent();
  const id = await f.create();
  await f.approve(id);
  const job = await f.queue(id);
  await f.t.run((ctx) =>
    ctx.db.insert("communication_rate_buckets", {
      key: "recipient:m9-fictional@example.test",
      window: Math.floor(Date.now() / 86400000),
      count: 3,
    }),
  );
  expect(await f.claim(job)).toBe(null);
  expect((await f.t.run((ctx) => ctx.db.get(job)))?.last_code).toBe(
    "daily_limit",
  );
});
it("calendar events containing attendees are never treated as safe projections", () => {
  expect(
    matchesProjection(
      {
        id: "fictional",
        etag: "test",
        summary: "Test",
        attendees: [{ email: "guest@example.test" }],
        start: { date: "2026-11-01" },
        end: { date: "2026-11-02" },
        extendedProperties: { private: { glara: "m9" } },
      },
      {
        title: "Test",
        location: "",
        start: "2026-11-01",
        end: "2026-11-02",
        cancelled: false,
        revision: 1,
      },
    ),
  ).toBe(false);
});
