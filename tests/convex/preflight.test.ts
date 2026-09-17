import { expect, it } from "vitest";
import {
  evaluateConfiguration,
  frontendConfigurationAllowed,
  productionCapabilityAllowed,
  type ConfigurationPlan,
} from "../../src/lib/security/preflight";
import { contentSecurityPolicy } from "../../src/lib/security/csp";
const plan: ConfigurationPlan = {
  environment: "production",
  deployment: "prod:fictional-target",
  application_origin: "https://app.example.test",
  backend_origin: "https://fictional-target.convex.site",
  approved_hosts: ["app.example.test", "fictional-target.convex.site"],
  values: { GLARA_ENVIRONMENT: "production" },
  credentials: [],
  approved_features: [],
  calendar_gate_passed: false,
};
it("offline preflight accepts disabled features without inventing secret/domain approval", () => {
  const r = evaluateConfiguration(plan);
  expect(r.valid).toBe(true);
  expect(r.features.every((f) => !f.enabled)).toBe(true);
  expect(r.features.find((f) => f.feature === "calendar")?.stage).toBe(
    "intentionally_deferred",
  );
});
it("preflight rejects origin confusion, malformed configuration and environment crossover", () => {
  for (const origin of [
    "http://app.example.test",
    "https://user:password@app.example.test",
    "https://app.example.test:8443",
    "https://localhost",
    "https://app.example.test/path",
    "https://app.example.test?x=1",
    "https://woozy-jaguar-392.convex.site",
    "bad",
  ])
    expect(
      evaluateConfiguration({ ...plan, application_origin: origin }).valid,
    ).toBe(false);
  for (const mutation of [
    { environment: "unknown" },
    { deployment: "dev:fictional-target" },
    { backend_origin: "https://woozy-jaguar-392.convex.site" },
    { values: {} },
    { values: { ...plan.values, GLARA_ACCEPTANCE_MODE: "true" } },
    {
      values: {
        ...plan.values,
        M9_EMAIL_TEST_ALLOWLIST: "fictional@example.test",
      },
    },
    {
      credentials: [
        {
          name: "OPENAI_API_KEY",
          environment: "development",
          custody_verified: true,
          distinct_from_development: false,
        },
      ],
    },
  ])
    expect(evaluateConfiguration({ ...plan, ...mutation }).valid).toBe(false);
});
it("preflight cannot enable providers using flags without stage-specific evidence", () => {
  for (const flag of [
    "M9_EMAIL_ENABLED",
    "M9_CALENDAR_ENABLED",
    "GLARA_AI_SECURITY_APPROVED",
    "GLARA_AUTOMATION_ENABLED",
    "AUTH_EMAIL_ENABLED",
  ])
    expect(
      evaluateConfiguration({
        ...plan,
        values: { ...plan.values, [flag]: "true" },
      }).valid,
    ).toBe(false);
  expect(
    evaluateConfiguration({
      ...plan,
      approved_features: ["calendar"],
      values: {
        ...plan.values,
        M9_CALENDAR_ENABLED: "true",
        M9_GOOGLE_CALENDAR_ID: "primary",
      },
    }).issues,
  ).toContain("CALENDAR_DEFERRED");
  const result = evaluateConfiguration({
    ...plan,
    values: { ...plan.values, OPENAI_API_KEY: "fictional-private-canary" },
  });
  expect(result.valid).toBe(false);
  expect(JSON.stringify(result)).not.toContain("fictional-private-canary");
});
it("production execution stays closed without explicit server-owned rollout approval", () => {
  for (const cap of [
    "email",
    "calendar",
    "ai",
    "automation",
    "auth_email",
    "onboarding",
    "financial",
    "inventory",
  ])
    expect(
      productionCapabilityAllowed({ GLARA_ENVIRONMENT: "production" }, cap),
    ).toBe(false);
  expect(
    productionCapabilityAllowed({ GLARA_ENVIRONMENT: "invalid" }, "email"),
  ).toBe(false);
  expect(
    productionCapabilityAllowed(
      { GLARA_ENVIRONMENT: "production", GLARA_PRODUCTION_APPROVED: "true" },
      "financial",
    ),
  ).toBe(true);
  expect(
    productionCapabilityAllowed(
      { GLARA_ENVIRONMENT: "production", GLARA_PRODUCTION_APPROVED: "true" },
      "email",
    ),
  ).toBe(false);
  expect(
    productionCapabilityAllowed(
      {
        GLARA_ENVIRONMENT: "production",
        GLARA_PRODUCTION_APPROVED: "true",
        GLARA_ACCEPTANCE_MODE: "true",
      },
      "financial",
    ),
  ).toBe(false);
});
it("production CSP scopes network to the configured backend and forbids inline script handlers/eval/frames", () => {
  const csp = contentSecurityPolicy(
    "123456789012345678901234",
    "https://fictional.convex.cloud",
    false,
  );
  expect(csp).toContain("script-src-attr 'none'");
  expect(csp).not.toContain("unsafe-eval");
  expect(csp).toContain("wss://fictional.convex.cloud");
  expect(csp).toContain("frame-src 'none'");
  expect(() =>
    contentSecurityPolicy("x;script-src *", undefined, false),
  ).toThrow();
  expect(() =>
    contentSecurityPolicy(
      "123456789012345678901234",
      "https://example.test/path",
      false,
    ),
  ).toThrow();
});

it("production frontend rejects accidental development targets, missing authorization and mismatched public URLs", () => {
  const env = {
    GLARA_ENVIRONMENT: "production",
    GLARA_PRODUCTION_APPROVED: "true",
    CONVEX_DEPLOYMENT: "prod:fictional-production",
    SITE_URL: "https://app.example.test",
    NEXT_PUBLIC_CONVEX_URL:
      "https://fictional-production.eu-west-1.convex.cloud",
    NEXT_PUBLIC_CONVEX_SITE_URL:
      "https://fictional-production.eu-west-1.convex.site",
  };
  expect(frontendConfigurationAllowed(env)).toBe(true);
  for (const patch of [
    { GLARA_PRODUCTION_APPROVED: "false" },
    { CONVEX_DEPLOYMENT: "dev:fictional-production" },
    {
      CONVEX_DEPLOYMENT: "prod:woozy-jaguar-392",
      NEXT_PUBLIC_CONVEX_URL: "https://woozy-jaguar-392.eu-west-1.convex.cloud",
    },
    { NEXT_PUBLIC_CONVEX_URL: "https://other.convex.cloud" },
    { NEXT_PUBLIC_CONVEX_SITE_URL: "https://other.convex.site" },
    { SITE_URL: "http://localhost:3000" },
    { GLARA_ACCEPTANCE_MODE: "true" },
    { GLARA_ENVIRONMENT: "invalid" },
  ])
    expect(frontendConfigurationAllowed({ ...env, ...patch })).toBe(false);
  expect(
    frontendConfigurationAllowed({
      NEXT_PUBLIC_CONVEX_URL: "http://127.0.0.1:3350",
      GLARA_ENVIRONMENT: "development",
    }),
  ).toBe(true);
});
