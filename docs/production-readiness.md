# Production readiness and milestone sequencing

## Current owner-approved boundary

- **M9 EMAIL GATE PASSED**. Development email remains disabled after acceptance; this does not authorize production delivery or waive production authentication/email requirements.
- **M9 CALENDAR GATE DEFERRED â€” EXTERNAL OAUTH CONFIGURATION REQUIRED BEFORE ENABLEMENT**. The implementation is retained; live acceptance is incomplete.
- Calendar is **NON-BLOCKING FOR M10A PRODUCTION HARDENING** only while disabled.
- M10A hardening/preparation has now started in a separate authorized task. See [M10A-report.md](M10A-report.md); Sections 1â€“130 have been received and the gate is not passed. No M10A implementation was performed in the earlier deferral task.
- Overall M9 is not newly declared PASS. Historical incomplete final acceptance/review evidence remains incomplete.

## Disabled-by-default integration policy

Keep `M9_CALENDAR_ENABLED=false` in development and every future production configuration. An absent flag is disabled by the existing strict true check. Missing credentials must not grant access or trigger fallback credentials. Do not enable a connection or run the consent/setup helper as an implicit part of M10A. Existing Calendar implementation, source authority, permissions and tests must be preserved.

The fresh development check confirmed both `M9_CALENDAR_ENABLED=false` and `M9_EMAIL_ENABLED=false`. Two regression tests demonstrate no OAuth/Calendar fetch while Calendar is disabled or unset, even with an enabled database connection. Production has not been inspected, configured or modified by this task; this document defines its required default, not a claim of a production deployment check.

## M10B Go-Live review: mandatory deferred-integration register

Review every entry in [deferred-integrations.json](deferred-integrations.json).

For Google Calendar:

1. If remaining disabled, verify the deployment flag is false/absent, provider calls are blocked and the deferral remains visible. Calendar's incomplete live gate alone does not block hardening or a separately authorized rollout without Calendar.
2. If enablement is proposed, block it until the **original M9 Calendar Gate** is completed: dedicated non-primary calendar; secure OAuth and owner consent; safe create/update/cancel; duplicate/concurrent/revision protection; external-edit conflict/resolution; delete/repair; Vancouver DST; Consultation semantics; full authorization; source-of-truth preservation; failure/unknown handling; reconciliation; cleanup; no unresolved Calendar P0/P1. See [setup procedure](M9-calendar-setup.md) and [actual acceptance evidence](M9-calendar-acceptance.json).
3. A future gate pass does not itself authorize production deployment or enablement. Obtain the separate product-owner rollout authorization.

## Core assessment and remaining production work

The [M9 deferral core check](M9-deferral-core-check.json) records 102 passing local M9 tests and current hosted reconciliation with zero findings. No known unresolved enabled-M9 P0/P1 was identified within that scope. This is not a guarantee about unexecuted final hosted/browser/production acceptance.

Production invitation/onboarding delivery, password recovery, reused/expired links, production redirect/origin validation, required transactional provider/sender setup and other inherited security/operational readiness items remain **DEFERRED â€” REQUIRED BEFORE PRODUCTION** where applicable. The accepted development sender/email evidence is preserved without promoting these production obligations to passed.

The current M10A authorization excludes production deployment, customer traffic, production Email/Calendar enablement, real-customer data migration, external customer communication and M10B Go-Live. No production changes are authorized by this sequencing document.

## Incident response readiness

The [incident runbook](incident-response.md) and [five local drills](M10A-incident-drills.json) cover Sections 79â€“130. Review [IR-01â€“IR-07](M10A-incident-followups.json) during M10B: none is waived by a local test pass. Fill the restricted contact/incident templates outside the public repository; assign real responders, verify trusted Owner recovery, storage ACLs, monitoring, global containment and backup/restore before production readiness. Local drills do not authorize external notification, production rollback, provider enablement or M10B.

## Canonical M10A control and evidence review

Use [M10A-readiness-controls.json](M10A-readiness-controls.json) and [M10A-evidence-register.json](M10A-evidence-register.json); [M10A-readiness-summary.json](M10A-readiness-summary.json) is derived by `npm run readiness:summary`. All received sections through 474, including 224A-224AC, are mapped in the control map. Historical checkpoints do not close current controls automatically. IR-01â€“IR-07 remain visible with original history. Assign actual humans before M10B entry. M10A PRODUCTION READINESS GATE FAILED; no production or M10B implementation is authorized here.

Review [backup/recovery](M10A-backup-recovery.md), [safe mode](M10A-safe-mode.md), [monitoring](M10A-observability.md), [supply chain](M10A-supply-chain.md), [migration](M10A-migration-plan.md), [performance](M10A-performance.md), [authentication decisions](M10A-auth-decisions.md) and [retention/privacy](M10A-retention-privacy.md). Policy approval and production/provider configuration must not be replaced with local test results. Calendar remains canonically deferred and disabled, non-blocking while disabled; Email's historical acceptance remains intact with sending disabled.

## Final M10A decision

M10A PRODUCTION READINESS GATE FAILED. See [final acceptance](M10A-final-acceptance.json), [report](M10A-report.md) and [blocked handoff](M10B-handoff.md). There are 27 internal P1 readiness blockers; this is not a pending-external-only result. Production is untouched, Email/Calendar are disabled, and M10B is unauthorized.
