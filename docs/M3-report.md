# M3 — Staging Operations report

Status: implementation complete; development acceptance results recorded below. Independent review and the production prerequisites remain required. M4 has not been started.

## Delivery

A won opportunity can now hand off to a numbered staging project. Project 360 connects its room plan, operational checklist, team, calendar, ad hoc tasks, restricted access instructions, notes and audit activity. The dashboard shows today's/tomorrow's agenda and a bounded priority review. The calendar supports Today, Week and Upcoming agenda views; Project search joins the existing global search.

The original attachment stopped at section 41. The subsequently supplied sections 41–100 were incorporated before implementation. Mobile delivery follows the supplied crew requirements: assigned project access, touch-friendly checklist/task completion, operational notes and agenda navigation. No missing inventory or commercial features have been inferred.

## Architecture and source structure

- `convex/operationsSchema.ts`: native table definitions and shared workflow validators, composed into `convex/schema.ts`.
- `convex/operationsCore.ts`: live session/profile authorization, project access levels, assignment/reference checks, version checks, checklist gates, bounded child reads, safe card projections and audit helpers.
- `convex/operations.ts`: public validated queries and transactional mutations. No new actions, HTTP endpoints, external services or scheduled jobs.
- `src/lib/operations/model.ts`: explicit workflow states, transition graph, validation, default template, configuration defaults and derived attention rules.
- `src/lib/operations/time.ts`: Vancouver clock conversion, rejecting nonexistent or ambiguous local times.
- `src/components/operations`: list, handoff, Project 360, calendar, settings and reusable form controls. Edit forms capture their version when opened. Failed writes show controlled business errors; arbitrary server details are not displayed.
- `src/app/(workspace)/projects`: list, new, detail and operational settings routes. `/calendar` replaces the M3 placeholder.
- `tests/convex/operations.test.ts`, `tests/operations.test.ts`, `tests/e2e/operations.spec.ts` and the hosted support runner: regression, security and workflow evidence.

Existing Convex Auth, its pinned in-memory compatibility fix, protected workspace hydration gate, M1 CRM and M2 money/business logic are retained. No Supabase components have been reintroduced.

## Data model and deliberate choices

| Entity                           | Purpose and principal indexed paths                                                                                                                                                                                                                                                                                |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| projects                         | Stable native IDs, immutable number/source relationships, status, priority, primary team, package and date-only lifecycle facts. Indexes by opportunity, property, Realtor, source quote, status, primary manager/designer/lead, package end, status plus package end and archive. Search index on project number. |
| project_counters                 | Independent annual project counter; quote counters are untouched.                                                                                                                                                                                                                                                  |
| project_rooms                    | Stable room IDs, controlled room type/scope/status, custom name, design notes and numeric ordering. Project and project/order indexes.                                                                                                                                                                             |
| project_checklist_templates      | Reusable, versioned active/default template identity.                                                                                                                                                                                                                                                              |
| project_checklist_template_items | Versioned through their template; changes soft-archive old template rows and insert replacements. Indexed by template and order.                                                                                                                                                                                   |
| project_checklist_items          | Copied project-owned requirements, stable gate keys, assignee, due rule, required flag, server-owned completion/skipping metadata and version. Project, project/status, assignee/status, due and gate indexes.                                                                                                     |
| project_team_assignments         | Additional designers/crew only; project primary role fields are authoritative for manager/designer/lead. Project and user assignment indexes. No workforce rostering.                                                                                                                                              |
| operations_events                | Canonical scheduled staging/destaging timestamps plus other project operations. Project, UTC start, type/start, lead/start and derived Vancouver day indexes.                                                                                                                                                      |
| project_access_details           | Restricted access instructions/code, separate from generic project records and search. Unique-by-mutation project lookup and explicit version.                                                                                                                                                                     |
| project_notes                    | Append-first notes with internal/operations/design visibility and bounded chronological reads. Soft archive is available to project management.                                                                                                                                                                    |
| project_media                    | Metadata-only foundation with Convex Storage ID, stable project/room references and category validator. There are no upload/read-URL endpoints or upload UI.                                                                                                                                                       |
| operations_settings              | Versioned daily staging/destaging capacity, package labels and alert thresholds. Defaults are read safely before configuration is persisted.                                                                                                                                                                       |
| activities (extended)            | Ad hoc project tasks use optional project_id/project_room_id, version and completion actor. New project and room-task indexes. Existing M1/M2 fields/statuses remain intact.                                                                                                                                       |
| audit_logs (reused)              | Atomic operational audit records with authenticated actor; no duplicate status-history table.                                                                                                                                                                                                                      |

Explicit specification deviations and tradeoffs:

1. **Staging/destaging dates live only in operations_events.** Project read models derive them. This prevents project/event date drift. Date query indexes therefore belong to events rather than duplicated project date columns. M4/M5 can reference the same project and event IDs.
2. **Checklist requirements and Activities remain separate.** Checklist items are process snapshots; Activities are ad hoc work. No task is mirrored into another table. A project task has exactly one primary parent (`project_id`); `project_room_id` is subordinate context verified against that project. M1/M2 writers continue their own validated parent paths and reject completing project tasks through their APIs.
3. **Primary role fields plus additional participant rows** avoid two competing primary assignment lists. Changes/removals validate live profiles and require dependent open work/events to be reassigned. Existing assignments do not override archived-profile denial.
4. **Search does not copy address/Realtor names onto projects.** Bounded native searches over current property/Realtor indexes are joined to projects, then authorized. Address/name edits appear without fan-out backfills. Search has a bounded preview rather than unlimited fuzzy matching.
5. **Owner/Admin create projects and manage team/settings/templates.** Related Sales can view the handoff and project, and update listing/pending/sold. An explicitly assigned Sales project manager receives operational management access on that project. This is an intentional responsibility grant, not company-wide Sales access. Normal Sales cannot create/assign operational teams themselves.
6. **One default checklist editor is delivered.** The relational schema supports additional templates and creation accepts an active selected template; a template-library management UI is deferred. Existing project instances never follow later template edits.
7. **Manager overview notes are a short editable brief.** Ongoing operational/design notes use the append-first notes table and explicit visibility, rather than continually rewriting that brief. Neither appears in Marketing or ordinary Sales projections.
8. **No dedicated status history or storage workflow.** Audit supplies M3 transition history. Media metadata is explicitly preparatory; uploads, downloads, media retention and file permission acceptance need a later authorized milestone. Stable project/room IDs support M4 without destructive changes.

## Creation, lifecycle and integrity

Creation derives property/Realtor from the won opportunity, validates active related records, checks any accepted source quote belongs to that opportunity, allocates `GLS-YYYY-NNNN` using the Vancouver year, and copies checklist/rooms in one mutation. A nullable source quote permits a won handoff without an accepted quote. An existing non-archived project—including a cancelled/completed one—is returned rather than duplicated. Archiving a terminal project permits a later replacement; restore rejects a conflicting replacement. Annual numbering fails explicitly after 9,999 projects rather than changing its specified format silently.

Primary flow:

`planning → designing → ready_to_schedule → scheduled → staging → staged → listing_live → pending_sale → sold → destaging_scheduled → destaging → completed`

Also allowed: ready_to_schedule → designing; staged → sold; listing_live → sold; pending_sale → listing_live. Any nonterminal stage can be cancelled by project management with a reason. Cancellation retains the won opportunity and history, cancels scheduled events and closes open ad hoc tasks. Completed/cancelled projects cannot receive routine operational edits. Owner/Admin may archive/restore terminal projects; broad historical corrections and reopening are not implemented.

Scheduling checks required preparation, a nonempty design-ready room plan, manager/designer/lead and package end date. Starting staging rechecks preparation. Staging completion checks required staging items. Destaging requires confirmed access; completion checks required destaging items and no remaining open tasks. Only required relevant items gate transitions. Required items cannot be skipped; project management can change a requirement before its gate with an audited reason. Passed required gates cannot be undone by resetting, archiving or weakening their checklist items.

Cancellation/completion and individual event cancellation have explicit event cleanup. Starting a staging/destaging before its scheduled business day is rejected; reschedule it first. Project operations never write quote prices or status. M2 now prevents reopening a won opportunity or archiving commercial source records retained by any project history.

## Authorization and privacy

Every public backend function checks live authentication/session validity and the current, non-archived profile. IDs supplied by a client do not grant access; parent references and assignments are checked again inside mutations.

| Access level                          | Returned information and allowed work                                                                                                                                                                                               |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner/Admin                           | All operations; creation, team/configuration, project updates, audit activity and restricted access.                                                                                                                                |
| Assigned Sales project manager        | Operational management on the explicit project assignment, including restricted access and project audit activity. Global settings/team assignment remain Owner/Admin-only.                                                         |
| Related Sales                         | Projects linked to an opportunity or Realtor currently assigned to them; safe summary/source links, dates and listing/pending/sold updates. No internal notes, checklist details or access instructions.                            |
| Assigned Designer/additional designer | Room plan, design notes, project task work, dates and operational checklist; completion limited to assigned checklist items. No commercial source details, manager brief or restricted access endpoint.                             |
| Assigned Staging Lead/additional Crew | Operational project/event/room/checklist information, own checklist/task completion, operations notes and permitted staging/destaging transitions. Restricted access endpoint only while the project remains open and non-archived. |
| Marketing                             | Only staged/listing_live/pending_sale/sold/completed non-archived projects; safe address/Realtor/status/date/package view. No source links, team, tasks, checklist, notes, access or commercial data.                               |
| Unassigned/archived/anonymous         | Denied.                                                                                                                                                                                                                             |

Restricted access data is obtained only through `accessDetails`, never through the generic list/detail/search/agenda projection. Updates audit metadata/version rather than instruction/code values. Notes are not dumped into audit snapshots. Project audit UI exposes a bounded action timeline, not unrestricted raw audit snapshots. Existing global/CRM audit permissions are unchanged.

Access codes use the backend's storage protections; there is no invented application encryption or separate key-management system. Threat-model review, least-privilege administrative access, retention policy and provider encryption/backup guarantees require production review. Staff must use the restricted access form rather than putting codes into ordinary notes or event descriptions. No external-client or public project endpoint is present.

## Calendar, capacity, dates and concurrency

Persisted event times are normalized UTC ISO timestamps. Calendar display and input use `America/Vancouver`, regardless of the browser timezone. Date-only package/listing/pending/sold/actual-end fields use validated `YYYY-MM-DD`. Nonexistent or repeated DST clock times are rejected rather than guessed. The pre-staging previous-day due rule means 17:00 on the previous **Vancouver calendar day**; staging/destaging-day due rules use the scheduled start. Rescheduling updates due dates and checklist versions for unfinished template instances, retaining completed history.

An event occupies one Vancouver day, lasts at most 12 hours, and must end after it starts. Overnight/multi-day operations must be split into separate events in a future extension. Same-project and same-lead overlaps are blocked transactionally. Capacity is derived from noncancelled event records, including completed operations on that day; no daily counter rows can drift. Owner/Admin settings default to 4 stagings and 3 destagings per day. Lowering a limit preserves existing bookings and blocks additional over-capacity bookings.

Explicit expected versions protect projects, rooms, checklist, events, access, templates and settings. Scheduling also checks the project version. Convex transaction retries and indexed range reads preserve duplicate/number/conflict invariants under concurrency. Audit commits with the successful mutation; rejected mutations leave no audit or partial business state.

## Query bounds and scale limits

- Project lists: maximum 12 candidate projects/page, native cursor pagination, indexed source/primary-role/status paths, additional city/date/attention filters and server ACL applied to the bounded page. Sparse pages show a next-page explanation. Default list is active; explicit status filters find terminal projects.
- Project children: 40 active rooms, 80 non-archived checklist items, 80 non-archived ad hoc task records, 80 event records and 30 active additional participants. Mutations enforce these limits. Completed/cancelled tasks can be archived to free working-list capacity. These limits are deliberate initial internal-operation limits, not unlimited history claims.
- Calendar: maximum 25 candidate events/page over at most 31 days; exact Vancouver dates and ACL are applied server-side. Daily conflict reads use a 201-record sentinel and fail explicitly on an overfull day.
- Notes/audit: cursor pages capped at 25. Note visibility is filtered server-side.
- Action center: indexed candidates from active package-expiry stages, sold, overdue checklist/tasks and imminent events; at most 20 projects evaluated and 12 cards returned. A partial-review notice links to project filters when candidate limits are reached. It is not an exhaustive company-wide KPI/BI report.
- Global search: bounded project-number/property/Realtor candidates, authorization before returning up to 12 matches. No notes, access data or financial values enter the search index.
- Staff options: explicit 200-profile ceiling; add indexed staff search before exceeding it. Primary staff filters are provided to Owner/Admin; related role users receive scoped safe lists and project-local participants.

Large-import/load acceptance, overnight planning, high-volume staffing, unrestricted deep child-history browsing and BI totals are not claimed by M3.

## Verification and acceptance

Development target: `daryan-kamalifar / glara-os / woozy-jaguar-392` (eu-west-1). Frontend: production Next build at localhost:3000. All fixtures use reserved fictional accounts and fictional properties; no real client records or email deliveries were used.

- Local tests: **59 passed** (13 Node tests, 46 Convex tests including 19 M3 backend cases).
- TypeScript, production build and lint: passed.
- Hosted M1 API: **48/48 passed** after M3 deployment.
- Hosted M2 API: **20/20 passed** after M3 deployment.
- Hosted M3 API: **16/16 passed**, rerun after the final deadline correction; see [hosted results](M3-hosted-api-results.json). This includes real password-authenticated role projections and planning → staging → sold → destaging → completion.
- M3 desktop/mobile browser workflow: **2/2 passed**. Creates a project through the won handoff, edits a room, prepares checklist, schedules, signs in as assigned crew, completes a checklist requirement, checks privacy, views agenda/global project search, saves schedule changes repeatedly and verifies no horizontal overflow.
- Complete browser suite: **40/40 passed** (M0–M3, desktop and mobile).
- Screenshots reviewed: desktop project overview and mobile crew checklist; agenda/overview captures are available in ignored test artifacts.
- The complete 40-scenario run preceded the final deadline correction and list page-size tightening; M3 hosted and desktop/mobile scenarios were rerun after the deadline/form correction. The final backend-only filter correction passed its added local regression and **5/5 hosted query checks**; see [query results](M3-query-api-results.json). Initial browser failures were test locator issues (textarea label lookup and a status label matching an option). They were fixed with accessible textbox/precise status locators, not by weakening product assertions.
- Formatting and production dependency audit passed; **0 production dependency vulnerabilities**. Secret scan found no credential-pattern matches or tracked environment files in the reviewed source files.

Local security cases include won-only creation; duplicate and number concurrency; accepted quote ownership; forged actor rejection; archived staff rejection; designer/crew assignment and revocation; unrelated Sales denial; Marketing isolation; restricted-access/audit privacy; cross-project rooms; task-parent integrity and room archive dependencies; immutable template copies; critical gates; concurrent completion; crew-only assigned checklist actions; daily capacity; concurrent rescheduling; cancellation/terminal archive; completed-project immutability; and retained M2 source history.

Hosted runner: `npx tsx tests/support/m3-hosted-acceptance.ts`; after browser fixtures exist, query regression runner: `npx tsx tests/support/m3-query-acceptance.ts`. Completed fictional operations consume the configured daily capacity; repeated full lifecycle acceptance must respect that limit in the disposable development environment. Browser runner: `npm run test:e2e` with the documented fictional identity configuration. Stop the local server before a build; do not replace `.next` under a running production server. Test artifacts and credentials remain ignored. Browser-created projects are cancelled and archived during cleanup; the hosted lifecycle project is completed and archived. Commercial fictional source records are retained to preserve the tested history.

## Setup and handoff

1. Follow README for `npm ci`, `.env.local`, existing Convex selection and authenticated staff provisioning. No new secret or environment variable is needed for M3.
2. Deploy schema/functions to an explicitly selected development deployment with `npx convex dev --once --env-file .env.local`. M3 is additive; no data migration, destructive reset or backfill is required.
3. Sign in as Owner/Admin. Open Projects → Operations settings to adjust capacity, package labels and the default template. Without edits, defaults are used; the first project transaction creates the default template safely.
4. Open a won opportunity → Create staging project. Assign the primary team, package and rooms. Finish preparation before scheduling; use Project 360 for further work.
5. Run the regression/hosted tests with fictional identities and review this report before real operations or M4.

No M4 Inventory, agreements, invoices, payments, automation, AI, external calendar or full media management has been built.

## Remaining production dependencies

**DEFERRED — REQUIRED BEFORE PRODUCTION**, not passed: invitation/onboarding email delivery; password recovery delivery and full recovery-flow acceptance; expired/reused authentication-code handling acceptance; production authentication redirect/origin verification; transactional email provider configuration; sender/domain verification for `Support@glarahome.com`; production deployment/security review, regional placement, backups and restore testing. Existing development tests do not certify these production requirements.

Independent M3 review remains required. Stop here; M4 requires explicit authorization.
