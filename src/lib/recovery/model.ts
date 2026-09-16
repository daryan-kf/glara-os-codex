import { z } from "zod";
const safeId = z.string().regex(/^[a-zA-Z0-9._-]{1,100}$/);
export const backupManifest = z
  .object({
    backup_id: safeId,
    source_environment: z.enum([
      "development",
      "isolated_restore",
      "production",
    ]),
    source_deployment: safeId,
    source_commit: z.string().regex(/^[a-f0-9]{40}$/),
    created_at: z.iso.datetime({ offset: true }),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive(),
    includes_file_storage: z.literal(true),
    encrypted_at_rest: z.literal(true),
    restricted_store_reference: z
      .string()
      .regex(/^restricted-backup:[a-zA-Z0-9._-]+$/),
    tables: z
      .array(
        z
          .object({ name: safeId, rows: z.number().int().nonnegative() })
          .strict(),
      )
      .min(1),
  })
  .strict();
export const restoreTarget = z
  .object({
    environment: z.literal("isolated_restore"),
    deployment: safeId,
    empty_verified: z.literal(true),
    recovery_mode: z.literal(true),
    email_enabled: z.literal(false),
    calendar_enabled: z.literal(false),
    automation_enabled: z.literal(false),
    ai_enabled: z.literal(false),
    provider_credentials_present: z.literal(false),
  })
  .strict();
// Preflight metadata is necessary, never sufficient evidence of an actual restore.
export function planRestore(
  rawManifest: unknown,
  rawTarget: unknown,
  actualSha256: string,
  actualBytes: number,
) {
  const manifest = backupManifest.parse(rawManifest),
    target = restoreTarget.parse(rawTarget);
  if (
    target.deployment === manifest.source_deployment ||
    target.deployment === "woozy-jaguar-392"
  )
    throw new Error("RESTORE_TARGET_UNSAFE");
  if (manifest.sha256 !== actualSha256 || manifest.bytes !== actualBytes)
    throw new Error("BACKUP_INTEGRITY_FAILED");
  if (
    new Set(manifest.tables.map((t) => t.name)).size !== manifest.tables.length
  )
    throw new Error("DUPLICATE_TABLE");
  return {
    backup_id: manifest.backup_id,
    target: target.deployment,
    destructive_replace_allowed: false,
    status: "PREFLIGHT_ONLY" as const,
    restore_verified: false,
  };
}
export type Comparison = {
  name: string;
  before: string | number;
  after: string | number;
};
export function reconcileRestore(checks: Comparison[]) {
  const required = [
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
  const names = new Set(checks.map((c) => c.name));
  return {
    passed:
      names.size === checks.length &&
      required.every((n) => names.has(n)) &&
      checks.every((c) => c.before === c.after),
    missing: required.filter((n) => !names.has(n)),
    mismatches: checks.filter((c) => c.before !== c.after).map((c) => c.name),
  };
}
