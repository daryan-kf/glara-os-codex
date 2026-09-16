import { operationsFixture } from "./operations-unit-fixture";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
export async function communicationFixture() {
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
