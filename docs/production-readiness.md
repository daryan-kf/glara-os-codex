# Production readiness and milestone sequencing

## Current owner-approved boundary

- **M9 EMAIL GATE PASSED**. Development email remains disabled after acceptance; this does not authorize production delivery or waive production authentication/email requirements.
- **M9 CALENDAR GATE DEFERRED — EXTERNAL OAUTH CONFIGURATION REQUIRED BEFORE ENABLEMENT**. The implementation is retained; live acceptance is incomplete.
- Calendar is **NON-BLOCKING FOR M10A PRODUCTION HARDENING** only while disabled.
- M10A hardening/preparation is authorized for a subsequent task. No M10A implementation was performed in the deferral task.
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

Production invitation/onboarding delivery, password recovery, reused/expired links, production redirect/origin validation, required transactional provider/sender setup and other inherited security/operational readiness items remain **DEFERRED — REQUIRED BEFORE PRODUCTION** where applicable. The accepted development sender/email evidence is preserved without promoting these production obligations to passed.

The current M10A authorization excludes production deployment, customer traffic, production Email/Calendar enablement, real-customer data migration, external customer communication and M10B Go-Live. No production changes are authorized by this sequencing document.
