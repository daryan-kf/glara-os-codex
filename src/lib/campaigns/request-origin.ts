import { applicationOrigin } from "../security/origin";

export function campaignRequestOriginAllowed(
  request: Request,
  env: Record<string, string | undefined>,
) {
  try {
    const environment =
      env.GLARA_ENVIRONMENT === "production" ? "production" : "development";
    const canonical = applicationOrigin(env.SITE_URL, environment);
    if (request.headers.get("origin") !== canonical) return false;
    const destination = new URL(request.url).origin;
    if (destination === canonical) return true;
    // External rewrites change the destination host, not the browser's Origin.
    // Allow only the configured zone; never trust forwarding headers.
    return (
      environment === "production" &&
      env.VERCEL === "1" &&
      env.GLARA_PUBLIC_CAMPAIGN_ONLY === "true" &&
      destination ===
        applicationOrigin(env.GLARA_EXPO_UPSTREAM_ORIGIN, "production")
    );
  } catch {
    return false;
  }
}
