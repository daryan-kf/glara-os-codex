# M1 hosted Supabase acceptance report

## A. Environment

- Operator: Codex, executing the user's authorized disposable acceptance task.
- Test date: 2026-09-13 UTC.
- Repository: `daryan-kf/glara-os-codex`; baseline commit `9d168ab99307957f5f541071eea5f8ce2b54b410`. Tested implementation commit: `8e14a19e9961e27110c59e321c5e42f3677ce9fc` (the exact source and test changes exercised by the final runs; committed after verification).
- Dedicated project: `glara-os-acceptance`, reference `jymmquptpbzwpionmhvj`, Daryan organization, Canada Central (`ca-central-1`), Free plan.
- Hosted API: `https://jymmquptpbzwpionmhvj.supabase.co`; application tested as a production Next.js build at `http://localhost:3000` against that hosted API. This is not a public application deployment.
- Safety: newly created project verified to have zero Auth users and zero public business tables before migration. Existing unrelated projects were not modified. All accounts and CRM fixtures are fictional. No database reset or wipe was run.
- API/admin credentials and fictional passwords were kept in process memory and local Windows DPAPI-encrypted temporary files. `.env.local` contains only the project URL and publishable key and remains ignored. No tokens, passwords, private row dumps or live browser traces are included in this report or Git.

## B. Migration Results

All five local/remote migration versions match:

| Migration                             | Result                                |
| ------------------------------------- | ------------------------------------- |
| `202609120001_foundation.sql`         | PASS                                  |
| `202609130001_realtor_crm.sql`        | PASS                                  |
| `202609130002_m1_hardening.sql`       | PASS                                  |
| `202609130003_m1_search_tokens.sql`   | PASS — additive hosted acceptance fix |
| `202609130004_m1_conflict_status.sql` | PASS — additive hosted acceptance fix |

The original three migrations were not edited. No extra business modules or tables were introduced. CLI 2.117.0 applied migrations through `db push --linked`; final `migration list` confirmed parity.

Three M1 defects found and resolved:

1. **P1, invited-user login blocked:** `[auth.email].enable_signup=false` disabled the email provider. Set this provider flag to true while retaining global `[auth].enable_signup=false`. Hosted password login and public-signup rejection now both pass. Provider enablement and global signup control are separate [Supabase Auth settings](https://supabase.com/docs/reference/api/v1-get-auth-service-config).
2. **P1, hyphenated email search:** query tokenization differed from the indexed PostgreSQL parser. Migration 003 uses the same parser for both. A focused regression covers hyphenated and plus-addressed fictional emails, names, prefixes and nonmatches; real hosted combined search now passes.
3. **P1, brokerage conflicts timed out:** using SQLSTATE `40001` for business version conflicts triggered hosted PostgREST retries. Migration 004 returns `PT409` (HTTP 409), preserving locking and version checks. The application maps it to the existing conflict message. This follows [Supabase's documented retry-loop fix](https://supabase.com/docs/guides/troubleshooting/high-cpu-and-infinite-transaction-retries-when-using-custom-error-codes-in-rpc-functions-77326b). Real concurrent requests now return one success and one conflict promptly. A check for abandoned old RPC backends found none requiring termination.

Initial failed runs are not claimed as passes: the first login configuration failure caused dependent test failures; after login correction, search and brokerage conflict failures were isolated and fixed. An archived-brokerage assertion also failed during an interrupted conflict run, then passed on subsequent complete runs. The final result file contains the final full run.

## C. Role Matrix

| Identity       | Hosted API / RLS | Desktop / mobile workspace boundary | Verified result                                                        |
| -------------- | ---------------- | ----------------------------------- | ---------------------------------------------------------------------- |
| Owner          | PASS             | PASS / PASS                         | Operational CRM, audit, recovery, source administration                |
| Sales          | PASS             | PASS / PASS                         | Operational CRM; restore and source administration denied              |
| Admin          | PASS             | PASS / PASS                         | Operational CRM, recovery, source administration                       |
| Marketing      | PASS             | PASS / PASS                         | Safe directory/source access; CRM creation denied                      |
| Designer       | PASS             | PASS / PASS                         | CRM denied                                                             |
| Staging Crew   | PASS             | PASS / PASS                         | CRM denied                                                             |
| Unassigned     | PASS             | PASS / PASS                         | No role; workspace and CRM denied                                      |
| Archived Sales | PASS             | PASS / PASS                         | Archived profile; workspace and CRM denied, including valid Auth token |

Eight fictional Auth identities were created through trusted admin provisioning with confirmed email for tests. Each operational identity has exactly its intended role; unassigned has none. This provisioning does **not** prove email invitation delivery.

## D. Direct API / RLS Results

**61 checks PASS, 0 FAIL** in [the sanitized machine-readable result](M1-hosted-api-results.json), executed by `tests/support/hosted-acceptance.mjs` over real hosted Auth/PostgREST.

Authenticated table reads, RPC access and field isolation match the role matrix. Anonymous table/RPC requests are denied. Direct table mutations are rejected for all eight identities; business writes use the gated RPC. Non-operational identities cannot bypass UI restrictions through direct API calls. No private row contents were recorded as evidence.

## E. CRM Workflow Results

PASS: fictional brokerage/source/prospect creation, owner and brokerage assignment, initial next action, valid edit, duplicate email/phone rejection, stale edit rejection, combined search/filtering, follow-up/task creation and completion, cancellation with and without replacement, rescheduling, archive and permitted restore.

The last prospect action cannot disappear without replacement. Invalid cancellation/rescheduling leaves no partial audit entries. Rescheduling retains the original due date, cancelled status and null completion date, with a linked open replacement.

The browser suite covers Realtor list and 360, create/edit, notes, follow-up, completion, cancel/reschedule, global search, archive and restore on desktop and mobile against hosted Supabase. API assertions independently verify database state and permissions.

## F. Brokerage Hardening Results

PASS: two separate authenticated callers concurrently editing the same captured version produce exactly one winner; the other receives `PT409`. Version increments once. Missing version also receives `PT409`. Archived records reject ordinary and crafted edits from Owner, Admin and Sales, leaving the record and audit unchanged.

The error-code expectation was updated because `40001` incorrectly declares a retriable serialization failure; conflict rejection was not removed or relaxed.

## G. Marketing Isolation Results

PASS: safe directory/profile display fields and lead sources remain available, including the assigned owner's display name. Private Realtor notes/scores, activities, brokerage notes, operational owner choices and enumeration of other profiles/roles are inaccessible. Direct CRM mutation and creation UI are denied.

## H. Audit Results

PASS: audit actors are the actual authenticated callers, including a crafted forged-actor attempt. Realtor creation/edit/archive/restore, brokerage edit, cancellation and reschedule original/replacement are recorded. Rejected writes do not commit audit entries. Every non-Owner identity is denied audit visibility.

## I. Auth / Session Results

AUTOMATED PASS: all eight password logins, token refresh and role enforcement after refresh, Auth logout invalidating the session, archived-profile denial using a valid token, unauthenticated protected-route redirects, application login/logout, secure HttpOnly SameSite cookies, desktop/mobile navigation and recovery page layout.

Hosted configuration: Site URL `http://localhost:3000`; allowed callback `http://localhost:3000/auth/confirm`; signup disabled globally; email/password provider enabled; 12-character minimum password; email confirmation and double-confirm email changes enabled. These are local acceptance origins, not production origins. JWT lifetime remains 3600 seconds; natural one-hour expiry was not waited out.

**PENDING EXTERNAL MANUAL ACCEPTANCE:** real invitation delivery/password setup, recovery delivery/password change, and expired/reused delivered links. The Free project's default email provider rejected template modification. No SMTP credentials or controlled deliverable test inbox were available; no paid upgrade or real-person email was attempted. Templates remain versioned in `supabase/templates/`.

## J. Local Quality Gates

| Check                                               | Result                                                                              |
| --------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run typecheck`                                 | PASS                                                                                |
| `npm run lint`                                      | PASS                                                                                |
| `npm test`                                          | PASS — 15 tests                                                                     |
| `npm run build`                                     | PASS — production build with hosted configuration                                   |
| `npm run test:e2e` with `PLAYWRIGHT_CHANNEL=chrome` | PASS — 18 isolated desktop/mobile tests; 20 hosted-only cases intentionally skipped |
| Hosted Auth browser suite                           | PASS — 6 desktop/mobile tests; 4 double-only cases intentionally skipped            |
| Hosted CRM / eight-role browser suite               | PASS — 20 desktop/mobile tests                                                      |
| `npm run format:check`                              | PASS                                                                                |

The first isolated browser attempt could not launch bundled Chromium because it was not installed. The suite was rerun with installed Chrome; no assertion was disabled. Hosted traces are disabled to avoid persisting tokens. Occasional Next.js stream-closed diagnostics occurred during immediate test navigation; assertions and user-visible pages passed.

## K. Outstanding Manual Acceptance

1. Configure an authorized SMTP provider and a controlled disposable deliverable inbox in this development project. Do not use employee/customer accounts or the reserved `.example.test` addresses for delivery.
2. Install the versioned invite/recovery templates. Keep global signup disabled, email provider enabled, confirmations enabled and the 12-character policy. Set the exact application Site URL and `/auth/confirm` redirect for the test origin.
3. Invite a fictional user, confirm delivery and password setup, assign the intended role through trusted administration and verify login.
4. Request recovery, follow the delivered link, change password, verify the new password works and the old one does not. Retry the used link and an expired link; both must fail safely. Confirm redirect allowlisting.
5. Record date, operator and PASS/FAIL summaries here without email links or tokens. Only then reconsider the release recommendation.

No application hosting/production rollout was performed. Re-run applicable origin/cookie checks on the eventual HTTPS deployment. No M2 work was started.

## L. Release Recommendation

**RELEASE GATE PENDING EXTERNAL ACTION**

Automated hosted database, security, workflow and browser acceptance passes after the scoped fixes. Email delivery and delivered-link acceptance are still untested and must be completed before declaring the release gate passed.
