import { expect, it } from "vitest";
import {
  safeOperationalEvent,
  writeOperationalEvent,
  healthSignals,
  type Health,
} from "../../src/lib/observability/model";
const h: Health = {
  email: {
    enabled: true,
    paused: false,
    lag_minutes: 0,
    unknown: 0,
    provider_failures: 0,
    partial: false,
  },
  automation: { frozen: false, failed: 0, partial: false },
  ai: { frozen: false, failed: 0, partial: false },
  reconciliation: { verified: true, drift: 0 },
  backup: { status: "verified", verified_at: 1000, max_age_ms: 1000 },
};
it("structured operational logs cannot include arbitrary errors, prompts, credentials or headers", () => {
  const record = safeOperationalEvent(
    {
      module: "email",
      operation: "dispatch",
      code: "UNAVAILABLE",
      correlation_id: "12345678-1234-4234-8234-123456789abc",
      password: "private",
      headers: { Authorization: "private" },
      prompt: "private",
      error: new Error("private"),
    },
    1000,
  );
  expect(JSON.stringify(record)).not.toContain("private");
  expect(record?.timestamp).toBe("1970-01-01T00:00:01.000Z");
  expect(
    safeOperationalEvent({ ...record, code: "sensitive raw provider error" }),
  ).toBeNull();
  const output: unknown[] = [];
  writeOperationalEvent({ emit: (e) => output.push(e) }, { secret: "private" });
  expect(output).toEqual([]);
});
it("health signals expose bounded queue/provider/drift/backup failures with stable dedupe keys", () => {
  expect(healthSignals(h, 1500)).toEqual([]);
  const broken = structuredClone(h);
  broken.email.paused = true;
  broken.email.unknown = 3;
  broken.email.lag_minutes = 25;
  broken.email.provider_failures = 3;
  broken.reconciliation.drift = 1;
  broken.automation.failed = 1;
  broken.ai.failed = 3;
  broken.backup.status = "failed";
  const signals = healthSignals(broken, 1500);
  for (const key of [
    "email.circuit_pause",
    "email.queue_lag",
    "email.unknown_delivery",
    "email.provider_failure",
    "reconciliation.drift",
    "backup.failed",
    "automation.failures",
    "ai.provider_failure",
  ])
    expect(signals.some((s) => s.key === key)).toBe(true);
  expect(new Set(signals.map((x) => x.key)).size).toBe(signals.length);
  expect(healthSignals(h, 2500).some((x) => x.key === "backup.stale")).toBe(
    true,
  );
});
it("unknown monitoring remains unknown instead of a green overall status", () => {
  const unverified = structuredClone(h);
  unverified.reconciliation.verified = false;
  unverified.backup.status = "unknown";
  expect(
    healthSignals(unverified, 1500).filter((x) => x.state === "unknown"),
  ).toHaveLength(2);
});

import { operationsFixture } from "../support/operations-unit-fixture";
import { api } from "../../convex/_generated/api";
it("internal health rejects unauthorized roles and archived operators and exposes no source records", async () => {
  const f = await operationsFixture();
  for (const role of [
    "sales",
    "designer",
    "staging_crew",
    "marketing",
  ] as const)
    await expect(
      f.c(role).query(api.operationalHealth.health, {}),
    ).rejects.toThrow();
  await expect(f.t.query(api.operationalHealth.health, {})).rejects.toThrow();
  const result = await f.c("owner").query(api.operationalHealth.health, {});
  expect(result.dimensions.backup.status).toBe("unknown");
  expect(JSON.stringify(result)).not.toContain("example.test");
  await f.t.run(async (ctx) => {
    const p = await ctx.db
      .query("profiles")
      .withIndex("by_user", (q) => q.eq("userId", f.who("admin").id))
      .unique();
    await ctx.db.patch(p!._id, { deleted_at: new Date().toISOString() });
  });
  await expect(
    f.c("admin").query(api.operationalHealth.health, {}),
  ).rejects.toThrow();
});
