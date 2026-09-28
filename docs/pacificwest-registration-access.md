# PacificWest live registration access

The public form at https://glarahome.com/win saves to the isolated production deployment. The local Glara OS workspace remains connected to its separate development deployment. Its campaign and Realtor lists are development data, not a copy of live registrations.

## Owner access

The Owner confirmed access to the authenticated live data console on September 27, 2026 (America/Vancouver).

In Marketing or Campaigns, use the Owner shortcuts:

- **View live registrations** opens `campaign_entries`.
- **View live Realtor profiles** opens `realtors`.
- **Check confirmation delivery** opens `campaign_receipts`.

The deployment name is configured privately in the local server environment, not in this guide.

Sign in with the Convex account that already has project access. These links grant no new permission. The console is an administrative surface, not a read-only reporting account. View the records; do not edit entry identity, consent, eligibility, draw state or credit values directly. Those changes belong in the reviewed application workflows.

The local Marketing and Campaigns pages now show an Owner-only shortcut when the server-only `GLARA_LIVE_CAMPAIGN_DEPLOYMENT` is set to the separate production deployment name. This setting is a console link destination, not a second database connection or a credential. The shortcut is absent from public-only deployments, other roles, unconfigured workspaces and workspaces already connected to the designated live deployment. The optional setting must be configured separately for another approved staff frontend.

## How a registration is stored

A successful registration transaction creates the campaign entry, links an existing Realtor or creates a new CRM profile and brokerage, records the registration activity, ensures an open next action for a prospect, and writes audit evidence. Identity conflicts remain visible as pending review instead of overwriting an existing contact. Marketing consent is recorded separately; existing withdrawals and suppressions are preserved. Duplicate registrations do not create additional entries or confirmation emails.

The registration receipt is queued in the same transaction. Dispatch is asynchronous on the existing one-minute worker interval, not a guarantee of immediate inbox delivery. `delivered` means provider delivery evidence; it is not owner mailbox inspection. A delivery failure does not remove the saved entry.

For the existing live campaign, find `pacificwest-2026` in `marketing_campaigns` and filter `campaign_entries` by that record's ID. Follow `realtor_id` to the CRM profile; `brokerage_id` identifies the brokerage. Use `pending_contact` for unresolved identities. Join a receipt through its `entry_id`; exclude `test=true` receipts when counting real registration confirmations.

Records are committed before the public form reports successful receipt. The console reads production directly; there is no synchronization job or manual import into development. For an already-open table, use its live updates or refresh to see subsequent entries.

## Verification on September 27, 2026

A read-only check of live records passed: complete CRM/brokerage linkage, registration audit, activity, prospect next action, separate consent/rules evidence, one receipt per entry, delivered confirmation, and no duplicate email/phone identities. No participant details were written into source control, exported, or copied to development. The point-in-time aggregate evidence is kept privately in `.acceptance/pacificwest/registration-integrity.json`.

Validation: 3 shortcut security/configuration tests and 56 existing campaign, launch, receipt and origin tests passed; TypeScript, ESLint and the Next.js webpack production build passed. Unauthenticated browser checks at 1440x900 and 390x844 both redirected the protected campaign route to login and exposed no Owner shortcut or production information. The Owner confirmed seeing the live table. Automated control of the existing desktop browser was unavailable; no automated claim about that authenticated browser session is made.

## Boundaries retained

No production schema, records, flags, authentication settings or deployments changed in this access task. The public campaign remains public-only; general staff production login has not been enabled. General Email and Calendar remain disabled. The separately approved registration-receipt capability remains enabled. This is not approval or completion of general M10B, staff authentication/MFA, recovery, or backup readiness.

## Private in-site portal

The read-only portal at https://glarahome.com/campaign-admin reads the existing production campaign and linked CRM records directly. The Owner explicitly approved a password-only exception for this limited view and one secure password-setup email. Use the approved Owner email, select **I have a code** to set an initial password, then sign in. If the code has expired, use **Set or reset password** to request a new one. Codes expire after 15 minutes; do not share them or passwords in chat.

This does not make the local development Realtor list a production list, grant staff app access, or enable exports/editing/draws. See [portal readiness and security boundaries](pacificwest-private-portal.md) for actual deployment evidence and remaining Owner-side acceptance.
