import "server-only";
type Event = "auth_failed" | "profile_load_failed" | "logout_failed";
export function logEvent(event: Event) {
  console.warn(JSON.stringify({ event, timestamp: new Date().toISOString() }));
}

import { crmLogContext } from "./crm/errors";
export function logCrmFailure(operation: unknown, error: unknown) {
  console.warn(
    JSON.stringify({
      ...crmLogContext(operation, error),
      timestamp: new Date().toISOString(),
    }),
  );
}
