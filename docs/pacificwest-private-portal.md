# PacificWest private registration portal

## Release decision

**LIVE — OWNER CONFIRMED SUCCESSFUL LOGIN AND VISIBLE REGISTRATIONS.**

The product owner first required MFA, then explicitly superseded that choice by requesting immediate activation without MFA. The owner separately approved creating the dedicated sign-in account, a production authentication-email key, password-setup email delivery and the production settings needed for this read-only portal. This is a narrow exception for PacificWest registration viewing. It does not waive privileged MFA or other production-readiness requirements for the broader Glara OS application; MFA is not implemented or marked passed.

The public campaign and its existing records, assignee, draw and prize remain unchanged. A distinct sign-in user is provisioned through the existing internal account workflow with a random initial password that is not disclosed. The Owner chooses a password using a single-use emailed setup code. The non-login campaign assignee is preserved; the exact allowed login user is configured privately on the server. General production onboarding is reclosed after this one authorized account.

Deployment and acceptance details are recorded below. The existing authenticated Convex console remains an alternative access route; see [registration access](pacificwest-registration-access.md).

## What is implemented

`/campaign-admin` is a dedicated read-only PacificWest view with live Convex subscriptions, search by name/contact/brokerage/city, registration/eligibility/review/consent totals, and desktop/mobile participant cards. It shows contact information, registration time in Vancouver, licence declarations, separate marketing consent, CRM linkage state and confirmation delivery state. It does not send messages, export contacts, edit records, run a draw or award credit.

Queries read the existing campaign, entry, Realtor, brokerage and receipt records. No separate participant database, migration, production-to-development synchronization or duplicate campaign is introduced. Search traverses bounded pages. Totals respect the existing 5,000-entry campaign limit. Provider delivery is not an inbox-read confirmation.

## Security boundary

- Default closed. `GLARA_EXPO_ADMIN_ENABLED` must explicitly be true in the isolated public-campaign deployment. Production additionally requires `GLARA_PRODUCTION_APPROVED` and `GLARA_PRODUCTION_EXPO_ADMIN_APPROVED`, no recovery mode, and no acceptance mode/password fixtures.
- The server-only `GLARA_EXPO_ADMIN_USER_ID` must match the authenticated user. That user must have an active Owner profile without a pending containment change.
- Every data query verifies the authenticated session, its user binding and expiration. Archived/contained users and revoked sessions are denied. The browser rechecks its session periodically and on focus.
- Existing general CRM/financial/campaign mutation APIs remain denied by the public-only boundary. The only added routes are `/campaign-admin` and `/api/campaign-auth`; general staff login and `/api/auth` remain closed.
- Existing credential rate limiting remains active. There is no public signup or production password-provisioning shortcut. Password reset continues to depend on the existing approved authentication email configuration; it is not enabled by the portal flag.
- The dedicated auth endpoint validates request method, content type, body size, allowed auth action and the canonical request Origin, including only the configured trusted upstream. It does not trust arbitrary forwarded-host headers.
- Responses are private/no-store, use the existing nonce CSP, and the page is noindex. Session cookies use the supported auth middleware. Logging out performs a full navigation to clear client state.
- Access audit actor comes from the server session; contact values are not copied into audit payloads. Access records are throttled to one per session per five minutes.
- No service/admin key reaches the browser. Frontend public Convex configuration is not authorization; direct backend calls face the same checks.

## Activation procedure and retained boundaries

1. Use only the previously supplied and reconfirmed Owner identity. Apply the explicit password-only exception to this read-only portal. A platform console MFA setting does not protect application password login and is not claimed as such.
2. Complete production invitation/password recovery delivery and single-use/expired-code acceptance where the final auth architecture requires it. The existing non-login campaign assignee remains intact and the separate login user is explicitly allowlisted. Never send passwords, tokens or recovery codes in chat or source control.
3. Deploy reviewed backend/frontend source with portal flags still false. Assign the authenticated Owner ID privately in the backend environment. Do not enable general staff access, external AI, Calendar or general Email as a side effect.
4. Prepare exact reverse-proxy routes on the existing website: `/campaign-admin` and `/api/campaign-auth` to the isolated giveaway frontend, using its existing asset routing. Pick one canonical host and preserve the canonical browser Origin and secure auth cookies. Do not mount the full staff app or wildcard auth/admin paths. No DNS change is required by this plan.
5. Validate real canonical/upstream Origin rejection, secure cookies, no-store behavior, wrong account/role denial, logout/session revocation, desktop/mobile rendering and read-only live updates. Do not create fictional registrations in the live campaign or expose participant details in reports.
6. Only after these gates pass, configure both portal enablement/approval flags deliberately in the relevant deployment environments. The canonical address is `https://glarahome.com/campaign-admin`. A successful Owner login is only confirmed after the Owner sets a password and actually signs in.
7. Rollback: disable the portal flag in frontend and backend and revoke portal Owner sessions if containment is needed. The existing `/win` registration and separately approved receipts remain independent.

## Evidence

The repeatable `scripts/campaign-portal-browser.mjs` rehearsal uses a fresh localhost Convex backend and copied frontend, fictional contacts and generated temporary credentials. Provider keys are stripped, crons are disabled and all external capabilities are false. It does not connect to production or shared development. The local backend executable must already be available in the private acceptance workspace.

The final desktop (1440 x 1000) and mobile (390 x 844) rehearsal passed login, reactive arrival of a new fictional registration, search, responsive layout, restricted-route denial and logout. Disabled-backend sign-in was denied. Screenshots were visually inspected. Sanitized machine evidence is in [campaign-portal-local.json](evidence/campaign-portal-local.json). That evidence describes the earlier local rehearsal. Current hosted results are recorded below; MFA remains an explicitly approved scoped exception, not a passed control.

The portal security suite covers default-closed flags, anonymous/unapproved users, all other roles, archived/contained users, revoked/expired sessions, client clock forgery, limited projections, pending identities, receipt joins, bounded input and server-derived audit identity. Existing campaign and staff behavior remains covered by regression tests.

Final local quality gates: `npm test` passed 24 Node tests and 639 Vitest tests (44 files), including 10 portal security tests; TypeScript, ESLint, changed-file formatting, secret scanning and the Next.js webpack production build passed. These are the earlier local results; current production scope is recorded below. No production MFA pass is claimed.

## Production routing correction

The hosted rehearsal found a canonical-origin rejection: the CLI invocation with `--cwd` resolved the repository root development `vercel.json` instead of the isolated release configuration, overriding production project settings. The corrected command runs from the actual release working directory and passes its absolute `--local-config` path. The isolated deployment pins production at both build and runtime. For subsequent releases, preserve the reviewed private deployment configuration derived from `vercel.giveaway.json`, including the exact production Convex URLs, explicit portal approval/enablement flags and canonical upstream. Bind these non-secret values at build and runtime; keep secret credentials in the provider environment. Do not deploy a staff frontend through this public campaign configuration.

After verifying the exact canonical Origin and approved upstream URL, the dedicated authentication proxy normalizes Host for the Convex Auth SDK's second same-origin check. Arbitrary forwarded headers never grant this exception. Tests cover absent/foreign origins, forged forwarded host and wrong protocol. Temporary diagnostic logging was removed.

Local validation for this activation: 45 portal/campaign regression tests passed, then 28 portal/origin tests passed after the proxy fix; TypeScript and ESLint passed. Both Vercel production builds passed. The website's local dependency installation failed with a TLS cipher error, so its remote build and TypeScript checks provide the build evidence. Local website lint had zero errors and one pre-existing ContactForm navigation warning. No dependency or contact-form change was made.

## Live acceptance — September 27, 2026 (America/Vancouver)

The canonical `/campaign-admin` is live with password authentication, the exact Owner allowlist and read-only backend authorization. Both frontend portal flags and backend portal flags are enabled. Onboarding was reclosed after provisioning the one explicitly authorized login account. The original campaign assignee was not changed.

Desktop and mobile hosted checks passed: HTTP 200 sign-in and setup forms, responsive layout, no client errors, no anonymous contact data, private/no-store headers, canonical www-to-apex redirect, cross-origin rejection, secure HttpOnly/SameSite cookies, anonymous direct query denial, and closed general staff routes. `/win` remained reachable and its API rejected malformed input with 400 rather than configuration/origin failure. No fictional production entry was created.

Exactly one setup-email request was made through the live canonical UI. The provider reports delivered; Codex did not inspect the code or inbox. The Owner then confirmed successful login and visible registrations. This is owner-side acceptance, not an automated authenticated browser session with the Owner's password. No password or recovery code was shared with Codex.

`AUTH_EMAIL_ENABLED=true` and its production approval support only the allowlisted Owner's setup/recovery through this public-only deployment. General `M9_EMAIL_ENABLED=false`, Calendar, AI and consequential automation remain disabled. The separately approved entrant receipt worker is unchanged. The website routing commit is `97228cd5eb8ef11c54ed3a4ee314e534134cd257`.

See [sanitized hosted evidence](evidence/campaign-portal-live.json). No overall M10B, broad production auth, independent recovery, expired/reused production code acceptance, or privileged MFA gate is declared passed. The Owner's explicit exception is limited to this portal.

## Owner-requested password length

After confirming access, the Owner requested a shorter password minimum. The portal now accepts 8–128 characters for password setup/reset, enforced by a shared policy on the server and in the form. Matching confirmation remains required. Existing passwords and sessions are not changed by this deployment. Public signup, rate limits, the exact Owner allowlist and the read-only scope remain unchanged. The updated portal/origin suite passed 29 tests; production build and hosted form validation were repeated.
