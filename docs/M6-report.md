# M6 — Analytics and executive command center

**M6 DEVELOPMENT ACCEPTANCE PASSED — deployed to the authorized Convex development environment. Production requirements remain deferred. M7 has not started.**

Specification received through section 180, including both identical event-correction continuations. Accepted M5 base: `a387526d0b83b973a630538015bc8f7731e8c2ab`. M7 has not started. Production has not been changed.

## Delivery and release boundary

This change implements the Convex-native analytics projection engine, role-scoped dashboard and reports, reconciliation, controlled repair, and regression tests. It preserves M1–M5 as the authoritative business records. Analytics does not become a second financial ledger or an alternative inventory reservation engine.

The product owner explicitly authorized M6 upload, deployment, analytics backfill and fictional hosted/browser acceptance to Daryan's development deployment `woozy-jaguar-392`, project `glara-os`. The implementation and officially regenerated bindings have been deployed there. Production remains untouched. Earlier upload review was resolved by this explicit authorization.

Sequential backfill completed. The first independent rebuild correctly blocked activation: it found one stale current follow-up city and two corresponding dimension buckets after an M2 property change. Dependency tracking now refreshes open activities linked directly to a property, through an opportunity, or through a project. A regression test verifies current geography changes while historical activity facts remain unchanged. An explicit authenticated Owner repair refreshed that one projection, using current source version, revision and an audited reason. Source records and historical events were not edited. Initial failed evidence is retained in `docs/M6-initial-drift-results.json`; the subsequent fresh zero-drift run passed and reporting was activated.

The frontend detects the backend capability through `profiles.viewer.analytics_version`. It retains a working M5 fallback for an older backend, and with M6 it withholds executive reporting until sequential backfill and fresh zero-drift reconciliation permit explicit Owner activation.

## Architecture and files

| Location                                | Responsibility                                                                              |
| --------------------------------------- | ------------------------------------------------------------------------------------------- |
| `src/lib/analytics/periods.ts`          | Vancouver event precision, period validation and comparison ranges                          |
| `src/lib/analytics/model.ts`            | Exact integer amounts, ratios, net bucket deltas, configurable targets                      |
| `src/lib/analytics/catalog.ts`          | Central metric labels and role allowlists                                                   |
| `convex/analyticsSchema.ts`             | Projection, settings, correction and reconciliation tables                                  |
| `convex/analyticsSources.ts`            | Recompute facts from authoritative M1–M5 records and historical evidence                    |
| `convex/analyticsLedger.ts`             | Stable fact identities, idempotence, source-version checks and delta application            |
| `convex/functions.ts`                   | Transactional source-change tracking and public event-context redaction                     |
| `convex/analytics.ts`                   | Scoped summaries, comparisons, trends, drill-downs, cohorts, targets and backfill           |
| `convex/analyticsOperations.ts`         | Action center and capacity using existing M3/M4 queries                                     |
| `convex/analyticsHistory.ts`            | Paginated as-of AR and underused serialized inventory                                       |
| `convex/analyticsMaintenance.ts`        | Bounded backfill/reconciliation actions and read-only source/inventory evidence diagnostics |
| `convex/analyticsReconciliation.ts`     | Independent rebuild, drift reports, explicit repair and activation                          |
| `src/components/analytics/`             | Responsive dashboard, overview panels, Owner reports and reporting clock                    |
| `scripts/m6-backfill.mjs`               | Opt-in, exact-development-target sequential backfill runner                                 |
| `tests/convex/analytics*.test.ts`       | Domain, correction, authorization and reconciliation tests                                  |
| `tests/support/m6-hosted-acceptance.ts` | Prepared hosted role/query/reconciliation acceptance runner                                 |
| `tests/e2e/analytics.spec.ts`           | Prepared M6 desktop/mobile feature acceptance                                               |

No new package, secret, external provider, AI integration or automation engine was introduced. Existing Next.js strict TypeScript, Convex Auth, centralized role checks and protected routes remain in use. A pre-existing negative-cent formatting defect was fixed with exact integer formatting and regression coverage.

## Data schema and indexes

New tables: `analytics_facts`, `analytics_buckets`, `analytics_settings`, `analytics_state`, `analytics_changes`, `analytics_reconciliations`, and `analytics_expected`.

Facts retain source table/id, stable event key, source version, active state, event precision/time, historical dimensions and exact string value. Indexes support source identity and bounded metric/day/month or salesperson/realtor/source/city/project/product drill-downs. Buckets store day, month or current values indexed by key, period, metric and dimension/member. Reconciliation expected rows are indexed by run/key and run/checked state. Source additions are optional event-context snapshots plus focused activity, invoice, asset and movement indexes; existing records remain valid.

Source tables include CRM activities/realtors, opportunities/consultations/quotes, projects, agreements, invoices, payments/allocations/reversals/credits, extensions, assessments, products/assets/stock/reservations/movements/damage/inspections. Property and product changes also refresh affected current projections. Generic `updated_at` is used only for change/version tracking where needed, never as a historical business event.

## Event and accounting semantics

- Offset-bearing instants use America/Vancouver. Date-only receipt, listing and sale values preserve business-date precision. No invented midnight instant moves a business day.
- Periods include today, week/month/quarter/year to date, previous complete month and bounded historical custom dates. Comparisons use corresponding elapsed calendar ranges, with month/leap-day clamping. The server supplies the clock; the client refreshes time-sensitive queries each minute.
- Project output counts the first evidenced valid staged transition once per project. Scheduled capacity remains a separate forecast. Rejected staging transitions produce no completed staging fact.
- Opportunity creation cohorts, reached-stage evidence and the current valid Won/Lost outcome are distinct. Reopening removes the closed-outcome contribution; another valid Won contributes once under its valid event.
- Invoice issuance, credits and voids remain separate event flows. Cash follows actual receipt day; recording follows entry time. Allocation does not add company cash. Reversals and credits contribute in their own later periods without rewriting original gross flows.
- Current AR, collectible value, unallocated cash and customer credits derive from M5 authoritative records. Historical AR reconstructs eligible invoices, credits, allocations, receipt dates, reversals and voids as of the requested day. Its paginated subtotal is explicitly not a company-wide historical total.
- Financial arithmetic uses integer cents as strings and BigInt, with explicit half-up rounding where appropriate. No floating-point monetary sums are introduced.
- Event identity uses source IDs and event keys, not mutable names. New event contexts freeze responsible salesperson, source and other supported dimensions. Reassignment changes future events and appropriate current pipeline state without moving previous performance.
- Backdated new events recover ownership/geography from reliable source audit evidence as of the business day. Date-only attribution uses end-of-business-day evidence, not a fabricated precise time. Missing legacy evidence remains unknown; current ownership is not silently used to invent historical attribution.
- Same-month and cross-month corrections net old/new bucket contributions. Relevant dimension totals, including unknown members, conserve company totals. Archiving preserves historical facts while appropriate active/current counts change.

## Security and roles

Authentication, archived-user denial and role checks run on the server for every public entry point. Actor identity comes from the authenticated session. Public queries strip internal event contexts from source payloads. Direct function invocation cannot override scope.

| Role                    | M6 access                                                                                                                  |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Owner                   | Executive and commercial metrics, targets, all reports, reconciliation, explicit audited repairs and activation            |
| Admin                   | Operational/commercial dashboard and authorized drill-downs; no Owner settings or repair                                   |
| Sales                   | Own salesperson scope, pipeline, follow-ups and cohort/stage information; no company finance or other salesperson override |
| Marketing               | Approved aggregate creation/staging/content counts and lead-source comparisons; no private CRM or financial metrics        |
| Designer / Staging Crew | Existing assigned operations workflows, without executive/CRM analytics                                                    |

The Reports navigation route retains the existing Owner-only grant. Admin analytics appears on Dashboard. Metric permissions are centralized rather than implemented solely by hiding cards. Query input is validated and bounded; safe domain errors do not disclose internal payloads.

## Concurrency, reconciliation and corrections

Wrapped authoritative mutations capture affected sources and refresh facts/buckets atomically in the same Convex transaction. Convex optimistic concurrency retries conflicting writes. Stored stable identities and source versions prevent duplicate application and stale overwrite. Dependent invoices/payments/projects and current property/product projections refresh with the source mutation.

Reconciliation independently paginates authoritative records, recomputes expected facts and bucket totals, and compares both stored facts and buckets. It writes only report metadata/expected rows; it does not repair projections by default. A source revision watermark makes a run stale if business data changes during the run.

Owner repair requires a reason and current source/reconciliation proof. Source repair accepts the source identity/version, not an arbitrary replacement financial amount. Bucket repair uses independently computed expected values and rejects stale or source-dirty proof. Repairs are audited and invalidate the previous watermark. Activation requires completed sequential backfill and a fresh complete run with zero source drift and zero bucket drift.

M6 does not grant new authority to edit immutable M5 receipt dates, issued financial snapshots or historical audit records. Tests use isolated fixture-only source changes when an upstream correction API does not exist. Those tests establish projection behavior, not a new business correction feature. Valid source adjustments still go through the owning M1–M5 workflow.

## Dashboard and reports

The Owner dashboard includes configurable minimum/target/stretch staging targets (20/35/50 defaults), period comparisons, source drill-downs, trend tables, sales funnel/stage velocity/cohorts, commercial flows, current balances and operational inventory counts. Serialized assets and quantity stock are displayed separately. Warehouse quantity explicitly excludes reservation subtraction; it is not presented as a date-aware promise of availability.

The action center reuses existing M3 attention/capacity and M4 exceptions. Commercial actions cover overdue balances, unapplied receipts, deposit needs and accepted extension/damage billing gaps. Ordering is deterministic by severity, financial impact, due date and identity. Bounded feeds disclose partial results. Forecasts show scheduled workload for 7/14/30 days rather than claiming actual completed staging.

Reports expose transparent configurable Realtor segments, dimension comparisons, historical AR pages, underused inventory, targets, reconciliation and activation. Missing history, unknown dimensions, zero denominators and unavailable projections have explicit states. Accessible solid/dashed SVG trend lines complement exact-value tables; only dimensionless pixel coordinates convert to Number, while monetary values remain integer cents. Forms validate custom dates without destroying the page.

## Local checks performed

| Check                                                       | Result                                                                                                |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `npm test`                                                  | PASS: 13 Node tests + 250 Vitest tests; 16 Vitest files; 0 failures (final suite: 8.46s Vitest)       |
| TypeScript                                                  | PASS: `npm run typecheck` and final build type check                                                  |
| ESLint                                                      | PASS: final `npm run lint`                                                                            |
| Prettier                                                    | PASS: full `npm run format:check`                                                                     |
| Next.js production build                                    | PASS: final Next.js production build                                                                  |
| Full desktop/mobile regression                              | PASS: 56/56 scenarios, 562.7 seconds, 0 failures/skips/flaky tests                                    |
| Hosted M6 API/security/reconciliation                       | PASS: 26/26 checks; final rebuild scanned 2,324 source records with 0 source drift and 0 bucket drift |
| Hosted M6 fictional multi-period correction scenario (§179) | PASS: 8/8 assertions, followed by final global zero-drift reconciliation                              |
| Final M6 desktop/mobile screen checks                       | PASS: 10/10 on the final frontend build, 30.3 seconds, 0 failures/skips/flaky tests                   |
| M1–M5 hosted regressions against M6                         | PASS: 150/150 checks, no failed assertions                                                            |

The full browser suite covers authenticated and unauthenticated navigation, session cookie/storage protection, role boundaries, CRM, sales, operations, inventory, commercial workflows and M6. The final M6 rerun verifies role dashboards, period changes, drill-downs, report navigation, fully loaded targets/history/inventory reports, responsive widths and the accessible chart. Desktop/mobile Owner dashboards, the trend chart and loaded report controls were visually inspected. Two invalid-credentials/recovery-send scenarios were deliberately excluded; no email delivery acceptance is implied. Compact browser evidence is committed in `docs/M6-browser-results.json` and `docs/M6-final-browser-results.json`; screenshots remain ignored local artifacts.

An intermediate run with unit tests, lint and browser checks competing for resources exceeded the unchanged five-second M5 volume-test limit. Related source tracking was optimized to reuse existing stable fact identities instead of recomputing a redundant pre-change projection. The subsequent complete suite passed, including that volume test, without changing its assertions or timeout. Dedicated hosted load testing beyond the acceptance fixture volume was not performed.

Automated local coverage includes event precision/DST/leap periods, same-month/cross-month net corrections, later reversals/credits, received-versus-recorded dates, current and historical AR, no allocation cash duplication, reopen/re-Won, first staged once, invalid staging rejection, sold/discovery date corrections, later inventory adjustment, archive preservation, backdated ownership attribution, exact negative amounts, dimensional conservation, duplicate/stale source application, concurrent credit/reversal and repair/reversal, independent zero-drift rebuild, corruption detection, default read-only reconciliation, stale-proof repair denial, sequential backfill/activation and direct role/anonymous/archived-user denial.

## Development deployment and acceptance procedure

1. The product owner has supplied explicit M6 source-upload/deployment authorization for Daryan's development deployment `woozy-jaguar-392`, project `glara-os`. Do not target production.
2. Verify `.env.local` targets `dev:woozy-jaguar-392` and its existing Convex URL. Regenerate official bindings, run local checks, then deploy with `npx convex dev --once --env-file .env.local` only against the authorized target.
3. In PowerShell set `$env:GLARA_M6_BACKFILL='yes'`, set `$env:GLARA_M6_BACKFILL_RESTART='yes'` for the first intentional initialization, then `node scripts/m6-backfill.mjs`. For an interrupted run, omit the restart flag to resume its persisted cursor. This script invokes already-deployed internal functions without `--push`, rejects a deploy-key override and enforces the exact development target. It leaves reporting unavailable. `analyticsMaintenance.backfillBatch` executes up to 100 small transactions per internal action, avoiding a new CLI launch per page. Owner-only `reconcileBatch`, also used by the Reports UI, executes up to 50 protected reconciliation mutations, preserving live role/session checks and stale-watermark rejection. Read-only internal diagnostics identify at most 100 source mismatches by record/key/changed field, without returning customer payloads.
4. As Owner, open Reports, run reconciliation to completion and review drift. Investigate source drift; use explicit targeted repair only with valid proof and reason. Run a fresh reconciliation after repair. Activate only with a current zero-drift result.
5. Run guarded hosted acceptance with the existing private fictional identity environment and `GLARA_CONVEX_ACCEPTANCE=yes`: `npx tsx tests/support/m6-hosted-acceptance.ts`. This runner alone does not establish §179 acceptance. The separate `m6-hosted-corrections.ts` runner imports new fictional historical records, checks eight multi-period assertions, and requires final global zero-drift reconciliation. Its source is `tests/support/m6-historical-import.ts`: temporarily copy it into Convex with relative imports adjusted, deploy only to the authorized dev target, run acceptance, remove the temporary Convex file, and redeploy. The helper checks the exact deployment URL, reserved fictional actor, exact fixture markers, relationships and amounts. It clones new records with historical evidence and new sequence numbers; it does not redate existing records. It has been removed from the running deployment after the scenario.
6. Run M1–M5 hosted regressions. Stop the local Next server before building the frontend, restart it, then run M6 desktop/mobile acceptance with `GLARA_M6_ACCEPTANCE=yes` plus the existing acceptance identity environment. Review the visual results.
7. Record exact results, fix failures, update this report, commit and push. Stop before M7.

## Known limitations and pre-production dependencies

The hosted geography drift found during acceptance was fixed, covered by regression and explicitly repaired. The final independent rebuild and browser acceptance passed. No unresolved P0/P1 issue was identified in these acceptance results. This is development acceptance, not production readiness or a claim that no undiscovered defect exists.

Legacy audit gaps remain explicit unknown attribution. No fabricated historical utilization snapshot, external payment/refund ledger, automatic sender integration, AI score, or unsupported DSO calculation is provided. Read-only inventory evidence acceptance additionally compares each serialized staging-use counter with actual install movements; it reports mismatches and never repairs M4 source inventory. This check currently caps per-asset install evidence at 500 and fails explicitly above that bound. Existing lightweight M2 summaries remain for compatibility and derive from authoritative records.

Bounded work includes 300 facts/source, 500 historical audit events, 200 related opportunities/property, 200 open activities or projects per relationship, 200 assets/product and 100 stock rows/product; unusually large relationships require a planned paginated extension. Breakdown limits are 500 members/slice and 5,000 accumulated rows; AR due keys are capped at 2,000. Underused inventory and historical AR are paginated. Queue truncation and unknown data must not be interpreted as company totals. Reconciliation/backfill can become stale under concurrent activity and must be resumed/restarted as directed, never silently accepted.

No real customer data, payment-sensitive fixture data, test passwords, environment files or secrets are intended for this commit. `.env.example` remains the documented placeholder template. Test identities remain private, and generated browser/result artifacts remain ignored. Final repository review checked all 286 tracked/nonignored files: no credential-pattern matches, known environment secret matches or matches to any of the eight private fictional passwords; no tracked environment files beyond `.env.example`. New fixtures use fictional example identities and amounts. Raw test artifacts remain ignored; committed result reports contain assertion names, counts and non-sensitive execution metadata. Pattern checks cannot prove the absence of every possible secret.

Invitation/onboarding delivery where applicable, password recovery delivery/flow, reused/expired auth-link handling, production redirect/origin verification, transactional provider configuration and sender/domain verification for `Support@glarahome.com` remain **DEFERRED — REQUIRED BEFORE PRODUCTION**. No deferred requirement is marked passed. Supabase-specific gates remain superseded by the Convex migration.

## Hosted execution evidence

- `docs/M6-hosted-regression-results.json`: 150/150 M1–M5 hosted checks passed (M1 48; M2 20; M3 16 + 5 query checks; M4 25 + 7 quantity checks; M5 15 + 14 integrity checks). An initial M3 setup attempt stopped before assertions while backfill was active; isolated fixture creation and the subsequent complete run passed. The generic runner did not preserve the underlying cause, so no specific cause is claimed.
- `docs/M6-hosted-correction-results.json`: 8/8 assertions passed. May creation/cohort; June Won, first staged, invoice issue and actual receipt; July entry/allocation with no company receipt duplication; August credit; subsequent real reassignment preserves original salesperson attribution; reconstructed AR is 10000 / 6000 / 5000 cents at June / July / August end. The dates are deliberately historical relative to the September execution clock.
- `docs/M6-initial-drift-results.json`: initial complete rebuild detected 1 source-fact and 2 bucket differences and did not activate reporting. Corrected dependency behavior and audited targeted repair are described above.
- `docs/M6-initial-reconciliation-results.json`: fresh initial activation proof. Initial fresh proof passed over 2,107 source records with zero source and bucket drift and enabled reporting. Final acceptance repeated independent reconciliation after the 56-scenario browser suite and a fresh 20-check M2 run: 2,324 source records, zero source drift and zero bucket drift (revision 1117).

- `docs/M6-hosted-api-results.json`: 26/26 M6 hosted checks, including direct role/scope denial, anonymous denial, archived/unassigned denial, 46 serialized counters matching actual installation evidence, and the final independent zero-drift rebuild.
- `docs/M6-browser-results.json`: 56/56 full desktop/mobile scenarios. `docs/M6-final-browser-results.json`: final 10/10 M6 scenarios after chart and batched-reconciliation UI changes, including waiting for loaded report data.

## Completion boundary

M6 development deployment, backfill, explicit activation, multi-period acceptance, regression/security testing and reporting are complete. The temporary historical-import backend function was removed and the development backend redeployed; only its reproducible, guarded test fixture source remains under `tests/support`. No production environment, external email delivery or M7 functionality was changed. Stop here for independent review before any next milestone.
