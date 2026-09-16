import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";
import { api } from "../../convex/_generated/api";
import { operationsClient } from "./operations-fixture";
import { credentials } from "./identities";
import type { Id } from "../../convex/_generated/dataModel";
const results: { scenario: string; passed: boolean; elapsed_ms: number }[] = [];
const out = ".acceptance/m10/hosted-security.json";
async function check(scenario: string, fn: () => Promise<void>) {
  const start = performance.now();
  try {
    await fn();
    results.push({
      scenario,
      passed: true,
      elapsed_ms: Math.round(performance.now() - start),
    });
  } catch {
    results.push({
      scenario,
      passed: false,
      elapsed_ms: Math.round(performance.now() - start),
    });
  } finally {
    writeFileSync(
      out,
      JSON.stringify(
        {
          executed_at: new Date().toISOString(),
          environment: "development",
          deployment: "woozy-jaguar-392",
          results,
          production_mutations: 0,
          external_sends: 0,
        },
        null,
        2,
      ),
    );
  }
}
async function main() {
  assert.equal(process.env.GLARA_M10_ACCEPTANCE, "yes");
  const owner = (await operationsClient()).client,
    url = (await operationsClient()).url;
  const roles = [
    "owner",
    "admin",
    "sales",
    "designer",
    "staging_crew",
    "marketing",
    "anonymous",
  ];
  const cases: [string, Record<string, unknown>, string[]][] = [
    [
      "crm:read",
      { input: JSON.stringify({ op: "list" }) },
      ["owner", "admin", "sales", "marketing"],
    ],
    [
      "sales:listOpportunities",
      { paginationOpts: { numItems: 5, cursor: null } },
      ["owner", "admin", "sales"],
    ],
    [
      "operations:list",
      { paginationOpts: { numItems: 5, cursor: null } },
      roles.filter((r) => r !== "anonymous"),
    ],
    ["inventory:settings", {}, ["owner", "admin"]],
    ["commercial:dashboard", {}, ["owner", "admin"]],
    ["analytics:settings", {}, ["owner"]],
    ["automation:rules", {}, ["owner", "admin"]],
    ["ai:settings", {}, roles.filter((r) => r !== "anonymous")],
    [
      "communications:configuration",
      {},
      ["owner", "admin", "sales", "marketing"],
    ],
    ["emergency:state", {}, ["owner", "admin"]],
    ["operationalHealth:health", {}, ["owner", "admin"]],
  ];
  for (const role of roles) {
    const client =
      role === "anonymous"
        ? new ConvexHttpClient(url, { logger: false })
        : (await operationsClient(role)).client;
    for (const [name, args, allow] of cases)
      await check(
        `${role} ${name} ${allow.includes(role) ? "allowed" : "denied"}`,
        async () => {
          const call = () =>
            client.query(makeFunctionReference<"query">(name), args);
          if (allow.includes(role)) await call();
          else await assert.rejects(call);
        },
      );
    if (!["owner"].includes(role))
      await check(`${role} cannot change emergency controls`, async () => {
        await assert.rejects(() =>
          client.mutation(api.emergency.change, {
            changes: [{ capability: "email", version: 0, frozen: true }],
            reason: "Fictional unauthorized attempt",
          }),
        );
      });
  }
  await check("Email and Calendar remain disabled", async () => {
    const h = await owner.query(api.operationalHealth.health, {});
    assert.equal(h.dimensions.email.enabled, false);
    assert.equal(h.calendar, "DISABLED_DEFERRED");
  });
  await check(
    "Health refresh dedupe and acknowledgement retain current conditions",
    async () => {
      await owner.mutation(api.operationalHealth.refresh, {});
      const before = await owner.query(api.operationalHealth.alerts, {});
      await owner.mutation(api.operationalHealth.refresh, {});
      const after = await owner.query(api.operationalHealth.alerts, {});
      assert.deepEqual(
        after.map((r) => r._id),
        before.map((r) => r._id),
      );
      const active = after.find((r) => r.active && !r.acknowledged_at);
      if (active) {
        await owner.mutation(api.operationalHealth.acknowledge, {
          id: active._id,
          version: active.version,
        });
        assert.equal(
          (await owner.query(api.operationalHealth.alerts, {})).find(
            (r) => r._id === active._id,
          )?.active,
          true,
        );
      }
    },
  );
  const original = await owner.query(api.emergency.state, {});
  assert(
    original.every((s) => !s.frozen),
    "Existing freeze: stop, do not override",
  );
  try {
    await owner.mutation(api.emergency.change, {
      changes: original.map((s) => ({
        capability: s.capability,
        frozen: true,
        version: s.version,
      })),
      reason: "Fictional M10A hosted containment drill",
      incident: "DRILL-M10-HOSTED",
    });
    await check(
      "All emergency capabilities frozen with authorized reads",
      async () => {
        assert(
          (await owner.query(api.emergency.state, {})).every((s) => s.frozen),
        );
        await owner.query(api.commercial.dashboard, {});
      },
    );
    await check("Financial create denied by frozen boundary", async () => {
      await assert.rejects(
        () =>
          owner.mutation(api.commercial.saveCustomer, {
            version: 0,
            input: JSON.stringify({
              type: "seller",
              name: "Fictional blocked",
              contact: "Fictional",
              email: "fictional@accounts.example.test",
              phone: "",
              company: "",
              address: "Fictional",
            }),
          }),
        /CAPABILITY_FROZEN/,
      );
    });
    await check("Inventory create denied by frozen boundary", async () => {
      await assert.rejects(
        () =>
          owner.mutation(api.inventory.saveCategory, {
            version: 0,
            name: "Fictional blocked",
            active: true,
          }),
        /CAPABILITY_FROZEN/,
      );
    });
    await check("AI request denied before provider execution", async () => {
      await assert.rejects(
        () => owner.mutation(api.ai.request, { input: "{}" }),
        /CAPABILITY_FROZEN/,
      );
    });
  } finally {
    const state = await owner.query(api.emergency.state, {});
    await owner.mutation(api.emergency.change, {
      changes: state.map((s) => ({
        capability: s.capability,
        frozen: false,
        version: s.version,
      })),
      reason: "Fictional M10A drill controlled recovery",
      incident: "DRILL-M10-HOSTED",
    });
  }
  const target = await operationsClient("staging_crew"),
    profile = await target.client.query(api.profiles.viewer, {});
  assert(
    profile &&
      profile.email.endsWith("@accounts.example.test") &&
      profile.id === credentials("staging_crew").id,
  );
  try {
    await check(
      "Real supported session revocation denies existing token across M1-M9",
      async () => {
        await owner.action(api.securityAdmin.revokeUser, {
          userId: profile.id,
          reason: "Fictional M10A revocation acceptance",
          incident: "DRILL-M10-REVOKE",
        });
        for (const [name, args] of cases)
          await assert.rejects(() =>
            target.client.query(makeFunctionReference<"query">(name), args),
          );
        assert.equal(await target.client.query(api.profiles.viewer, {}), null);
      },
    );
    await check("Archived fictional user cannot freshly sign in", async () => {
      await assert.rejects(() => operationsClient("staging_crew"));
    });
  } finally {
    execFileSync(
      process.execPath,
      [
        "node_modules/convex/bin/main.js",
        "run",
        "admin:setProfile",
        JSON.stringify({
          userId: profile.id as Id<"users">,
          name: profile.name,
          roles: profile.roles,
          archived: false,
        }),
        "--deployment",
        "woozy-jaguar-392",
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
  }
  await check("Restoring profile cannot revive destroyed session", async () => {
    assert.equal(await target.client.query(api.profiles.viewer, {}), null);
    await assert.rejects(() => target.client.query(api.ai.settings, {}));
  });
  await check(
    "Restored fictional identity can establish a new session",
    async () => {
      await operationsClient("staging_crew");
    },
  );
  const priorRoleSession = await operationsClient("staging_crew");
  const applyRoles = (roles: typeof profile.roles) =>
    execFileSync(
      process.execPath,
      [
        "node_modules/convex/bin/main.js",
        "run",
        "admin:setProfile",
        JSON.stringify({
          userId: profile.id,
          name: profile.name,
          roles,
          archived: false,
        }),
        "--deployment",
        "woozy-jaguar-392",
      ],
      { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
    );
  try {
    await check(
      "Platform role change revokes pre-change session immediately",
      async () => {
        applyRoles(["designer"]);
        assert.equal(
          await priorRoleSession.client.query(api.profiles.viewer, {}),
          null,
        );
        await assert.rejects(() =>
          priorRoleSession.client.query(api.operations.list, {
            paginationOpts: { cursor: null, numItems: 5 },
          }),
        );
        const fresh = await operationsClient("staging_crew");
        assert.deepEqual(
          (await fresh.client.query(api.profiles.viewer, {}))?.roles,
          ["designer"],
        );
      },
    );
  } finally {
    applyRoles(profile.roles);
  }
  await check(
    "Final emergency controls normal and providers disabled",
    async () => {
      assert(
        (await owner.query(api.emergency.state, {})).every((s) => !s.frozen),
      );
      const h = await owner.query(api.operationalHealth.health, {});
      assert.equal(h.dimensions.email.enabled, false);
      assert.equal(h.calendar, "DISABLED_DEFERRED");
    },
  );
  console.log(
    JSON.stringify({
      passed: results.filter((r) => r.passed).length,
      failed: results.filter((r) => !r.passed).length,
      failures: results.filter((r) => !r.passed).map((r) => r.scenario),
    }),
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
}
main().catch(() => {
  console.error(
    "Hosted acceptance stopped; inspect restricted evidence and verify cleanup.",
  );
  process.exitCode = 1;
});
