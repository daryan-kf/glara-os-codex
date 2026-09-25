import { expect, test } from "vitest";
import { campaignRequestOriginAllowed } from "../../src/lib/campaigns/request-origin";
const canonical = "https://glarahome.com";
const upstream = "https://glara-giveaway-production.vercel.app";
const env = {
  SITE_URL: canonical,
  GLARA_ENVIRONMENT: "production",
  VERCEL: "1",
  GLARA_PUBLIC_CAMPAIGN_ONLY: "true",
  GLARA_EXPO_UPSTREAM_ORIGIN: upstream,
};
function request(destination: string, origin?: string, forwarded?: string) {
  return new Request(`${destination}/api/giveaway`, {
    method: "POST",
    headers: {
      ...(origin ? { origin } : {}),
      ...(forwarded
        ? { "x-forwarded-host": forwarded, "x-forwarded-proto": "https" }
        : {}),
    },
  });
}
test("canonical and configured zone accept the canonical browser origin", () => {
  expect(campaignRequestOriginAllowed(request(canonical, canonical), env)).toBe(
    true,
  );
  expect(campaignRequestOriginAllowed(request(upstream, canonical), env)).toBe(
    true,
  );
});
test.each([
  undefined,
  "null",
  upstream,
  "https://attacker.test",
  `${canonical}.attacker.test`,
])("rejects absent or foreign origin %s through the approved zone", (origin) =>
  expect(campaignRequestOriginAllowed(request(upstream, origin), env)).toBe(
    false,
  ),
);
test("forwarded headers cannot authorize another destination", () => {
  expect(
    campaignRequestOriginAllowed(
      request("https://attacker.test", canonical, "glarahome.com"),
      env,
    ),
  ).toBe(false);
});
test.each([
  { GLARA_EXPO_UPSTREAM_ORIGIN: undefined },
  { GLARA_EXPO_UPSTREAM_ORIGIN: "http://localhost:3000" },
  { GLARA_EXPO_UPSTREAM_ORIGIN: `${upstream}/path` },
  { VERCEL: undefined },
  { GLARA_PUBLIC_CAMPAIGN_ONLY: "false" },
  { GLARA_ENVIRONMENT: "development" },
])("zone exception fails closed for invalid configuration %o", (override) => {
  expect(
    campaignRequestOriginAllowed(request(upstream, canonical), {
      ...env,
      ...override,
    }),
  ).toBe(false);
});
