# M5 — Convex-native commercial operations

**M5 DEVELOPMENT GATE PASSED**

Scope: the complete replacement M5 specification, sections 1–91. The product owner explicitly authorized M5 development deployment and corrective acceptance work. Base implementation: `765c18a3180bff3df10587e1045c877a9c57242f`. M5 was deployed to Daryan's `glara-os` / `woozy-jaguar-392` on 2026-09-14. A corrective Convex deployment completed at 13:43:25 UTC; the corrected Next production build then passed. The source and evidence in this report are included in the final acceptance commit. M6 has not started. No production deployment, destructive reset, email configuration, real payment or real customer fixture was used.

This document does not certify production readiness. Obtain the commit containing this report with `git log -1 --format=%H -- docs/M5-report.md`.

## Architecture and files

- `convex/commercial.ts`: public, authenticated queries and transactional mutations. No new HTTP endpoint, action, payment processor, email sender or public onboarding path.
- `convex/commercialCore.ts`: centralized Owner/Admin write permissions, assigned-Sales read scope, exact derived balances, independent counters, document source checks and audit helpers.
- `convex/commercialSchema.ts`: additive Convex tables and indexes, composed into the existing schema. No SQL, Supabase component, manual database reset or data rewrite.
- `src/lib/commercial/model.ts`: strict server-shared input contracts, exact money calculations, tax allocation and derived invoice status.
- `src/components/commercial`: project summary, agreements, invoice editor, payment receipts/allocation, assessments, AR, commercial settings, audit history and printable documents.
- Protected routes: `/projects/[id]/commercial`, `/agreements/[id]`, `/invoices/[id]`, `/payments/[id]`, `/assessments/[id]`, `/payments`, `/commercial`, `/commercial/settings`.
- `tests/convex/commercial*.test.ts`: unit and authenticated Convex transaction tests. `tests/support/m5-hosted-acceptance.ts`, `tests/support/m5-hosted-integrity.ts` and `tests/e2e/commercial.spec.ts` provide hosted and browser acceptance against real Convex authentication and fictional fixtures.

## Schema and indexes

| Table                     | Responsibility                                                                              | Main indexes                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| commercial_customers      | Durable billing identity independent of Realtor                                             | active/archive                                                                                       |
| agreements                | Numbered terms, source quote, bill-to and property snapshots, acceptance, replacement chain | project, number, status                                                                              |
| invoices                  | Numbered draft/issued/void documents and source references                                  | project, agreement, source type/id, issue date, customer/date, Realtor/date, status/due date, number |
| invoice_items             | Separate immutable issued line items, discount and tax snapshots                            | invoice                                                                                              |
| payments                  | Immutable evidence of received funds, independent number, request key                       | project, received date, request key, number                                                          |
| payment_allocations       | Append-only positive allocation ledger                                                      | payment, invoice                                                                                     |
| payment_reversals         | Append-only reversal evidence                                                               | payment                                                                                              |
| credit_notes              | Numbered gross invoice credits and reason                                                   | invoice, number                                                                                      |
| package_extensions        | Explicit period/rate proposal and acceptance                                                | project, original period, status                                                                     |
| damage_charge_assessments | Human liability decision linked to M4 incident                                              | project, incident, status                                                                            |
| commercial_settings       | Configurable default taxes, deposit and terms                                               | key                                                                                                  |
| commercial_counters       | Separate agreement/invoice/payment/credit yearly sequences                                  | key                                                                                                  |

One additive `inventory_movements.by_project_type` index supports recovery review. M4 physical records are not migrated into commercial records. IDs are native Convex references; timestamps are server-generated ISO strings and date-only business rules use America/Vancouver. Financial documents retain archival fields, but M5 intentionally exposes lifecycle actions rather than destructive document deletion.

## Money, tax and billing identity

CAD amounts are validated decimal inputs and stored as canonical integer-cent strings. Arithmetic uses BigInt. Tax configuration uses integer basis points, with half-up rounding per line/rate. Documents snapshot applied tax names, rates and amounts. There is no hard-coded GST/PST assumption; settings start with an empty tax list. The default deposit is configurable and is snapshotted in each agreement.

Deposit tax components use largest-remainder apportionment across net value and each tax amount. The remaining balance invoice receives the exact remainder, so even a one-cent deposit with multiple tax lines cannot produce a negative subtotal or aggregate drift. Draft deposit/balance documents reserve contract value in the same transaction; concurrent creation cannot invoice the agreement twice.

Customers support seller, Realtor, brokerage, company and other identities. Customer updates do not change historical agreement/invoice bill-to snapshots. Payments snapshot the payer at receipt. All references must remain within the authorized project/customer scope.

## Agreements and invoice lifecycle

Agreement drafts are editable with expected-version checks. Sending freezes terms; acceptance records name, optional email, method, reference and authenticated actor/time. Marking sent does not deliver email, and acceptance is an internal evidence record rather than certified electronic signing. Accepted source quotes must belong to the same opportunity; changed pricing requires an explicit override reason before issuance.

Sent/accepted/declined agreements can have a new replacement draft. Acceptance supersedes the previous document without rewriting it. Replacing an agreement with active invoices is blocked; posted commercial obligations must be resolved first. Accepted agreements lock direct M3 package-end edits. Agreement acceptance is rejected after operational completion/cancellation or when its end precedes scheduled staging.

Invoices use separate items. Manual draft items, taxes, discounts, dates and notes are editable. Source invoices derive values from accepted agreements, accepted extensions or approved assessments. Source draft amounts are deliberately read-only: correct their source or void/re-create the draft. Issued totals, items and identity snapshots cannot be edited. Void preserves the original document, number, items, reason and actor. Valid payments prevent voiding; credited invoices retain their issued history.

Paid, partially paid, overdue and credited states derive from issued value, valid allocations, credits and the Vancouver due date. UI/print totals use backend values rather than a second calculation path.

## Payments, allocations, reversals and credits

Owner/Admin records funds already received by cash, cheque, e-transfer, card, debit, bank transfer or other method. M5 does not process payments or store card/security codes, banking passwords or processor credentials. Reference fields reject card-number-like sequences. A unique client request UUID prevents duplicate receipt submission; identity and receipt number are server-controlled.

A payment may allocate to several issued invoices of the same project and durable customer. Every allocation is positive, no greater than remaining invoice balance, and within the payment's remaining amount. Transactional reads protect simultaneous allocation and credit operations. Excess funds remain visibly unallocated.

Reversal appends evidence and removes the original payment's allocations from derived balances; it never deletes the payment. Credits append independently numbered evidence and reduce collectible invoice value. A credit after payment surfaces an explicit customer credit balance requiring refund/reallocation review. No automatic bank refund occurs. Credit notes currently record the gross correction amount and reason; tax-reporting credit breakdowns, refund settlement workflows and general-ledger accounting are outside this implementation.

## Extensions and operational completion

Extensions store original/new end dates, monthly/weekly/custom basis, rate, quantity, explicit tax snapshot, reason and acceptance evidence. Pending proposals do not change the project date. Accepting one updates the operational package end atomically while preserving original agreement dates and extension history. One noncancelled extension per original period prevents concurrent duplication; source invoices cannot be created twice.

Project commercial summaries surface package expiry at 30/14/7 days or expired, pending/uninvoiced/unpaid extensions, missing deposits, overdue invoices, unresolved incidents, charge reviews and credit balances. Owner/Admin dashboard metrics and review queues expose financial action items. AR supports status, customer, Realtor, project and date filters through bounded indexed pagination.

M4 inventory and checklist gates still control operational completion. Once physical work is reconciled, unpaid invoices do not block completion; the commercial summary displays **COMMERCIAL BALANCE OUTSTANDING**. M5 financial mutations never move, repair, release or dispose of assets.

## Damage and missing-item boundary

An M4 incident never creates a charge automatically. Creating an assessment validates its project, reservation, product, asset and room relationships server-side. It starts `review_required` with unknown liability and unresolved customer responsibility. Minimal evidence snapshots preserve product/asset/room/date and accepted liability terms; private crew notes are not copied into financial documents.

Review records controlled liability/valuation bases, rationale, proposed value, customer-facing description and explicit damage-specific tax rates. Approval requires reviewed liability, a positive amount and reason. Proposed and approved amounts remain separate. No-charge and waiver are distinct decisions with actor/time/reason. Sales can read related assessments but cannot approve them.

Only approved assessments can produce an invoice. There is one nonvoid source invoice per assessment, protected transactionally. Voiding allows explicit re-invoicing while retaining history; issued reductions use credits. Partial split billing is intentionally not supported. Paying a damage invoice does not free an asset in repair.

Quantity recovery reviews follow the related reservation family and require a human to assess any partial recovery. Recovery review is driven by actual M4 `found` movement evidence, not a missing-item write-off. A recovered item with a charge prompts credit/cancellation review; it does not recalculate the invoice. Fully credited unpaid charges no longer require the same recovery conflict alert; a paid credit still surfaces refund review.

## Authorization and audit

| Actor                                     | Commercial access                                                                                 |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Owner / Admin                             | Full M5 read/write, settings, AR and audit                                                        |
| Sales                                     | Read only for projects related through Realtor/opportunity assignment or Sales project management |
| Designer / Staging Crew / Marketing       | No commercial access, including direct function calls and document routes                         |
| Anonymous / archived / unassigned profile | Denied                                                                                            |

Every public query/mutation checks authenticated session/profile and centralized permissions. Generic M3/M4 projections remain free of bill-to, agreement, payment and charge amounts. No UI-only permission is relied on.

Audit entries and financial records derive actor identity from the authenticated server context. Agreement changes, commercial settings, customer changes, invoice edits/issue/void, allocations, reversals, credits, extensions and assessment decisions are audited transactionally. Commercial audit endpoints are Owner/Admin only and paginate by entity. Immutable payments, allocations, reversals, credits and issued documents remain the financial source records.

## Local verification

- Strict TypeScript: passed.
- Next.js production build: passed; final rerun passed before commit.
- ESLint zero warnings: passed; final rerun recorded before commit.
- Existing Node tests: 13 passed.
- Convex/Vitest: 188 passed, including 55 M5 tests and all 133 existing M1–M4 tests.
- M5 coverage includes exact penny tax splits, customer/document snapshots, role and archive denial, direct invocation attacks, independent numbering, simultaneous deposit creation/payment allocation/credits/extensions/assessment decisions, reversal, waiver, physical-state independence, recovery versus write-off, and representative 30-invoice/30-payment indexed aggregation/pagination.
- Dependency audit, all dependencies and production-only: zero vulnerabilities.
- Secret scan: no credential patterns or tracked environment files; final scan count recorded in the local evidence file.
- Formatting: passed.
- M1–M4 hosted suites were rerun against the corrected M5 development deployment; exact results are recorded below.
- M5 hosted acceptance: **29/29 passed** (15 lifecycle/physical-boundary checks and 14 integrity/concurrency checks).
- Production-build desktop/mobile browser regression: **47 passed / 1 connection timeout; unchanged targeted rechecks 4/4 passed**. Tests use real Convex identity and fictional records, not mocked authentication.

See `docs/M5-local-checks.json`, `docs/M5-hosted-api-results.json`, `docs/M5-hosted-integrity-results.json` and the regression/browser evidence linked below.

## Repeatable development acceptance

Verify `.env.local` selects `dev:woozy-jaguar-392` before any upload. Under the explicit M5 development authorization, deploy with `npx convex dev --once --env-file .env.local`; this also regenerates typed bindings. Inject the existing fictional role credentials from the secret store, set `GLARA_CONVEX_ACCEPTANCE=yes`, and run:

```powershell
npx tsx tests/support/m5-hosted-acceptance.ts
npx tsx tests/support/m5-hosted-integrity.ts
node tests/support/convex-hosted-acceptance.mjs
node tests/support/m2-hosted-acceptance.mjs
npx tsx tests/support/m3-hosted-acceptance.ts
npx tsx tests/support/m3-query-acceptance.ts
npx tsx tests/support/m4-hosted-acceptance.ts
npx tsx tests/support/m4-quantity-hosted.ts
npm run test:e2e
```

Select unused fictional historical event days where existing accepted fixtures fill operational capacity. Do not raise production-style scheduling capacity or weaken existing assertions merely to make regression fixtures fit. Historical event dates are explicit test simulations; confirmation actors/timestamps remain real server evidence.

The M5 runner includes accepted agreement, deposit/balance, simultaneous payments, reversal, extension, role attacks, physical staging/destaging, damaged returns, waiver, charge payment while asset remains in repair, paid credit, missing-item recovery and completion with a commercial warning. Browser tests exercise billing identity, agreement acceptance, deposit issuance, partial payment and outstanding balance, remaining allocation and unallocated cash, credit, extension acceptance, customer-filtered AR, charge review/invoicing, printable state, Sales read access and Crew denial on desktop and mobile. Mobile assertions reject horizontal overflow. Desktop receivables and mobile invoice screenshots were also inspected for readable content, touch targets and layout.

## Acceptance evidence and corrections

All hosted results below use `woozy-jaguar-392` in eu-west-1. This is a development environment. Raw browser screenshots and detailed runner output stay in ignored `test-results/`; committed summaries contain no credentials or customer/payment data. Fixture identifiers in `docs/M5-hosted-fixture.json` refer only to fictional acceptance records.

| Suite                                       | Final result                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------- |
| M1 hosted                                   | 48 passed, 0 failed                                                              |
| M2 hosted                                   | 20 passed, 0 failed                                                              |
| M3 hosted lifecycle + query filters         | 16 + 5 passed, 0 failed                                                          |
| M4 hosted inventory + quantity conservation | 25 + 7 passed, 0 failed                                                          |
| M5 hosted lifecycle + integrity             | 15 + 14 passed, 0 failed                                                         |
| Hosted total                                | 150 passed, 0 failed                                                             |
| Desktop / mobile production browser         | Desktop 23/24, mobile 24/24; unchanged targeted rechecks desktop 2/2, mobile 2/2 |

The hosted M1–M4 results are consolidated in [M5-regression-hosted-results.json](M5-regression-hosted-results.json). M5 evidence is in [M5-hosted-api-results.json](M5-hosted-api-results.json) and [M5-hosted-integrity-results.json](M5-hosted-integrity-results.json). Browser results are recorded in [M5-browser-results.json](M5-browser-results.json).

Three **P2 product defects** were discovered and fixed during acceptance:

1. **Multi-role Sales read denial.** The operational role classifier returned Designer/Crew before checking Sales assignment, causing a Sales user with both roles to lose legitimate commercial read access. Commercial scope now independently checks Sales project management or Realtor/opportunity assignment after requiring the financial role. Owner/Admin writes remain required. Two new regression cases verify allowed reads, denied writes, and denial after Sales relationships are removed. The focused suite initially failed 2 of 11 tests, then passed 11 of 11. [Initial evidence](M5-multirole-initial-results.json).
2. **Quote input reset during loading.** The new-quote form mounted before its linked opportunity query completed; its changing React key then erased entered items. It now waits for initial opportunity data and uses the stable requested ID. The existing full sales workflow retains the exact-cents assertions and now explicitly checks that the description and unit price survive before save.
3. **Incorrect initial opportunity owner.** The salesperson selector mounted before the authenticated viewer and owner choices loaded, selecting the first available owner rather than the Sales user. The form now waits for its starting data. Browser coverage explicitly verifies the selected salesperson before saving the deal.

The first full browser run was **46 passed / 2 failed / 0 skipped**: desktop exposed the quote reset; mobile exposed the opportunity initialization race. [Initial evidence](M5-browser-initial-results.json). The backend correction was redeployed to the same development target; frontend corrections were rebuilt for the final production-build run. No financial or inventory rule was loosened.

Acceptance harness corrections are recorded separately from product defects:

- Initial M5 hosted run: **14 passed / 1 failed**. The completion-denial assertion ran after all inventory had already reached warehouse inspection/repair, a state M4 intentionally allows at completion. The assertion now runs while an unapproved missing item remains outstanding, and the final step still verifies completion with unpaid commercial warnings after physical reconciliation. [Initial evidence](M5-hosted-initial-results.json).
- Initial adapted M3 historical-date run: **12 passed / 4 failed**. Its staging start used the selected historical day while the end still used today's date. Both now use the same validated event day; the failures were invalid fixture intervals and downstream lifecycle checks. [Initial evidence](M5-M3-initial-results.json).
- Convex HTTP clients queue mutations by default. M4/M5 hosted mutation calls now explicitly use `skipQueue: true`; simultaneous test calls reach the hosted backend concurrently. Final successful results therefore verify actual hosted conflicts, not merely sequential requests.
- Historical fictional event days avoid existing test scheduling capacity. No capacity setting was relaxed. Final hosted simulations used M5 July 18, M3 July 20, M4 July 21 and quantity July 22, 2026; browser mixed-inventory simulations use July 23/24. Confirmation actors and timestamps come from the real authenticated server context. The upstream tax-default snapshot check restores the original defaults in `finally`.

The corrected-source full browser run also observed one workspace-connection timeout in the desktop Marketing denial check: after the five-second assertion deadline, only the connecting screen was visible. The unchanged test then passed twice on desktop and twice on mobile (4/4), with no retry setting or authorization assertion changed. This is retained as a P2 intermittent development-latency observation, not evidence of permitted Marketing access. Initial failure and recheck outcomes are preserved in the final browser evidence.

No unresolved P0/P1 issue has been identified within the tested M5 development scope. This does not replace independent review or production readiness verification.

## Limits and deferred production dependencies

- Commercial records are bounded to 100 per project/type and 100 allocations or credits per ledger parent; one request allocates to at most 30 invoices. Customer options support 100 active billing customers; large directories require indexed search/pagination before expanding that bound. Dashboard calculations fail closed above 500 issued invoices / 500 current-month payments / 100 accepted agreements rather than returning inaccurate partial financial totals. Dense ledgers can also reach Convex transaction read limits; use indexed AR pages and extend the aggregation architecture before larger deployments.
- Global operational review queues are explicitly sampled (20 records per assessment/extension state; 40 recent incidents), with a partial indicator. They are not complete company-wide counts. Per-project summaries surface all records within the documented project bounds.
- Credits are gross adjustments, not a tax filing/general-ledger system. Actual refund transfer and settlement are manual external operations. Bank reconciliation, card processing, electronic signature, attachments/storage uploads and email delivery were not introduced.
- Source invoice edits require void/re-create before issue. Replacement of an accepted agreement with active invoices is blocked. This avoids rewriting posted commercial history; more advanced contractual amendments remain a future explicit design.
- No M6 analytics, automation or AI has been implemented.

**DEFERRED — REQUIRED BEFORE PRODUCTION:** real invitation/onboarding delivery; password recovery delivery and full recovery acceptance; expired/reused authentication-code handling verification; production origin/redirect/HTTPS verification; transactional email provider configuration; sender/domain verification for `Support@glarahome.com`; production deployment and operational backup/readiness review. None of these is marked passed by M5.

M6 must not begin until M5 hosted/browser acceptance and independent review are complete.
