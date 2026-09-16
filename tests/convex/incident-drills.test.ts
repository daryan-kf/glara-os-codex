import { afterEach, expect, it, vi } from "vitest";
import { api, internal } from "../../convex/_generated/api";
import { operationsFixture } from "../support/operations-unit-fixture";
import { communicationFixture } from "../support/communication-unit-fixture";
import { commercialFixture } from "../support/commercial-unit-fixture";
import { defaults, scopeSchema } from "../../src/lib/ai/model";
import { applySource } from "../../convex/analyticsLedger";
import { sourceProjection } from "../../convex/analyticsSources";

const page = { numItems: 25, cursor: null };
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function emailEnvironment() {
  vi.stubEnv("M9_EMAIL_ENABLED", "true");
  vi.stubEnv("M9_EMAIL_VERIFIED", "true");
  vi.stubEnv(
    "M9_EMAIL_TEST_ALLOWLIST",
    [
      "m9-fictional@example.test",
      ...Array.from({ length: 4 }, (_, i) => `incident-${i}@example.test`),
    ].join(","),
  );
  vi.stubEnv("M9_RESEND_KEY", "fictional-incident-provider-key");
  vi.stubEnv(
    "M9_UNSUBSCRIBE_SECRET",
    "fictional-incident-unsubscribe-material",
  );
  vi.stubEnv("M9_PUBLIC_HTTP_ORIGIN", "https://fictional.convex.site");
}
const newRealtor = (assigned_to: string) =>
  JSON.stringify({
    op: "realtor_create",
    data: {
      assigned_to,
      first_name: "Fictional",
      last_name: "Incident drill",
      relationship_status: "active_partner",
    },
  });

async function incidentDraft(
  f: Awaited<ReturnType<typeof communicationFixture>>,
  index: number,
) {
  const row = await f.c("sales").mutation(api.crm.write, {
    input: JSON.stringify({
      op: "realtor_create",
      data: {
        assigned_to: f.who("sales").id,
        first_name: "Fictional",
        last_name: `Incident ${index}`,
        relationship_status: "active_partner",
        email: `incident-${index}@example.test`,
      },
    }),
  });
  const source = {
    type: "realtor" as const,
    id: row.id as import("../../convex/_generated/dataModel").Id<"realtors">,
  };
  await f.c("owner").mutation(api.communications.recordConsent, {
    source,
    recipient: source,
    category: "sales_relationship",
    scope: "sales_relationship",
    basis: "express_consent",
    evidence: "Fictional incident drill consent",
    evidence_source: "Local isolated test",
    observed_at: Date.now(),
  });
  return f.create({
    source,
    recipient: source,
    subject: `Fictional incident ${index}`,
  });
}

it("IR-A compromised Sales archival denies existing-session CRM/M8/M9 access and preserves evidence", async () => {
  const f = await operationsFixture();
  const before = await f.t.run((ctx) => ctx.db.query("audit_logs").collect());
  const assigned = await f.t.run(async (ctx) => ({
    realtor: await ctx.db.get(
      f.r.id as import("../../convex/_generated/dataModel").Id<"realtors">,
    ),
    opportunity: await ctx.db.get(f.oid),
  }));
  expect(assigned.realtor?.assigned_to).toBe(f.who("sales").id);
  expect(assigned.opportunity?.assigned_to).toBe(f.who("sales").id);
  await f.t.mutation(internal.admin.setProfile, {
    userId: f.who("sales").id,
    name: "Fictional compromised Sales",
    roles: ["sales"],
    archived: true,
  });
  const fetchSpy = vi.fn(() => {
    throw Error("Drill must not call providers");
  });
  vi.stubGlobal("fetch", fetchSpy);
  for (const denied of [
    () => f.c("sales").query(api.sales.getOpportunity, { id: f.oid }),
    () =>
      f
        .c("sales")
        .mutation(api.crm.write, { input: newRealtor(f.who("sales").id) }),
    () => f.c("sales").query(api.ai.settings, {}),
    () =>
      f.c("sales").mutation(api.ai.request, {
        input: JSON.stringify({
          request_key: crypto.randomUUID(),
          scope: scopeSchema.parse({ feature: "realtor", entity_id: f.r.id }),
          question: "Summarize this realtor",
        }),
      }),
    () => f.c("sales").query(api.communications.configuration, {}),
    () =>
      f.c("sales").mutation(api.communications.create, {
        source: { type: "opportunity", id: f.oid },
        recipient: {
          type: "realtor",
          id: f.r
            .id as import("../../convex/_generated/dataModel").Id<"realtors">,
        },
        category: "sales_relationship",
        subject: "Fictional",
        body: "Fictional incident",
        request_key: crypto.randomUUID(),
      }),
  ])
    await expect(denied()).rejects.toThrow();
  expect(fetchSpy).not.toHaveBeenCalled();
  expect(
    (await f.c("owner").query(api.sales.getOpportunity, { id: f.oid }))
      ?.opportunity._id,
  ).toBe(f.oid);
  const after = await f.t.run((ctx) => ctx.db.query("audit_logs").collect());
  for (const row of before)
    expect(after.find((x) => x._id === row._id)).toEqual(row);
  expect(
    after.some(
      (x) => x.entity === "profiles" && x.entity_id === f.who("sales").id,
    ),
  ).toBe(true);
  expect(await f.t.run((ctx) => ctx.db.get(f.who("sales").id))).not.toBeNull();
});

it("IR-B email storm containment pauses a bounded queue and preserves clean reconciliation without sending", async () => {
  emailEnvironment();
  const f = await communicationFixture();
  await f.consent();
  const jobs = [];
  for (let i = 0; i < 4; i++) {
    const id = await incidentDraft(f, i);
    await f.approve(id);
    jobs.push(await f.queue(id));
    expect(await f.queue(id)).toBe(jobs[i]);
  }
  const config = (
    await f.c("owner").query(api.communications.configuration, {})
  ).config!;
  const pause = {
    version: config.version,
    signature: config.signature,
    secondary_approval: config.secondary_approval,
    paused: true,
  };
  await expect(
    f.t.mutation(api.communications.saveSettings, pause),
  ).rejects.toThrow();
  await expect(
    f.c("sales").mutation(api.communications.saveSettings, pause),
  ).rejects.toThrow();
  await f.c("owner").mutation(api.communications.saveSettings, pause);
  vi.stubEnv("M9_EMAIL_ENABLED", "false");
  const spy = vi.fn(async (): Promise<Response> => {
    throw Error("No external sends in drill");
  });
  vi.stubGlobal("fetch", spy);
  await f.t.action(internal.communicationProvider.tick, {});
  expect(spy).not.toHaveBeenCalled();
  const health = await f
    .c("owner")
    .query(api.communications.operationsHealth, {});
  expect(health.paused).toBe(true);
  expect(health.enabled).toBe(false);
  expect(
    (await f.c("owner").query(api.communications.queueHealth, {})).find(
      (x) => x.state === "ready",
    )?.count,
  ).toBe(4);
  for (const job of jobs)
    expect((await f.t.run((ctx) => ctx.db.get(job)))?.attempts).toBe(0);
  const report = await f
    .c("owner")
    .query(api.communications.reconcilePage, { paginationOpts: page });
  expect(report.page).toHaveLength(4);
  expect(report.page.every((x) => x.issues.length === 0)).toBe(true);
  await f.c("owner").mutation(api.communications.saveSettings, {
    ...pause,
    version: config.version + 1,
    paused: false,
  });
  await f.t.action(internal.communicationProvider.tick, {});
  expect(spy).not.toHaveBeenCalled(); // Removing the app pause cannot override the disabled environment.
  expect(
    await f.t.run((ctx) => ctx.db.query("communication_outbox").collect()),
  ).toHaveLength(4);
  // Controlled recovery uses only a stubbed provider; no process/hosted flag is changed.
  spy.mockImplementation(
    async () =>
      new Response(
        JSON.stringify({ id: `fictional-recovered-${spy.mock.calls.length}` }),
        { status: 200 },
      ),
  );
  vi.stubEnv("M9_EMAIL_ENABLED", "true");
  await f.t.action(internal.communicationProvider.tick, {});
  expect(spy).toHaveBeenCalledTimes(4);
  await f.t.action(internal.communicationProvider.tick, {});
  expect(spy).toHaveBeenCalledTimes(4);
  for (const job of jobs)
    expect((await f.t.run((ctx) => ctx.db.get(job)))?.status).toBe("complete");
  const recovered = await f
    .c("owner")
    .query(api.communications.reconcilePage, { paginationOpts: page });
  expect(recovered.page.every((x) => x.issues.length === 0)).toBe(true);
  vi.stubEnv("M9_EMAIL_ENABLED", "false");
});

it("IR-D Resend 503 becomes unknown delivery, opens the circuit and does not retry on recovery", async () => {
  emailEnvironment();
  const f = await communicationFixture();
  await f.consent();
  const jobs = [];
  for (let i = 0; i < 3; i++) {
    const id = await incidentDraft(f, i);
    await f.approve(id);
    jobs.push(await f.queue(id));
  }
  const spy = vi.fn(
    async () => new Response("Fictional outage", { status: 503 }),
  );
  vi.stubGlobal("fetch", spy);
  await f.t.action(internal.communicationProvider.tick, {});
  expect(spy).toHaveBeenCalledTimes(3);
  const health = await f
    .c("owner")
    .query(api.communications.operationsHealth, {});
  expect(health.paused).toBe(true);
  expect(health.circuit_reason).toBe("repeated_provider_failure");
  expect(health.problems).toHaveLength(3);
  for (const job of jobs)
    expect((await f.t.run((ctx) => ctx.db.get(job)))?.status).toBe("unknown");
  const config = (
    await f.c("owner").query(api.communications.configuration, {})
  ).config!;
  await f.c("owner").mutation(api.communications.saveSettings, {
    version: config.version,
    signature: config.signature,
    secondary_approval: config.secondary_approval,
    paused: false,
  });
  spy.mockImplementation(
    async () =>
      new Response(JSON.stringify({ id: "must-not-be-called" }), {
        status: 200,
      }),
  );
  await f.t.action(internal.communicationProvider.tick, {});
  expect(spy).toHaveBeenCalledTimes(3);
  expect(
    await f
      .c("owner")
      .mutation(api.crm.write, { input: newRealtor(f.who("sales").id) }),
  ).toBeTruthy();
  expect(
    await f.t.run((ctx) => ctx.db.query("communication_outbox").collect()),
  ).toHaveLength(3);
});

it("IR-E compromised AI key containment blocks queued and new provider work while core CRM works", async () => {
  const f = await operationsFixture();
  vi.stubEnv("OPENAI_API_KEY", "fictional-incident-ai-key");
  vi.stubEnv("GLARA_AI_MODEL", "fictional-incident-model");
  vi.stubEnv("GLARA_AI_SECURITY_APPROVED", "true");
  const config = {
    ...defaults,
    enabled: true,
    retention_acknowledged: true,
    enabled_roles: ["owner"],
    features: ["realtor"],
  };
  await f.c("owner").mutation(api.ai.saveSettings, {
    version: 0,
    input: JSON.stringify(config),
  });
  const input = () =>
    JSON.stringify({
      request_key: crypto.randomUUID(),
      scope: scopeSchema.parse({ feature: "realtor", entity_id: f.r.id }),
      question: "Summarize the recorded relationship",
    });
  const request = await f
    .c("owner")
    .mutation(api.ai.request, { input: input() });
  const before = await f.t.run((ctx) => ctx.db.get(f.oid));
  const args = {
    version: 1,
    input: JSON.stringify({ ...config, enabled: false }),
  };
  await expect(
    f.c("sales").mutation(api.ai.saveSettings, args),
  ).rejects.toThrow();
  await expect(f.t.mutation(api.ai.saveSettings, args)).rejects.toThrow();
  await f.c("owner").mutation(api.ai.saveSettings, args);
  vi.stubEnv("GLARA_AI_SECURITY_APPROVED", "false");
  const spy = vi.fn(() => {
    throw Error("No AI provider request allowed");
  });
  vi.stubGlobal("fetch", spy);
  await expect(
    f.c("owner").action(api.aiProvider.generate, { id: request }),
  ).rejects.toThrow();
  await expect(
    f.c("owner").mutation(api.ai.request, { input: input() }),
  ).rejects.toThrow();
  expect(spy).not.toHaveBeenCalled();
  expect(await f.t.run((ctx) => ctx.db.get(f.oid))).toEqual(before);
  expect(
    await f
      .c("sales")
      .mutation(api.crm.write, { input: newRealtor(f.who("sales").id) }),
  ).toBeTruthy();
});

it("IR-C bad-release derived drift is diagnosed and repaired from M5 source; ledger and audits survive", async () => {
  const f = await commercialFixture();
  await f.t.run(async (ctx) => {
    const p = await sourceProjection(ctx, "opportunities", f.oid);
    await applySource(ctx, "opportunities", f.oid, p.facts, p.version);
  });
  const payment = await f.payment("10");
  const source = await f.t.run((ctx) => ctx.db.get(payment));
  const audits = await f.t.run((ctx) => ctx.db.query("audit_logs").collect());
  const bucket = await f.t.run(async (ctx) => {
    const b = (await ctx.db.query("analytics_buckets").collect()).find(
      (x) =>
        x.metric === "cash_received_cents" &&
        x.grain === "month" &&
        x.dimension === "company",
    )!;
    await ctx.db.patch(b._id, { value: "1001" });
    return b;
  });
  async function reconcile() {
    const id = await f.owner.mutation(api.analyticsReconciliation.start, {});
    for (let i = 0; i < 500; i++) {
      const run = await f.owner.mutation(api.analyticsReconciliation.advance, {
        id,
      });
      if (run.status !== "running") return { id, run };
    }
    throw Error("Bounded reconciliation did not finish");
  }
  const first = await reconcile();
  expect(first.run.source_drift).toBe(0);
  expect(first.run.bucket_drift).toBe(1);
  expect((await f.t.run((ctx) => ctx.db.get(bucket._id)))?.value).toBe("1001");
  const expected = await f.t.run((ctx) =>
    ctx.db
      .query("analytics_expected")
      .withIndex("by_run_key", (q) =>
        q.eq("run_id", first.id).eq("key", bucket.key),
      )
      .unique(),
  );
  await f.owner.mutation(api.analyticsReconciliation.repairBucket, {
    id: expected!._id,
    reason: "IR-C fictional independently verified projection repair",
  });
  const second = await reconcile();
  expect(second.run.source_drift).toBe(0);
  expect(second.run.bucket_drift).toBe(0);
  expect(await f.t.run((ctx) => ctx.db.get(payment))).toEqual(source);
  const after = await f.t.run((ctx) => ctx.db.query("audit_logs").collect());
  for (const audit of audits)
    expect(after.find((x) => x._id === audit._id)).toEqual(audit);
}, 30000);
