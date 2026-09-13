# M1 Hardening Report

Date: September 13, 2026. Scope: narrowly bounded M1 hardening; no M2 functionality or architectural rewrite.

**Implementation and isolated checks: PASS. Hosted release gate: PENDING EXTERNAL ACCEPTANCE.**

## 1. Findings addressed

| P1 finding                                       | Resolution                                                                                                                                                                                       |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Archived brokerage editable through ordinary RPC | Separate create/update paths. Updates lock the row, reject archived/missing offices and require matching positive version. No upsert resurrection. Applies equally to Owner, Sales and Admin.    |
| No cancel/reschedule UI                          | Open-action dialogs expose cancellation and atomic cancellation-plus-replacement. Last prospect action still requires a replacement or prior relationship-status change.                         |
| Undifferentiated database errors                 | Safe operation/code/category logging; static user messages for permissions, configuration, constraints, duplicates, stale/unavailable records, next-action invariants and retryable failures.    |
| Marketing operational roster                     | Operational choices RPC denied; dedicated sources query returns no owners. Roster policies exclude Marketing; own identity remains readable. Directory names use a narrow authorized projection. |

## 2. Files changed

| Files                                               | Purpose                                                                                                                     |
| --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| supabase/migrations/202609130002_m1_hardening.sql   | Versioning, archive guard, atomic reschedule, replacement linkage, narrowed policies/projections and purpose-specific query |
| src/lib/crm/model.ts                                | Brokerage version contract and reschedule validation/operation                                                              |
| src/lib/crm/data.ts                                 | Safe classified/logged query failures and role-appropriate choices                                                          |
| src/lib/crm/errors.ts; src/lib/logger.ts            | Pure safe classification/log projection and server-only structured logging                                                  |
| src/app/(workspace)/realtors/actions.ts             | Reschedule validation, safe mutation errors and response-contract handling                                                  |
| src/app/(workspace)/realtors/unavailable/page.tsx   | Authenticated read-failure page with static category-specific messages                                                      |
| src/app/(workspace)/realtors/page.tsx               | Operational owner picker omitted for Marketing                                                                              |
| src/components/crm/forms.tsx; display.tsx           | Brokerage version submission, cancel/reschedule dialogs and original-due-date history                                       |
| tests/support/database.ts                           | Apply the new migration in isolated tests                                                                                   |
| tests/crm-hardening.test.ts; crm-errors.test.ts     | Adversarial SQL/RLS and logging regressions                                                                                 |
| tests/e2e/hardening.spec.ts                         | Desktop/mobile cancellation, rescheduling and Marketing scope                                                               |
| README.md; docs/architecture.md; docs/operations.md | Updated current behavior and release-gate references                                                                        |
| docs/hosted-supabase-acceptance.md                  | Exact hosted environment, fictional users, direct REST, workflow, audit and session procedure                               |
| docs/screenshots/m1-hardening-*.png                 | Fictional desktop/mobile evidence                                                                                           |

## 3. New migration

**202609130002_m1_hardening.sql** is appended after the unchanged M0 and M1 migrations.

- brokerages.version: integer, NOT NULL, default 1, positive constraint.
- activities.replaces_activity_id: nullable self-referencing UUID foreign key.
- brokerage_save updates use SELECT FOR UPDATE, active-row guard and optimistic version comparison; accepted edits increment version.
- activity_reschedule locks the existing parent Realtor, cancels the open original, and inserts a linked replacement within the same transaction.
- Replacement preserves original type, owner, priority and notes. The original due_at remains untouched and completed_at stays null.
- Existing deferred prospect constraint and transactional audit triggers remain active.
- CREATE OR REPLACE RPC/view definitions preserve established boundaries and explicitly retain restricted grants.
- Revised profile/role policies restrict roster reads to operational roles. The safe directory owner-name function checks caller role and, for Marketing, association with an active visible Realtor.

No already-applied migration was edited.

## 4. Security impact

Archived offices cannot be edited by crafted ordinary RPC calls, including attempts to pass deleted_at=null. Missing offices cannot be recreated through the update path. Stale versions return 40001; archive/missing guards return 42501. Row locking serializes competing updates before the version comparison.

Marketing can read its own identity, permitted Realtor owner display names and lead sources, but cannot enumerate the operational roster through profiles, user_roles or choices. Existing field separation, crew/designer denial and inactive-account controls remain intact.

Structured logs include only event, allowlisted operation, sanitized database code, fixed category and timestamp. Raw database messages, details/hints, forms, notes, row contents, tokens and credentials are never copied into these logs. User messages are fixed templates, including for recognized business exceptions; arbitrary PostgreSQL text is not reflected.

Read failures redirect to a protected category-specific state instead of collapsing every failure into a migration diagnosis. Mutations return safe form errors. Unknown transport failures recommend retry/reload; schema mismatch recommends configuration review.

## 5. UX changes

Open next actions expose Complete, Reschedule and Cancel action. Cancel never means completed. Cancelling the last prospect action without replacement shows the invariant message and leaves the original untouched. Reschedule requires replacement title/date; the original is displayed as Cancelled with its original due date.

Dialogs use the existing responsive Radix foundation and work in the mobile flow. Brokerages submit the loaded version when editing. Marketing retains directory and sources while the operational owner picker is omitted.

[Fictional desktop evidence](screenshots/m1-hardening-desktop.png) · [Fictional mobile evidence](screenshots/m1-hardening-mobile.png). Full-page captures show fixed mobile navigation at its viewport boundary.

## 6. Tests added

- Archived brokerage write attempts by Sales, Admin and Owner, including crafted archive data.
- Stale/missing brokerage version and nonexistent-ID rejection; rejected writes preserve rows/audit counts.
- Marketing choices denial, no cross-user profiles/roles roster, safe owner-name and sources retained.
- Cancellation of the last prospect action rejected atomically.
- Missing/invalid replacement date rolls back.
- Reschedule keeps original due date, cancelled/non-completed status, assignee and explicit replacement link.
- Repeated reschedule of a closed original rejected; cancellation with replacement and audit actor validated.
- Error-code categories and rejection of private error/operation content in logs/messages.
- Browser cancel/reschedule history and invariant handling on desktop/mobile.
- Browser Marketing directory/source access without owner picker or source-write action.

Local stale-version tests simulate competing stale snapshots; a true multi-session hosted race is explicitly included in external acceptance.

## 7. Exact test results

| Command                                    | Final result                             |
| ------------------------------------------ | ---------------------------------------- |
| npm run typecheck                          | PASS; zero TypeScript errors             |
| npm run lint                               | PASS; zero warnings                      |
| npm test                                   | PASS; 14 tests, 0 failures               |
| npm run build                              | PASS                                     |
| PLAYWRIGHT_CHANNEL=chrome npm run test:e2e | PASS; 18 tests, 0 failures, 36.1 seconds |
| npm run format:check                       | PASS                                     |
| git diff --check                           | PASS                                     |

All prior M0/M1 tests remain enabled and passing. The final browser run logged expected auth-failed negative tests and structured next_action cancellation rejections, with no raw payloads. Tooling emitted color-environment notices; no application exception occurred.

The first implementation check caught a Supabase thenable typing mismatch; it was fixed using Promise.resolve before the passing quality gate. No lint rules or test cases were disabled to pass.

## 8. Hosted Supabase acceptance status

**PENDING EXTERNAL ACCEPTANCE.**

No .env.local or process Supabase URL/publishable key was configured. No hosted authentication, REST/PostgREST, migration, session-refresh or release test is claimed as passed.

Follow [the exact hosted acceptance procedure](hosted-supabase-acceptance.md). It covers all six roles, additional inactive/unassigned negatives, direct API grants/RLS, creation/editing, follow-up/completion/cancellation/rescheduling, archive/restore, archived brokerage and stale concurrency, audit actor and refresh/logout. Use a dedicated hosted development project and fictional data only. Record actual outcomes privately.

## 9. Remaining P2 items

Documented for measurement and later work, not rewritten:

1. Directory lateral aggregation: calculate EXPLAIN ANALYZE and activity fan-out at representative volumes; consider measured alternatives only.
2. Exact counts: evaluate broad-filter count cost separately from page fetch.
3. Name ordering: lower(last_name)/lower(first_name) sort does not exactly match the current plain-column name index.
4. Phone substring search: normalized contains queries may scan; benchmark before specialized indexing.
5. Offset pagination: deep pages grow more expensive; evaluate keyset pagination after measuring expected usage.
6. Brokerage/source archive management: no normal archive/restore UI yet; archived brokerage ordinary editing is now denied.
7. Exact-limit hasNext: timeline/queue/brokerage screens infer next page from a full page and may show an empty final page at an exact limit. Later use limit+1 or explicit continuation metadata.

No performance benchmark at 5,000–20,000 records is claimed.

## 10. M2 readiness recommendation

The requested local P1 hardening work is complete and ready for hosted acceptance. **Do not treat the release gate as satisfied or approve M2 readiness until hosted acceptance is executed and reviewed.** No M2 code, integrations, AI or unrelated redesign was added.

STOP at this hardening pass.
