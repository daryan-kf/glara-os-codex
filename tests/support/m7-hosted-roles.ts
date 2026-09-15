import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { api } from "../../convex/_generated/api";
import type { Doc, Id } from "../../convex/_generated/dataModel";
import { operationsClient } from "./operations-fixture";
import { credentials } from "./identities";
const results: { name: string; passed: boolean }[] = [];
let scale = 0;
async function main() {
  if (process.env.GLARA_M7_ACCEPTANCE !== "yes")
    throw Error("M7 opt-in required");
  const { client: c } = await operationsClient(),
    sales = (await operationsClient("sales")).client;
  const f = JSON.parse(
    readFileSync("test-results/m7-matrix-fixture.json", "utf8"),
  ) as {
    opportunity: Id<"opportunities">;
    realtor: Id<"realtors">;
    marker: string;
  };
  const uid = credentials("sales").id as Id<"users">;
  const originals: Doc<"automation_rules">[] = [];
  const tasks: Id<"activities">[] = [];
  function internal(name: string, args: object): unknown {
    const r = spawnSync(
      process.execPath,
      [
        "node_modules/convex/bin/main.js",
        "run",
        name,
        JSON.stringify(args),
        "--env-file",
        ".env.local",
      ],
      { encoding: "utf8", windowsHide: true },
    );
    if (r.status !== 0) throw Error(r.stderr);
    return r.stdout.trim() ? JSON.parse(r.stdout) : null;
  }
  const control = (op: string) =>
    internal("m7AcceptanceControl:control", {
      table: "opportunities",
      entity_id: f.opportunity,
      user_id: uid,
      role: "sales",
      op,
    });
  const run = () =>
    c.mutation(api.automation.execute, {
      table: "opportunities",
      entity_id: f.opportunity,
    });
  const active = async () =>
    (
      await c.query(api.automation.preview, {
        table: "opportunities",
        entity_id: f.opportunity,
      })
    )
      .flatMap((x) => x.active)
      .find((x) => x.family === "contact")!;
  const check = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
      results.push({ name, passed: true });
      console.log("PASS " + name);
    } catch (e) {
      results.push({ name, passed: false });
      throw e;
    }
  };
  async function enable(key: string, ids: string[]) {
    const r = (await c.query(api.automation.rules, {})).find(
      (x) => x.key === key,
    )!.record!;
    originals.push(r);
    await c.mutation(api.automation.saveRule, {
      id: r._id,
      version: r.version,
      config: {
        ...r.config,
        enabled: true,
        delay_days: 0,
        daily_limit: 100,
        entity_ids: ids,
        assignment: "entity_owner",
        activation: "current",
      },
    });
  }
  try {
    for (let i = 0; i < 20; i++)
      tasks.push(
        (
          await c.mutation(api.crm.write, {
            input: JSON.stringify({
              op: "activity_create",
              data: {
                realtor_id: f.realtor,
                type: "follow_up",
                title: `${f.marker} load ${i}`,
                description: f.marker,
                due_at: new Date(Date.now() - 86400000).toISOString(),
                completed_at: "",
                status: "open",
                priority: "normal",
                assigned_to: uid,
              },
            }),
          })
        ).id as Id<"activities">,
      );
    await enable("next_action", tasks);
    for (const id of tasks)
      await c.mutation(api.automation.execute, {
        table: "activities",
        entity_id: id,
      });
    await enable("new_contact", [f.opportunity]);
    await run();
    const original = await active();
    assert.ok(original);
    await check(
      "Role revocation immediately hides existing notification and direct CRM access",
      async () => {
        control("revoke_user");
        const feed = await sales.query(api.automation.notifications, {
          resolved: false,
          paginationOpts: { cursor: null, numItems: 30 },
        });
        assert.ok(!feed.page.some((x) => x.action_id === original._id));
        await assert.rejects(
          sales.query(api.sales.getOpportunity, { id: f.opportunity }),
        );
        await run();
        assert.notEqual((await active()).assigned_to, uid);
        control("restore_user");
        await run();
        assert.equal((await active()).assigned_to, uid);
        const n = await sales.query(api.automation.notifications, {
          resolved: false,
          paginationOpts: { cursor: null, numItems: 30 },
        });
        assert.ok(n.page.some((x) => x.action_id === original._id));
      },
    );
    // Return the twenty adopted tasks to Sales before verifying multi-page reassignment.
    for (const id of tasks)
      await c.mutation(api.automation.execute, {
        table: "activities",
        entity_id: id,
      });
    await check(
      "Archived assignee loses access and bounded reassignment resumes beyond 25 actions",
      async () => {
        scale = (control("archive_user") as { assigned_actions: number })
          .assigned_actions;
        assert.ok(scale > 25, `Expected multi-page fixture; observed ${scale}`);
        await assert.rejects(
          sales.query(api.automation.actions, {
            status: "active",
            paginationOpts: { cursor: null, numItems: 30 },
          }),
        );
        internal("automation:reassignProfile", { user_id: uid, cursor: null });
        await run();
        const next = await active();
        assert.notEqual(next.assigned_to, uid);
        assert.equal(next.activity_id, original.activity_id);
        for (const id of tasks)
          await c.mutation(api.automation.execute, {
            table: "activities",
            entity_id: id,
          });
        control("restore_user");
        await run();
        assert.equal((await active()).assigned_to, uid);
      },
    );
  } finally {
    control("restore_user");
    for (const id of tasks) {
      await c.mutation(api.crm.write, {
        input: JSON.stringify({ op: "activity_complete", id, data: {} }),
      });
      await c.mutation(api.automation.execute, {
        table: "activities",
        entity_id: id,
      });
    }
    for (const saved of originals) {
      const r = (await c.query(api.automation.rules, {})).find(
        (x) => x.record?._id === saved._id,
      )!.record!;
      await c.mutation(api.automation.saveRule, {
        id: r._id,
        version: r.version,
        config: saved.config,
      });
    }
  }
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() =>
    writeFileSync(
      "docs/M7-hosted-role-results.json",
      JSON.stringify(
        {
          deployment: "woozy-jaguar-392",
          timestamp: new Date().toISOString(),
          results,
          assigned_actions_tested: scale,
          passed: results.filter((x) => x.passed).length,
          failed: results.filter((x) => !x.passed).length,
          completed: process.exitCode !== 1,
        },
        null,
        2,
      ) + "\n",
    ),
  );
