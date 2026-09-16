import { describe, expect, it } from "vitest";
import {
  evaluateReadiness,
  validateCoverage,
  reopenControl,
  type Control,
  type Evidence,
  type Context,
} from "../../src/lib/readiness/model";
const at = "2026-09-16T00:00:00Z",
  sha = "a".repeat(40);
function fixture() {
  const control: Control = {
    control_id: "IR-01",
    title: "Revocation gate",
    domain: "authentication",
    accountable_role: "Security Owner",
    assigned_owner: "Fictional verifier",
    implementation_owner: "Engineer",
    verification_owner: "Security reviewer",
    status: "passed",
    severity_if_open: "P1",
    m10a_blocker: true,
    m10b_blocker: true,
    target_date: "Before M10A pass",
    last_reviewed_at: at,
    required_evidence: ["Direct revoked-session denial"],
    required_evidence_types: ["security_test"],
    allowed_evidence_environments: ["local"],
    evidence_ids: ["ev-1"],
    closed_at: at,
    closure_evidence_ids: ["ev-1"],
    completion_action: "Verify revocation",
    limitations: [],
    external_action: null,
    deferred: null,
    canonical_reference: null,
    history: [],
  };
  const evidence: Evidence = {
    evidence_id: "ev-1",
    control_id: "IR-01",
    evidence_type: "security_test",
    source: "Local test",
    environment: "local",
    source_commit: sha,
    source_paths: ["convex/access.ts"],
    executed_at: at,
    executed_by: "Test runner",
    verified_at: at,
    verified_by: "Fictional verifier",
    result: "passed",
    artifact_reference: "docs/M10A-results.json",
    limitations: ["Local only"],
    expires_at: null,
    freshness: {
      source_sensitive: true,
      invalidated_by: ["security_code"],
      invalidated_at: null,
    },
  };
  const context: Context = {
    now: Date.parse(at) + 1000,
    sourceCommit: sha,
    calendar: {
      status: "M9 CALENDAR GATE DEFERRED",
      production_enabled: false,
      development_enabled: false,
    },
  };
  const controls = {
      schema_version: 1 as const,
      controls: [control],
      risk_acceptances: [],
    },
    events = { schema_version: 1 as const, evidence: [evidence] };
  const check = () => evaluateReadiness(controls, events, context);
  return { control, evidence, controls, events, context, check };
}
describe("M10A readiness fails closed", () => {
  it("rejects PASS with no evidence or missing incident closure references", () => {
    const f = fixture();
    f.control.evidence_ids = [];
    expect(f.check().valid).toBe(false);
    f.control.evidence_ids = ["ev-1"];
    f.control.closure_evidence_ids = [];
    expect(f.check().valid).toBe(false);
  });
  it("rejects expired evidence and source-sensitive proof from an older implementation", () => {
    const f = fixture();
    f.evidence.expires_at = at;
    expect(f.check().m10a_pass).toBe(false);
    f.evidence.expires_at = null;
    f.context.sourceCommit = "b".repeat(40);
    expect(f.check().summary?.stale_evidence).toBe(1);
  });
  it("rejects M10A PASS while a blocker remains open", () => {
    const f = fixture();
    f.control.status = "in_progress";
    expect(f.check().m10a_pass).toBe(false);
  });
  it("rejects production enablement of canonically deferred Calendar", () => {
    const f = fixture();
    f.control.canonical_reference =
      "docs/deferred-integrations.json#m9-google-calendar";
    f.context.calendar.production_enabled = true;
    expect(f.check().errors).toContain("DEFERRED_CALENDAR_ENABLED");
    Object.assign(f.context.calendar, { production_enabled: undefined });
    expect(f.check().errors).toContain("DEFERRED_CALENDAR_ENABLED");
  });
  it("detects a conflicting Calendar PASS or canonical activation", () => {
    const f = fixture();
    f.control.canonical_reference =
      "docs/deferred-integrations.json#m9-google-calendar";
    expect(f.check().errors).toContain("CALENDAR_STATUS_CONFLICT");
  });
  it("rejects missing accountable role and blocks M10B entry without assigned human", () => {
    const f = fixture();
    f.control.accountable_role = "";
    expect(f.check().valid).toBe(false);
    f.control.accountable_role = "Owner";
    f.control.assigned_owner = null;
    f.control.m10a_blocker = false;
    f.control.status = "pending_verification";
    expect(f.check().m10b_entry).toBe(false);
  });
  it("rejects secret-like evidence and unknown evidence types without echoing values", () => {
    const f = fixture();
    const secret = "sk-" + "x".repeat(40);
    f.evidence.source = secret;
    const result = f.check();
    expect(result.errors).toContain("SECRET_LIKE_VALUE");
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(
      evaluateReadiness(
        f.controls,
        {
          ...f.events,
          evidence: [{ ...f.evidence, evidence_type: "invented_pass" }],
        },
        f.context,
      ).valid,
    ).toBe(false);
  });
  it("surfaces malformed commit and missing artifact or Git reference", () => {
    const f = fixture();
    f.evidence.source_commit = "latest";
    expect(f.check().valid).toBe(false);
    f.evidence.source_commit = sha;
    f.context.referenceExists = () => false;
    expect(f.check().errors).toContain("INVALID_REFERENCE:ev-1");
  });
  it("reopening removes a readiness PASS and clears closure while retaining history", () => {
    const f = fixture();
    expect(f.check().m10a_pass).toBe(true);
    f.controls.controls[0] = reopenControl(
      f.control,
      "New authorization regression",
      at,
    );
    expect(f.check().m10a_pass).toBe(false);
    expect(f.controls.controls[0].closure_evidence_ids).toEqual([]);
    expect(f.controls.controls[0].history[0].reason).toBe(
      "New authorization regression",
    );
  });
  it("derives summary counts directly from canonical control state", () => {
    const f = fixture();
    f.controls.controls.push({
      ...f.control,
      control_id: "open-2",
      status: "failed",
      evidence_ids: [],
      closure_evidence_ids: [],
      closed_at: null,
      assigned_owner: null,
    });
    const s = f.check().summary!;
    expect(s.total_controls).toBe(2);
    expect(s.passed).toBe(1);
    expect(s.open).toBe(1);
    expect(s.failed).toBe(1);
    expect(s.m10a_blockers).toBe(1);
    expect(s.without_assigned_owner).toBe(1);
    expect(s.without_sufficient_evidence).toBe(1);
  });
  it("does not promote local proof to production or ignore contradictory failed evidence", () => {
    const f = fixture();
    f.control.allowed_evidence_environments = ["future_production"];
    expect(f.check().valid).toBe(false);
    f.control.allowed_evidence_environments = ["local"];
    f.events.evidence.push({
      ...f.evidence,
      evidence_id: "ev-2",
      result: "failed",
    });
    f.control.evidence_ids.push("ev-2");
    expect(f.check().valid).toBe(false);
  });
  it("invalidated provider configuration requires fresh evidence and unsafe references are rejected", () => {
    const f = fixture();
    f.evidence.freshness.invalidated_at = at;
    expect(f.check().m10a_pass).toBe(false);
    f.evidence.artifact_reference = "docs/../.env.local";
    expect(f.check().valid).toBe(false);
  });
});

it("rejects empty registers, unproven N/A and future closure times", () => {
  const f = fixture();
  expect(
    evaluateReadiness(
      { ...f.controls, controls: [] },
      { schema_version: 1, evidence: [] },
      f.context,
    ).valid,
  ).toBe(false);
  f.control.status = "not_applicable";
  f.control.limitations = ["Unsupported assertion"];
  expect(f.check().valid).toBe(false);
  f.control.status = "passed";
  f.control.closed_at = "2099-01-01T00:00:00Z";
  expect(f.check().valid).toBe(false);
});

it("coverage rejects silently dropped requirements or inherited incident controls", () => {
  const f = fixture();
  const errors = validateCoverage(
    { schema_version: 1, sections: { "1": ["IR-01"], "2": ["missing"] } },
    [f.control],
  );
  expect(errors).toContain("INVALID_SECTION_REFERENCE:2");
  expect(errors).toContain("UNCOVERED_SECTION:224AC");
  expect(errors).toContain("UNCOVERED_SECTION:474");
  expect(errors).toContain("MISSING_INHERITED_CONTROL:IR-07");
  expect(errors).toContain("MISSING_INHERITED_CONTROL:M9-CALENDAR");
});
