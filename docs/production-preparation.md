# Closed production preparation

**PRODUCTION PREPARATION PENDING EXTERNAL ACTION**

Current evidence: [production-preparation.json](production-preparation.json). Change review: [post-M10A-review.md](post-M10A-review.md).

The isolated Convex production shell `terrific-seahorse-419` exists under Daryan's `glara-os` project, reference `production-preparation`, US East / N. Virginia. It is not the default deployment. No Canadian data-residency claim is made. Database/user/storage checks are empty. Eighteen safety settings were set and read back; recovery mode is true, rollout approval false, all external capabilities and test mode false. No development secret was copied.

Backend code has NOT been deployed to this shell: automatic approval review rejected that step because it interpreted the prior M10A boundary as excluding production code deployment. No workaround was attempted. The existing development app received the tested fixes.

## Exact next owner decisions

1. Choose the production hostname; `app.glarahome.com` remains a suggestion only.
2. Confirm the production Owner's name/email and independent recovery contact. Historical development identity is not production authorization. No passwords in chat.
3. Confirm the supported MFA provider/account and platform MFA enrollment. Existing password auth does not provide privileged application MFA. No custom cryptography or identity migration is authorized by this preparation.
4. Connect the frontend hosting account. Browser automation could not initialize and no usable local Vercel session was available. Create a separate production project with protection covering all deployments; do not repoint the development project.
5. Explicitly authorize deploying this reviewed backend to the already configured production shell with all capabilities disabled, resolving the automated approval rejection.
6. Before real-data operations, name the backup/security alert recipients and independent custodian, and identify the privacy/CASL policy reviewer.

## Prepared deployment procedure

`node scripts/prepare-production.mjs` verifies the exact project, production reference, non-default selection, empty tables and every OFF flag. `--configure` only fills missing closed-state flags and refuses conflicting values. After explicit deployment approval, `--deploy` uses a deployment-scoped key held in memory, revokes it in `finally`, and checks the target stays empty. It never provisions users, imports data, supplies provider credentials, or modifies `.env.local`. Review the scoped source SHA before each run.

For the frontend, use `vercel.production.json` explicitly in a separate protected production project. Both build-time and runtime point to the production shell and carry the closed flags. Do not use the development `vercel.json`; do not set an unapproved SITE_URL. Verify the approved hostname, DNS, TLS, cookie/origin behavior and headers before enabling HSTS. The built application currently returns 503 for login, dashboard, inventory and auth while closed.

Auth keys and provider credentials remain absent until the final supported auth architecture is chosen. Generate fresh production credentials through secure platform interfaces; never copy dev keys. Owner bootstrap remains trusted operator provisioning, no public signup, no shared password and no staff provisioning before a confirmed list. Recovery must work through independently controlled platform access and revoke compromised sessions.

## Backups, monitoring, migration and rollout

Before real data: approve retention/RPO/RTO and custodians; configure isolated production snapshots including file storage, independently protected custody, scheduled verification and failure alerts; perform restore in a separate target. Database snapshots do not replace code/config/secret recovery. Existing executable restore, migration rehearsal and incident procedures remain in the M10A runbooks; they are not a production backup-service acceptance claim.

Use existing reconciliation/security/queue controls plus hosting/backend availability and error monitoring. Actual critical alert destination and responder assignment are pending owner input. No monitor account, fee or notification recipient was invented.

Migration stays at inventory/mapping/validation/deduplication/dry-run/rejected-record/reconciliation planning until actual source data and permission exist. Preserve the localhost-only rehearsal guard. Do not repurpose it for hosted imports. Native product spreadsheet import remains available in development; it is not authorization to import real production data. Real migration requires the exact separate authorization **AUTHORIZE PRODUCTION DATA MIGRATION** plus backups and approved source mapping.

Staff UAT, after explicit access approval: login/recovery; customer and follow-up; opportunity/quote; project conversion/checklist; product photo/Excel/receipt/reservation; invoice/payment; role-appropriate analytics. Verify restricted staff cannot access private finance/CRM. Disabled integrations should remain visibly inactive. Record actual staff names/date/issues; current emulated browser tests are not staff sign-off.

Rollout sequence remains Owner only → Owner/Admin → small approved staff group → all approved staff → selected automation → approved AI → approved email. Calendar stays deferred. Each step needs its own authorization and healthy evidence. For the first 24 hours, review auth/error/queue/integrity/provider state at launch and at 1, 4 and 24 hours, with named coverage before launch.

Freeze immediately on unauthorized access, unexplained sends, financial/inventory drift, source/import mismatch, Owner/session failure, secret exposure, backup failure or target mismatch. **Feature freeze:** retain recovery mode and OFF flags. **Code rollback:** deploy a reviewed compatible prior artifact through the explicit target. **Data recovery:** restore an approved snapshot to an isolated target, reconcile before switching; code rollback never reverses business mutations. Keep evidence and do not purge history.

Email development acceptance remains historical PASS; production email and authentication delivery remain OFF / REQUIRED BEFORE PRODUCTION where applicable. AI and consequential automation remain OFF. Google Calendar remains DEFERRED with original live acceptance required before any enablement. No live traffic, staff access or external communication is authorized.
