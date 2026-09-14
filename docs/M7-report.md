# M7 — Automation & Growth Engine

## Release status

**M7 DEVELOPMENT GATE PENDING EXTERNAL ACTION**

The local implementation is complete and local checks pass. M7 was not deployed: automatic approval review rejected the upload because the previous specific deployment authorization covered M6 only. An explicit request for M7 development deployment and acceptance is pending. Hosted M7 acceptance and full hosted M1–M6 regression remain unverified for this release. Production was not modified and M8 was not started.

Production invitation/recovery email delivery, expired/reused authentication links, production redirect/origin verification, transactional provider setup, and `Support@glarahome.com` sender/domain verification remain **DEFERRED — REQUIRED BEFORE PRODUCTION**. No Supabase acceptance work is reinstated.

## Architecture

- `convex/automation.ts`: authenticated configuration, read-only previews, explicit evaluation/repair, task and notification operations, health, bounded enrollment, and private scheduler functions.
- `convex/automationCore.ts`: condition-family deduplication, immutable evidence, assignment, suppression, cooldown, escalation, task lifecycle, and source queue enrollment.
- `convex/automationSources.ts`: controlled source adapters using M1–M5 records, M3 risk/checklist semantics, M4 availability, and M5 exact balance functions. No user-provided expressions or executable code.
- `src/lib/automation/model.ts`: 28 visible disabled templates, bounded configuration validation, Vancouver date/instant semantics, stable keys, and escalation policy.
- `convex/crons.ts`: Convex internal due-queue dispatch every five minutes. A dispatch processes at most four batches of 25 sources. Failed transactions retry at 5/10/15-minute offsets, then remain in a failed queue for explicit Owner/Admin retry.
- `src/components/automation/center.tsx`: Rules, Active Actions, Escalations, Failures, History and Settings; responsive personal notifications; existing tasks remain the work records.

M1–M5 mutation registration records lightweight queue metadata after authorized source changes. Business source authorization remains authoritative. Notification/task evaluation runs in a separate transaction: a reminder failure cannot roll back the earlier payment or other business transaction. Task creation and notification linkage share a transaction, so a failed reminder is retried without partial duplicate work.

The implementation uses Convex optimistic transactions and indexed read-before-insert uniqueness rather than PostgreSQL triggers, RLS, RPCs, or SQL migrations. It follows Convex's [cron](https://docs.convex.dev/scheduling/cron-jobs) and [scheduled function transaction](https://docs.convex.dev/scheduling/scheduled-functions) guarantees.

## Schema and indexes

New tables:

- `automation_rules`, `automation_rule_versions`: current controlled configuration and immutable version history; indexed by rule key and rule/version.
- `automation_queue`: one source entry with generation, due time, attempts, safe error code and observation time; indexed by source and status/due time.
- `automation_actions`: one active condition-family action, task reference, cycle, current policy version, assignment, escalation, snooze and independent resolution; indexed by condition key, source/status, assignee/status/priority, rule, and activity.
- `automation_executions`: immutable deduplicated policy/context/outcome evidence; indexed by dedupe key, source, rule and status.
- `automation_suppressions`, `automation_escalations`: reasoned suppression history and escalation transitions with server-derived actor/recipient IDs.
- `notifications`: recipient-specific task/action references, read and resolved timestamps; message projection rechecks current authorization.
- `automation_limits`: per-rule/day circuit limits.
- `automation_scan`: resumable bounded source enrollment cursor.

Existing activities receive optional protected automation metadata. Commercial reminders deliberately have no CRM or project activity relationship that would expose them through operational project views. Operations reminders retain their project task link; Sales reminders use the existing opportunity or Realtor activity relationship. The existing audit log stores system actors as `null` with `AUTOMATION_*` action names; execution rows explicitly distinguish system and user actors. Activity `created_by` references the rule author while `actor_kind: system` identifies execution authority.

A `payments.by_customer` index supports customer credit review. No new file store, external integration, valuation, payment state, liability, or inventory movement is introduced.

## Rule coverage and clocks

Sales: new contact, day-2/day-5 quote follow-up, overdue manual next action, high-value stalled opportunity, Realtor nurture, timing/no-response reactivation. Won/no-project handoff is an operations reminder.

Operations: preparation window, tomorrow's required staging checklist, sold/no-destaging, package expiry, overdue project work and management review of red project risk. M3 requires preparation to be completed before scheduling; tomorrow's reminder also evaluates required staging checklist work instead of weakening that gate.

Inventory: required reservation readiness/shortage using M4 availability, missing serialized assets, long repairs, late return and missing quantity stock. No asset cost or replacement value is invented.

Commercial: unpaid deposit, due-soon/overdue/escalated collection, accepted extension without invoice, approved assessment without invoice, unallocated payment, customer credit review, and incident without assessment. Reminders never create invoices, liability assessments, payments, refunds, or credit notes.

Instant offsets use source timestamps such as quote `sent_at`. Date-only due/package/sold dates use `America/Vancouver`. Eligibility uses “due at or before now,” so missed runs catch up. Source writes enqueue re-evaluation; enrolled sources are revisited through the due index. Disabled rules are skipped by scheduled evaluation. Configuration and source corrections are evaluated against current authoritative state.

## Idempotency and concurrency

The active key is `source table : source ID : condition family`. Quote day-2/day-5 and invoice collection rules share families, preventing competing stage tasks. Executions include cycle, policy version, transition and observed context. Repeat evaluation does not create another active task or unread notification. Overdue-manual-task rules adopt the existing task instead of inserting a duplicate.

Escalation reassigns an existing generated task where applicable. Customer collection escalation uses elapsed Vancouver days from invoice due date. Task completion is separate from source resolution: a still-open condition observes cooldown and may begin a new action cycle. A paid invoice resolves; reversal may requalify a new cycle. Read-time relevance checks hide paid invoice, accepted quote and recovered asset reminders immediately while queue cleanup is pending. A new authoritative source event can restart a previously failed generation, retaining failure evidence. A disabled rule leaves history and existing work intact.

Automatic closure never deletes evidence. If closure would remove the last required Realtor/opportunity next action, a neutral next-action planning handoff is created in the existing activity system. Normal completion still rejects removing the last next action without replacement.

Limits: 25 sources per scheduler batch, four batches per dispatch, 20 records per enrollment page, configurable 1–100 new actions per rule/day (default 25), and at most three cycles per condition/day. Existing M3/M5 relationship and task limits still apply. Limit and failure states remain visible rather than silently truncating business evaluation.

## Authorization and privacy

- Owner/Admin manage configuration, preview, suppression, reconciliation/repair and failure retry.
- Public mutations derive authenticated identity from the live Convex Auth session and active profile.
- Internal work functions are not public endpoints.
- Notification content and action access recheck current roles and source relationships; role removal/archive revokes visibility.
- Sales sees assigned, authorized Sales automation. Designer/Crew see authorized assigned project work. Marketing receives no private sales, commercial or management automation payloads.
- Assignment validates active profiles and source access, then falls back to Admin and Owner. A missing valid assignee fails safely. Profile changes enqueue reassignment in resumable 25-action batches. An escalated recipient outside a project team receives a standalone queue task, preserving M3 membership rules.
- Financial amounts remain exact CAD cents; financial reminder task records are isolated from project/CRM activity lists.
- Scope IDs, delays, escalation chains, minimum amounts and action limits are validated server-side. Acceptance configuration can be restricted to at most 20 source IDs, avoiding unintended reminders for unrelated development data.

## Reconciliation and UI

Preview compares current rule eligibility, suppression, and active actions without writes. Explicit repair resolves stale work, creates missing work and reconciles duplicate linkage. It cannot edit authoritative business facts. Rule versions remain immutable.

M6's Action Center coalesces source risk and its active automation task. Personal notifications link to the authorized source; action cards explain why, show cycle/version, and support completion and bounded snooze. Owner/Admin can inspect history, configure human-readable policy, enroll bounded backlog batches, and review failed work. Rule operational statistics are explicitly bounded samples, not revenue attribution claims.

## Verification

Final local regression: **13/13 Node tests and 270/270 Vitest tests passed** (17 Vitest files, 9.82 seconds for Vitest). This includes **20/20 M7 tests**. These cover configuration, Vancouver dates, deduplication/races, immutable versions, suppression/expiry, cooldown, escalation, revoked roles, archived assignee fallback, invoice payment/reversal, checklist resolution, physical recovery, manual-task adoption, explicit repair, circuit limits, source correction and a resumable 120-record load.

TypeScript, ESLint with zero warnings, Prettier and the final Next.js production build passed. Dependency audit reported zero vulnerabilities. The repository secret scan found no known credential or private-key matches and no tracked environment files other than the permitted example.

Eight desktop/mobile compatibility scenarios passed against the existing M6 backend: protected routes (including `/automation`), responsive login/recovery pages, actual login/navigation/logout, and Sales denial from Owner Reports. Recovery delivery was not exercised. See `M7-compatibility-browser-results.json`. This verifies backward compatibility while M7 deployment is pending; it is **not M7 functional browser acceptance**. Hosted M7 and full hosted M1–M6 regression are **NOT RUN FOR M7**. Earlier M6 reports remain baseline evidence only.

Prepared acceptance harnesses:

- `tests/support/m7-hosted-acceptance.ts`: scoped fictional lifecycle, native mutations, transactional replay, privacy, collection/reversal and bounded enrollment.
- `tests/support/m7-acceptance-control.ts`: temporary private development-only fixture adapter for M7 scheduling metadata and rollback injection. It must be removed from the deployed backend after testing. It never redates existing M1–M6 business events.
- `tests/e2e/automation.spec.ts`: desktop/mobile Owner/Admin rule/health/history access plus restricted-role notifications and route denial.

## Limits and production prerequisites

- External email/SMS/WhatsApp, payments, liability decisions, inventory movement, date changes, project creation and M8 AI remain outside automation authority.
- Source enrollment is explicit, paginated and resumable. Production activation needs a reviewed backlog scope and operating thresholds; rules ship disabled.
- Current source relationship limits are enforced; oversized sources require explicit operator review. Rule statistics clearly report bounded sample sizes.
- No invented high-value asset prioritization: M4 has no authoritative financial valuation field.
- Production workload/cost monitoring, historical evidence retention, backup/recovery rehearsal, security review, and all deferred email/auth requirements remain required before production.
- Hosted M7 and full M1–M6 regressions, M7 browser acceptance and independent review remain outstanding. No P0/P1 defect was identified by local checks, but a zero-defect hosted acceptance result is not claimed.

## Defects addressed during local hardening

- Coalesced overlapping quote/collection stages and adopted overdue manual tasks instead of creating duplicates.
- Kept completion separate from source resolution and preserved next-action invariants on closure.
- Prevented commercial task data appearing through project activities.
- Rechecked visibility after role revocation, source payment, acceptance and asset recovery.
- Corrected project task membership during escalation and queued assignment review after profile changes.
- Added explicit duplicate/linkage repair and bounded circuit/failed-work visibility in the existing Action Center.

## Resume acceptance

After specific M7 upload consent: verify the exact development URL, run `npx convex dev --once --env-file .env.local`, initialize disabled defaults, and deploy the guarded temporary `m7AcceptanceControl` adapter only for fictional acceptance. Run the prepared M7 harness and all M1–M6 hosted suites, then all desktop/mobile suites with the two deferred recovery-send scenarios excluded. Remove the temporary adapter and redeploy, rerun final local gates, update this report with exact results, and commit/push the final evidence. Do not begin M8.
