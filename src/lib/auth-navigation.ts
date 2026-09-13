"use client";
/** Discard cached workspace content and auth provider state after an identity change. */
export function reloadAfterAuth(
  path:
    | "/dashboard"
    | "/login"
    | "/login?status=password-updated"
    | "/login?status=logout-error",
) {
  window.location.assign(path);
}
