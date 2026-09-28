# PacificWest private registration portal

## Release decision

**IMPLEMENTED AND LOCALLY VERIFIED — PRODUCTION ACTIVATION BLOCKED ON MFA AND OWNER ONBOARDING.**

On September 27, 2026 (America/Vancouver), the product owner chose activation only after two-factor authentication is ready. No password-only production exception is approved. The current portal password/recovery UI is a foundation, not an implemented MFA solution. Do not enable this portal until the supported MFA architecture is implemented and its server-side enforcement, enrollment, recovery and session-revocation acceptance are complete.

This task does not change the live giveaway, registration records, draw, credit, receipt worker, Email or Calendar settings. Production was not deployed or modified. The existing authenticated Convex console remains the available route for viewing live registrations; see [registration access](pacificwest-registration-access.md).

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

## Required activation procedure — not executed

1. Confirm the real Owner identity through the approved process. Enroll and verify supported MFA; test that direct backend authentication and data access cannot bypass it. A Vercel or Convex console MFA setting alone does not protect the application's password login.
2. Complete production invitation/password recovery delivery and single-use/expired-code acceptance where the final auth architecture requires it. Keep the existing non-login campaign assignee intact until the sign-in identity mapping is explicitly reconciled. Never send passwords, tokens or recovery codes in chat or source control.
3. Deploy reviewed backend/frontend source with portal flags still false. Assign the authenticated Owner ID privately in the backend environment. Do not enable general staff access, external AI, Calendar or general Email as a side effect.
4. Prepare exact reverse-proxy routes on the existing website: `/campaign-admin` and `/api/campaign-auth` to the isolated giveaway frontend, using its existing asset routing. Pick one canonical host and preserve the canonical browser Origin and secure auth cookies. Do not mount the full staff app or wildcard auth/admin paths. No DNS change is required by this plan.
5. Validate real canonical/upstream Origin rejection, secure cookies, no-store behavior, MFA, wrong account/role denial, logout/session revocation, desktop/mobile rendering and read-only live updates. Do not create fictional registrations in the live campaign or expose participant details in reports.
6. Only after these gates pass, configure both portal enablement/approval flags deliberately in the relevant deployment environments. The planned address is `https://glarahome.com/campaign-admin`; it is **not live or accepted** in this task.
7. Rollback: disable the portal flag in frontend and backend and revoke portal Owner sessions if containment is needed. The existing `/win` registration and separately approved receipts remain independent.

## Evidence

The repeatable `scripts/campaign-portal-browser.mjs` rehearsal uses a fresh localhost Convex backend and copied frontend, fictional contacts and generated temporary credentials. Provider keys are stripped, crons are disabled and all external capabilities are false. It does not connect to production or shared development. The local backend executable must already be available in the private acceptance workspace.

The final desktop (1440 x 1000) and mobile (390 x 844) rehearsal passed login, reactive arrival of a new fictional registration, search, responsive layout, restricted-route denial and logout. Disabled-backend sign-in was denied. Screenshots were visually inspected. Sanitized machine evidence is in [campaign-portal-local.json](evidence/campaign-portal-local.json). Real production login, MFA, email recovery and reverse-proxy acceptance remain **NOT RUN**.

The portal security suite covers default-closed flags, anonymous/unapproved users, all other roles, archived/contained users, revoked/expired sessions, client clock forgery, limited projections, pending identities, receipt joins, bounded input and server-derived audit identity. Existing campaign and staff behavior remains covered by regression tests.

Final local quality gates: `npm test` passed 24 Node tests and 639 Vitest tests (44 files), including 10 portal security tests; TypeScript, ESLint, changed-file formatting, secret scanning and the Next.js webpack production build passed. No production MFA or hosted portal acceptance is claimed.
