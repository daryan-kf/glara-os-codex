import { z } from "zod";
export const statuses = [
  "not_started",
  "in_progress",
  "pending_external_action",
  "pending_verification",
  "passed",
  "failed",
  "deferred",
  "not_applicable",
] as const;
export const domains = [
  "environment",
  "authentication",
  "authorization",
  "MFA",
  "secrets",
  "application_security",
  "privacy",
  "retention",
  "backup",
  "disaster_recovery",
  "observability",
  "incident_response",
  "supply_chain",
  "migration",
  "performance",
  "AI",
  "automation",
  "email",
  "deferred_integration",
  "release",
  "rollback",
] as const;
export const evidenceTypes = [
  "automated_test",
  "hosted_test",
  "browser_test",
  "security_test",
  "configuration_check",
  "reconciliation",
  "provider_verification",
  "restore_drill",
  "incident_drill",
  "load_test",
  "dependency_audit",
  "secret_scan",
  "code_review",
  "manual_inspection",
  "owner_confirmation",
  "external_provider_evidence",
  "policy_approval",
  "runbook_drill",
] as const;
const text = z.string().trim().min(1).max(2000);
const instant = z.iso.datetime({ offset: true });
const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/);
const artifact = z
  .string()
  .regex(/^(?:docs\/[A-Za-z0-9._/-]+|restricted-evidence:[A-Za-z0-9._-]+)$/)
  .refine((x) => !x.includes(".."));
const sourcePath = z
  .string()
  .regex(/^[A-Za-z0-9_.][A-Za-z0-9_./*-]*$/)
  .refine((x) => !x.includes("..") && !x.startsWith(".env"));
export const controlSchema = z
  .object({
    control_id: id,
    title: text,
    domain: z.enum(domains),
    accountable_role: text,
    assigned_owner: text.nullable(),
    implementation_owner: text,
    verification_owner: text,
    status: z.enum(statuses),
    severity_if_open: z.enum(["P0", "P1", "P2", "P3"]),
    m10a_blocker: z.boolean(),
    m10b_blocker: z.boolean(),
    target_date: text,
    last_reviewed_at: instant,
    required_evidence: z.array(text).min(1),
    required_evidence_types: z.array(z.enum(evidenceTypes)).min(1),
    allowed_evidence_environments: z
      .array(
        z.enum([
          "local",
          "development",
          "isolated_restore",
          "provider_test",
          "future_production",
        ]),
      )
      .min(1),
    evidence_ids: z.array(id),
    closed_at: instant.nullable(),
    closure_evidence_ids: z.array(id),
    completion_action: text,
    limitations: z.array(text),
    external_action: z
      .object({
        dependency: text,
        accountable_owner: text,
        required_action: text,
        why_unavailable: text,
        completion_evidence: text,
      })
      .strict()
      .nullable(),
    deferred: z
      .object({
        reason: text,
        approved_by: text,
        approved_at: instant.nullable(),
        approval_reference: text,
        conditions: z.array(text).min(1),
        prohibited_behavior: z.array(text).min(1),
        activation_prerequisites: z.array(text).min(1),
        m10b_review_required: z.literal(true),
      })
      .strict()
      .nullable(),
    canonical_reference: z
      .string()
      .regex(/^docs\/[A-Za-z0-9._-]+\.json#[A-Za-z0-9._-]+$/)
      .nullable(),
    history: z.array(
      z
        .object({ at: instant, status: z.enum(statuses), reason: text })
        .strict(),
    ),
  })
  .strict();
export const evidenceSchema = z
  .object({
    evidence_id: id,
    control_id: id,
    evidence_type: z.enum(evidenceTypes),
    source: text,
    environment: z.enum([
      "local",
      "development",
      "isolated_restore",
      "provider_test",
      "future_production",
    ]),
    source_commit: z.string().regex(/^[a-f0-9]{40}$/),
    source_paths: z.array(sourcePath).min(1),
    executed_at: instant,
    executed_by: text,
    verified_at: instant,
    verified_by: text,
    result: z.enum(["passed", "failed", "incomplete"]),
    artifact_reference: artifact,
    limitations: z.array(text).min(1),
    expires_at: instant.nullable(),
    freshness: z
      .object({
        source_sensitive: z.boolean(),
        invalidated_by: z.array(
          z.enum([
            "security_code",
            "dependencies",
            "environment",
            "provider_configuration",
            "migration",
            "policy",
          ]),
        ),
        invalidated_at: instant.nullable(),
      })
      .strict(),
  })
  .strict();
export const controlsSchema = z
  .object({
    schema_version: z.literal(1),
    controls: z.array(controlSchema).min(1),
    risk_acceptances: z.array(
      z
        .object({
          risk_id: id,
          description: text,
          severity: z.enum(["P0", "P1", "P2", "P3"]),
          affected_system: text,
          compensating_controls: z.array(text),
          accountable_business_owner: text.nullable(),
          technical_assessment: text,
          acceptance_date: instant.nullable(),
          review_date: instant.nullable(),
          m10b_effect: text,
        })
        .strict(),
    ),
  })
  .strict();
export const evidenceRegisterSchema = z
  .object({ schema_version: z.literal(1), evidence: z.array(evidenceSchema) })
  .strict();
export type Control = z.infer<typeof controlSchema>;
export type Evidence = z.infer<typeof evidenceSchema>;
export type Controls = z.infer<typeof controlsSchema>;
export type EvidenceRegister = z.infer<typeof evidenceRegisterSchema>;
export type Context = {
  now: number;
  sourceCommit: string;
  sourceIsCurrent?: (evidence: Evidence) => boolean;
  referenceExists?: (evidence: Evidence) => boolean;
  calendar: {
    status: string;
    production_enabled: boolean;
    development_enabled: boolean;
  };
};
const secretLike =
  /(?:sk-(?:proj-)?[A-Za-z0-9_-]{24,}|re_[A-Za-z0-9]{28,}|GOCSPX-[A-Za-z0-9_-]{20,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._-]{16,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+|(?:password|api[_-]?key|refresh[_-]?token)\s*[:=]\s*["']?[A-Za-z0-9_./+-]{12,})/i;
export function evaluateReadiness(
  rawControls: unknown,
  rawEvidence: unknown,
  context: Context,
) {
  const errors: string[] = [];
  if (secretLike.test(JSON.stringify([rawControls, rawEvidence])))
    errors.push("SECRET_LIKE_VALUE");
  const cp = controlsSchema.safeParse(rawControls),
    ep = evidenceRegisterSchema.safeParse(rawEvidence);
  if (!cp.success || !ep.success)
    return {
      valid: false,
      m10a_pass: false,
      m10b_entry: false,
      errors: [...errors, "INVALID_SCHEMA"],
      summary: null,
    };
  const controls = cp.data.controls,
    evidence = ep.data.evidence;
  const unique = (ids: string[], kind: string) => {
    if (new Set(ids).size !== ids.length) errors.push(`DUPLICATE_${kind}`);
  };
  unique(
    controls.map((c) => c.control_id),
    "CONTROL",
  );
  unique(
    evidence.map((e) => e.evidence_id),
    "EVIDENCE",
  );
  for (const risk of cp.data.risk_acceptances) {
    if (
      risk.acceptance_date &&
      (risk.severity === "P0" ||
        !risk.accountable_business_owner ||
        !risk.review_date ||
        Date.parse(risk.review_date) <= context.now)
    )
      errors.push(`INVALID_RISK_ACCEPTANCE:${risk.risk_id}`);
  }
  const stale = new Set<string>(),
    insufficient = new Set<string>();
  for (const e of evidence) {
    if (!controls.some((c) => c.control_id === e.control_id))
      errors.push(`ORPHAN_EVIDENCE:${e.evidence_id}`);
    if (
      Date.parse(e.executed_at) > context.now ||
      Date.parse(e.verified_at) < Date.parse(e.executed_at) ||
      Date.parse(e.verified_at) > context.now
    )
      errors.push(`INVALID_TIME:${e.evidence_id}`);
    if (
      e.freshness.invalidated_at ||
      (e.expires_at && Date.parse(e.expires_at) <= context.now) ||
      (e.freshness.source_sensitive &&
        !(context.sourceIsCurrent
          ? context.sourceIsCurrent(e)
          : e.source_commit === context.sourceCommit))
    )
      stale.add(e.evidence_id);
    if (context.referenceExists && !context.referenceExists(e)) {
      errors.push(`INVALID_REFERENCE:${e.evidence_id}`);
      stale.add(e.evidence_id);
    }
  }
  for (const c of controls) {
    const refs = c.evidence_ids.map((id) =>
      evidence.find(
        (e) => e.evidence_id === id && e.control_id === c.control_id,
      ),
    );
    if (refs.some((e) => !e)) errors.push(`MISSING_EVIDENCE:${c.control_id}`);
    const proof = refs.filter(
      (e): e is Evidence =>
        !!e &&
        e.result === "passed" &&
        !stale.has(e.evidence_id) &&
        c.allowed_evidence_environments.includes(e.environment),
    );
    const sufficient = c.required_evidence_types.every((t) =>
      proof.some((e) => e.evidence_type === t),
    );
    if (!sufficient) insufficient.add(c.control_id);
    if (
      c.status === "passed" &&
      (!sufficient ||
        !c.closed_at ||
        !c.closure_evidence_ids.length ||
        c.closure_evidence_ids.some(
          (id) => !proof.some((e) => e.evidence_id === id),
        ) ||
        refs.some((e) => e?.result === "failed"))
    )
      errors.push(`UNPROVEN_PASS:${c.control_id}`);
    if (
      c.status === "passed" &&
      c.history.at(-1)?.status &&
      c.history.at(-1)?.status !== "passed"
    )
      errors.push(`CONFLICTING_HISTORY:${c.control_id}`);
    if (c.status === "deferred" && !c.deferred)
      errors.push(`UNSAFE_DEFERRAL:${c.control_id}`);
    if (c.status === "pending_external_action" && !c.external_action)
      errors.push(`MISSING_EXTERNAL_ACTION:${c.control_id}`);
    if (
      c.closed_at &&
      (Date.parse(c.closed_at) > context.now ||
        proof.some((e) => Date.parse(e.verified_at) > Date.parse(c.closed_at!)))
    )
      errors.push(`INVALID_CLOSURE_TIME:${c.control_id}`);
    if (
      c.status === "not_applicable" &&
      (!c.limitations.length ||
        !proof.some(
          (e) =>
            e.evidence_type === "policy_approval" ||
            e.evidence_type === "code_review",
        ))
    )
      errors.push(`UNJUSTIFIED_NA:${c.control_id}`);
    if (
      c.canonical_reference ===
      "docs/deferred-integrations.json#m9-google-calendar"
    ) {
      if (
        !context.calendar.status.includes("DEFERRED") ||
        c.status !== "deferred"
      )
        errors.push("CALENDAR_STATUS_CONFLICT");
      if (
        context.calendar.production_enabled !== false ||
        context.calendar.development_enabled !== false
      )
        errors.push("DEFERRED_CALENDAR_ENABLED");
    }
  }
  const unresolved = controls.filter(
    (c) => c.status !== "passed" && c.status !== "not_applicable",
  );
  const m10aBlockers = unresolved.filter((c) => c.m10a_blocker),
    m10bBlockers = unresolved.filter((c) => c.m10b_blocker);
  const requiredUnproven = controls.filter(
    (c) =>
      c.m10a_blocker &&
      insufficient.has(c.control_id) &&
      c.status !== "not_applicable",
  );
  const valid = !errors.length;
  return {
    valid,
    errors,
    m10a_pass: valid && !m10aBlockers.length && !requiredUnproven.length,
    m10b_entry:
      valid &&
      !m10aBlockers.length &&
      !requiredUnproven.length &&
      controls.filter((c) => c.m10b_blocker).every((c) => !!c.assigned_owner) &&
      m10bBlockers.every((c) => !!c.assigned_owner),
    summary: {
      total_controls: controls.length,
      passed: controls.filter((c) => c.status === "passed").length,
      open: unresolved.length,
      failed: controls.filter((c) => c.status === "failed").length,
      pending_external: controls.filter(
        (c) => c.status === "pending_external_action",
      ).length,
      deferred: controls.filter((c) => c.status === "deferred").length,
      m10a_blockers: m10aBlockers.length,
      m10b_blockers: m10bBlockers.length,
      without_assigned_owner: controls.filter((c) => !c.assigned_owner).length,
      without_sufficient_evidence: insufficient.size,
      stale_evidence: stale.size,
    },
  };
}
export function reopenControl(
  control: Control,
  reason: string,
  at: string,
): Control {
  return controlSchema.parse({
    ...control,
    status: "pending_verification",
    closed_at: null,
    closure_evidence_ids: [],
    last_reviewed_at: at,
    history: [
      ...control.history,
      { at, status: "pending_verification", reason },
    ],
  });
}

export function validateCoverage(raw: unknown, controls: Control[]) {
  const parsed = z
    .object({
      schema_version: z.literal(1),
      sections: z.record(z.string(), z.array(id).min(1)),
    })
    .strict()
    .safeParse(raw);
  if (!parsed.success) return ["INVALID_COVERAGE_MAP"];
  const required = [
    ...Array.from({ length: 474 }, (_, i) => String(i + 1)),
    ...[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ", "AA", "AB", "AC"].map(
      (s) => "224" + s,
    ),
  ];
  const ids = new Set(controls.map((c) => c.control_id));
  const errors: string[] = [];
  for (const section of required)
    if (!parsed.data.sections[section])
      errors.push(`UNCOVERED_SECTION:${section}`);
  for (const [section, refs] of Object.entries(parsed.data.sections))
    if (!required.includes(section) || refs.some((ref) => !ids.has(ref)))
      errors.push(`INVALID_SECTION_REFERENCE:${section}`);
  for (const controlId of [
    ...Array.from({ length: 7 }, (_, i) => "IR-0" + (i + 1)),
    "M9-CALENDAR",
  ])
    if (!ids.has(controlId))
      errors.push(`MISSING_INHERITED_CONTROL:${controlId}`);
  return errors;
}
