import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
if (process.env.GLARA_CONVEX_ACCEPTANCE !== "yes")
  throw Error("Explicit disposable acceptance opt-in required");
const state = JSON.parse(process.env.GLARA_CONVEX_IDENTITIES ?? "{}");
const configured =
  process.env.NEXT_PUBLIC_CONVEX_URL ??
  readFileSync(".env.local", "utf8")
    .match(/^NEXT_PUBLIC_CONVEX_URL=(.+)$/m)?.[1]
    ?.trim();
assert.equal(state.url, configured);
assert.ok(state.url.includes(state.deployment));
const ref = makeFunctionReference,
  client = () => new ConvexHttpClient(state.url, { logger: false });
const results = [];
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
const clients = {},
  tokens = {};
for (const [role, user] of Object.entries(state.users)) {
  assert.ok(user.email.endsWith("@accounts.example.test"));
  await check(role + " password authentication", async () => {
    const c = client();
    const response = await c.action(ref("auth:signIn"), {
      provider: "password",
      params: { email: user.email, password: user.password, flow: "signIn" },
    });
    assert.ok(response.tokens?.token);
    tokens[role] = response.tokens;
    c.setAuth(response.tokens.token);
    clients[role] = c;
  });
}
const read = (role, input) =>
  clients[role].query(ref("crm:read"), { input: JSON.stringify(input) });
const write = (role, input) =>
  clients[role].mutation(ref("crm:write"), { input: JSON.stringify(input) });
await check("anonymous read denied", () =>
  assert.rejects(client().query(ref("crm:read"), { input: '{"op":"list"}' })),
);
await check("public registration denied", () =>
  assert.rejects(
    client().action(ref("auth:signIn"), {
      provider: "password",
      params: {
        email: "no-signup@accounts.example.test",
        password: randomUUID(),
        flow: "signUp",
      },
    }),
  ),
);
await check("public internal provisioning denied", () =>
  assert.rejects(
    clients.owner.action(ref("admin:provision"), {
      email: "no-provision@accounts.example.test",
      name: "Denied",
      roles: ["owner"],
    }),
  ),
);
for (const role of ["designer", "staging_crew", "unassigned", "archived"]) {
  await check(role + " CRM read denied", () =>
    assert.rejects(read(role, { op: "list" })),
  );
  await check(role + " CRM write denied", () =>
    assert.rejects(
      write(role, { op: "source_save", data: { name: "Denied" } }),
    ),
  );
}
const suffix = randomUUID();
const data = {
  first_name: "FictionalAPI",
  last_name: suffix,
  email: suffix + "@accounts.example.test",
  assigned_to: state.users.sales.id,
  relationship_status: "prospect",
  next_title: "Original call",
  next_due_at: "2026-10-01T18:00:00Z",
  notes: "Private acceptance note",
  average_listing_price: "1234567.89",
};
let id;
await check("initial next action enforced", () =>
  assert.rejects(
    write("sales", {
      op: "realtor_create",
      data: { ...data, next_title: "", next_due_at: "" },
    }),
  ),
);
await check("failed creation rolls back", async () =>
  assert.equal((await read("owner", { op: "list", q: data.email })).total, 0),
);
await check("sales creates prospect atomically", async () => {
  id = (await write("sales", { op: "realtor_create", data })).id;
  assert.ok(id);
});
await check("exact decimal retained", async () =>
  assert.equal(
    (await read("owner", { op: "detail", id })).average_listing_price,
    "1234567.89",
  ),
);
await check("duplicate email denied", () =>
  assert.rejects(write("admin", { op: "realtor_create", data })),
);
await check("Marketing fields restricted", async () => {
  const r = await read("marketing", { op: "detail", id });
  assert.equal(r.notes, undefined);
  assert.equal(r.average_listing_price, undefined);
  assert.equal(r.relationship_score, undefined);
});
await check("Marketing roster restricted", async () =>
  assert.deepEqual((await read("marketing", { op: "sources" })).owners, []),
);
await check("Marketing writes denied", () =>
  assert.rejects(
    write("marketing", { op: "realtor_update", id, version: 1, data }),
  ),
);
for (const role of [
  "sales",
  "admin",
  "marketing",
  "designer",
  "staging_crew",
  "unassigned",
  "archived",
])
  await check(role + " audit denied", () =>
    assert.rejects(
      clients[role].query(ref("profiles:audit"), { entity_id: id }),
    ),
  );
await check("audit actor derived from session", async () => {
  const rows = await clients.owner.query(ref("profiles:audit"), {
    entity_id: id,
  });
  assert.ok(rows.length);
  assert.ok(rows.every((r) => r.actor_id === state.users.sales.id));
});
let activity;
await check("initial activity created", async () => {
  activity = (await read("sales", { op: "activities", id })).rows[0];
  assert.equal(activity.title, "Original call");
});
await check("last action cancellation denied", () =>
  assert.rejects(
    write("sales", { op: "activity_cancel", id: activity.id, data: {} }),
  ),
);
await check("failed cancellation keeps activity open", async () =>
  assert.equal(
    (await read("sales", { op: "activities", id })).rows[0].status,
    "open",
  ),
);
await check("reschedule retains cancelled original", async () => {
  await write("sales", {
    op: "activity_reschedule",
    id: activity.id,
    data: { next_title: "Rescheduled", next_due_at: "2026-10-05T18:00:00Z" },
  });
  const rows = (await read("sales", { op: "activities", id })).rows;
  const old = rows.find((r) => r.id === activity.id);
  assert.equal(old.status, "cancelled");
  assert.equal(old.completed_at, null);
  assert.equal(old.due_at, activity.due_at);
  assert.ok(
    rows.some(
      (r) => r.replaces_activity_id === activity.id && r.status === "open",
    ),
  );
});
await check("concurrent stale edits only commit once", async () => {
  const results = await Promise.allSettled(
    ["sales", "admin"].map((role) =>
      write(role, {
        op: "realtor_update",
        id,
        version: 1,
        data: { ...data, next_title: "", next_due_at: "" },
      }),
    ),
  );
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
await check("sales archives", async () => {
  await write("sales", { op: "realtor_archive", id, version: 2 });
  assert.equal(await read("sales", { op: "detail", id }), null);
});
await check("sales restore denied", () =>
  assert.rejects(write("sales", { op: "realtor_restore", id, version: 3 })),
);
await check("admin restore preserves next action", async () => {
  await write("admin", { op: "realtor_restore", id, version: 3 });
  assert.equal(
    (await read("sales", { op: "detail", id })).next_action,
    "Rescheduled",
  );
});
await check("token refresh works", async () => {
  const fresh = await client().action(ref("auth:signIn"), {
    refreshToken: tokens.sales.refreshToken,
  });
  assert.ok(fresh.tokens?.token);
  clients.sales.setAuth(fresh.tokens.token);
  tokens.sales = fresh.tokens;
  assert.ok(await clients.sales.query(ref("profiles:viewer"), {}));
});
await check("logout immediately revokes old JWT access", async () => {
  await clients.sales.action(ref("auth:signOut"), {});
  await assert.rejects(read("sales", { op: "list" }));
});
await check("logout revokes refresh token", async () => {
  const response = await client()
    .action(ref("auth:signIn"), { refreshToken: tokens.sales.refreshToken })
    .catch(() => null);
  assert.ok(!response?.tokens);
});
for (const [role, c] of Object.entries(clients))
  if (role !== "sales") await c.action(ref("auth:signOut"), {});
mkdirSync("test-results", { recursive: true });
writeFileSync(
  "test-results/convex-hosted-acceptance.json",
  JSON.stringify(
    {
      timestamp: new Date().toISOString(),
      deployment: state.deployment,
      results,
    },
    null,
    2,
  ),
);
console.log(
  results.filter((r) => r.passed).length + "/" + results.length + " passed",
);
if (results.some((r) => !r.passed)) process.exitCode = 1;
