import { expect, it } from "vitest";
import { planRestore, reconcileRestore } from "../../src/lib/recovery/model";
const manifest = {
  backup_id: "fictional-001",
  source_environment: "development",
  source_deployment: "fictional-source",
  source_commit: "a".repeat(40),
  created_at: "2026-09-16T00:00:00Z",
  sha256: "b".repeat(64),
  bytes: 100,
  includes_file_storage: true,
  encrypted_at_rest: true,
  restricted_store_reference: "restricted-backup:fictional-001",
  tables: [{ name: "realtors", rows: 3 }],
};
const target = {
  environment: "isolated_restore",
  deployment: "fictional-target",
  empty_verified: true,
  recovery_mode: true,
  email_enabled: false,
  calendar_enabled: false,
  automation_enabled: false,
  ai_enabled: false,
  provider_credentials_present: false,
};
it("restore preflight rejects shared, source, production, nonempty and outbound-enabled targets", () => {
  for (const patch of [
    { deployment: "woozy-jaguar-392" },
    { deployment: manifest.source_deployment },
    { environment: "production" },
    { empty_verified: false },
    { email_enabled: true },
    { calendar_enabled: true },
    { provider_credentials_present: true },
    { recovery_mode: false },
  ])
    expect(() =>
      planRestore(manifest, { ...target, ...patch }, manifest.sha256, 100),
    ).toThrow();
  expect(planRestore(manifest, target, manifest.sha256, 100)).toMatchObject({
    restore_verified: false,
    destructive_replace_allowed: false,
  });
});
it("restore preflight rejects tampered/truncated/unprotected backups and duplicate inventory", () => {
  expect(() => planRestore(manifest, target, "c".repeat(64), 100)).toThrow(
    "BACKUP_INTEGRITY_FAILED",
  );
  expect(() => planRestore(manifest, target, manifest.sha256, 99)).toThrow();
  expect(() =>
    planRestore(
      { ...manifest, encrypted_at_rest: false },
      target,
      manifest.sha256,
      100,
    ),
  ).toThrow();
  expect(() =>
    planRestore(
      { ...manifest, tables: [...manifest.tables, ...manifest.tables] },
      target,
      manifest.sha256,
      100,
    ),
  ).toThrow("DUPLICATE_TABLE");
});
it("restore comparison cannot pass with absent checks, duplicates or unexplained financial drift", () => {
  expect(reconcileRestore([]).passed).toBe(false);
  const names = [
    "table_counts",
    "relationships",
    "financial_balances",
    "inventory_identity",
    "inventory_reservations",
    "analytics",
    "audit_actor_history",
    "storage_integrity",
    "role_denial",
    "outbound_disabled",
  ];
  const checks = names.map((name) => ({ name, before: 1, after: 1 }));
  expect(reconcileRestore(checks).passed).toBe(true);
  expect(reconcileRestore([...checks, checks[0]]).passed).toBe(false);
  checks[2].after = 2;
  expect(reconcileRestore(checks)).toMatchObject({
    passed: false,
    mismatches: ["financial_balances"],
  });
});
