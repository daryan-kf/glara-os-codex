# M7 — Automation & Growth Engine

## Release status

**M7 DEVELOPMENT GATE — PASS**

**M7 HOSTED ACCEPTANCE — PASS** on the authorized development deployment. No unresolved P0/P1 issue was identified within the tested development scope.

The product owner explicitly authorized M7 development deployment and corrective acceptance. Commit `ba509338b4404e4d6196e4821767ccc39a3bae29` was first deployed to the verified `daryan-kamalifar:glara-os` development deployment `woozy-jaguar-392`. Corrective changes were subsequently deployed there. Production was not modified and M8 was not started.

Production invitation/recovery email delivery, expired/reused authentication links, production redirect/origin verification, transactional provider setup, and `Support@glarahome.com` sender/domain verification remain **DEFERRED — REQUIRED BEFORE PRODUCTION**. No Supabase acceptance work is reinstated.

## Architecture

- `convex/automation.ts`: authenticated configuration, read-only previews, explicit evaluation/repair, task and notification operations, health, bounded enrollment, and private scheduler functions.
- `convex/automationCore.ts`: condition-family deduplication, immutable evidence, assignment, suppression, cooldown, escalation, task lifecycle, and source queue enrollment.
- `convex/automationSources.ts`: controlled source adapters using M1–M5 records, M3 risk/checklist semantics, M4 availability, and M5 exact balance functions. No user-provided expressions or executable code.
- `src/lib/automation/model.ts`: 28 visible disabled templates, bounded configuration validation, Vancouver date/instant semantics, stable keys, and escalation policy.
- `convex/crons.ts`: Convex internal due-queue dispatch every five minutes. A dispatch processes at most four batches of 25 sources. Failure attempts record 5/10/15-minute next-due offsets. Attempts one and two retry automatically; the third failure enters the terminal failed queue for explicit Owner/Admin retry. The recorded third offset does not schedule another automatic attempt.
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

A `payments.by_customer` index and the existing `invoices.by_customer` index support customer credit review. Outstanding invoice credit balances are included alongside unallocated cash without double counting. Receipt dates and the latest adjustment of each outstanding invoice credit provide the aging clocks. No new file store, external integration, valuation, payment state, liability, or inventory movement is introduced.

## Rule coverage and clocks

Sales: new contact, day-2/day-5 quote follow-up, overdue manual next action, high-value stalled opportunity, Realtor nurture, timing/no-response reactivation. Won/no-project handoff is an operations reminder.

Operations: preparation window, tomorrow's required staging checklist, sold/no-destaging, package expiry, overdue project work and management review of red project risk. M3 requires preparation to be completed before scheduling. Both advance reminders also evaluate required staging checklist work, preserving the M3 readiness gate.

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

- Final local suite: **13/13 Node tests; 279/279 Vitest tests**, 17 files, including **29 M7 tests**, 10.41 seconds for Vitest. The final production build passed after removal of temporary functions.
- M7 hosted suites: **64/64** checks across lifecycle (27), growth/commercial/races (20), operations (7), revoked/archived roles (2), and final security/retry/credit/dispatcher checks (8).
- Clean deployment smoke: **5/5**, including current role denial, concurrent execution, completion with zero activity projection drift, all 28 rules disabled, and no failed queue work.
- M1–M5 hosted regression: **150/150**, including M3 query regression. M6 historical correction regression: **8/8**. Final M6 hosted regression passed **26/26**, including independent reconciliation of **3,045 source records**, **zero source drift**, **zero bucket drift**, revision **2363**. Serialized inventory evidence checked **59 assets** with zero mismatches. Total M1–M6 hosted regression is **184/184**.
- Browser: the initial full run passed **71/76** in 11.4 minutes. Four manager checks incorrectly expected a transient success message after a versioned form remounted; the tests now check the persisted version shown in the UI. One mobile M2 login timed out without a reported authentication error. The stable-deployment rerun passed **28/28** (all M7 and M2 scenarios), followed by **8/8** actionable desktop/mobile workflows after the final snooze-clock and activity projection corrections. Across these runs, all 76 distinct scenarios passed; this is not a claim of a single clean 76-test run.
- Strict TypeScript, ESLint with zero warnings, Prettier, the final production build, and `git diff --check` passed. Dependency audit found zero vulnerabilities across 601 dependencies. The final secret review checked 320 tracked/nonignored files, including comparison against eight private fictional passwords, and found no known secrets or tracked private environment files.
- Desktop and mobile M7 task screenshots were visually inspected. Touch controls, snooze state, completion state, and responsive layouts were exercised through the browser.

Evidence files: `M7-hosted-results.json`, `M7-hosted-matrix-results.json`, `M7-hosted-operations-results.json`, `M7-hosted-role-results.json`, `M7-hosted-final-results.json`, `M7-clean-hosted-smoke-results.json`, `M7-prior-module-hosted-results.json`, and browser/local result files in this directory. Earlier M5/M6 reports remain historical baseline evidence; fresh regression results are copied into the M7 report set.

The tested scale includes 200 sources enrolled in ten resumable 20-record batches, 30 active actions during archived-user reassignment across the 25-record batch boundary, paginated execution history, scoped circuit limits, and an actual private dispatcher invocation processing 28 due sources within its 100-source ceiling. The local load regression independently exercises 120 sources. These are development acceptance measurements, not a production load certification.

## Reproducing acceptance

Local gates: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, and `npm audit --json`. Stop the Next server before a production build.

Hosted runners under `tests/support/` require the existing fictional identity environment, `GLARA_CONVEX_ACCEPTANCE=yes` and the corresponding `GLARA_M7_ACCEPTANCE=yes` or `GLARA_M6_ACCEPTANCE=yes` opt-in. They verify the authorized development URL. Keep credentials outside source control. The initial suites are `m7-hosted-acceptance.ts`, `m7-hosted-matrix.ts`, `m7-hosted-operations.ts`, `m7-hosted-roles.ts`, and `m7-hosted-final.ts`; they depend on explicitly scoped fictional fixtures and the guarded temporary adapter. Review their fixture dependencies before rerunning. They are not production commands.

After adapter removal, `npx tsx tests/support/m7-clean-smoke.ts` exercises public functions with `GLARA_M7_BROWSER_FIXTURE` pointing to the private fictional fixture JSON. Browser coverage lives in `tests/e2e/automation.spec.ts`; the normal repository runner is `npm run test:e2e -- tests/e2e/automation.spec.ts`. The acceptance run used the installed Chrome channel and an existing production server. Finally run `npx tsx tests/support/m6-hosted-acceptance.ts` after all business fixture writes have stopped; revision changes correctly invalidate an in-progress reconciliation.

## Temporary fixtures and clean deployment

The guarded internal M7 adapter was used only on marked fictional sources and fictional non-manager identities in the authorized deployment. It corrected fictional quote, invoice, opportunity, Realtor and package timestamps to exercise real elapsed-date thresholds; no real business record was redated. It also supplied isolated rollback failures, duplicate linkage, snooze/suppression expiry, and reversible role/archive tests. Original role and rule settings were restored.

Twelve remaining marked fictional automation actions were closed in a bounded cleanup; business records, payments, physical inventory history and audit history were retained. No records were destructively reset. Subsequent browser/smoke fixtures close their own actions and restore disabled policy in `finally` blocks.

Both temporary source files were removed from `convex/` and a clean backend was redeployed. CLI invocation confirmed that `m7AcceptanceControl:control`, `m7AcceptanceControl:cleanup` and `m6HistoricalImport:importHistory` are unavailable. Officially regenerated bindings contain none of these modules. Reproducible guarded adapter sources remain under `tests/support/`; they are not deployed.

## Limits and production prerequisites

- External email/SMS/WhatsApp, payments, liability decisions, inventory movement, date changes, project creation and M8 AI remain outside automation authority.
- Source enrollment is explicit, paginated and resumable. Production activation needs a reviewed backlog scope and operating thresholds; rules ship disabled.
- Current source relationship limits are enforced, including 100 linked sources, 100 payments and 100 invoices per customer, and existing project/team caps. Oversized sources require explicit operator review. Rule statistics clearly report bounded sample sizes.
- No invented high-value asset prioritization: M4 has no authoritative financial valuation field.
- Production workload/cost monitoring, historical evidence retention, backup/recovery rehearsal, security review, and all deferred email/auth requirements remain required before production.
- Independent review remains required before M8. Development acceptance does not certify production readiness. No unresolved P0/P1 issue was identified in the tested development scope. The initial mobile login timeout did not recur in the unchanged M2 rerun; its root cause was not established.

## Defects addressed during local hardening

- Coalesced overlapping quote/collection stages and adopted overdue manual tasks instead of creating duplicates.
- Kept completion separate from source resolution and preserved next-action invariants on closure.
- Prevented commercial task data appearing through project activities.
- Rechecked visibility after role revocation, source payment, acceptance and asset recovery.
- Corrected project task membership during escalation and queued assignment review after profile changes.
- Added explicit duplicate/linkage repair and bounded circuit/failed-work visibility in the existing Action Center.

## Hosted hardening corrections

- Suppression now closes existing active work atomically, including evaluation races, while preserving the prospect/opportunity next-action invariant.
- Unresolved notifications use the matching index range, so resolved history cannot hide current work on the first page.
- Returning an action to a previous assignee reopens the existing notification instead of silently losing it.
- Snoozed notifications remain quiet; action cards display the snooze date and actual task completion immediately. The expiry display uses an effect-managed clock refreshed every 30 seconds, keeping React rendering pure.
- Customer credit review includes both unallocated receipts and outstanding paid-invoice credits. Credit/allocation writes enqueue the customer for re-evaluation; Vancouver dates are used consistently.
- Lost reactivation distinguishes listing from sale and excludes properties with an authoritative recorded project sale.
- Three-day preparation now evaluates outstanding required staging checks after M3 planning has passed.
- The temporary adapter uses static imports supported by Convex. Harness corrections handle void CLI results, valid reserved dates, isolated calendar slots, and existing M2 duplicate-opportunity protection.

### Activity analytics release blocker resolved

Global reconciliation initially detected ten source-fact differences on five completed fictional CRM activities, with twenty-three affected aggregate comparisons. A legacy M1 activity has no numeric version, so analytics originally used its updated timestamp. M7 completion added a small numeric version, which the analytics stale-version guard rejected. A new regression reproduced this exact failure before correction.

Activity projection watermarks now retain the maximum of the updated timestamp and optional counter. The stale-version guard and server authorization remain intact. The existing authenticated Owner compare/repair APIs repaired ten derived facts on the five explicitly identified fictional activities, with audit reasons. Before/after source snapshots matched exactly. No business facts, dates, payment records or audit history were changed by this repair. The new hosted clean smoke verifies zero drift after completing a newly created legacy CRM follow-up. See `M7-analytics-repair-results.json` and the retained initial failure evidence.

The final independent reconciliation passed with zero drift after the repair, final browser workflows, and clean hosted smoke.

No M1–M6 business capability was intentionally removed. No external communications, automatic commercial decisions, production deployment, or M8 work were performed.
