import { z } from "zod";
export const modules = [
  "application",
  "authentication",
  "backend",
  "automation",
  "ai",
  "email",
  "calendar",
  "reconciliation",
  "backup",
  "inventory",
  "financial",
] as const;
export const operations = [
  "request",
  "dispatch",
  "queue",
  "verify",
  "restore",
  "backup",
  "revoke",
  "freeze",
] as const;
export const codes = [
  "UNAVAILABLE",
  "DENIED",
  "RATE_LIMITED",
  "CIRCUIT_PAUSED",
  "QUEUE_LAG",
  "UNKNOWN_DELIVERY",
  "DRIFT",
  "BACKUP_FAILED",
  "BACKUP_STALE",
  "NOT_CONFIGURED",
  "RECOVERED",
] as const;
const eventInput = z.object({
  module: z.enum(modules),
  operation: z.enum(operations),
  code: z.enum(codes),
  correlation_id: z.uuid(),
});
// Deliberately construct a whitelist; errors, payloads, addresses, tokens and headers never reach a sink.
export function safeOperationalEvent(input: unknown, now = Date.now()) {
  const parsed = eventInput.safeParse(input);
  if (!parsed.success) return null;
  return { timestamp: new Date(now).toISOString(), ...parsed.data };
}
export type OperationalEvent = NonNullable<
  ReturnType<typeof safeOperationalEvent>
>;
export interface OperationalSink {
  emit(event: OperationalEvent): void;
}
export function writeOperationalEvent(sink: OperationalSink, input: unknown) {
  const event = safeOperationalEvent(input);
  if (event) sink.emit(event);
}
export type Health = {
  email: {
    enabled: boolean;
    paused: boolean;
    lag_minutes: number;
    unknown: number;
    provider_failures: number;
    partial: boolean;
  };
  automation: { frozen: boolean; failed: number; partial: boolean };
  ai: { frozen: boolean; failed: number; partial: boolean };
  reconciliation: { verified: boolean; drift: number };
  backup: {
    status: "unknown" | "verified" | "failed";
    verified_at: number | null;
    max_age_ms: number;
  };
};
export function healthSignals(health: Health, now = Date.now()) {
  const signals: {
    key: string;
    priority: "high" | "medium";
    state: "attention" | "unknown";
  }[] = [];
  const add = (
    key: string,
    priority: "high" | "medium",
    state: "attention" | "unknown" = "attention",
  ) => signals.push({ key, priority, state });
  if (health.email.paused && health.email.enabled)
    add("email.circuit_pause", "high");
  if (health.email.lag_minutes >= 15) add("email.queue_lag", "medium");
  if (health.email.unknown) add("email.unknown_delivery", "high");
  if (health.email.provider_failures >= 3)
    add("email.provider_failure", "high");
  if (health.automation.failed) add("automation.failures", "high");
  if (health.ai.failed >= 3) add("ai.provider_failure", "medium");
  if (health.reconciliation.drift) add("reconciliation.drift", "high");
  if (!health.reconciliation.verified)
    add("reconciliation.unverified", "high", "unknown");
  if (health.backup.status === "failed") add("backup.failed", "high");
  else if (
    health.backup.status !== "verified" ||
    health.backup.verified_at === null
  )
    add("backup.unverified", "high", "unknown");
  else if (now - health.backup.verified_at > health.backup.max_age_ms)
    add("backup.stale", "high");
  return signals; // Stable keys support aggregation; no external alert sends or self-email loop.
}
