# Production readiness and milestone sequencing

## Current boundary

M10A PRODUCTION READINESS GATE PENDING EXTERNAL ACTION. The full frozen specification through Section 474 remains mapped to canonical controls. Technical results and exact external requirements are in [M10A-report.md](M10A-report.md), [M10A-external-actions.md](M10A-external-actions.md) and [M10B-handoff.md](M10B-handoff.md). Production and M10B remain unauthorized.

M9 EMAIL GATE PASSED historically, including OWNER CONFIRMED INBOX RECEIPT. Development sending remains disabled. This does not pass production onboarding/recovery delivery or authorize another send.

M9 CALENDAR GATE DEFERRED — EXTERNAL OAUTH CONFIGURATION REQUIRED BEFORE ENABLEMENT. Implementation/security remain intact; OAuth is unconfigured and live acceptance incomplete. Calendar is non-blocking only while disabled.

## Integration defaults and activation

`M9_EMAIL_ENABLED=false` and `M9_CALENDAR_ENABLED=false` were verified on development. Calendar's absent flag also fails closed. No provider call is allowed while disabled; missing credentials cannot activate fallback behavior. No OAuth/setup flow was run. Production defaults must remain disabled; this is a configuration requirement, not a claim that production was inspected.

At M10B review, inspect [deferred-integrations.json](deferred-integrations.json). Calendar activation requires its original dedicated non-primary calendar, OAuth/consent, live create/update/cancel, idempotency/concurrency, external edit/delete conflict, DST, authorization, reconciliation and cleanup gates. See [setup](M9-calendar-setup.md) and [actual evidence](M9-calendar-acceptance.json). A future gate pass still does not authorize production enablement automatically.

## Remaining human/provider requirements

Production authentication delivery, reused/expired codes/links, exact redirect/origin and secure cookie verification, transactional provider/sender setup and independent Owner recovery remain DEFERRED — REQUIRED BEFORE PRODUCTION. Privileged application MFA needs an approved supported architecture; actual platform/operator enrollment and recovery evidence remain unverified.

Named accountable humans, independent responder channels/evidence custody/monitoring, approved retention/provider contracts/CASL/notification policy, protected release governance and independently recoverable backup policy/store/schedule/alerts remain explicit external actions. Technical tests do not manufacture these approvals. Staff UAT was not performed.

## Canonical review

[M10A-readiness-controls.json](M10A-readiness-controls.json) and [M10A-evidence-register.json](M10A-evidence-register.json) govern closure; `npm run readiness:summary` derives the summary. All 503 identifiers (1–474 and 224A–AC) remain mapped. Historical failed/stale evidence is retained and cannot close current controls. Original IR-01–IR-07 requirements remain visible. Current tests and isolated recovery are not production operational acceptance.

Review [backup/recovery](M10A-backup-recovery.md), [incident response](incident-response.md), [safe mode](M10A-safe-mode.md), [monitoring](M10A-observability.md), [supply chain](M10A-supply-chain.md), [migration](M10A-migration-plan.md), [performance](M10A-performance.md), [authentication](M10A-auth-decisions.md) and [privacy](M10A-retention-privacy.md). New source/dependency/environment/provider changes require affected evidence to be reopened and rerun.

Production mutations remain zero. No production deployment/configuration/DNS, customer traffic/data migration, real staff/customer communication, provider enablement or M10B was performed or authorized.
