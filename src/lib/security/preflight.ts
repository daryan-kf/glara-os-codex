import { z } from "zod";
const environment = z.enum(["development", "production"]);
const feature = z.enum(["email", "calendar", "ai", "automation", "auth_email"]);
export const configurationPlan = z
  .object({
    environment,
    deployment: z.string().regex(/^(dev|prod):[a-z0-9-]+$/),
    application_origin: z.string(),
    backend_origin: z.string(),
    approved_hosts: z.array(z.string().regex(/^[a-z0-9.-]+$/)).min(1),
    values: z.record(z.string(), z.string()),
    credentials: z.array(
      z
        .object({
          name: z.enum([
            "M9_RESEND_KEY",
            "M9_RESEND_WEBHOOK_SECRET",
            "M9_UNSUBSCRIBE_SECRET",
            "M9_GOOGLE_CLIENT_ID",
            "M9_GOOGLE_CLIENT_SECRET",
            "M9_GOOGLE_REFRESH_TOKEN",
            "OPENAI_API_KEY",
            "AUTH_RESEND_KEY",
            "JWT_PRIVATE_KEY",
          ]),
          environment,
          custody_verified: z.boolean(),
          distinct_from_development: z.boolean(),
        })
        .strict(),
    ),
    approved_features: z.array(feature),
    calendar_gate_passed: z.boolean(),
  })
  .strict();
export type ConfigurationPlan = z.infer<typeof configurationPlan>;
const flags = {
  email: "M9_EMAIL_ENABLED",
  calendar: "M9_CALENDAR_ENABLED",
  ai: "GLARA_AI_SECURITY_APPROVED",
  automation: "GLARA_AUTOMATION_ENABLED",
  auth_email: "AUTH_EMAIL_ENABLED",
} as const;
const secrets = {
  email: ["M9_RESEND_KEY", "M9_RESEND_WEBHOOK_SECRET", "M9_UNSUBSCRIBE_SECRET"],
  calendar: ["M9_GOOGLE_CLIENT_SECRET", "M9_GOOGLE_REFRESH_TOKEN"],
  ai: ["OPENAI_API_KEY"],
  automation: [],
  auth_email: ["AUTH_RESEND_KEY"],
} as const;
// Takes a NON-SECRET plan; metadata is an operator attestation, not proof of provider custody.
export function evaluateConfiguration(input: unknown) {
  const parsed = configurationPlan.safeParse(input);
  if (!parsed.success)
    return {
      valid: false,
      issues: ["INVALID_CONFIGURATION_PLAN"],
      features: [],
    };
  const p = parsed.data,
    issues: string[] = [],
    production = p.environment === "production";
  const safeNames = new Set([
    ...Object.values(flags),
    "GLARA_ENVIRONMENT",
    "GLARA_ACCEPTANCE_MODE",
    "GLARA_ACCEPTANCE_PASSWORDS",
    "M9_EMAIL_TEST_ALLOWLIST",
    "M9_EMAIL_VERIFIED",
    "M9_GOOGLE_CALENDAR_ID",
    "GLARA_AI_MODEL",
    "M9_PUBLIC_HTTP_ORIGIN",
  ]);
  if (Object.keys(p.values).some((k) => !safeNames.has(k)))
    issues.push("UNEXPECTED_PLAN_VALUE");
  if (
    p.deployment.startsWith("prod:") !== production ||
    p.values.GLARA_ENVIRONMENT !== p.environment
  )
    issues.push("ENVIRONMENT_MISMATCH");
  const validOrigin = (raw: string, backend = false) => {
    try {
      const u = new URL(raw),
        loopback = ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname);
      return (
        !u.username &&
        !u.password &&
        u.pathname === "/" &&
        !u.search &&
        !u.hash &&
        p.approved_hosts.includes(u.hostname) &&
        (!u.port || (!production && loopback)) &&
        (u.protocol === "https:" ||
          (!production && loopback && u.protocol === "http:")) &&
        (!production || !loopback) &&
        (!backend || u.hostname === p.deployment.split(":")[1] + ".convex.site")
      );
    } catch {
      return false;
    }
  };
  if (!validOrigin(p.application_origin))
    issues.push("APPLICATION_ORIGIN_INVALID");
  if (!validOrigin(p.backend_origin, true))
    issues.push("BACKEND_ORIGIN_INVALID");
  if (
    production &&
    ((p.values.GLARA_ACCEPTANCE_MODE !== undefined &&
      p.values.GLARA_ACCEPTANCE_MODE !== "false") ||
      p.values.GLARA_ACCEPTANCE_PASSWORDS ||
      p.values.M9_EMAIL_TEST_ALLOWLIST)
  )
    issues.push("PRODUCTION_TEST_CONFIGURATION");
  for (const c of p.credentials)
    if (
      c.environment !== p.environment ||
      (production && !c.distinct_from_development)
    )
      issues.push("CREDENTIAL_ENVIRONMENT_MISMATCH:" + c.name);
  const features = Object.entries(flags).map(([name, flag]) => {
    const f = name as keyof typeof flags,
      raw = p.values[flag],
      enabled = raw === "true";
    if (raw !== undefined && raw !== "true" && raw !== "false")
      issues.push("INVALID_FLAG:" + flag);
    if (enabled) {
      if (!p.approved_features.includes(f))
        issues.push("FEATURE_UNAPPROVED:" + f);
      if (f === "calendar" && !p.calendar_gate_passed)
        issues.push("CALENDAR_DEFERRED");
      if (
        f === "email" &&
        (p.values.M9_EMAIL_VERIFIED !== "true" ||
          p.values.M9_PUBLIC_HTTP_ORIGIN !== p.backend_origin)
      )
        issues.push("EMAIL_PREREQUISITES");
      if (
        f === "calendar" &&
        (!p.values.M9_GOOGLE_CALENDAR_ID ||
          p.values.M9_GOOGLE_CALENDAR_ID === "primary")
      )
        issues.push("DEDICATED_CALENDAR_REQUIRED");
      if (f === "ai" && !p.values.GLARA_AI_MODEL)
        issues.push("AI_MODEL_REQUIRED");
      for (const key of secrets[f])
        if (
          !p.credentials.some(
            (c) =>
              c.name === key &&
              c.custody_verified &&
              c.environment === p.environment,
          )
        )
          issues.push("CREDENTIAL_ATTESTATION_REQUIRED:" + key);
    }
    return {
      feature: f,
      enabled,
      stage: enabled
        ? "before_feature_enablement"
        : f === "calendar"
          ? "intentionally_deferred"
          : "before_M10B_enablement",
    };
  });
  return { valid: issues.length === 0, issues: [...new Set(issues)], features };
}
// The same server-owned environment fence applies to mutation/worker entry points.
export function productionCapabilityAllowed(
  env: Record<string, string | undefined>,
  capability: string,
) {
  if (
    env.GLARA_ENVIRONMENT &&
    !["development", "production"].includes(env.GLARA_ENVIRONMENT)
  )
    return false;
  if (env.GLARA_ENVIRONMENT !== "production") return true;
  if (
    env.GLARA_PRODUCTION_APPROVED !== "true" ||
    env.GLARA_ACCEPTANCE_MODE === "true" ||
    env.GLARA_ACCEPTANCE_PASSWORDS ||
    env.M9_EMAIL_TEST_ALLOWLIST
  )
    return false;
  if (
    [
      "email",
      "calendar",
      "ai",
      "automation",
      "auth_email",
      "onboarding",
    ].includes(capability)
  )
    return (
      env["GLARA_PRODUCTION_" + capability.toUpperCase() + "_APPROVED"] ===
      "true"
    );
  return true;
}
