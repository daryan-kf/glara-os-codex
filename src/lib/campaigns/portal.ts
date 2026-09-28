// Separate, default-closed access to a read-only campaign portal.
export function campaignPortalEnabled(env: Record<string, string | undefined>) {
  if (
    env.GLARA_EXPO_ADMIN_ENABLED !== "true" ||
    env.GLARA_PUBLIC_CAMPAIGN_ONLY !== "true" ||
    env.GLARA_RECOVERY_MODE === "true"
  )
    return false;
  if (env.GLARA_ENVIRONMENT === "development") return true;
  return (
    env.GLARA_ENVIRONMENT === "production" &&
    env.GLARA_PRODUCTION_APPROVED === "true" &&
    env.GLARA_PRODUCTION_EXPO_ADMIN_APPROVED === "true" &&
    env.GLARA_ACCEPTANCE_MODE !== "true" &&
    !env.GLARA_ACCEPTANCE_PASSWORDS
  );
}

export function campaignPortalPathAllowed(path: string) {
  return ["/campaign-admin", "/api/campaign-auth"].includes(
    path.replace(/\/$/, ""),
  );
}
