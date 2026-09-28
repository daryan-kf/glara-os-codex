import { test } from "node:test";
import assert from "node:assert/strict";
import { liveCampaignAccess } from "../src/lib/campaigns/live-access";
import { roles } from "../src/lib/permissions";
const env = {
  GLARA_LIVE_CAMPAIGN_DEPLOYMENT: "fictional-campaign-123",
  NEXT_PUBLIC_CONVEX_URL: "https://fictional-development-456.convex.cloud",
};
test("live campaign shortcut never exposes a session or bypasses console login", () => {
  const links = liveCampaignAccess(["owner"], env);
  assert.equal(
    links?.registrations,
    "https://dashboard.convex.dev/d/fictional-campaign-123/data?table=campaign_entries",
  );
  for (const value of Object.values(links!)) {
    const url = new URL(value);
    assert.equal(url.origin, "https://dashboard.convex.dev");
    assert.deepEqual([...url.searchParams.keys()], ["table"]);
  }
});
test("shortcut is owner-only and absent from public campaigns", () => {
  for (const role of roles.filter((r) => r !== "owner"))
    assert.equal(liveCampaignAccess([role], env), null);
  assert.equal(liveCampaignAccess([], env), null);
  assert.equal(
    liveCampaignAccess(["owner"], {
      ...env,
      GLARA_PUBLIC_CAMPAIGN_ONLY: "true",
    }),
    null,
  );
});
test("shortcut fails closed for missing/unsafe config and same live workspace", () => {
  for (const deployment of [
    undefined,
    "",
    "https://evil.example",
    "../other",
    "live?token=secret",
  ])
    assert.equal(
      liveCampaignAccess(["owner"], {
        ...env,
        GLARA_LIVE_CAMPAIGN_DEPLOYMENT: deployment,
      }),
      null,
    );
  for (const url of [
    "",
    "not-a-url",
    "https://fictional-campaign-123.convex.cloud",
    "https://fictional-campaign-123.eu-west-1.convex.cloud",
  ])
    assert.equal(
      liveCampaignAccess(["owner"], { ...env, NEXT_PUBLIC_CONVEX_URL: url }),
      null,
    );
});
