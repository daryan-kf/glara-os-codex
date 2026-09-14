# M4 — Convex-native inventory management

**M4 DEVELOPMENT GATE PASSED**

M4 is deployed to the explicitly approved development environment. Production readiness is not certified. M5 has not started.

Scope: both supplied M4 attachments, sections 1–130. Optional features and operational bounds are explicitly identified below.

## Test environment

- Repository: `daryan-kf/glara-os-codex`, branch `main`.
- Tested implementation commit: `a6f34eff33878646f3da10d5371148a0b8490ed6`. The final report commit adds documentation/evidence only; obtain its SHA with `git log -1 --format=%H -- docs/M4-report.md`.
- Convex: Daryan's `glara-os` development deployment `woozy-jaguar-392`, EU West endpoint. Final functions deployed September 14, 2026, 00:51 America/Los_Angeles.
- Frontend: Next.js production build on localhost:3000, Windows, Node 24.15.0; Chrome desktop and Pixel 7 emulation. Business dates use America/Vancouver.
- Data: only clearly named fictional products, locations, properties and projects and reserved `@accounts.example.test` identities. No real owner/client credentials were used in acceptance. Credentials are stored outside Git; no production deployment occurred.
- Some fixtures use historical event/listing/sale dates to avoid exhausting today's configured capacity. Actual inventory confirmations retain authenticated server timestamps. These are test simulations, not historical business records.

## What was built

Inventory now distinguishes catalog Products, serialized physical Assets and homogeneous quantity Stock. The UI includes catalog search/filtering, Product 360, Asset 360, configurable categories/locations, receipts, stock movements, project room planning, date-aware reservations, mobile pick/return lists, explicit installation, inspection, cleaning/repair, damage/missing recovery, retail sale protection and archival. The dashboard surfaces inventory holds, wrong-item exceptions and sampled reservation shortages. Global search distinguishes Products and Assets; crew asset results link only to assigned project inventory. Project inventory is integrated with M3 lifecycle and room/archive dependencies.

Each variation is a Product with its own explicit SKU; there is no separate variant hierarchy. Optional bundles, QR image generation, camera scanning, media upload, retail/POS integration, optimization and automation were not introduced. Stable asset IDs and safe internal asset URLs form the scanning foundation. Acquisition costs, prices and financial integrations are deliberately absent from M4.

## Structure

- `convex/inventorySchema.ts`: additive schema and indexes, composed into the existing schema.
- `convex/inventoryCore.ts`: centralized inventory permissions, allocation calculations, atomic stock/ledger writes, partial-line handling and lifecycle gates.
- `convex/inventory.ts`: validated public queries and mutations. No new actions, HTTP endpoints or public administration bypasses.
- `src/lib/inventory/model.ts`: controlled states, validation, date-window peak demand and derived readiness.
- `src/components/inventory/catalog.tsx`: catalog, product/asset detail, location/category management, receipts, care and history.
- `src/components/inventory/project.tsx`: assigned room inventory, reservation selection and mobile picking/returning.
- `src/app/(workspace)/inventory/`: protected catalog, settings, product and asset routes.
- `src/app/(workspace)/projects/[id]/inventory/`: assigned project workflow.
- `tests/convex/inventory*.test.ts`: business/security regression. M3 and M4 share the existing operational test fixture extracted to `tests/support/operations-unit-fixture.ts`.
- `tests/support/m4-hosted-acceptance.ts`, `tests/e2e/inventory.spec.ts`: fictional hosted and browser acceptance.

## Data and indexes

| Table                    | Purpose and primary access paths                                                                                                                                                                                                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `products`               | Normalized unique non-archived SKU; catalog descriptors, track mode, eligibility, active/archive state and revision. SKU/archive, category/archive and active/archive indexes; native text search over SKU/name/brand/collection/color/material.                                                 |
| `inventory_categories`   | Configurable named categories. Name key and active indexes. No category-specific workflow rules.                                                                                                                                                                                                 |
| `inventory_locations`    | Configurable store/warehouse/staging-storage/other sources. Name and active indexes; source flags are checked server-side.                                                                                                                                                                       |
| `inventory_assets`       | Stable physical identity, current state/location/project/room, condition, eligibility, acquisition date and use count. Number, product, product/location, location/status and status indexes.                                                                                                    |
| `inventory_stock`        | Product/location bucket projection: available, inspection, cleaning, repair, damaged, missing, sold, retired. Product/location, location and missing-balance indexes.                                                                                                                            |
| `inventory_counters`     | Dedicated asset numbering counter, looked up by key. Generates `GLA-000001` and subsequent stable numbers transactionally.                                                                                                                                                                       |
| `inventory_reservations` | Normalized project/room/product/optional-asset references, source, return location, dates, quantity, state, actor, revision, installation timestamp, return outcome and explicit exception approval. Product/active, asset/active, project, room/active, source/active and state/active indexes. |
| `inventory_movements`    | Immutable movement facts, server actor/time, reason, source/destination, project/room/reservation and signed stock-bucket deltas. Product, asset and project history indexes.                                                                                                                    |
| `inventory_inspections`  | Immutable assessments, before/after condition, result, quantity and authenticated inspector. Product, asset and project indexes.                                                                                                                                                                 |
| `inventory_damage`       | Structured reported/assessed/repair/resolved/written-off incidents with revision and resolution. Product, asset, project and status indexes.                                                                                                                                                     |

Existing `audit_logs`, profiles, auth sessions, projects and rooms are reused. There are no SQL migrations or Supabase components. No M0–M3 backfill or destructive reset is required. The schema additions apply through the normal Convex deployment process.

## Source of truth and transactions

Every quantity-bucket change is applied by `movement()` in the same mutation as its immutable ledger entry and audit record. There is no public arbitrary balance overwrite, ledger edit/delete, actor override or timestamp override. The signed `stock_deltas` support reconciliation. Serialized state/location updates and their movement records also commit together.

In-transit, installed and returning quantities are held in reservation lines, outside location usable stock. Care and missing quantities are represented in location bucket projections; the corresponding project lines reference those same held units and must not be added again when calculating total inventory. A source-associated missing/damaged quantity does not assert that the items are physically present there. The project view shows project/transit or an unconfirmed location as appropriate.

A partial movement decreases the original line and creates a traceable child line with its own state and revision. Parent identity is retained, quantities are conserved, and the accepted movement points to the affected line. Pick and return lists are projections of these lines, not separate competing records. No asset records are manufactured for quantity products.

Receipts create good homogeneous quantity stock; mixed-condition receipts should be separated into meaningful batches, with damaged stock reported explicitly. Serialized receipts include condition; unusable receipts enter inspection. Downward quantity corrections create missing balances rather than silently removing units. Positive correction/receipt evidence can be recorded through a new receipt with an explicit reason; historical movements are never rewritten.

Convex mutations provide atomic, serializable transactions with conflict retries. Availability reads, allocations and ledger writes are inside those transactions. User-visible revisions additionally reject stale edits or repeated state transitions. See [Convex OCC and atomicity](https://docs.convex.dev/database/advanced/occ) and [mutation semantics](https://docs.convex.dev/functions/mutation-functions).

## Availability and retail policy

Reservation dates are validated ISO calendar dates in the Vancouver business context. Both endpoints are inclusive. Bookings sharing an end/start date conflict; the following day may be booked. No automatic turnaround buffer is imposed: staff include required preparation/turnaround days in the selected window.

Quantity availability is current usable location stock minus **peak overlapping reserved demand**, not the sum of disjoint future bookings. Picked/installed/returning quantities have already left usable stock, so they are not subtracted twice. Serialized availability checks physical state, condition, staging eligibility, source and overlapping reservations.

Inventory physically out, missing or in care is not assumed to return merely because a planned end date passed. Existing future reservations may therefore show shortages until actual returns pass inspection. A project schedule change does not silently rewrite its reservation dates; staff release and rebook reservations when their dates or source change. Picking is allowed only within the reserved dates and a suitable project phase.

`retail_available` is derived from current usable inventory and all future confirmed commitments. Sale, transfer and permanent quantity reduction preserve future peak demand. Serialized committed items cannot be sold or transferred. Planned demand creates no allocation and does not reduce retail availability.

## Permissions and security boundaries

| Role            | Inventory permissions                                                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner/Admin     | Catalog/configuration, receipts, stock movement, project allocation, inspection/release, missing recovery/write-off, damage resolution, archival and inventory history.                                                                      |
| Designer        | Nonfinancial catalog/availability and inventory reservations for projects where assigned through M3. Product assignment links are restricted to those projects. No stock receipts, sale, movement, inspection release or exception approval. |
| Staging Crew    | Assigned project pick/return lists; identity/quantity-confirmed picking, installation, destaging, returns and damage/missing/wrong-item reporting. No company catalog or stock administration.                                               |
| Sales/Marketing | Inventory function and route access denied, including direct calls. Existing M1/M2/M3 permissions remain in place.                                                                                                                           |

Every inventory function requires an authenticated, current, non-archived profile and live session. Project scope is checked on the backend; client navigation is not authority. Inputs use Convex validators plus strict business validation. Actors come from the server profile. Private CRM/sales/access-code data is not joined into inventory views. Detailed inventory movement/inspection/damage history is restricted to Owner/Admin. No new credentials or browser token storage were introduced.

Designers receive no acquisition costs or prices; those fields do not exist in M4. Stock counts and retail eligibility are operational inventory data. Sensitive asset notes are manager-only. Unrelated project IDs are omitted from a designer's asset read projection; project assignment links are scoped separately.

## Workflow and M3 gates

1. Plan a product/asset and quantity for a stable project room. Planned demand can become reserved only after availability checks.
2. Assigned crew confirms the asset number or quantity. Picking moves usable stock to project transit. Installation is a separate confirmation and increments serialized use count.
3. Wrong-item, damage and missing reports append evidence and create structured incidents. A report is **not** an approved lifecycle exception. Only Owner/Admin can approve exceptions; changing state resets the prior approval.
4. `staging → staged` requires lines installed, released/resolved, or explicitly approved as exceptions. An empty inventory plan preserves the existing M3 workflow. No status transition installs inventory automatically.
5. Installed pieces enter returning only during destaging; unused picked stock can return directly. Expected return lists derive from actual installation and exclude never-installed pieces. Every receipt enters inspection at a confirmed location. Explicit good/damaged/cleaning/repair return outcomes retain instructions; damaged returns record condition and an incident. Missing stock displays an unconfirmed physical location.
6. Owner/Admin inspection records available/cleaning/repair/damaged/retired. Care items require explicit release. Damaged items still at a property must be received before inspection can make them available.
7. Completion blocks planned/reserved/picked/installed/returning stock, unapproved missing exceptions and damaged stock not physically received. Confirmed warehouse care may continue after completion; it is still unavailable.
8. Cancellation atomically releases all planned/reserved lines if nothing has been picked. It appends release evidence without physical stock deltas. Picked/installed/returning/care/missing lines block cancellation until reconciled. Project archival blocks every active inventory line. Room archival or changing its scope to no-staging blocks active room inventory. Inventory care remains accessible to managers after project completion. Products archive only after their remaining physical stock and reservations are reconciled.

Readiness is derived: not_started, planning, reserved, picking, ready, installed, returning, exception or reconciled. It is not separately editable. Shortages and unapproved wrong-item reports override a reserved status. Corrected picking clears that line exception. Future confirmed asset bookings also block inspection retirement and missing-item write-off.

## Query bounds and operational limits

- Catalog: native cursor pages of up to 8 candidate products, indexed SKU/text/category access. Combined filters can yield sparse pages; the UI explicitly supports continuing them.
- Product detail: first 100 assets and first 100 stock locations, with a visible partial indicator. Exact asset-number search links directly to the asset. Date availability narrows to the selected source before reading its first 100 assets.
- Allocation safety: at most 400 active lines per product and 100 per asset; attempts exceeding the safety bound fail explicitly. Project history is limited to 200 lines, including splits. Room IDs and quantities avoid unnecessary serialized accessory rows.
- Project availability reuses allocation reads across repeated product/asset lines. Large imports and worst-case load testing are still required before increasing these limits.
- Movement and assignment history: cursor pages of 20. Care history shows the latest 20 inspections and 20 incidents with a partial marker. Attention lists are bounded recent samples, not a company-wide KPI.
- Categories/locations: configuration reads show 100 with a partial marker. A location cannot be disabled while it has usable/care/missing stock or active allocations; terminal history is retained.

These bounds are explicit reliability limits for the initial private application, not certification for an unbounded inventory import. Monetary accounting, media upload, camera scanning, external retail sync and automated reservation-date changes remain outside this implementation.

## Verification record

| Layer                       | Exact result                                                                         |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Node unit tests             | **13/13 passed**                                                                     |
| Convex/Vitest               | **133/133 passed**, including 87 M4 cases and 46 M1–M3 cases                         |
| Total local automated tests | **146/146 passed**, no skipped tests                                                 |
| Hosted M1 regression        | **48/48 passed**                                                                     |
| Hosted M2 regression        | **20/20 passed**                                                                     |
| Hosted M3 regression        | **16/16 passed**, plus **5/5 query checks**                                          |
| Hosted M4 core acceptance   | **25/25 passed**, rerun after the final missing-location projection fix              |
| Hosted M4 30-unit scenario  | **7/7 passed**                                                                       |
| Desktop browser             | **22/22 passed** in aggregate; final M4 targeted rerun **2/2 passed**                |
| Mobile browser              | **22/22 passed** in aggregate; final M4 targeted rerun **2/2 passed**                |
| TypeScript / ESLint         | Passed; zero lint warnings                                                           |
| Production build            | Passed after final runtime changes                                                   |
| Formatting / Git whitespace | Passed during release verification                                                   |
| Production dependency audit | Zero reported vulnerabilities, no new dependencies                                   |
| Secret/environment review   | 212 source files scanned, no credential pattern matches or tracked environment files |

Evidence: [M4 hosted results](M4-hosted-api-results.json), [30-unit hosted results](M4-quantity-hosted-results.json), [M1–M3 hosted regression](M4-regression-hosted-results.json), [scale measurements](M4-scale-results.json), [browser run record](M4-browser-results.json).

The full browser suite initially passed 42 of 44 scenarios. The two new mixed-mode fixtures incorrectly dated destaging before their fictional sale. The backend correctly rejected them. The dates were corrected and both desktop/mobile scenarios passed. Their aborted fictional projects (GLS-2026-0020 and GLS-2026-0025) were explicitly quarantined, received, inspected, cancelled and archived using authenticated public functions; their simulated audit history was preserved. No authorization or business check was disabled. The final backend change only corrects the displayed whereabouts of missing/damaged stock; all four M4 browser scenarios were rerun against it and passed. Desktop and mobile screenshots were reviewed, including the corrected unconfirmed missing-stock label. Existing M0–M3 browser results remain applicable because their runtime code is unchanged.

### Concurrency and ledger reconciliation

Passed local and hosted checks: concurrent reservations on independent projects; serialized overlap/inclusive-boundary rejection; repeated 8/7/9 requests against 20 units; unique numbering for eight concurrent receipts; competing asset transfers; competing available/repair inspection decisions; stale pickup replay; stale product/asset/location/reservation/incident protection through revision checks. Failed mutations leave stock, assets, lines, movements, inspections, incidents and audits unchanged in the atomicity tests.

The controlled local 100-unit sequence reconciles every bucket after receipt, transfer, reservation, release, partial pick/install/return, missing/found, cleaning/release and adjustment. The hosted 30-unit sequence reserves A10 and B8, confirms 12 free, installs A10, returns nine and records one missing. Completion is denied until explicit recovery/inspection. B's eight remain protected until cancellation releases them. Every final hosted bucket equals the sum of immutable ledger deltas. No negative balance, duplicate asset identity, double booking or unresolved ledger drift was observed.

### Security matrix results

- Owner/Admin: centralized manager authorization, validated inventory changes, authenticated actor attribution and audit history. Owner executes the full hosted lifecycle. Admin uses the same inventory manager guard; existing hosted authentication/role regression passes.
- Designer: catalog projection and assigned planning access allowed; stock mutation and unrelated project access denied. Additional designer membership uses M3 assignment checks.
- Staging Crew: assigned pick/install/return/report actions work on desktop and mobile. Catalog administration, inspection release and unrelated project access are denied. Exact asset search only exposes an assigned inventory destination.
- Sales/Marketing: direct inventory reads and mutations denied. Global inventory search is denied. Existing safe CRM/commercial/content projections retain their previous boundaries.
- Anonymous/unassigned/archived: backend access denied, including a previously valid archived-user session. M1 logout/refresh revocation tests pass.
- Crafted requests: foreign room, product/asset mismatch, inactive location, invalid quantities, stale revisions, explicit asset-number injection and spoofed reservation/inspection actors are rejected. Client role/navigation state never authorizes a mutation.

### Acceptance coverage map

| Specification area                                                        | Exercised evidence                                                                                                                                                                                                     |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Products, SKU, categories, tracking modes, conditions, locations (§42–49) | Validation suite, immutable mode/identity cases, receipt and location dependency tests, desktop/mobile product creation                                                                                                |
| Transfers, quantities, ledger, atomicity (§50–54, 93–100)                 | Local reconciliation helper, repeated races, hosted serialized transfer/inspection race, 30-unit scenario                                                                                                              |
| Reservation/date/retail/assignment rules (§55–65)                         | Peak-demand and inclusive dates, overlap/nonoverlap, source/eligibility checks, foreign rooms, sale/transfer protections, cancellation release                                                                         |
| Picking, installation, readiness, M3 gates (§66–74, 111–113)              | Quantity splits, correct/wrong asset identity, wrong-item alerts, explicit installation/use count, required-line gate; state-derived readiness table                                                                   |
| Returns, missing/damage, inspection/care, retirement (§75–86)             | Installed ancestry, explicit damaged return, nine-of-ten return, missing/found, cleaning/repair, incident graph, future-booking retirement guard                                                                       |
| Cancellation and archives (§87–92)                                        | Automatic unpicked release; physical/care blockers; room/product/location dependencies; history preservation                                                                                                           |
| Views, search, mobile, attention (§101–110)                               | Product/Asset 360, bounded histories, role-aware exact SKU/asset search, room lists, mobile overflow checks, incident/shortage projections                                                                             |
| Scale and regressions (§114–123, 126–127)                                 | 1,000 products/3,000 assets/5 locations/50 active reservations/1,000 historical ledger rows; transaction limits; complete M1–M3 hosted and browser regression                                                          |
| Desktop/mobile acceptance (§124–125)                                      | Product creation and receipts, designer reservation, partial quantity pick/unused return, mixed asset/quantity installation, damaged return, missing recovery, inspection/repair/release, search, transfer and history |

QR generation/scanning, optional substitution UI, costs and media/file workflows were not implemented and are not represented as tested. Substitution uses explicit release plus a new reservation, preserving original identity/history. Full Project creation/planning UI is exercised by the existing M3 browser suite; M4 mixed-mode setup uses authenticated APIs for project creation, scheduling and some reservations, then exercises physical actions through the UI.

### Scale results and remaining limits

The local Convex emulator ran with default per-transaction limits enabled. The dataset contains 1,000 products, 3,000 assets, five locations, 50 active reservations and 1,000 historical movement rows. Catalog cursor pages stay at eight; movement pages stay at 20; search/detail/project responses remained below 100 KB. Exact measurements are in the linked JSON. This is an emulator read-bound test, **not hosted warehouse-scale latency certification**. Representative hosted load testing remains required before raising documented limits or importing live warehouse data. No claim of unlimited scale, offline operation or a complete warehouse management system is made.

## Setup and release handoff

Existing README setup applies: `npm ci`, the existing `.env.local` Convex URL/deployment configuration, configured Convex Auth keys and staff identities. No new variables or dependencies are required.

The user explicitly authorized M4 development deployment. To reproduce it, select that development deployment and run `npx convex dev --once --env-file .env.local`, then the hosted and browser acceptance runners. Test credentials remain outside Git in the existing fictional identity configuration. Hosted runners create only clearly fictional records; movement and commercial histories are preserved rather than deleted. Stop the local production server before rebuilding, then restart it against the matching deployed backend.

Hosted runners: `npx tsx tests/support/m4-hosted-acceptance.ts` and `npx tsx tests/support/m4-quantity-hosted.ts`. `GLARA_M4_EVENT_DAY` optionally selects a historical fictional event day for the core runner. Use an unused historical day or respect today’s capacity when repeating lifecycle tests. Browser runners: `npm run test:e2e`; targeted files are `inventory.spec.ts` and `inventory-mixed.spec.ts`. The standard runner builds and starts its own server. Keep credentials out of shell output, logs and Git. Independent review remains separate from development acceptance. Do not begin M5.

## Production dependencies

**DEFERRED — REQUIRED BEFORE PRODUCTION**, not passed: real invitation/onboarding email delivery where used; password recovery delivery and full recovery acceptance; expired/reused authentication-link/code handling acceptance; production redirect/origin verification; transactional email provider configuration; sender/domain verification for `Support@glarahome.com`; production hosting/security review, backup/restore tests, regional/data handling decisions and representative inventory load acceptance.

## Explicit physical and incident transitions

- Receipt creates available assets in usable condition; poor/damaged receipts enter inspection.
- Available → in_transit through confirmed pick; in_transit → staged only through installation; staged → returning only during project destaging.
- Returning or unused in_transit → inspection through a confirmed receipt. Missing → inspection requires found evidence; damaged project assets require a receiving location before inspection.
- Available → inspection/damaged/missing uses an explicit hold/report. Inspection/cleaning/repair/damaged → available/cleaning/repair/damaged/retired requires manager inspection, condition validation and a ledger entry. Future committed assets cannot retire.
- Available → sold/retired uses a manager disposition and commitment checks. Missing → retired requires explicit write-off; sold/retired have no public reversal.
- Incidents: reported → assessed/written_off; assessed → repair/resolved/written_off; repair → resolved/written_off. Resolved and written_off are terminal. Incident closure does not itself release physical stock.
- Planned → reserved/released; reserved → picked/released or a reported missing/damaged state. Partial quantities split while retaining parent identity. No status is directly editable by the client.
