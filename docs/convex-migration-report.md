# Convex migration report — independent review handoff

Date: 2026-09-13. Scope: existing M0/M1 only. **M2 is stopped pending independent review.**

The product owner has superseded Supabase-specific release checks. No Supabase SMTP, RLS, PostgREST, RPC, SQL migration or hosted-Supabase acceptance work is required for this Convex handoff. Business/security outcomes remain required. Email and production-authentication dependencies below are **DEFERRED — REQUIRED BEFORE PRODUCTION**, not passed.

## Removed components and replacements

| Removed from the active application               | Convex replacement                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Supabase JS/SSR clients and environment variables | Convex SDK, generated bindings, public deployment URL                                                       |
| Supabase Auth and token-hash callback             | Convex Auth Password provider, session/refresh records, code-based recovery                                 |
| PostgreSQL tables, UUIDs and foreign keys         | Validated Convex documents, native typed IDs and reference checks in mutations                              |
| RLS and direct-table grants                       | Explicit identity/session/profile/role checks in every business function; internal administration functions |
| PostgREST and SQL RPCs                            | Convex `query` and `mutation` functions called with the user's token                                        |
| SQL triggers and deferred constraints             | Atomic mutation logic, prospect invariant and audit insertion                                               |
| PostgreSQL row locks and version checks           | Convex transaction conflict detection plus explicit expected-version checks                                 |
| SQL migrations and source seeds                   | Versioned schema/index declarations and repeatable internal source initialization                           |
| Supabase Storage plans                            | No M0/M1 uploads existed; future authorized file workflows will use Convex Storage                          |
| PGlite/Supabase mock harness                      | convex-test plus real hosted Convex API and browser tests                                                   |
| SQLSTATE/PostgREST error classification           | Allowlisted domain error codes in `ConvexError.data` and safe UI messages                                   |

`legacy/supabase` is an inert rollback/history archive, excluded from active compilation/lint/test/deployment. It is not retained as a release-gate dependency. Full rollback baseline is `a6ee904`. The old cloud project was not modified or deleted. No Supabase tables, passwords, client records or historical audit rows were imported. This was a backend replacement on a development installation, not a populated business-data migration.

## Authentication

`convex/auth.ts`, `auth.config.ts` and `http.ts` configure Convex Auth. The Password provider rejects public registration, validates email and enforces 12–128 character new passwords. Signing keys live only in the deployment environment. Sessions last up to seven days, refresh inactivity is one day and JWT lifetime is one hour. The Next.js provider/proxy handles HttpOnly, SameSite=Lax cookies; production cookie configuration requires Secure and host-prefixed names. Client tokens use in-memory storage.

`currentProfile` resolves signed identity, checks the referenced session exists, belongs to the user and is unexpired, then fetches current profile/roles. Business access therefore ends immediately when the session is removed, the user is archived or roles are removed. Password login alone does not grant workspace access to archived/unassigned users. Logout and refresh-token invalidation were tested against the hosted backend.

Trusted internal administration provisions profiles/roles. Public clients cannot invoke it. Email invitations create an unknown random password and initiate a password-setting code. Recovery uses a 15-minute code; its delivery/reuse/expiry acceptance is deferred. Legacy Supabase callback URLs are rejected and never create a Convex session. MFA is not implemented.

The deployment now also contains a separately requested Owner account in addition to fictional acceptance users. Its administrative password setup was not email-onboarding acceptance. No real owner credentials are in source or this report, and acceptance tests use only the reserved fictional accounts.

## Authorization and security boundaries

`convex/access.ts` centralizes backend grants; `src/lib/permissions.ts` controls module presentation. UI grants are not trusted by the backend.

| Identity                                                  | CRM outcome                                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Owner                                                     | CRM operations, source administration, restore and audit reads                       |
| Sales                                                     | CRM operations; no restore/source administration/audit reads                         |
| Admin                                                     | CRM operations, source administration and restore; no audit reads                    |
| Marketing                                                 | Realtor directory/detail safe projection, sources and brokerage ID/name options only |
| Designer / Staging Crew                                   | All CRM function access denied                                                       |
| Anonymous / archived / no assigned role / revoked session | CRM access denied                                                                    |

Marketing cannot read private notes, scores, listing values, full brokerage records, activity history or the operational roster. Brokerage options intentionally reveal only ID/name to preserve directory filtering. Backend calls enforce the same restrictions as screens. Owner permissions do not expose a public raw-table mutation endpoint. Database/deployment administrators remain a separate trusted boundary, as with any hosted backend.

All writes validate Zod business contracts, native IDs, active referenced records and assignments. Incoming IDs, archive fields and audit actors cannot override server-owned fields. Unknown operation/payload/error content produces safe messages; logs contain only allowlisted operation, category and domain code, with no raw record/token payload. Direct malicious calls and private-field isolation are exercised in tests.

## Schema and indexes

Application definitions are in `convex/schema.ts`. Business documents have `created_at`, `updated_at` and `deleted_at`. IDs are Convex IDs, not UUIDs.

| Document        | Purpose                                                                                 | Declared indexes                                                    |
| --------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| profiles        | User reference, name, roles, archived state                                             | `by_user(userId)`                                                   |
| brokerages      | Office/contact information, notes and version                                           | `by_name(name)`                                                     |
| lead_sources    | Reusable attribution labels                                                             | `by_name(name)`                                                     |
| realtors        | Public directory attributes, relationships, assignment, normalized contacts and version | `by_email(email)`, `by_phone(phone_key)`, `by_archived(deleted_at)` |
| realtor_private | Private notes, scores, listing count and exact decimal price string                     | `by_realtor(realtor_id)`                                            |
| activities      | Calls/messages/notes/tasks/follow-ups, status, assignment, dates and replacement link   | `by_realtor(realtor_id)`, `by_status(status, deleted_at)`           |
| audit_logs      | Actor, entity, action, old/new snapshots and timestamp                                  | `by_entity(entity_id)`                                              |

Convex Auth supplies `users` (email/phone indexes), `authAccounts` (user/provider and provider/account indexes), `authSessions` (user index), `authRefreshTokens` (session and session/parent indexes), `authVerificationCodes` (account/code indexes), `authVerifiers` (signature index) and `authRateLimits` (identifier index). No browser functions expose these tables for unrestricted reads/writes.

Indexes are lookup structures, not uniqueness constraints. Active email/phone uniqueness is checked inside transactions; concurrent conflicting writes are retried against the updated state. Average listing price is stored as a validated decimal string. Future commercial arithmetic must preserve decimal precision. No quote/payment module was added.

## Queries, mutations and actions

- `crm.read` is a Convex query for directory/search/detail, choices/sources, activity timeline, follow-ups and brokerage lists/options/detail. It enforces each operation's role and projection. Its bounded JSON envelope preserves the existing frontend adapter contract; it does not execute SQL, PostgREST or a database RPC.
- `profiles.viewer` returns the caller's own profile; `profiles.audit` is owner-only and returns up to 100 matching audit entries.
- `crm.write` is a Convex mutation for Realtor create/update/archive/restore, activity creation/completion/cancellation/rescheduling, brokerage saves and source saves. All related writes and audit events occur in the same transaction.
- Auth actions own sign-in/reset/logout flows. The optional email sender performs HTTP delivery through Resend, outside database transactions; it is not configured or exercised as delivery acceptance.
- Internal `admin.provision` creates credentials then assigns a profile; its optional invitation is a separate external side effect. Failure is not a rollback guarantee across account creation and email delivery. `admin.setProfile` and `admin.initializeSources` are internal mutations. Test provisioning requires an explicit development flag and reserved fictional addresses; the flag is currently unset.

Read pagination currently uses bounded scans and in-memory sorting for combinations of filters and derived follow-up dates. Realtor listing returns 25 rows, global search 8, activities/follow-ups 30, brokerage options 20. The 10,000 Realtor scan guard is an explicit error, not a demonstrated capacity guarantee. Rich activity histories can hit execution limits earlier. Some indexes are prepared for future use rather than used by every query. Indexed cursor pagination/load testing is needed before large imports; no claim of scalable full-text indexing is made.

## Audit and concurrency

Business actor IDs come from authenticated server-side identity. Each successful sensitive mutation appends before/after snapshots in `audit_logs`; a failed transaction rolls back both data and audit writes. Snapshot shape is heterogeneous, but only trusted backend code can insert it. There is no public audit-edit/delete operation. Administrative profile changes use a null actor to identify deployment administration rather than impersonating a staff user. Existing Supabase audit evidence remains historical and is not presented as imported Convex history.

Realtor and brokerage saves require the expected version; concurrent stale saves cannot both commit. Activity operations require an open activity and active parent Realtor. Prospect creation and completion/cancellation/rescheduling check that a dated open next action remains. Convex transaction conflict tracking covers those reads and writes; no PostgreSQL locks/triggers are used. Tests include simultaneous completion of two remaining actions: only one commits, one remains open, and only the successful update is audited.

Rescheduling cancels the original, retains its original due date and links the new action. Archiving hides active views/follow-ups but preserves history; restore rechecks assignment, contacts and the next-action invariant. Accepted activity timestamps are normalized to UTC.

## M0/M1 parity and changed behavior

Preserved: protected routes, profiles, roles, responsive shell, Realtor CRM, brokerages, source labels, activities, task/follow-up ownership, Realtor 360, filters/search, archive/restore, audit events, optimistic edits, next-action enforcement, Marketing isolation, non-CRM denial, backend validation and safe errors.

This review corrected two initial migration regressions: Marketing brokerage-filter options were denied, and multi-word names required contiguous word order. Both now have dedicated regression coverage. Search uses case-insensitive token matching and normalized phone matching rather than PostgreSQL lexemes; token order is independent, partial names and full hyphenated email strings remain supported. There is no SQL parser or ranking/stemming compatibility claim.

Changed: native IDs replace UUID links; code-based reset replaces Supabase links; exact decimal prices are strings; identity administration uses trusted Convex functions; session/audit enforcement lives in functions rather than database triggers. No implemented M1 business screen was intentionally removed. Full-text search implementation and large-dataset performance differ as documented. No real-data or old-audit import was performed.

File/storage: M0/M1 did not implement media upload/download or attachment workflows. No bucket/files needed migration. Future Convex Storage use must authorize upload URL issuance and reads, validate metadata/type/size, store `_storage` references and protect entity associations; this is a design requirement, not implemented functionality.

## Verification

| Check                                     | Result            |
| ----------------------------------------- | ----------------- |
| Next.js production build                  | Passed            |
| Strict TypeScript                         | Passed            |
| ESLint zero-warning gate                  | Passed            |
| Shared validation/permission/error tests  | 8 passed          |
| Convex transaction/security/parity tests  | 13 passed         |
| Hosted Convex API checks                  | 48 passed         |
| Desktop/mobile production-build workflows | 30 passed         |
| Dependency audit                          | 0 vulnerabilities |

[Machine-readable hosted API evidence](convex-hosted-api-results.json). The new checks cover active-session profile/role revocation, deleted/expired sessions, simultaneous task completion, safe Marketing brokerage options, combined filters, paged totals, token-order search and UTC timestamp normalization. All writes in acceptance use fictional accounts/records; the real Owner account was not used or changed.

During browser navigation teardown Next.js emitted stream-closed diagnostics; deliberate invalid-account and next-action failures also logged safe errors. All assertions passed. These are development-hosted results, not production-origin or email-delivery certification. The test layers are distinct: shared unit contracts, convex-test transaction tests, and real deployed Convex with production-build browser tests. No Supabase test suite is part of these results.

## Pre-production dependencies

| Requirement                                                                             | Status                                    |
| --------------------------------------------------------------------------------------- | ----------------------------------------- |
| Real invitation/onboarding delivery for the selected invitation architecture            | **DEFERRED — REQUIRED BEFORE PRODUCTION** |
| Password recovery delivery and end-to-end recovery/password/session behavior            | **DEFERRED — REQUIRED BEFORE PRODUCTION** |
| Reused/expired recovery code handling (the selected equivalent of authentication links) | **DEFERRED — REQUIRED BEFORE PRODUCTION** |
| Production auth redirect/origin and HTTPS cookie verification                           | **DEFERRED — REQUIRED BEFORE PRODUCTION** |
| Transactional/authentication email provider configuration                               | **DEFERRED — REQUIRED BEFORE PRODUCTION** |
| Sender/domain verification for `Support@glarahome.com`                                  | **DEFERRED — REQUIRED BEFORE PRODUCTION** |

No provider setup, sender verification or real email delivery was attempted during this review. Generic recovery UI success is not evidence of delivery. Supabase-specific SMTP/token-hash acceptance is superseded; the applicable Convex recovery outcomes remain above.

Other outstanding production work: Vercel/Convex production environment, regional placement, protected backups and restore drill, production soak/load testing and large-dataset query work. Current backend is Daryan's **development** deployment `woozy-jaguar-392` in **eu-west-1**. A populated business installation would also require a reviewed data/identity import plan.

**STOP: migration is handed off for independent review. Do not begin M2 until that review is complete and M2 is explicitly authorized. Production readiness is not claimed.**
