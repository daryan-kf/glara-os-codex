import type { Role } from "../permissions";

// This is an authenticated-console shortcut, never a second data connection.
export function liveCampaignAccess(
  roles: readonly Role[],
  env: Record<string, string | undefined>,
) {
  const deployment = env.GLARA_LIVE_CAMPAIGN_DEPLOYMENT;
  if (
    !roles.includes("owner") ||
    env.GLARA_PUBLIC_CAMPAIGN_ONLY === "true" ||
    !deployment ||
    !/^[a-z]+(?:-[a-z]+)+-[0-9]+$/.test(deployment)
  )
    return null;
  let workspaceHost: string;
  try {
    workspaceHost = new URL(env.NEXT_PUBLIC_CONVEX_URL ?? "").hostname;
  } catch {
    return null;
  }
  if (
    workspaceHost === `${deployment}.convex.cloud` ||
    workspaceHost.startsWith(`${deployment}.`)
  )
    return null;
  const base = `https://dashboard.convex.dev/d/${deployment}/data`;
  return {
    registrations: `${base}?table=campaign_entries`,
    realtors: `${base}?table=realtors`,
    receipts: `${base}?table=campaign_receipts`,
  };
}
