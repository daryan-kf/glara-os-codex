import "server-only";
import { randomUUID } from "node:crypto";
import { writeOperationalEvent } from "./observability/model";
type Event = "auth_failed" | "profile_load_failed" | "logout_failed";
export function logEvent(event: Event) {
  writeOperationalEvent(
    { emit: (record) => console.warn(JSON.stringify(record)) },
    {
      module: "authentication",
      operation: event === "logout_failed" ? "revoke" : "request",
      code: "UNAVAILABLE",
      correlation_id: randomUUID(),
    },
  );
}

import { crmLogContext } from "./crm/errors";
export function logCrmFailure(operation: unknown, error: unknown) {
  console.warn(
    JSON.stringify({
      ...crmLogContext(operation, error),
      correlation_id: randomUUID(),
      timestamp: new Date().toISOString(),
    }),
  );
}
