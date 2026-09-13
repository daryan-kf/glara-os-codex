import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference as ref } from "convex/server";
if (process.env.GLARA_CONVEX_ACCEPTANCE !== "yes")
  throw Error("Explicit fictional acceptance opt-in required");
const state = JSON.parse(process.env.GLARA_CONVEX_IDENTITIES ?? "{}");
const url =
  process.env.NEXT_PUBLIC_CONVEX_URL ??
  readFileSync(".env.local", "utf8")
    .match(/^NEXT_PUBLIC_CONVEX_URL=(.+)$/m)?.[1]
    ?.trim();
assert.equal(state.url, url);
assert.ok(url.includes(state.deployment + "."));
assert.ok(state.deployment.startsWith("woozy-jaguar-"));
const clients = {},
  results = [];
for (const [role, user] of Object.entries(state.users)) {
  assert.ok(user.email.endsWith("@accounts.example.test"));
  const c = new ConvexHttpClient(url, { logger: false });
  const response = await c.action(ref("auth:signIn"), {
    provider: "password",
    params: { email: user.email, password: user.password, flow: "signIn" },
  });
  assert.ok(response.tokens?.token);
  c.setAuth(response.tokens.token);
  clients[role] = c;
}
const q = (role, name, args = {}) =>
  clients[role].query(ref("sales:" + name), args);
const m = (role, name, args) =>
  clients[role].mutation(ref("sales:" + name), args);
const input = (data) => JSON.stringify(data);
async function check(name, fn) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch {
    results.push({ name, passed: false });
    console.log("FAIL " + name);
  }
}
const suffix = randomUUID();
const realtor = await clients.sales.mutation(ref("crm:write"), {
  input: input({
    op: "realtor_create",
    data: {
      first_name: "FictionalM2",
      last_name: suffix,
      relationship_status: "active_partner",
      assigned_to: state.users.sales.id,
    },
  }),
});
const data = {
  address_line_1: "Fictional " + suffix + " Lane",
  city: "Vancouver",
  province: "BC",
  property_type: "detached",
  occupancy_status: "vacant",
  realtor_id: realtor.id,
  seller_name: "Private Fictional Seller",
  notes: "Private M2 acceptance",
};
const pid = await m("sales", "saveProperty", {
  version: 0,
  input: input(data),
});
const oppData = {
  property_id: pid,
  assigned_to: state.users.sales.id,
  estimated_value: "5000.01",
  probability: 20,
  next_action_title: "Fictional follow-up",
  next_action_date: "2099-01-01T18:00:00Z",
};
await check("active opportunity requires next action", () =>
  assert.rejects(
    m("sales", "saveOpportunity", {
      version: 0,
      input: input({ ...oppData, next_action_title: "", next_action_date: "" }),
    }),
  ),
);
const oid = await m("sales", "saveOpportunity", {
  version: 0,
  input: input(oppData),
});
await check("anonymous sales query denied", () =>
  assert.rejects(
    new ConvexHttpClient(url, { logger: false }).query(
      ref("sales:pipeline"),
      {},
    ),
  ),
);
for (const role of [
  "marketing",
  "designer",
  "staging_crew",
  "unassigned",
  "archived",
]) {
  await check(role + " direct commercial read/write denied", async () => {
    await assert.rejects(q(role, "getOpportunity", { id: oid }));
    await assert.rejects(
      m(role, "saveOpportunity", { version: 0, input: input(oppData) }),
    );
  });
}
for (const role of ["marketing", "designer"])
  await check(
    role + " property projection excludes private fields",
    async () => {
      const row = await q(role, "getProperty", { id: pid });
      assert.equal(row.commercial, false);
      assert.ok(!JSON.stringify(row).includes("Private"));
      assert.ok(!("opportunities" in row));
    },
  );
await check("duplicate address prevented", () =>
  assert.rejects(
    m("owner", "saveProperty", { version: 0, input: input(data) }),
  ),
);
await check("stale property edits rejected", async () => {
  await m("sales", "saveProperty", {
    id: pid,
    version: 1,
    input: input({ ...data, postal_code: "V6B 1A1" }),
  });
  await assert.rejects(
    m("sales", "saveProperty", { id: pid, version: 1, input: input(data) }),
  );
});
await check(
  "last next action cannot be closed without replacement",
  async () => {
    const row = await q("sales", "getOpportunity", { id: oid });
    await assert.rejects(
      m("sales", "finishAction", {
        id: row.opportunity.next_action.id,
        status: "completed",
      }),
    );
  },
);
await check("stage concurrency has one winner", async () => {
  const attempts = await Promise.allSettled(
    [1, 2].map(() =>
      m("sales", "transition", {
        id: oid,
        version: 1,
        input: input({ stage: "contacted" }),
      }),
    ),
  );
  assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
});
await check("lost reason mandatory", () =>
  assert.rejects(
    m("sales", "transition", {
      id: oid,
      version: 2,
      input: input({ stage: "lost" }),
    }),
  ),
);
const quoteData = {
  opportunity_id: oid,
  items: [
    { description: "Fictional staging", quantity: 2, unit_price: "100.01" },
  ],
  discount: "0.00",
  tax_rate: "5.00",
  valid_until: "2099-01-01",
};
const qid = await m("owner", "saveQuote", {
  version: 0,
  input: input(quoteData),
});
await check("exact cents and tax rounding", async () => {
  const row = await q("owner", "getQuote", { id: qid });
  assert.equal(row.quote.subtotal_cents, "20002");
  assert.equal(row.quote.tax_cents, "1000");
  assert.equal(row.quote.total_cents, "21002");
});
await check("issued quote terms immutable", async () => {
  await m("owner", "quoteStatus", { id: qid, version: 1, status: "sent" });
  await assert.rejects(
    m("owner", "saveQuote", { id: qid, version: 2, input: input(quoteData) }),
  );
});
await check("revision creates separately numbered draft", async () => {
  const revised = await m("owner", "reviseQuote", { id: qid, version: 2 });
  const old = await q("owner", "getQuote", { id: qid }),
    fresh = await q("owner", "getQuote", { id: revised });
  assert.equal(old.quote.status, "superseded");
  assert.equal(fresh.quote.revision_of, qid);
  assert.notEqual(old.quote.number, fresh.quote.number);
});
await check("consultation status and stale edits", async () => {
  const cid = await m("sales", "saveConsultation", {
    version: 0,
    input: input({
      opportunity_id: oid,
      assigned_to: state.users.sales.id,
      scheduled_at: "2099-01-01T18:00:00Z",
      consultation_type: "onsite",
      notes: "Fictional",
    }),
  });
  await m("sales", "consultationStatus", {
    id: cid,
    version: 1,
    status: "completed",
  });
  await assert.rejects(
    m("sales", "consultationStatus", {
      id: cid,
      version: 1,
      status: "cancelled",
    }),
  );
});
await check(
  "indexed property/Realtor filter returns linked opportunity",
  async () => {
    const rows = await q("sales", "listOpportunities", {
      paginationOpts: { numItems: 25, cursor: null },
      property_id: pid,
      realtor_id: realtor.id,
    });
    assert.equal(rows.page.length, 1);
    assert.equal(rows.page[0]._id, oid);
  },
);
await check("archive preserves quote history", async () => {
  const row = await q("owner", "getOpportunity", { id: oid });
  await m("owner", "archive", {
    kind: "opportunities",
    id: oid,
    version: row.opportunity.version,
    restore: false,
  });
  assert.ok(await q("owner", "getQuote", { id: qid }));
});
mkdirSync("test-results", { recursive: true });
writeFileSync(
  "test-results/m2-hosted-api.json",
  JSON.stringify(
    {
      deployment: state.deployment,
      executedAt: new Date().toISOString(),
      results,
    },
    null,
    2,
  ),
);
console.log(
  `${results.filter((x) => x.passed).length}/${results.length} M2 hosted checks passed`,
);
if (results.some((x) => !x.passed)) process.exitCode = 1;
