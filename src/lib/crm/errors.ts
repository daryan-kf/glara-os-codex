const operations = new Set([
  "list",
  "search",
  "detail",
  "activities",
  "followups",
  "choices",
  "sources",
  "brokerages",
  "brokerage",
  "brokerage_options",
  "realtor_create",
  "realtor_update",
  "realtor_archive",
  "realtor_restore",
  "activity_create",
  "activity_complete",
  "activity_cancel",
  "activity_reschedule",
  "brokerage_save",
  "source_save",
]);
export const crmMessages = {
  permission: "Your account cannot access or change this CRM record.",
  configuration:
    "CRM configuration needs attention. Ask your administrator to verify the backend deployment.",
  validation: "Some fields are invalid. Review the form and try again.",
  duplicate:
    "An active record already uses this email, phone, or name. Review the existing record; records are never merged automatically.",
  conflict: "This record changed. Reload before saving.",
  next_action:
    "A prospect needs a next action. Add a replacement or change its relationship status before closing the last action.",
  unavailable:
    "This record is archived, unavailable or no longer open. Reload before trying again.",
  retry:
    "CRM is temporarily unavailable. Please retry or reload. If this continues, contact your administrator.",
} as const;
export type CrmErrorCategory = keyof typeof crmMessages;
export function classifyCrmError(error: unknown): {
  code: string;
  category: CrmErrorCategory;
  message: string;
} {
  const candidate =
    error && typeof error === "object" && "data" in error ? error.data : error;
  const value =
    candidate && typeof candidate === "object"
      ? (candidate as Record<string, unknown>)
      : {};
  const categories: Record<string, CrmErrorCategory> = {
    FORBIDDEN: "permission",
    CONFIGURATION: "configuration",
    INVALID_INPUT: "validation",
    DUPLICATE: "duplicate",
    CONFLICT: "conflict",
    NEXT_ACTION_REQUIRED: "next_action",
    UNAVAILABLE: "unavailable",
  };
  const code =
    typeof value.code === "string" && Object.hasOwn(categories, value.code)
      ? value.code
      : "UNKNOWN";
  const category = categories[code] ?? "retry";
  return { code, category, message: crmMessages[category] };
}
export function crmLogContext(operation: unknown, error: unknown) {
  const classified = classifyCrmError(error);
  return {
    event: "crm_backend_failure",
    operation:
      typeof operation === "string" && operations.has(operation)
        ? operation
        : "unknown",
    error_code: classified.code,
    category: classified.category,
  };
}
