export function communicationError(error: unknown) {
  const candidate =
    error && typeof error === "object" && "data" in error ? error.data : null;
  const code =
    candidate && typeof candidate === "object" && "code" in candidate
      ? String(candidate.code)
      : "";
  const messages: Record<string, string> = {
    FORBIDDEN: "You no longer have permission to access this source.",
    INVALID_INPUT: "Review the recipient and required form fields.",
    CONFLICT: "This record changed. Refresh and review it again.",
    UNAVAILABLE: "The source record is unavailable or archived.",
    CONFIGURATION_REQUIRED:
      "Development provider configuration is required. Delivery remains disabled.",
    SECOND_REVIEW_REQUIRED:
      "A different authorized reviewer must approve this message.",
    RATE_LIMIT:
      "Recent contact or the daily limit requires waiting before another send.",
  };
  return (
    messages[code] ??
    "The request could not be completed. Please retry or ask your administrator."
  );
}
