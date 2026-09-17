import { afterEach, expect, it, vi } from "vitest";
import { operationsFixture } from "../support/operations-unit-fixture";
import { fictionalMigrationPackage } from "../support/m10-migration-package";
import { internal } from "../../convex/_generated/api";
import { validatePackage } from "../../src/lib/security/migration";
afterEach(() => vi.unstubAllEnvs());
async function fixture() {
  const f = await operationsFixture();
  await f.won();
  vi.stubEnv("GLARA_ENVIRONMENT", "development");
  vi.stubEnv("GLARA_MIGRATION_ENABLED", "true");
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3321");
  const data = fictionalMigrationPackage(f),
    input = JSON.stringify(data);
  const apply = (dry_run = false, through = data.rows.length, text = input) =>
    f
      .c("owner")
      .mutation(internal.migration.apply, { input: text, dry_run, through });
  const counts = () =>
    f.t.run(async (ctx) => ({
      realtors: (await ctx.db.query("realtors").collect()).length,
      projects: (await ctx.db.query("projects").collect()).length,
      audit: (await ctx.db.query("audit_logs").collect()).length,
      runs: await ctx.db.query("migration_runs").collect(),
      records: await ctx.db.query("migration_records").collect(),
    }));
  return { ...f, data, input, apply, counts };
}
it("native migration dry-run rolls back business writes, manifests, analytics and audit; committed retry is idempotent", async () => {
  const f = await fixture(),
    before = await f.counts();
  await expect(f.apply(true)).rejects.toThrow("MIGRATION_DRY_RUN_VALID");
  expect(await f.counts()).toEqual(before);
  expect(await f.apply()).toMatchObject({
    applied: 13,
    skipped: 0,
    complete: true,
  });
  const after = await f.counts();
  expect(await f.apply()).toMatchObject({ applied: 0, skipped: 13 });
  expect(await f.counts()).toEqual(after);
  expect(await f.apply(false, 3)).toMatchObject({
    applied: 0,
    skipped: 3,
    complete: true,
  });
  expect(await f.counts()).toEqual(after);
  expect(
    await f.c("owner").query(internal.migration.status, { key: f.data.key }),
  ).toMatchObject({ expected: 13, applied: 13, complete: true });
});
it("migration resumes verified checkpoints and rejects changed source without duplicate writes", async () => {
  const f = await fixture();
  await f.apply(false, 3);
  expect(await f.apply()).toMatchObject({ applied: 10, skipped: 3 });
  const changed = structuredClone(f.data);
  changed.rows[0].args.input = {
    op: "realtor_create",
    data: { first_name: "Changed" },
  };
  await expect(f.apply(false, 13, JSON.stringify(changed))).rejects.toThrow(
    "MIGRATION_SOURCE_CHANGED",
  );
});
it("migration is denied for production, shared development, anonymous and non-Owner operators", async () => {
  const f = await fixture();
  for (const role of [
    "sales",
    "admin",
    "marketing",
    "designer",
    "staging_crew",
  ] as const)
    await expect(
      f.c(role).mutation(internal.migration.apply, {
        input: f.input,
        dry_run: false,
        through: 1,
      }),
    ).rejects.toThrow();
  await expect(
    f.t.mutation(internal.migration.apply, {
      input: f.input,
      dry_run: false,
      through: 1,
    }),
  ).rejects.toThrow();
  vi.stubEnv("GLARA_ENVIRONMENT", "production");
  await expect(f.apply()).rejects.toThrow("ISOLATED_MIGRATION_ONLY");
  vi.stubEnv("GLARA_ENVIRONMENT", "development");
  vi.stubEnv(
    "CONVEX_SITE_URL",
    "https://woozy-jaguar-392.eu-west-1.convex.site",
  );
  await expect(f.apply()).rejects.toThrow("ISOLATED_MIGRATION_ONLY");
  vi.stubEnv("CONVEX_SITE_URL", "http://127.0.0.1:3321");
  vi.stubEnv("GLARA_MIGRATION_ENABLED", "false");
  await expect(f.apply()).rejects.toThrow("ISOLATED_MIGRATION_ONLY");
});
it.each(["malformed", "duplicate", "parent", "role", "money", "date"])(
  "invalid %s migration leaves no partial phase writes",
  async (kind) => {
    const f = await fixture(),
      data = structuredClone(f.data),
      before = await f.counts();
    if (kind === "duplicate") data.rows[1].stable_id = data.rows[0].stable_id;
    if (kind === "parent") data.rows[0].args.input = { $ref: "absent" };
    if (kind === "role") data.staff.sales = "invalid";
    if (kind === "money") data.rows[11].args.amount = "NaN";
    if (kind === "date") data.rows[11].args.received_date = "2026-02-31";
    await expect(
      f.apply(false, 13, kind === "malformed" ? "{" : JSON.stringify(data)),
    ).rejects.toThrow();
    expect(await f.counts()).toEqual(before);
  },
);
it("migration packages reject secrets, unsupported commands and unbounded batches", () => {
  for (const input of [
    "{}",
    JSON.stringify({ version: 1, rows: Array(101).fill({}) }),
  ])
    expect(() => validatePackage(input)).toThrow();
});
