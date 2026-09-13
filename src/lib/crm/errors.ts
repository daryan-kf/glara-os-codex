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
    "CRM configuration needs attention. Ask your administrator to apply the current migrations and refresh the API schema.",
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
  const value =
    error && typeof error === "object"
      ? (error as Record<string, unknown>)
      : {};
  const code =
    typeof value.code === "string" &&
    /^(?:[0-9A-Z]{5}|PGRST[0-9]{3}|CONFIG_SHAPE)$/.test(value.code)
      ? value.code
      : "UNKNOWN";
  const message = typeof value.message === "string" ? value.message : "";
  let category: CrmErrorCategory = "retry";
  if (code === "42501") category = "permission";
  else if (
    ["42883", "42P01", "PGRST202", "PGRST204", "CONFIG_SHAPE"].includes(code)
  )
    category = "configuration";
  else if (code === "23505") category = "duplicate";
  else if (code === "40001" || message.startsWith("This record changed."))
    category = "conflict";
  else if (
    code === "P0001" &&
    message.startsWith("A prospect needs a next action.")
  )
    category = "next_action";
  else if (
    code === "P0001" &&
    /^(Realtor is archived|This activity is no longer open|Realtor unavailable)/.test(
      message,
    )
  )
    category = "unavailable";
  else if (
    /^(22|23)/.test(code) ||
    (code === "P0001" &&
      /^(Select an active|Contact completion cannot)/.test(message))
  )
    category = "validation";
  return { code, category, message: crmMessages[category] };
}
export function crmLogContext(operation: unknown, error: unknown) {
  const classified = classifyCrmError(error);
  return {
    event: "crm_database_failure",
    operation:
      typeof operation === "string" && operations.has(operation)
        ? operation
        : "unknown",
    database_code: classified.code,
    category: classified.category,
  };
}
