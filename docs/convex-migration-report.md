# Convex migration acceptance

Date: 2026-09-13. Scope: replace Supabase for existing M0/M1; no M2 implementation.

## Implementation

Next.js now uses Convex for authentication, profiles, role checks, CRM storage and audit history. Supabase runtime packages and configuration are removed from the active app. Schema, generated bindings, internal administration, transactional business rules and replacement tests are committed together. Original SQL migrations, backend adapters and test harnesses are preserved under `legacy/supabase`; full rollback baseline is `a6ee904`.

Hosted target: `daryan-kamalifar / glara-os`, development deployment `woozy-jaguar-392`, **eu-west-1**. This differs from the old Canada Central Supabase environment. Only fictional users and CRM records were created. The Supabase project was not deleted, reset or used as a data source for this migration.

## Security and behavior

- Public signup and public internal-administration calls are denied.
- CRM operations validate both signed identity and the current unexpired session record, then active profile/roles. Old JWTs lose CRM access immediately after logout.
- Marketing cannot read private Realtor fields, operational rosters, activity history or audit records; non-CRM roles cannot call CRM functions.
- All mutations use validated inputs, active references, duplicate-contact checks and version guards. Audit snapshots and business writes share one transaction.
- Prospect next actions, rescheduling history, archive/restore and decimal precision are retained.
- HTTP auth cookies, in-memory client token state and centralized server authorization replace the Supabase SSR adapter/RLS architecture.
- A mutation navigation issue discovered by browser tests was corrected in the client action completion handler; archive/restore dialogs reset when archive state changes.

## Verification

| Check                                    | Result                              |
| ---------------------------------------- | ----------------------------------- |
| Production Next.js build                 | Passed                              |
| TypeScript strict check                  | Passed                              |
| ESLint, zero-warning gate                | Passed                              |
| Prettier format check                    | Passed                              |
| Shared validation/permission tests       | 8 passed                            |
| Convex transactional/security tests      | 8 passed                            |
| Hosted Convex API acceptance             | 46 passed                           |
| Hosted desktop/mobile browser acceptance | 30 passed                           |
| npm dependency audit                     | 0 vulnerabilities                   |
| Source/client bundle credential scan     | Passed; acceptance passwords absent |

Machine-readable API evidence: [convex-hosted-api-results.json](convex-hosted-api-results.json). Test-password provisioning was disabled on the development deployment after account setup; the temporary password environment variable was removed. Local identity credentials remain in encrypted, untracked storage.

The browser run emitted expected invalid-account/next-action diagnostics and Next.js stream-closed messages during navigation teardown; all assertions passed. A production soak test is still pending. The API runner uses real password sessions against the deployed backend, not a mocked database. Backend unit tests use convex-test and are separate evidence. Browser tests use a production Next.js build and real hosted Convex on desktop Chrome and Pixel 7 emulation.

Email delivery is **not** part of the automated pass claim. Provider/inbox verification is pending; generic reset UI behavior and invalid credentials are tested. No email was sent to a real person.

## Remaining release gates

- Configure a verified email provider/sender and complete real invitation/recovery, expiry, code reuse and password/session invalidation acceptance.
- Deploy and verify production Vercel/Convex configuration, HTTPS cookies and the intended region before staff rollout.
- Schedule protected backups and demonstrate restoration into a separate deployment.
- Perform load testing and replace broad scans with indexed cursor pagination before importing a large dataset. Current Realtor scans explicitly reject more than 10,000 records; this is not a demonstrated capacity guarantee, and activity-rich data can hit backend limits earlier.
- No real records or existing user passwords were migrated. A populated Supabase installation would require a separate, reviewed data migration with ID mapping and account invitations.

This migration does not authorize M2 or certify production/email readiness. Earlier Supabase acceptance reports are historical and do not substitute for Convex verification.
