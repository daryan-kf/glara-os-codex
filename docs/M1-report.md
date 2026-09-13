# M1 completion report — Realtor CRM

Reviewed September 13, 2026. **M1 implementation and isolated quality gates pass. Hosted Supabase acceptance remains outstanding. M2 has not begun.**

## A. Summary

Built a working Realtor CRM on the existing M0 foundation: brokerages, Realtors, reusable lead sources, assignment, relationship statuses, private notes/manual scores, activity history, tasks/follow-ups, search/filter/sort/pagination, archive and owner/admin recovery. Global search finds real CRM records and New opens functional M1 creation screens. No future business data is fabricated.

## B. Architecture decisions

- Preserve Next.js Server Components, strict TypeScript, Tailwind/Radix UI, Supabase SSR Auth, centralized permissions and versioned migrations.
- Keep tasks/follow-ups as specialized activities. Due dates, priority, ownership, status, notes and completion belong to one record.
- Derive first/last contact from completed communication activities and next follow-up from the earliest open action. Manual scores remain optional, explicitly labelled context.
- Separate sensitive fields into a one-to-one `realtor_private` table so Marketing restrictions also hold through direct database APIs.
- Centralize reads in `src/lib/crm/data.ts`, validation/types in `model.ts` and mutations in the Realtor server-action module. Explicit RPC cases map allowed fields and derive actors from Auth.
- Enforce the prospect next-action invariant transactionally with deferred constraints and parent-row locks; use optimistic versions for Realtor edits/archive/restore.
- Keep business lists bounded. No per-row network fetching or external search engine.

## C. Database changes

New migration: `supabase/migrations/202609130001_realtor_crm.sql`. M0 history is unchanged.

| Object          | Purpose                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------- |
| brokerages      | Current office relationship, contact details, notes, timestamps/archive                  |
| lead_sources    | Reusable configurable source names; 12 safe initial records                              |
| realtors        | Contact/location/status/assignment, generated search vector, version, timestamps/archive |
| realtor_private | Notes, listing estimates, CAD numeric(16,2) average price and nullable manual scores     |
| activities      | Manual communications, tasks and follow-ups with due/completion/status/owner/actor       |

Statuses/types use constrained text values rather than database enums, allowing explicit future migrations. Foreign keys, required fields, lengths, score bounds, valid state/due-date combinations and active-assignee checks are enforced. Active email and normalized phone uniqueness prevent obvious duplicates without merging.

Indexes cover search, name, brokerage, owner/status, timeline event time and open/assigned due dates. `realtor_directory` is a security-invoker view. `crm_query` supports bounded list/search/detail/timeline/due queue/configuration queries; `crm_mutate` supports explicit CRM operations. Private functions enforce roles, safe brokerage projections, activity validation and the next-action rule.

List page size is 25, global results eight, timeline/due queues 30 and brokerage lookup 25. Roster/source choices are capped at 500. Pagination is capped at 800 pages.

## D. Security / RLS

Every new table has RLS; anonymous access and direct authenticated table writes are revoked.

| Identity                          | Data scope                                                                                                                                  |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner                             | Full operational CRM, recovery/source management, existing owner-only audit access                                                          |
| Sales                             | Active operational CRM, activity/brokerage changes, Realtor archive; no restore/source configuration                                        |
| Admin                             | Operational CRM plus archive/recovery and sources                                                                                           |
| Marketing                         | Active safe Realtor directory and safe brokerage names; no internal notes, scores, listing estimates, activities, brokerage notes or writes |
| Designer / crew                   | No general CRM                                                                                                                              |
| Archived / unassigned / anonymous | Denied                                                                                                                                      |

Every mutation independently checks current active roles; UI checks are not trusted. Input is Zod-validated, then constrained again at the database boundary. Clients cannot set actor IDs, archive timestamps, versions directly or arbitrary fields. Safe error messages avoid exposing raw database details. Search is parameterized and has capped input/results. Auth, session security and identity administration remain M0 conventions.

## E. UI

- Realtor list with name/email/phone search; status, brokerage, city/area, assigned owner, source, follow-up and archive filters; name/newest/follow-up ordering.
- Create/edit Realtor with clear labels, optional context, lookup controls and retained values on validation failure.
- Realtor 360 with contact/relationship data, next actions, timeline, private context and labelled Opportunities/Projects/Revenue/Referrals placeholders.
- Follow-up queue with everyone/mine scope and completion with optional replacement next action.
- Brokerage list/create/edit and configurable lead sources.
- Global Realtor results and New Realtor/Brokerage/Follow-Up actions.
- Desktop table/two-column profile; mobile cards with next actions/history before extended profile fields. Existing responsive shell and accessible dialogs remain intact.

Overdue, due-today, upcoming and missing-next-action cues use Vancouver calendar dates. Date entry uses the device's timezone and is converted to an offset-aware timestamp.

## F. Audit

The existing transactional audit trigger now covers Realtors, private context, activities, brokerages and sources. It records table/entity UUID, action, old/new values, server-derived actor and timestamp. This captures creation, contact/status/assignment changes, notes/scores, archive/restore and follow-up completion. Multiple physical changes in one operation can produce multiple audit entries.

No client-supplied actor is used. Trusted administrative SQL without an Auth context has a null actor, as in M0. Audit logs remain restricted to active owners. This is not an automation/event-delivery engine.

## G. Tests

Final checks on this Windows workspace:

| Command                                    | Result                                                 |
| ------------------------------------------ | ------------------------------------------------------ |
| npm run typecheck                          | PASS, zero TypeScript errors                           |
| npm run lint                               | PASS, zero warnings                                    |
| npm test                                   | PASS, 9 tests, 0 failures                              |
| npm run build                              | PASS                                                   |
| PLAYWRIGHT_CHANNEL=chrome npm run test:e2e | PASS, 14 tests, 0 failures, desktop and Pixel 7 mobile |
| npm run format:check                       | PASS                                                   |

Database coverage uses actual M0+M1 SQL in PGlite: operational roles, Marketing field/table restrictions, crew/designer/archived/anonymous denial, direct-write denial, direct RPC invalid input, duplicate contacts, optimistic stale edits, next-action atomicity, archive/restore, audit actors, safe configuration projections, combined search/filter behavior and bounded pagination/timeline/due queues.

Browser coverage runs the production app, real Supabase SDK and a test-only Auth/PostgREST contract double backed by the actual database/RPCs. It covers login/logout/protected navigation/mobile layout, role denial, New brokerage, Realtor creation/profile/edit, note logging, follow-up creation/completion, global search, archive and restore. All test contacts are fictional.

The browser runner overrides Supabase settings at build and runtime to prevent a local real database from being used accidentally. The final run had only tooling color-environment notices and the expected safe auth-failed events for invalid-credential tests; no application exception was reported.

These checks do not claim a real Supabase deployment, email delivery verification, penetration test, load benchmark or exhaustive accessibility audit.

## H. Known limitations and remaining acceptance

1. No live Supabase environment was configured for this implementation. Apply the new migration in a disposable development project, provision role-specific fictional users and repeat creation/edit/search/follow-up/archive/restore plus direct API permission tests before real team use.
2. Verify real invitation/recovery delivery, Auth settings, HTTPS deployment and backup/restore using `docs/operations.md`.
3. CRM communication is manual. No email/Instagram/SMS/calendar integration, AI, automated scoring or outbound messages.
4. No M2+ tables/CRUD. Opportunities, projects, revenue and referrals remain labelled future sections.
5. Owner assignment is team-wide operational access, not per-salesperson row isolation. Marketing has deliberately narrower read-only access.
6. Identity management remains trusted administration. Lead sources support create/rename; brokerage create/edit is present. Dedicated source/brokerage archive management, activity rescheduling/edit history UI and bulk imports are deferred.
7. Phone uniqueness strips punctuation but does not canonicalize every international country-code convention. No silent merging.
8. Source/roster choices are capped at 500; offset directory paging supports up to 20,000 records. No 20,000-record performance benchmark was run. Profile next actions show the first 30, with the full due queue available separately.
9. Hosted deployment and production migration are not performed by the local quality checks.

## I. M2 readiness

Realtors now provide stable UUIDs, current brokerage/source/owner links, auditable relationship state and communication history for future properties/opportunities. Activities can gain explicit property/opportunity/project foreign-key associations in subsequent migrations. The same validated service, RPC/RLS, audit and browser/database testing conventions can support Sales CRM.

**Stop condition: M1 only. Do not begin M2 without a new instruction.**

## J. Screenshots

Captured from the tested production build using fictional records. Full-page mobile captures show fixed navigation at the viewport boundary; it remains fixed while scrolling in the app.

- [Desktop Realtor directory](screenshots/m1-realtor-list-desktop.png)
- [Desktop Realtor 360](screenshots/m1-realtor-360-desktop.png)
- [Mobile Realtor directory](screenshots/m1-realtor-list-mobile.png)
- [Mobile Realtor 360](screenshots/m1-realtor-360-mobile.png)
