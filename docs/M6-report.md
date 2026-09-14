# M6 — Analytics and executive command center

**IN PROGRESS — SPECIFICATION INCOMPLETE. M6 HAS NOT PASSED ACCEPTANCE.**

Base: accepted M5 commit `a387526d0b83b973a630538015bc8f7731e8c2ab`.

## Specification intake

Three attachments were supplied. The first contains detailed sections 1–52 and the start of 53. The second restates 1–52 and adds the authoritative event-time requirements through section 77, stopping within its example. The third continues sections 78–136 and stops mid-sentence in section 137, **EVENT CORRECTIONS**, after “If an authoritative module”.

The common business requirements and the explicit timestamp rules are compatible. Event correction, remaining acceptance/release requirements and any additional sections cannot be inferred from the truncated material. The remainder has been requested. No M6 deployment or aggregate backfill has been performed. Production requirements remain **DEFERRED — REQUIRED BEFORE PRODUCTION**. M7 has not started.

## Independent foundation implemented

`src/lib/analytics/periods.ts` provides strict, reusable analytics period helpers. It reuses the existing M3 Vancouver business-day implementation rather than introducing a conflicting timezone calculation.

- Explicit `instant` versus `business_date` event precision: offset-bearing timestamps are converted to America/Vancouver; date-only source values retain their business date. A receipt recorded as September 30 must not become September 29 through UTC-midnight parsing.
- Canonical day, month, quarter and year keys derive from the supplied authoritative source event, never generic record-update time.
- Today, Monday-based week-to-date, month-to-date, previous complete month, quarter-to-date and year-to-date presets. Custom inclusive historical ranges are initially bounded to 366 days; further query cardinality limits will be needed independently.
- The server must supply the evaluation instant. Period input rejects additional fields, including a client-supplied `as_of`. These pure helpers are not public backend functions and do not grant authorization.
- Future instants are excluded even when they fall on today's business date. Date-only events retain day precision; no time of day is invented. Scheduled-work forecasts require a separate query contract.
- Calendar-day arithmetic remains stable across daylight saving. Invalid dates, timezone-free timestamps, reversed ranges and oversized/future historical ranges are rejected.

These helpers are tested but not yet wired into a dashboard or authoritative mutation. This is a foundation checkpoint, not delivery of the executive command center.

## Source audit: actual M1–M5 fields

| Metric family                                 | Authoritative evidence available now                                                                            | Implementation implication                                                                                                                                                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Opportunity creation / current closed outcome | `created_at`, current `won_at` / `lost_at`; full `STAGE_CHANGED` audit snapshots                                | Current closed outcomes can be attributed to their current valid event; transition counts must remain separate. Reopening removes current-outcome contribution, not historical transition evidence. |
| Salesperson at Won                            | Opportunity `assigned_to` inside the immutable Won audit snapshot                                               | Use the historical responsible user, not today's assignment. Mark missing history explicitly.                                                                                                       |
| Consultation / Quote                          | `scheduled_at`, `completed_at`; quote `created_at`, `sent_at`, `accepted_at`                                    | Distinguish scheduled, completed, created, sent and accepted metrics.                                                                                                                               |
| Project created / completed / cancelled       | `created_at`, `completed_at`, `cancelled_at`                                                                    | Do not substitute opportunity dates or collection dates.                                                                                                                                            |
| First Project staged                          | First `PROJECT_STATUS_CHANGED` audit with `new_value.status = staged`                                           | No dedicated first-staged field exists. Count a project once using audit event time. Scheduled staging is not delivered work.                                                                       |
| Completed operations events                   | `EVENT_STATUS_CHANGED` audit generated atomically when the event is completed                                   | The event's `updated_at` is not the historical completion source.                                                                                                                                   |
| Listing / pending / sold                      | Project business-date fields                                                                                    | Preserve date-only precision. Property sale is not company revenue.                                                                                                                                 |
| Agreement sent / accepted                     | `issued_at`; `acceptance.recorded_at`                                                                           | M5 uses recorded internal acceptance evidence, not a separately captured external signing time. Label this limitation; do not invent `accepted_at`.                                                 |
| Invoice issued / voided                       | `issued_at`, `voided_at`, immutable issued cents, `realtor_id` and identity snapshot                            | Gross issuance and later void adjustments belong to separate event periods. Drafts contribute no issuance.                                                                                          |
| Cash received                                 | Payment `received_date` (business date), `amount_cents`, `method`                                               | M5 has no `received_at` instant. Use the authoritative receipt day and retain that precision; do not substitute `created_at`.                                                                       |
| Cash recorded / allocated / reversed          | Respective records' `created_at`                                                                                | Reversals are negative cash flow in their own event period. Allocation changes invoice satisfaction, not company cash receipts.                                                                     |
| Credit issued                                 | Credit note `created_at`                                                                                        | M5 creates a credit as an immediately issued immutable adjustment. This is the issuance-equivalent event; no draft credit lifecycle or separate `issued_at` exists.                                 |
| Extension accepted                            | `approval.recorded_at`                                                                                          | This is recorded acceptance, distinct from invoicing and collection.                                                                                                                                |
| Damage review / approval / decision           | `created_at`, `approved_at`, `decided_at`                                                                       | No-charge and waiver use decision time; physical discovery remains M4's event.                                                                                                                      |
| Inventory physical events                     | Movement `occurred_at`, damage `discovered_at`, inspection `inspected_at`                                       | Installation, return, recovery and disposition metrics follow actual movement evidence. Retail disposition is not automatically revenue.                                                            |
| Historical attribution gaps                   | Invoice identity contains a combined address and Realtor name; no structured city or salesperson-at-issue field | Do not parse geography heuristically or join mutable current assignments to invent history. Recover from reliable source audit evidence where possible; otherwise expose unknown attribution.       |
| Refund settlement                             | Not captured in M5                                                                                              | `external/manual settlement not captured`; a credit is not a refund.                                                                                                                                |

## Architecture constraints for the remaining implementation

- Reuse existing `sales_metrics` and `sales_realtor_counts` where semantics match. Inspect and extend their transactional update paths rather than creating another current-pipeline source of truth.
- Historical period facts must be source-reconcilable and preserve event-time attribution. Domain/period aggregates should be bounded and updated in the source transaction. No dashboard-wide scans.
- Keep current AR/valid cash state separate from historical issuance, credit, void, receipt and reversal flows. Late allocations can refine invoice-category attribution using the original receipt date, without duplicating company cash.
- Reuse M3 risk/capacity, M4 availability and M5 balance/exception rules. Do not create divergent analytics implementations of their business invariants.
- Backend role enforcement must return explicit safe projections; never return an executive payload and hide financial fields only in the browser.
- Source snapshots must preserve historical attribution. Missing historical evidence is not permission to manufacture dimensions or timing.
- Reconciliation must report discrepancies without silently repairing. Repair must be explicit, authorized and audited. The truncated event-correction section may further constrain this design; aggregate schema and backfill implementation await that text.

## Validation of this checkpoint

Checkpoint checks: 13 Node tests and 208 Vitest tests passed, including 20 new M6 period tests; strict TypeScript and ESLint with zero warnings passed. Formatting passed; the source scan checked 255 files with zero credential-pattern matches and no tracked private environment files. The application production build was not rerun for these unwired pure helpers and documentation. Hosted M6 acceptance and browser M6 acceptance have **NOT RUN**. No executive UI, aggregate tables, reconciliation functions, targets, ranking or backfill is represented as complete.
