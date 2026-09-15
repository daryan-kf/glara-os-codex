import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { operationsClient } from "./operations-fixture";
import { credentials } from "./identities";
const results: { name: string; passed: boolean }[] = [];
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, passed: false });
    throw e;
  }
}
async function main() {
  if (
    process.env.GLARA_M7_ACCEPTANCE !== "yes" ||
    !process.env.GLARA_M7_BROWSER_FIXTURE
  )
    throw Error("Development opt-in required");
  const { client: c } = await operationsClient(),
    sales = (await operationsClient("sales")).client;
  const f = JSON.parse(
    readFileSync(process.env.GLARA_M7_BROWSER_FIXTURE, "utf8"),
  ) as { realtor: Id<"realtors">; marker: string };
  await check(
    "Clean deployment has 28 disabled rules with idempotent initialization",
    async () => {
      const r = await c.query(api.automation.rules, {});
      assert.equal(r.length, 28);
      assert.ok(r.every((x) => x.record && !x.record.config.enabled));
      await c.mutation(api.automation.initialize, {});
      assert.deepEqual(await c.query(api.automation.rules, {}), r);
    },
  );
  const task = (
    await c.mutation(api.crm.write, {
      input: JSON.stringify({
        op: "activity_create",
        data: {
          realtor_id: f.realtor,
          type: "follow_up",
          title: f.marker + " clean smoke",
          description: f.marker,
          due_at: new Date(Date.now() - 86400000).toISOString(),
          completed_at: "",
          status: "open",
          priority: "normal",
          assigned_to: credentials("sales").id,
        },
      }),
    })
  ).id as Id<"activities">;
  const rule = (await c.query(api.automation.rules, {})).find(
    (x) => x.key === "next_action",
  )!.record!;
  try {
    await c.mutation(api.automation.saveRule, {
      id: rule._id,
      version: rule.version,
      config: {
        ...rule.config,
        enabled: true,
        entity_ids: [task],
        delay_days: 0,
        daily_limit: 100,
        assignment: "entity_owner",
      },
    });
    await check(
      "Clean hosted concurrent evaluations preserve one adopted task",
      async () => {
        await Promise.all([
          c.mutation(
            api.automation.execute,
            { table: "activities", entity_id: task },
            { skipQueue: true },
          ),
          c.mutation(
            api.automation.execute,
            { table: "activities", entity_id: task },
            { skipQueue: true },
          ),
        ]);
        const a = (
          await c.query(api.automation.preview, {
            table: "activities",
            entity_id: task,
          })
        ).flatMap((x) => x.active);
        assert.equal(a.length, 1);
        assert.equal(a[0].activity_id, task);
      },
    );
    const action = (
      await c.query(api.automation.preview, {
        table: "activities",
        entity_id: task,
      })
    ).flatMap((x) => x.active)[0];
    await check(
      "Clean role denial and assigned Sales completion remain enforced",
      async () => {
        const marketing = (await operationsClient("marketing")).client;
        await assert.rejects(
          marketing.mutation(api.automation.changeAction, {
            id: action._id,
            updated_at: action.updated_at,
            op: "complete",
            reason: f.marker,
          }),
        );
        await sales.mutation(api.automation.changeAction, {
          id: action._id,
          updated_at: action.updated_at,
          op: "complete",
          reason: f.marker,
        });
        await c.mutation(api.automation.execute, {
          table: "activities",
          entity_id: task,
        });
        assert.equal(
          (
            await c.query(api.automation.preview, {
              table: "activities",
              entity_id: task,
            })
          ).flatMap((x) => x.active).length,
          0,
        );
      },
    );
    await check(
      "Legacy CRM task completion preserves zero analytics source drift",
      async () => {
        assert.equal(
          (
            await c.query(api.analytics.compareSource, {
              table: "activities",
              id: task,
            })
          ).drift.length,
          0,
        );
      },
    );
  } finally {
    const r = (await c.query(api.automation.rules, {})).find(
      (x) => x.key === "next_action",
    )!.record!;
    await c.mutation(api.automation.saveRule, {
      id: r._id,
      version: r.version,
      config: rule.config,
    });
  }
  await check(
    "Final development health has no failed work and no enabled company-wide rules",
    async () => {
      assert.equal((await c.query(api.automation.health, {})).failed.length, 0);
      assert.ok(
        (await c.query(api.automation.rules, {})).every(
          (x) => !x.record?.config.enabled,
        ),
      );
    },
  );
}
main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() =>
    writeFileSync(
      "docs/M7-clean-hosted-smoke-results.json",
      JSON.stringify(
        {
          deployment: "woozy-jaguar-392",
          timestamp: new Date().toISOString(),
          results,
          passed: results.filter((x) => x.passed).length,
          failed: results.filter((x) => !x.passed).length,
          completed: process.exitCode !== 1,
        },
        null,
        2,
      ) + "\n",
    ),
  );
