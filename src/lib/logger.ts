import "server-only";
type Event = "auth_failed" | "profile_load_failed" | "logout_failed";
export function logEvent(event: Event) {
  console.warn(JSON.stringify({ event, timestamp: new Date().toISOString() }));
}
