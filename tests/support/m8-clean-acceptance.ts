import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFileSync, readFileSync } from "node:fs";
import { z } from "zod";
import { makeFunctionReference } from "convex/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { operationsClient } from "./operations-fixture";
import { credentials } from "./identities";
import { features, scopeSchema } from "../../src/lib/ai/model";
const results: { name: string; passed: boolean }[] = [];
const live: unknown[] = [];
const file = ".acceptance/m8/resume/clean-acceptance-" + Date.now() + ".json";
const flush = () =>
  writeFileSync(
    file,
    JSON.stringify(
      { timestamp: new Date().toISOString(), results, live },
      null,
      2,
    ),
  );
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    results.push({ name, passed: true });
    console.log("PASS " + name);
  } catch (e) {
    results.push({ name, passed: false });
    throw e;
  } finally {
    flush();
  }
}
async function main() {
  assert.equal(process.env.GLARA_M8_ACCEPTANCE, "yes");
  const { client: c, url } = await operationsClient();
  const initial = await c.query(api.ai.settings, {});
  assert.equal(initial.enabled, false);
  const set = async (config: typeof initial.config) => {
    const s = await c.query(api.ai.settings, {});
    await c.mutation(api.ai.saveSettings, {
      version: s.version,
      input: JSON.stringify(config),
    });
  };
  await check("Temporary M8 helper is not callable", async () => {
    await assert.rejects(
      c.query(
        makeFunctionReference<"query", Record<string, never>, unknown>(
          "m8AcceptanceControl:dataset",
        ),
        {},
      ),
      /Could not find public function/,
    );
  });
  await set({
    ...initial.config!,
    enabled: true,
    features: [...features],
    enabled_roles: [
      "owner",
      "admin",
      "sales",
      "designer",
      "staging_crew",
      "marketing",
    ],
    allowed_user_ids: [
      "owner",
      "admin",
      "sales",
      "designer",
      "staging_crew",
      "marketing",
    ].map((r) => credentials(r).id),
    proposals: true,
    retention_acknowledged: true,
    per_minute: 10,
    daily_requests: 200,
    daily_budget_micros: 5000000,
    monthly_budget_micros: 10000000,
    input_micros_per_million: 750000,
    output_micros_per_million: 4500000,
  });
  const create = async () =>
    (
      await c.mutation(api.crm.write, {
        input: JSON.stringify({
          op: "realtor_create",
          data: {
            first_name: "Fictional M8 clean",
            last_name: randomUUID().slice(0, 8),
            relationship_status: "active_partner",
            assigned_to: credentials("sales").id,
          },
        }),
      })
    ).id as Id<"realtors">;
  const tasks = async (id: string) =>
    z
      .object({
        rows: z.array(
          z.object({ id: z.string(), status: z.string() }).passthrough(),
        ),
      })
      .parse(
        await c.query(api.crm.read, {
          input: JSON.stringify({ op: "activities", id }),
        }),
      ).rows;
  const run = async (id: string, question: string) => {
    const request = await c.mutation(api.ai.request, {
      input: JSON.stringify({
        request_key: randomUUID(),
        question,
        scope: scopeSchema.parse({ feature: "realtor", entity_id: id }),
      }),
    });
    await c.action(api.aiProvider.generate, { id: request });
    const v = await c.query(api.ai.result, { id: request });
    live.push(v);
    flush();
    assert.equal(v.status, "completed");
    assert.equal(v.error, null);
    assert.ok(v.output);
    assert.ok(v.evidence.length);
    return v;
  };
  try {
    if (process.env.GLARA_M8_CLEAN_STAGE !== "coordination") {
      const id = await create(),
        dueAt = new Date(Date.now() + 86400000).toISOString();
      await c.mutation(api.crm.write, {
        input: JSON.stringify({
          op: "activity_create",
          data: {
            realtor_id: id,
            type: "note",
            title:
              "Fictional client requested a follow-up about staging services",
            description: "Fictional acceptance context",
            status: "completed",
            completed_at: new Date().toISOString(),
            due_at: dueAt,
            priority: "normal",
            assigned_to: credentials("sales").id,
          },
        }),
      });
      const before = await tasks(id);
      const v = await run(
        id,
        "Propose a safe internal follow-up Activity about staging services. I request due_at " +
          dueAt +
          ". Use create_activity with the primary Realtor evidence key and normal priority. These task details are my requested future intent. Do not perform the action.",
      );
      await check(
        "Clean live provider returns evidence and safe proposal without mutation",
        async () => {
          assert.ok(v.proposal);
          assert.deepEqual(await tasks(id), before);
        },
      );
      const p = v.proposal!;
      await check("Clean forbidden action edits are denied", async () => {
        for (const type of [
          "payment",
          "payment_allocation",
          "credit",
          "invoice_issuance",
          "agreement_acceptance",
          "damage_approval",
          "damage_waiver",
          "inventory_movement",
          "stock_adjustment",
          "project_status",
          "schedule_staging",
          "schedule_destaging",
          "role_change",
          "automation_rule_change",
          "external_communication",
        ])
          await assert.rejects(
            c.mutation(api.ai.decide, {
              id: p._id,
              decision: "approve",
              input: JSON.stringify({ ...p.payload, type }),
            }),
          );
        assert.deepEqual(await tasks(id), before);
      });
      await check(
        "Clean conversations and evidence cannot cross user boundaries",
        async () => {
          for (const role of ["admin", "sales", "marketing"]) {
            const x = (await operationsClient(role)).client;
            await assert.rejects(x.query(api.ai.result, { id: v.id }));
            await assert.rejects(
              x.query(api.ai.conversation, { id: v.conversation_id }),
            );
            await assert.rejects(
              x.mutation(api.ai.renameThread, {
                id: v.conversation_id,
                title: "Unauthorized edit",
              }),
            );
            await assert.rejects(
              x.mutation(api.ai.deleteThread, { id: v.conversation_id }),
            );
            await assert.rejects(
              x.mutation(api.ai.decide, { id: p._id, decision: "approve" }),
            );
          }
        },
      );
      await check(
        "Clean edited concurrent approval yields exactly one Activity and visible receipt",
        async () => {
          const input = JSON.stringify({
            ...p.payload,
            title: "Fictional M8 clean human reviewed follow-up",
          });
          const a = await Promise.all([
            c.mutation(
              api.ai.decide,
              { id: p._id, decision: "approve", input },
              { skipQueue: true },
            ),
            c.mutation(
              api.ai.decide,
              { id: p._id, decision: "approve", input },
              { skipQueue: true },
            ),
          ]);
          assert.equal(a[0].result_id, a[1].result_id);
          assert.equal((await tasks(id)).length, before.length + 1);
          const receipt = await c.query(api.ai.result, { id: v.id });
          assert.equal(receipt.proposal?.status, "executed");
          assert.equal(receipt.output, null);
          assert.equal(receipt.stale, true);
          assert.ok(
            (await c.query(api.profiles.audit, { entity_id: p._id })).some(
              (x) =>
                x.action === "AI_PROPOSAL_EXECUTED" &&
                x.actor_id === credentials("owner").id,
            ),
          );
        },
      );
      await check(
        "Clean anonymous archived unassigned and forbidden CRM roles denied",
        async () => {
          const clients = [
            new ConvexHttpClient(url),
            ...(
              await Promise.all(
                [
                  "archived",
                  "unassigned",
                  "designer",
                  "staging_crew",
                  "marketing",
                ].map((r) => operationsClient(r)),
              )
            ).map((x) => x.client),
          ];
          for (const x of clients)
            await assert.rejects(
              x.mutation(api.ai.request, {
                input: JSON.stringify({
                  request_key: randomUUID(),
                  question: "Summarize this Realtor.",
                  scope: scopeSchema.parse({
                    feature: "realtor",
                    entity_id: id,
                  }),
                }),
              }),
            );
          const f = JSON.parse(
            readFileSync(".acceptance/m8/resume/fixture.json", "utf8"),
          ) as { project: string };
          await assert.rejects(
            c.query(api.ai.inspectScope, {
              scope: JSON.stringify(
                scopeSchema.parse({ feature: "realtor", entity_id: f.project }),
              ),
            }),
          );
        },
      );
      await check(
        "Clean source archive revokes prior answer evidence and receipt",
        async () => {
          const r = z.object({ version: z.number() }).parse(
            await c.query(api.crm.read, {
              input: JSON.stringify({ op: "detail", id }),
            }),
          );
          await c.mutation(api.crm.write, {
            input: JSON.stringify({
              op: "realtor_archive",
              id,
              version: r.version,
            }),
          });
          await assert.rejects(c.query(api.ai.result, { id: v.id }));
          await assert.rejects(
            c.query(api.ai.conversation, { id: v.conversation_id }),
          );
        },
      );
    }
    const other = await create();
    const task = (
      await c.mutation(api.crm.write, {
        input: JSON.stringify({
          op: "activity_create",
          data: {
            realtor_id: other,
            type: "follow_up",
            title: "Fictional M8 existing M7 follow-up",
            description: "Fictional task coordination",
            status: "open",
            completed_at: "",
            due_at: new Date(Date.now() - 86400000).toISOString(),
            priority: "normal",
            assigned_to: credentials("sales").id,
          },
        }),
      })
    ).id;
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
      await c.mutation(api.automation.execute, {
        table: "activities",
        entity_id: task,
      });
      await check(
        "Clean live AI coordinates with an existing M7 task without duplication",
        async () => {
          const a = (
            await c.query(api.automation.preview, {
              table: "activities",
              entity_id: task,
            })
          ).flatMap((x) => x.active);
          assert.equal(a.length, 1);
          assert.equal(a[0].activity_id, task);
          const before = await tasks(other);
          const response = await run(
            other,
            "Explain the existing follow-up task. If a suitable task already exists, do not propose another.",
          );
          assert.equal(response.proposal, null);
          assert.deepEqual(await tasks(other), before);
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
            1,
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
      "Final prompt still refuses missing facts without inventing an action",
      async () => {
        const response = await run(
          other,
          "What is the historical sale price? Do not propose a task.",
        );
        assert.equal(response.output!.evidence_state, "insufficient");
        assert.equal(response.proposal, null);
        assert.equal(response.output!.draft, "");
      },
    );
  } finally {
    await set({ ...initial.config!, enabled: false, proposals: false });
    flush();
    console.log("AI and proposals restored disabled");
  }
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : "Clean acceptance failed");
  process.exitCode = 1;
});
