# M9 Google Calendar development setup

**M9 CALENDAR GATE DEFERRED — EXTERNAL OAUTH CONFIGURATION REQUIRED BEFORE ENABLEMENT**. The owner intentionally deferred activation. This retained procedure is for a later authorized Calendar activation task; do not execute setup or enablement as part of M10A by default. Calendar is **NON-BLOCKING FOR M10A PRODUCTION HARDENING** while disabled. See [deferred-integrations.json](deferred-integrations.json) for mandatory M10B review.

This is a setup-only flow for **woozy-jaguar-392**, project **glara-os**. It does not enable sync or replace the existing Calendar adapter. Email gate remains passed; overall M9 remains pending.

## Current external prerequisite

The owner confirmed no existing development client. No Google Cloud/OAuth client, refresh token or dedicated Calendar is configured. Both Codex browser and Windows-control runtimes fail before initialization with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. No Google Cloud API credential or `gcloud` CLI is available. This is a tooling/account-access dependency, not missing user permission.

Creating the Cloud client through an authenticated Google Cloud session is the next external step. If computer control is restored, Codex can perform the authorized setup; otherwise the owner must complete these configuration steps. Do not share credentials in chat.

1. In [Google Cloud Console](https://console.cloud.google.com/), create a dedicated development project, e.g. **Glara OS Development**. Avoid a production project. Enable **Google Calendar API**.
2. In **Google Auth Platform**, configure **Glara OS Development Acceptance** branding and the owning account's support/developer contact. Keep an external app in **Testing**, with the consenting owner added as a test user where required.
3. Configure only `https://www.googleapis.com/auth/calendar.app.created`. This allows creating secondary app calendars and managing their events; no Gmail, Drive, Contacts, broad Calendar, or ACL scope is requested. Do not manually create the calendar: the helper creates it after consent so it is app-created.
4. Create a **Web application** OAuth client named **Glara OS M9 Development**, with the exact authorized redirect URI:

   ```text
   http://127.0.0.1:58439/oauth/callback
   ```

5. Store the client ID as `M9_GOOGLE_CLIENT_ID` and client secret as `M9_GOOGLE_CLIENT_SECRET` directly in the **Convex development** deployment's environment settings. Never use production, tracked files, shell command arguments, chat or screenshots for secrets. The helper reads these through captured CLI output and never prints their values.
6. Tell Codex the client is configured. Codex runs the helper and provides its local consent start link. Sign in to the intended development calendar owner account, review the app-created Calendar permission and approve it. No copying of codes/tokens is needed.

## Prepared helper

From the repository root with existing Convex CLI access:

```powershell
node scripts/m9-google-authorize.mjs
```

The helper checks for the two configured client variables, then requires both `M9_EMAIL_ENABLED=false` and `M9_CALENDAR_ENABLED=false`. It refuses to overwrite an existing refresh token/calendar setup. It binds only to `127.0.0.1:58439` for at most 20 minutes, uses a random launch path, OAuth state and S256 PKCE, and validates the Host and callback state. It logs no callback URLs, authorization codes, credentials or provider error bodies. Codes are exchanged in memory and redirected out of the callback URL. Credentials go directly through CLI stdin to the fixed development deployment.

After narrow-scope consent, it saves the refresh token and creates **Glara OS — Development Acceptance** in **America/Vancouver**. It saves the exact non-primary calendar ID without printing account metadata. No events or attendees are created, and sync remains disabled. If calendar creation has an uncertain outcome, it never retries automatically; saved authorization permits private recovery/reconciliation before any further create.

The listener is not currently running: its preflight stopped because the client is missing. No actual authorization URL can be prepared without a registered client ID. The helper has six mocked security/contract tests; actual Google token exchange and calendar creation remain untested until consent.

## Acceptance after consent

Privately verify the refresh token, actual app-created calendar, provider API access, deployed adapter, destination, disabled email and fictional-only sources before enabling the controlled sync window. Execute all requested live create/update/cancel, conflict/repair, repeated/concurrent sync, consultation, Vancouver DST and reconciliation scenarios. No real attendees. Restore `M9_CALENDAR_ENABLED=false` afterward; preserve audit/mapping evidence. Existing local contracts are not live Google evidence.

Commands for focused verification:

```powershell
node --test tests/m9-google-setup.test.mjs
node node_modules/vitest/vitest.mjs run tests/convex/communications.test.ts
# Requires existing explicitly authorized fictional identities in the private acceptance environment:
node node_modules/tsx/dist/cli.mjs tests/support/m9-calendar-preflight.ts
```

The hosted helper tests list/candidates/reconcile access for ten identity categories. It is not the full mutation/source/projection-tampering matrix. Existing Calendar policy limits external integration controls to Owner/Admin; it does not replace M3 operational calendar permissions.

Production OAuth readiness, any test-mode token expiry, security/retention review and overall M9 acceptance remain separate. Do not publish the OAuth app to production merely to bypass a development restriction.

References: [Google Calendar scopes](https://developers.google.com/workspace/calendar/api/auth), [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [create a secondary calendar](https://developers.google.com/workspace/calendar/api/v3/reference/calendars/insert).
