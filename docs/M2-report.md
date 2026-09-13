# M2 Sales CRM — implementation and release-gate report

Status: **DEVELOPMENT ACCEPTANCE PASSED — NOT APPROVED FOR PRODUCTION**. M2 is deployed to the explicitly approved Daryan Convex development deployment. The API and browser acceptance results below replace the earlier pending status. M3 has not started.

## A. Summary

Adds properties, opportunities, a responsive pipeline/list, Opportunity 360, consultations, itemized quotes and operational sales summaries. Existing Realtor CRM remains in place. Navigation and global search connect the two CRM modules. Won deals show the future M3 action without creating projects.

## B. Convex schema additions

New tables: `properties`, `opportunities`, `consultations`, `quotes`, `quote_items`, `sales_counters`, `sales_metrics`, `sales_settings`, `sales_realtor_counts`.

Activities now have optional Realtor, property or opportunity references. All public creation paths require exactly one parent. Existing M1 actions remain Realtor-parented; M1 mutation paths explicitly reject M2 actions. Each opportunity's next action is the earliest open linked activity. There is no second stored next-action field.

Properties have address/MLS uniqueness keys and a native search index. Opportunities have indexes for stage, property, Realtor, assignee and archive status. Consultations and quotes have parent indexes. Quotes also have a status/validity index; items have a quote index. Metrics, numbering and discount settings have unique-key lookups enforced transactionally. Activity indexes support parent timelines, next-action selection and due-date checks.

Realtors gain an optional `sales_search_text` field and native search index for M2 selection. After deployment, run the internal `admin:backfillSalesSearch` mutation with `{ "cursor": null }`, then its returned cursor until `done`. It processes at most 100 records per call and is restartable. M1 saves maintain this derived name/contact search field. No business records are deleted or reset. Run internal `sales:backfillRealtorCounts` the same way for pre-existing M2 opportunities; its per-record marker and aggregate updates commit atomically, allowing safe restart alongside live writes.

## C. Authorization matrix

| Capability                            | Owner | Sales | Admin | Marketing       | Designer        | Staging Crew |
| ------------------------------------- | ----- | ----- | ----- | --------------- | --------------- | ------------ |
| Property overview                     | Full  | Full  | Full  | Safe projection | Safe projection | Denied       |
| Property seller, notes, listing value | Yes   | Yes   | Yes   | No              | No              | No           |
| Property writes                       | Yes   | Yes   | Yes   | No              | No              | No           |
| Opportunities, consultations, quotes  | Yes   | Yes   | Yes   | No              | No              | No           |
| Archive commercial records            | Yes   | Yes   | Yes   | No              | No              | No           |
| Restore opportunities                 | Yes   | No    | Yes   | No              | No              | No           |
| Configure discount authority          | Yes   | No    | No    | No              | No              | No           |
| Existing audit-log endpoint           | Yes   | No    | No    | No              | No              | No           |

Every backend query/mutation checks authenticated session validity, current profile and roles through the existing centralized access layer. Archived/unassigned accounts and anonymous clients cannot invoke commercial functions. UI visibility is not authorization. Marketing/Designer responses are explicitly projected; private property or commercial data is not sent and hidden in the browser. Direct backend calls are tested locally.

## D. Property architecture

One primary Realtor per property; many properties per Realtor. Optional descriptive fields remain nullable/blank. Active duplicate normalized address/unit/city/province and MLS values are rejected atomically. One active opportunity per property is allowed, with historical closed opportunities retained. Once an opportunity exists, primary Realtor reassignment is denied to preserve historical association. A future co-listing relation can extend this without replacing property IDs.

Property detail joins Realtor, opportunities, consultations, quotes and property activities within explicit bounds. Safe roles receive only physical property details and the permitted Realtor association. Archive requires linked opportunities to be archived first. Property restoration is not exposed in M2; unlike opportunity restoration, it remains a reviewed administrative enhancement.

## E. Opportunity architecture

Stages: new, contacted, interested, consultation, quote_sent, negotiation, won, lost. Active stages allow the adjacent previous/next stage and lost; negotiation may become won. Closed records may reopen to contacted after active-deal uniqueness and next-action checks. Entering quote_sent requires a recorded sent/accepted quote. Lost requires a valid reason. Won sets its timestamp, clears loss fields and probability becomes 100; lost sets probability to zero. Reopening clears closed timestamps. Stage history remains in audit records.

A linked open action with title/date is mandatory for an active opportunity. Creating, completing, cancelling and replacing actions validates this in the same mutation. Replacement preserves the original record and due date. Completing the last action without replacement fails atomically.

Pipeline cards include property, Realtor, value, owner, next action and stage age. Accessible stage forms work on desktop and mobile; there is no drag-and-drop dependency. Mobile shows a selected stage rather than squeezing eight columns into a small screen. List filters include stage, Realtor, city, assignee, source and overdue actions. Property/Realtor links open scoped lists.

## F. Consultation architecture

Consultations reference the opportunity; property/Realtor are derived rather than duplicated. Scheduled consultations can be rescheduled with version checks and marked completed, cancelled or no-show. Completion time is distinct from scheduled time. The current UI assigns new consultations to the signed-in user; backend validation supports an active assigned user. Broad calendar scheduling remains M3.

## G. Quote architecture

Quotes reference opportunities and have separately stored line items. A customer/property snapshot preserves displayed commercial identity. Draft terms can change with version checks. Sent/accepted terms cannot be edited. A sent, declined or expired quote may be revised into a separately numbered draft; the predecessor becomes superseded and remains readable. Accepted quotes are immutable and are not revised in this milestone.

A transactional annual counter creates `GLQ-YYYY-NNNN` numbers. Concurrent creation retries through Convex transaction semantics. Numbers are not supplied by clients. Status changes are explicit: draft → sent; sent → accepted/declined/expired subject to validity checks. Recording sent does not send email. Quote acceptance and opportunity won are separate intentional actions, with no project/payment side effects.

Sales/Admin discretionary discounts default to zero until Owner configures their basis-point limits. Owner retains override authority. Discounts are checked on draft saves and sending; configuration is versioned and audited. Quote tax rate is stored on each quote, with no hard-coded tax policy or accounting automation.

## H. Money precision strategy

All monetary input uses validated decimal strings with at most two decimal places. Server calculations convert to BigInt cents. Persisted monetary amounts are canonical integer-cent strings, avoiding Convex/JavaScript floating-point precision loss. Tax percentages become integer basis points; tax is rounded half-up on the subtotal after the quote-level discount. Quantities are integers from 1–1000; quotes contain 1–50 items. The server recalculates all totals and ignores client-calculated totals.

Example: 2 × $100.01 = $200.02; 5% tax rounds to $10.00; total $210.02. Fractional quantities, negative amounts, excessive precision and discounts above subtotal are rejected.

## I. Audit coverage

Business changes and audit writes share a mutation transaction. Coverage includes property/opportunity create/edit, stage/won/lost/reopen, consultations, activity completion/cancellation/replacement, quote terms/items, statuses/revisions, archive/restore and discount settings. Actor IDs come from authenticated server context, never request payloads. Audit logs retain old/new relevant records. No raw backend failure or private record payload is rendered in error messages.

## J. Concurrency strategy

Convex serializable mutations protect uniqueness checks, counters, metrics, line-item replacement and next-action invariants. Expected versions reject stale property, opportunity, consultation and quote edits. Frontend edit forms retain the version loaded with their input fields even when live queries update, preventing a stale form from borrowing a newer version. Activity terminal-state checks reject duplicate completion/cancellation. Quote revision and source supersession commit together.

## K. Search/pagination strategy

Cursor list pages are capped at 30 records, 256 examined rows and 1 MiB. Property text search is indexed; Realtor selection uses native Realtor search. Property search uses address/MLS and a separate live Realtor filter, avoiding stale copied Realtor names. Pipeline queries fetch at most six cards for each of eight stages and use transactional stage aggregates for counts/value. Related names are joined in a bounded backend response with memoized parent reads; the browser does not issue per-card queries.

Opportunity text/city/overdue predicates run against each bounded indexed page. A selective filter can therefore yield an empty page before the end; the UI permits continuation and does not call an empty partial page a complete absence of results. Detail timelines are bounded (30 consultations, 30 quotes, 50 activities; property previews cover at most 20 opportunities with three quotes/consultations each). Global search is capped. Stage/open/monthly totals use transaction-maintained metrics. Awaiting-quote and overdue checks are capped at 501 and display a plus indicator when limited. Overdue checks share the existing activity due index and can be a lower bound at high activity volume.

## L. Tests and exact results

Local checks on 2026-09-13:

- TypeScript strict: passed.
- ESLint zero warnings: passed.
- Node tests: **10 passed, 0 failed** (existing M1 plus exact money/stages).
- Convex-test: **27 passed, 0 failed** (13 M1 and 14 M2).
- Production build: passed.
- Production dependency audit: **0 vulnerabilities**.
- Formatting: passed.

M2 backend tests cover role denial and safe projections, duplicate/stale property changes, initial next-action rollback, stage/won/lost/reopen, concurrent writes/metrics, M1 bypass prevention, consultation state, discount authority, exact quote totals, revision/immutability, numbering collisions, expiry, archive/restore, audit identity and bounded responses.

Hosted acceptance on 2026-09-13, against development deployment `woozy-jaguar-392`:

- M1 hosted API: **48/48 passed**.
- M2 hosted API: **20/20 passed**. Results: [M2-hosted-api-results.json](M2-hosted-api-results.json).
- M0/M1 desktop/mobile browser scenarios: **30/30 passed**.
- M2 desktop/mobile scenarios: **8/8 passed** on corrective rerun, including property → opportunity → consultation → exact quote → sent → won, list search, layout overflow and direct-route role denial.
- The earlier combined run had 36 passes and two M2 failures; the failures were corrected and rerun, not disabled. All **38 unique browser scenarios** now have passing results. Targeted screenshot-readiness checks also wait for actual pipeline cards instead of capturing loading placeholders.
- Fictional screenshots exist under ignored `test-results/m2-visual` (property, quote editor, opportunity, pipeline on desktop/mobile). They contain fictional acceptance data, not real client records.

The user explicitly approved uploading source to the named development environment. Deployment and both paginated backfills completed successfully. Tests used the existing production Next build at localhost:3000 via a temporary Playwright configuration that omitted its server launcher; this avoided rebuilding files under a live server. Real operations and production deployment remain prohibited.

Acceptance fixes:

1. Deployed missing M2 functions that caused the dashboard summary request to fail.
2. Workspace client components wait for Convex's authenticated connection before subscribing to protected queries; backend authorization is unchanged.
3. Pinned Convex Auth 0.0.95 and added a version/hash-checked postinstall compatibility fix. Its memoized in-memory storage retained an initial empty state, so forced token refresh could return null and remove WebSocket authentication. The replacement uses a ref-backed store. This preserves in-memory access tokens and HttpOnly refresh cookies, without local-storage persistence. See README for upgrade instructions.
4. Realtor create/update now maintains the derived native sales search field; a new backend regression test verifies newly created Realtors appear immediately.
5. Browser tests use the dropdown's accessible combobox role and wait for loaded pipeline cards. No business rule or permission test was relaxed.

## M. Known limitations and pre-production dependencies

- Development acceptance is complete; independent review and the production prerequisites below remain necessary.
- Value-range filters, fractional quantities, broad calendar UI and general property/quote/consultation restore UI are not implemented. A top-five Realtor ranking uses transactional counts and an ordered index, with links to scoped opportunity lists.
- Detail previews and operational due/awaiting checks are deliberately bounded as described above. Deep histories require further pagination UX; the current implementation must not be described as displaying unlimited history.
- No file/media changes, projects, inventory, agreements, invoices, payments, AI, external messaging or calendar integrations were introduced.
- **DEFERRED — REQUIRED BEFORE PRODUCTION:** real onboarding/invitation delivery; recovery delivery and recovery flow acceptance; expired/reused code handling acceptance; production redirect/origin verification; transactional provider configuration; verification of `Support@glarahome.com` sender/domain; production deployment/security review. Existing local or mocked checks do not pass these gates.

## N. M3 readiness

The code establishes stable property/opportunity IDs, explicit won state, quotes with immutable commercial terms, authenticated transactional mutation boundaries and audit history. It is ready for independent M2 review with the documented bounds and limitations. **Do not begin M3 or use this build for real operations yet.**
