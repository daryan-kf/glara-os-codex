import { createHash } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { operationsFixture } from "../support/operations-unit-fixture";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import {
  render,
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
  const claim = async (id: Id<"communication_outbox">) => {
    const data = await f.t.mutation(internal.communicationDelivery.claim, {
      id,
      token_hash: "a".repeat(64),
      unsubscribe_url: "https://example.test/unsubscribe?token=fictional",
    });
    if (data)
      await f.t.mutation(internal.communicationDelivery.dispatch, {
        id,
        claim_version: data.claim_version,
      });
    return data;
  };
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
    tags: [
      {
        name: "glara_send",
        value: createHash("sha256").update(claimed!.send_key).digest("hex"),
      },
    ],
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
      key: "recipient:sales_relationship:m9-fictional@example.test",
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

describe("M9 complete specification hardening", () => {
  const reserve = (
    f: Awaited<ReturnType<typeof fixture>>,
    id: Id<"communication_outbox">,
  ) =>
    f.t.mutation(internal.communicationDelivery.claim, {
      id,
      token_hash: "c".repeat(64),
      unsubscribe_url: "https://example.test/unsubscribe",
    });
  it("rejects relabeling optional relationship outreach as transactional even for Owner", async () => {
    const f = await fixture();
    await expect(
      f.c("owner").mutation(api.communications.create, {
        source: f.source,
        recipient: f.source,
        category: "transactional",
        subject: "Fictional",
        body: "Fictional",
        request_key: crypto.randomUUID(),
      }),
    ).rejects.toThrow();
  });
  it("deduplicates equivalent M7 handoffs across different request keys", async () => {
    const f = await fixture();
    const activity = await f.t.run((ctx) =>
      ctx.db
        .query("activities")
        .withIndex("by_opportunity", (q) => q.eq("opportunity_id", f.oid))
        .first(),
    );
    const fields = {
      source: { type: "opportunity", id: f.oid },
      activity_id: activity!._id,
    };
    const first = await f.create(fields);
    expect(await f.create(fields)).toBe(first);
    expect((await f.t.run((ctx) => ctx.db.get(activity!._id)))?.status).toBe(
      "open",
    );
  });
  it("reclaims an expired unused lease, and rejects the stale worker's dispatch fence", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    const first = await reserve(f, job);
    await f.t.run((ctx) => ctx.db.patch(job, { lease_until: 0 }));
    expect(await f.t.mutation(internal.communicationDelivery.sweep, {})).toBe(
      1,
    );
    expect((await f.t.run((ctx) => ctx.db.get(job)))?.status).toBe("ready");
    const second = await reserve(f, job);
    expect(
      await f.t.mutation(internal.communicationDelivery.dispatch, {
        id: job,
        claim_version: first!.claim_version,
      }),
    ).toBe(false);
    expect(
      await f.t.mutation(internal.communicationDelivery.dispatch, {
        id: job,
        claim_version: second!.claim_version,
      }),
    ).toBe(true);
    expect(
      await f.t.mutation(internal.communicationDelivery.dispatch, {
        id: job,
        claim_version: second!.claim_version,
      }),
    ).toBe(false);
  });
  it.each(["consent", "suppression", "email", "pause", "role"])(
    "blocks %s change after claim but before dispatch",
    async (kind) => {
      const f = await fixture();
      const consent = await f.consent();
      const id = await f.create();
      await f.approve(id);
      const job = await f.queue(id);
      const reserved = await reserve(f, job);
      if (kind === "consent")
        await f.c("owner").mutation(api.communications.revokeConsent, {
          id: consent,
          reason: "Fictional consent withdrawn",
        });
      if (kind === "suppression")
        await f.c("owner").mutation(api.communications.suppress, {
          email: "m9-fictional@example.test",
          scope: "all_optional",
          reason: "Fictional stop request",
        });
      if (kind === "email")
        await f.t.run((ctx) =>
          ctx.db.patch(f.source.id, { email: "replacement@example.test" }),
        );
      if (kind === "pause") vi.stubEnv("M9_EMAIL_ENABLED", "false");
      if (kind === "role")
        await f.t.run(async (ctx) => {
          const p = await ctx.db
            .query("profiles")
            .withIndex("by_user", (q) => q.eq("userId", f.who("sales").id))
            .unique();
          await ctx.db.patch(p!._id, { roles: ["designer"] });
        });
      expect(
        await f.t.mutation(internal.communicationDelivery.dispatch, {
          id: job,
          claim_version: reserved!.claim_version,
        }),
      ).toBe(false);
      expect((await f.t.run((ctx) => ctx.db.get(job)))?.attempts).toBe(0);
    },
  );
  it("refuses fabricated outcomes for a lease never dispatched", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await reserve(f, job);
    await f.t.mutation(internal.communicationDelivery.outcome, {
      id: job,
      result: "accepted",
      provider_id: "fictional-forged",
      code: "accepted",
    });
    expect((await f.get(id)).row.status).toBe("queued");
  });
  it("preserves dispatched snapshots after a known rejection and stale source", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.claim(job);
    const snapshot = (await f.get(id)).row.snapshot;
    await f.t.mutation(internal.communicationDelivery.outcome, {
      id: job,
      result: "retryable",
      code: "rate_limited",
    });
    await f.t.run(async (ctx) => {
      await ctx.db.patch(job, { next_attempt_at: 0 });
      await ctx.db.patch(f.source.id, { email: "changed@example.test" });
    });
    expect(await f.claim(job)).toBe(null);
    const row = (await f.get(id)).row;
    expect(row.status).toBe("failed");
    expect(row.snapshot).toEqual(snapshot);
    await expect(
      f.c("sales").mutation(api.communications.edit, {
        id,
        version: row.version,
        subject: "Changed",
        body: "Changed",
      }),
    ).rejects.toThrow();
  });
  it("complaint suppresses optional scope without pretending all transactional service is forbidden", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.claim(job);
    await f.t.mutation(internal.communicationDelivery.outcome, {
      id: job,
      result: "accepted",
      provider_id: "complaint-test",
      code: "accepted",
    });
    await f.t.mutation(internal.communicationDelivery.delivery, {
      provider_id: "complaint-test",
      event_id: "complaint-event",
      kind: "complaint",
      occurred_at: Date.now(),
    });
    const suppression = await f.t.run((ctx) =>
      ctx.db.query("communication_suppressions").first(),
    );
    expect(suppression?.scope).toBe("all_optional");
    await expect(
      f.c("owner").mutation(api.communications.revokeSuppression, {
        id: suppression!._id,
        reason: "Attempt unsafe override",
      }),
    ).rejects.toThrow();
  });
  it("revoking a token generation invalidates old links without clearing existing preferences", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    await f.claim(await f.queue(id));
    const config = await f
      .c("owner")
      .query(api.communications.configuration, {});
    await f
      .c("owner")
      .mutation(api.communications.rotateUnsubscribeGeneration, {
        version: config.config!.version,
        reason: "Fictional compromised token rotation",
      });
    await f.t.mutation(internal.communicationDelivery.unsubscribe, {
      token_hash: "a".repeat(64),
    });
    expect(
      await f.t.run((ctx) =>
        ctx.db.query("communication_preferences").collect(),
      ),
    ).toHaveLength(0);
  });
  it("paginates delivery history and rejects oversized reads and unauthorized users", async () => {
    const f = await fixture();
    const id = await f.create();
    await f.t.run(async (ctx) => {
      for (let i = 0; i < 27; i++)
        await ctx.db.insert("communication_delivery_events", {
          communication_id: id,
          provider_id: "fictional",
          event_id: `page-${i}`,
          kind: "accepted",
          occurred_at: i,
          created_at: i,
        });
    });
    const first = await f.c("sales").query(api.communications.deliveryHistory, {
      id,
      paginationOpts: { numItems: 20, cursor: null },
    });
    const second = await f
      .c("sales")
      .query(api.communications.deliveryHistory, {
        id,
        paginationOpts: { numItems: 20, cursor: first.continueCursor },
      });
    expect(first.page).toHaveLength(20);
    expect(second.page).toHaveLength(7);
    expect(second.isDone).toBe(true);
    await expect(
      f.c("marketing").query(api.communications.deliveryHistory, {
        id,
        paginationOpts: { numItems: 20, cursor: null },
      }),
    ).rejects.toThrow();
    await expect(
      f.c("owner").query(api.communications.deliveryHistory, {
        id,
        paginationOpts: { numItems: 500, cursor: null },
      }),
    ).rejects.toThrow();
  });
  it("detects missing provenance without repairing business truth", async () => {
    const f = await fixture(),
      id = await f.create();
    await f.t.run((ctx) => ctx.db.patch(id, { status: "delivered" }));
    const report = await f.c("owner").query(api.communications.reconcilePage, {
      paginationOpts: { numItems: 25, cursor: null },
    });
    expect(report.page[0].issues).toContain("missing_provider_evidence");
    await expect(
      f.c("sales").query(api.communications.reconcilePage, {
        paginationOpts: { numItems: 25, cursor: null },
      }),
    ).rejects.toThrow();
  });
  it("disabling a template invalidates an approved queued message", async () => {
    const f = await fixture();
    await f.consent();
    await f.c("owner").mutation(api.communications.saveTemplate, {
      key: "disable-check",
      name: "Fictional",
      category: "sales_relationship",
      subject: "Hello {{recipient_name}}",
      body: "Fictional message",
      version: 0,
      active: true,
    });
    const template = (
      await f.c("owner").query(api.communications.templates, {})
    )[0];
    const id = await f.create({ template_version_id: template.current!._id });
    await f.approve(id);
    const job = await f.queue(id);
    await f.c("owner").mutation(api.communications.setTemplateActive, {
      id: template._id,
      version: template.version,
      active: false,
    });
    expect(await f.claim(job)).toBe(null);
  });
});

it.each([
  "{{Missing}}",
  "{{ recipient_name }}",
  "{{recipient_name}",
  "{other}",
  "{{recipient_name}} {{not_allowed}}",
])("rejects malformed or unresolved template %s", (value) => {
  expect(() => render(value, { recipient_name: "Fictional" })).toThrow();
});
it("two concurrent reviewers cannot approve different revisions", async () => {
  const f = await fixture();
  await f.consent();
  const id = await f.create(),
    reviewed = await f.get(id);
  const args = {
    id,
    version: reviewed.row.version,
    review_token: reviewed.eligibility.review_token,
  };
  const results = await Promise.allSettled([
    f.c("sales").mutation(api.communications.approve, args),
    f.c("owner").mutation(api.communications.approve, args),
  ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  expect((await f.get(id)).decisions).toHaveLength(1);
});
it.each(["unassigned", "revoked"])(
  "denies %s profiles at backend boundaries",
  async () => {
    const f = await fixture();
    await f.t.run(async (ctx) => {
      const p = await ctx.db
        .query("profiles")
        .withIndex("by_user", (q) => q.eq("userId", f.who("sales").id))
        .unique();
      await ctx.db.patch(p!._id, { roles: [] });
    });
    await expect(
      f.c("sales").query(api.communications.configuration, {}),
    ).rejects.toThrow();
  },
);
it("Owner retains immutable history after a source is archived but cannot approve another send", async () => {
  const f = await fixture();
  const id = await f.create();
  await f.t.run((ctx) =>
    ctx.db.patch(f.source.id, { deleted_at: new Date().toISOString() }),
  );
  const detail = await f.c("owner").query(api.communications.get, { id });
  expect(detail.row._id).toBe(id);
  expect(detail.eligibility.allowed).toBe(false);
  await expect(f.get(id)).rejects.toThrow();
});
it("due work continues across bounded batches without calling a provider", async () => {
  const f = await fixture();
  await f.consent();
  for (let i = 0; i < 12; i++) {
    const id = await f.create();
    await f.approve(id);
    await f.t.run(async (ctx) => {
      const row = await ctx.db.get(id);
      await ctx.db.patch(id, { status: "queued" });
      await ctx.db.insert("communication_outbox", {
        communication_id: id,
        send_key: row!.send_key,
        status: "ready",
        attempts: 0,
        next_attempt_at: 0,
        version: 1,
        created_at: i,
        updated_at: i,
      });
    });
  }
  const first = await f.t.query(internal.communicationDelivery.due, {});
  expect(first).toHaveLength(10);
  await f.t.run(async (ctx) => {
    for (const id of first) await ctx.db.patch(id, { status: "cancelled" });
  });
  expect(await f.t.query(internal.communicationDelivery.due, {})).toHaveLength(
    2,
  );
});
it("pauses after repeated provider failures and never requeues unknown jobs on resume", async () => {
  const f = await fixture();
  await f.consent();
  for (let i = 0; i < 3; i++) {
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.claim(job);
    await f.t.mutation(internal.communicationDelivery.outcome, {
      id: job,
      result: "unknown",
      code: "transport_uncertain",
    });
    await f.t.run((ctx) => ctx.db.patch(id, { updated_at: 0 }));
  }
  const health = await f
    .c("owner")
    .query(api.communications.operationsHealth, {});
  expect(health.paused).toBe(true);
  expect(health.consecutive_failures).toBe(3);
  expect(await f.t.query(internal.communicationDelivery.due, {})).toHaveLength(
    0,
  );
});
it("expired optional tokens cannot change preferences", async () => {
  const f = await fixture();
  await f.t.run((ctx) =>
    ctx.db.insert("communication_unsubscribe_tokens", {
      token_hash: "expired",
      recipient_key: `realtor:${f.source.id}`,
      scope: "all_optional",
      expires_at: 1,
      created_at: 0,
    }),
  );
  await f.t.mutation(internal.communicationDelivery.unsubscribe, {
    token_hash: "expired",
  });
  expect(
    await f.t.run((ctx) => ctx.db.query("communication_preferences").collect()),
  ).toHaveLength(0);
});
it("calendar OAuth, create, update and cancel contracts reuse a stable identity with no attendees", async () => {
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
  let remote: Record<string, unknown> | null = null;
  const methods: string[] = [],
    externalIds: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit = {}) => {
      if (url.includes("oauth2.googleapis.com")) {
        expect(String(init.body)).toContain("grant_type=refresh_token");
        return Response.json({ access_token: "fictional-contract-token" });
      }
      const method = init.method ?? "GET";
      methods.push(method);
      expect(url).toContain("sendUpdates=none");
      if (method === "GET")
        return remote
          ? Response.json(remote)
          : new Response(null, { status: 404 });
      if (method === "DELETE") {
        expect(init.headers).toHaveProperty("If-Match");
        remote = null;
        return new Response(null, { status: 204 });
      }
      const payload = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(payload).not.toHaveProperty("attendees");
      externalIds.push(String(payload.id));
      if (method === "PUT") expect(init.headers).toHaveProperty("If-Match");
      remote = { ...payload, etag: `revision-${methods.length}` };
      return Response.json(remote);
    }),
  );
  expect(
    (await f.c("owner").action(api.calendarProvider.sync, { source })).status,
  ).toBe("synced");
  await f.t.run((ctx) =>
    ctx.db.patch(event!._id, {
      start_at: "2026-11-01T09:00:00Z",
      end_at: "2026-11-01T10:00:00Z",
      version: event!.version + 1,
    }),
  );
  expect(
    (await f.c("owner").action(api.calendarProvider.sync, { source })).status,
  ).toBe("synced");
  await f.t.run((ctx) =>
    ctx.db.patch(event!._id, {
      status: "cancelled",
      version: event!.version + 2,
    }),
  );
  expect(
    (await f.c("owner").action(api.calendarProvider.sync, { source })).status,
  ).toBe("cancelled");
  expect(new Set(externalIds).size).toBe(1);
  expect(methods).toEqual(["GET", "POST", "GET", "PUT", "GET", "DELETE"]);
});
it("early bounce beyond one evidence batch still wins and history linking continues", async () => {
  const f = await fixture();
  await f.consent();
  const id = await f.create();
  await f.approve(id);
  const job = await f.queue(id);
  await f.claim(job);
  await f.t.run(async (ctx) => {
    for (let i = 0; i < 105; i++)
      await ctx.db.insert("communication_delivery_events", {
        provider_id: "large-early-history",
        event_id: `early-${i}`,
        kind: i === 104 ? "hard_bounce" : "accepted",
        occurred_at: i,
        created_at: i,
      });
  });
  await f.t.mutation(internal.communicationDelivery.outcome, {
    id: job,
    result: "accepted",
    provider_id: "large-early-history",
    code: "accepted",
  });
  expect((await f.get(id)).row.status).toBe("bounced");
  await f.t.mutation(internal.communicationDelivery.attachPendingEvidence, {
    provider_id: "large-early-history",
  });
  expect(
    await f.t.run((ctx) =>
      ctx.db
        .query("communication_delivery_events")
        .withIndex("by_unmapped", (q) =>
          q
            .eq("provider_id", "large-early-history")
            .eq("communication_id", undefined),
        )
        .collect(),
    ),
  ).toHaveLength(0);
});

it("provider failure is not hidden by an earlier or replayed acceptance event", () => {
  expect(deliveryState("sent", "failed")).toBe("failed");
  expect(deliveryState("failed", "accepted")).toBe("failed");
  expect(deliveryState("failed", "soft_bounce")).toBe("failed");
  expect(deliveryState("failed", "delivered")).toBe("delivered");
  expect(deliveryState("delivered", "failed")).toBe("delivered");
});

describe("M9 final reconciliation gates 330 and 331", () => {
  const page = { numItems: 25, cursor: null };
  it("allows a reviewed approval awaiting the human Send action", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const report = await f
      .c("owner")
      .query(api.communications.reconcilePage, { paginationOpts: page });
    expect(report.page.find((r) => r.id === id)?.issues).toEqual([]);
  });
  it("reports active optional communication against unsubscribe without changing records", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    await f.queue(id);
    await f.t.run((ctx) =>
      ctx.db.insert("communication_preferences", {
        recipient_key: `realtor:${f.source.id}`,
        channel: "email",
        scope: "all_optional",
        status: "unsubscribed",
        reason: "Fictional unsubscribe",
        created_at: Date.now(),
        updated_at: Date.now(),
        version: 1,
      }),
    );
    const before = await f.t.run((ctx) => ctx.db.get(id));
    const report = await f
      .c("owner")
      .query(api.communications.reconcilePage, { paginationOpts: page });
    expect(report.page.find((r) => r.id === id)?.issues).toContain(
      "active_optional_unsubscribed",
    );
    expect(await f.t.run((ctx) => ctx.db.get(id))).toEqual(before);
  });
  it("reports corrupted source/recipient keys and missing approval evidence", async () => {
    const f = await fixture();
    const id = await f.create();
    await f.t.run((ctx) =>
      ctx.db.patch(id, {
        source_key: "realtor:wrong",
        recipient_key: "realtor:wrong",
        status: "approved",
      }),
    );
    const report = await f
      .c("owner")
      .query(api.communications.reconcilePage, { paginationOpts: page });
    expect(report.page[0].issues).toEqual(
      expect.arrayContaining([
        "source_key_mismatch",
        "recipient_key_mismatch",
        "approval_snapshot_missing",
        "approval_evidence_missing",
      ]),
    );
  });
  it("reports duplicate provider mappings instead of throwing, including orphan provenance", async () => {
    const f = await fixture();
    const id = await f.create();
    await f.t.run(async (ctx) => {
      const row = await ctx.db.get(id);
      for (let i = 0; i < 2; i++)
        await ctx.db.insert("communication_provider_messages", {
          communication_id: id,
          provider: "resend",
          provider_id: "fictional-duplicate",
          send_key: row!.send_key,
          created_at: Date.now(),
        });
      await ctx.db.insert("communication_delivery_events", {
        communication_id: id,
        provider_id: "fictional-duplicate",
        event_id: "fictional-reconciliation-event",
        kind: "delivered",
        occurred_at: Date.now(),
        created_at: Date.now(),
      });
      await ctx.db.delete(id);
    });
    const report = await f
      .c("owner")
      .query(api.communications.providerReconcilePage, {
        paginationOpts: page,
      });
    expect(report.page).toHaveLength(2);
    for (const r of report.page)
      expect(r.issues).toEqual(
        expect.arrayContaining([
          "orphan_provider_mapping",
          "duplicate_provider_mapping",
        ]),
      );
    expect(
      (
        await f.c("owner").query(api.communications.eventReconcilePage, {
          paginationOpts: page,
        })
      ).page[0].mismatch,
    ).toBe(true);
  });
  it("reports orphan jobs, duplicate keys and expired claims", async () => {
    const f = await fixture();
    await f.consent();
    const id = await f.create();
    await f.approve(id);
    const job = await f.queue(id);
    await f.t.run(async (ctx) => {
      const row = await ctx.db.get(job);
      await ctx.db.insert("communication_outbox", {
        communication_id: id,
        send_key: row!.send_key,
        status: "claimed",
        attempts: 0,
        next_attempt_at: 0,
        lease_until: 0,
        created_at: 0,
        updated_at: 0,
        version: 1,
      });
      await ctx.db.delete(id);
    });
    const report = await f
      .c("owner")
      .query(api.communications.outboxReconcilePage, { paginationOpts: page });
    expect(
      report.page.every(
        (r) => r.orphan && r.issues.includes("duplicate_send_key"),
      ),
    ).toBe(true);
    expect(
      report.page.some((r) =>
        r.issues.includes("expired_lease_requires_recovery"),
      ),
    ).toBe(true);
  });
  it("does not accept a ready retry after an uncertain send as clean", async () => {
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
    await f.t.run(async (ctx) => {
      await ctx.db.patch(job, { status: "ready" });
      await ctx.db.patch(id, { status: "queued" });
    });
    const report = await f
      .c("owner")
      .query(api.communications.reconcilePage, { paginationOpts: page });
    expect(report.page[0].issues).toContain("unsafe_retry_state");
  });
  it("requires a completed dispatched job before accepting mapped provider provenance", async () => {
    const f = await fixture();
    const id = await f.create();
    await f.t.run(async (ctx) => {
      const row = await ctx.db.get(id);
      await ctx.db.insert("communication_provider_messages", {
        communication_id: id,
        provider: "resend",
        provider_id: "fictional-unproven",
        send_key: row!.send_key,
        created_at: Date.now(),
      });
    });
    const report = await f
      .c("owner")
      .query(api.communications.reconcilePage, { paginationOpts: page });
    expect(report.page[0].issues).toContain(
      "provider_dispatch_provenance_missing",
    );
  });
  it.each(["sales", "marketing", "designer", "staging_crew"] as const)(
    "denies %s access to the provider reconciliation scan",
    async (role) => {
      const f = await fixture();
      await expect(
        f.c(role).query(api.communications.providerReconcilePage, {
          paginationOpts: page,
        }),
      ).rejects.toThrow();
    },
  );
  it("denies anonymous provider reconciliation and oversized pages", async () => {
    const f = await fixture();
    await expect(
      f.t.query(api.communications.providerReconcilePage, {
        paginationOpts: page,
      }),
    ).rejects.toThrow();
    await expect(
      f.c("owner").query(api.communications.providerReconcilePage, {
        paginationOpts: { numItems: 26, cursor: null },
      }),
    ).rejects.toThrow();
  });
  it("reports calendar source and connection mismatches without modifying M3", async () => {
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
    await f
      .c("owner")
      .mutation(api.calendarSync.configure, { enabled: true, version: 0 });
    const projection = await f.c("owner").mutation(api.calendarSync.prepare, {
      source: { type: "operations_event", id: event!._id },
    });
    await f.t.run(async (ctx) => {
      const row = await ctx.db.get(projection.id);
      await ctx.db.delete(row!.connection_id);
      await ctx.db.patch(projection.id, {
        source_key: "operations_event:wrong",
        lease_until: 0,
      });
    });
    const report = await f
      .c("owner")
      .query(api.calendarSync.reconcilePage, { paginationOpts: page });
    expect(report.page[0].issues).toEqual(
      expect.arrayContaining([
        "source_key_mismatch",
        "connection_unavailable",
        "expired_sync_requires_reconciliation",
      ]),
    );
    expect(await f.t.run((ctx) => ctx.db.get(event!._id))).toEqual(event);
  });
});
it("final reconciliation detects a status that understates verified delivery", async () => {
  const f = await fixture();
  await f.consent();
  const id = await f.create();
  await f.approve(id);
  const job = await f.queue(id);
  await f.claim(job);
  await f.t.mutation(internal.communicationDelivery.outcome, {
    id: job,
    result: "accepted",
    provider_id: "fictional-verified-delivery",
    code: "accepted",
  });
  await f.t.mutation(internal.communicationDelivery.delivery, {
    provider_id: "fictional-verified-delivery",
    event_id: "fictional-delivery-reconciliation",
    kind: "delivered",
    occurred_at: Date.now(),
  });
  await f.t.run((ctx) => ctx.db.patch(id, { status: "sent" }));
  const report = await f.c("owner").query(api.communications.reconcilePage, {
    paginationOpts: { numItems: 25, cursor: null },
  });
  expect(report.page[0].issues).toContain("delivery_status_mismatch");
});

describe("M9 deferred Calendar fails closed", () => {
  it.each(["false", undefined])(
    "flag %s prevents OAuth and Calendar provider calls even with an enabled connection",
    async (flag) => {
      vi.stubEnv("M9_GOOGLE_CALENDAR_ID", "fictional-calendar@example.test");
      vi.stubEnv("M9_CALENDAR_ENABLED", flag);
      vi.stubEnv("M9_GOOGLE_CLIENT_ID", undefined);
      vi.stubEnv("M9_GOOGLE_CLIENT_SECRET", undefined);
      vi.stubEnv("M9_GOOGLE_REFRESH_TOKEN", undefined);
      const request = vi.fn(() => {
        throw new Error("Provider must not be contacted");
      });
      vi.stubGlobal("fetch", request);
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
      await f
        .c("owner")
        .mutation(api.calendarSync.configure, { enabled: true, version: 0 });
      await expect(
        f.c("owner").action(api.calendarProvider.sync, {
          source: { type: "operations_event", id: event!._id },
        }),
      ).rejects.toThrow("disabled");
      expect(request).not.toHaveBeenCalled();
      expect(await f.t.run((ctx) => ctx.db.get(event!._id))).toEqual(event);
      expect(
        (await f.c("owner").query(api.calendarSync.list, {})).projections,
      ).toHaveLength(0);
    },
  );
});
