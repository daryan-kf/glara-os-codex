# M10A security inventory — reviewed baseline, not final acceptance

This inventory covers the supplied Sections 16–78. “Reviewed” means source inspection; it is not a claim that every abuse scenario has been tested. The attachment ends within Section 78. Final matrix expansion is pending the rest of the specification.

## Authentication

| Entry point           | Existing behavior / evidence                                                                                                                                | Remaining obligation                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Password sign-in      | Convex Auth Password provider; Scrypt; normalized lowercase/trimmed email; public sign-up rejected                                                          | Direct backend enumeration/timing and brute-force matrix                                                                                                                     |
| Provision/onboard     | `admin.provision` is internal; generates random password unless fictional acceptance explicitly enabled; roles stored in profile by internal administration | No user-facing Owner/Admin invitation lifecycle; inviter identity currently null/operator context in audit. Build binding/expiry/revocation/reissue policy before production |
| Password recovery     | Email code, 15-minute maxAge; framework hashes stored verification code; resets credentials only after user/account binding; invalidates other sessions     | Actual auth-email delivery remains separate from M9 communication acceptance. Expiry/replay/mismatch/rate tests pending                                                      |
| Invitation resend     | No distinct invitation model or resend endpoint                                                                                                             | Required lifecycle not implemented                                                                                                                                           |
| Session refresh       | Convex Auth JWT one hour, total session seven days, inactivity one day; patched memory storage avoids stale refresh state                                   | Production refresh/fixation/revocation tests and library upgrade review                                                                                                      |
| Sign-out              | Framework invalidates session; server authorization resolves current session/profile                                                                        | Existing role/session tests pass; complete cross-module matrix pending                                                                                                       |
| Archived/role-revoked | `currentProfile` checks live session ownership/expiry; `requireRoles` rejects archived profile or missing current role                                      | Separate disabled flag does not exist; roles removed / profile archived is current policy. Test all protected paths                                                          |
| Redirect              | Fixed SITE_URL origin, three allowed routes; new strict origin parser                                                                                       | Future production hostname not selected/verified                                                                                                                             |
| Cookies               | Installed framework uses HttpOnly, SameSite=Lax, path `/`, __Host prefix/Secure for non-local hosts                                                         | Frontend proxy must be behind trusted host/origin controls; verify actual production headers and CSRF behavior                                                               |
| MFA                   | No application MFA configured                                                                                                                               | Production blocker for Owner/Admin until supported MFA architecture is decided and verified; deployment/operator MFA independently required                                  |

UI reset responses are deliberately generic, but that alone does not prove direct Convex action responses cannot enumerate accounts. The framework's stored `authRateLimits` covers failed credential/code verification; reset initiation needs additional review. No claims of a complete invitation or recovery acceptance matrix are made.

## Authorization map

Single private company application; there is no multi-tenant/company isolation model. Do not represent deployment isolation as multi-tenancy.

| Module            | Role/entity/operation boundary                                                                      | Main sources                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| M1 CRM            | Owner/Admin management; assigned Sales; reduced Marketing DTO; Designer/Crew denied                 | `access.ts`, `crm.ts`, CRM validation/model                    |
| M2 sales          | Assigned opportunity/property/quote source checks and server monetary validation                    | `sales.ts`                                                     |
| M3 operations     | Operational roles and project assignment; privileged settings separate                              | `operationsCore.ts`, `operations.ts`                           |
| M4 inventory      | Role-specific asset/reservation/movement/condition access; transactional integrity                  | `inventoryCore.ts`, `inventory.ts`                             |
| M5 commercial     | Financial scope and explicit reversal/approval checks                                               | `commercialCore.ts`, `commercial.ts`                           |
| M6 analytics      | Role-aware projection/fact views; private company financial reports restricted                      | `analytics*.ts`                                                |
| M7 automation     | Administrative rule changes; source visibility for actions; deterministic server actor checks       | `automationCore.ts`, `automationSources.ts`                    |
| M8 AI             | Context rebuilt from source permissions; current profile stamp; bounded proposals                   | `aiContext.ts`, `ai.ts`, `aiProvider.ts`                       |
| M9 communications | Source/recipient eligibility; role recheck before dispatch; private finance excluded from Marketing | `communicationCore.ts`, `communications.ts`, delivery/provider |
| M9 Calendar       | Owner/Admin external controls; source preserved; disabled                                           | `calendarSync.ts`, `calendarProvider.ts`                       |

Owner-only audit/configuration boundaries must not be treated as general Admin equivalence. Existing local regression tests exercise source swaps, revoked/archive access and financial/operational boundaries, but fresh exhaustive M10A IDOR tests across all listed entities are outstanding. Normal clients have no table-level audit write API; deployment operators remain a separate privileged trust boundary. Application audits derive actors from server identity and use server time; internal maintenance uses explicit system/null actors. Audit storage is append-oriented, not cryptographically immutable or WORM.

## Public endpoints

| Surface                                                       | Purpose and protection                                                                                                                     |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend `/api/auth`                                          | Framework auth-action proxy, including cookies/refresh; public by necessity. CSRF/Origin and request-size review remains open              |
| Convex public auth functions                                  | Sign-in/reset/store/sign-out framework protocol; browser error masking is not the whole security boundary                                  |
| `/.well-known/openid-configuration`, `/.well-known/jwks.json` | Public issuer metadata and public verification keys; no private signing material                                                           |
| Convex OAuth `/api/auth/signin/*`, `/api/auth/callback/*`     | Only registered by framework when OAuth auth provider exists; none configured for current password flow                                    |
| `/m9/webhook` POST                                            | Raw-byte-bounded body, signature/timestamp, current/previous signing secret, event dedupe, shared processing budget; no CORS credentials   |
| `/m9/unsubscribe` GET/POST                                    | Opaque HMAC token, GET confirmation only, POST mutation, generic result, token/body bounds, no-referrer/no-store and dedicated rate budget |
| Frontend `/auth/confirm`                                      | Retired Supabase link fallback only; cannot create a session                                                                               |
| Frontend `/api/crm/search`                                    | Protected server data access, bounded search, private no-store; not a public CRM data feed                                                 |
| Local setup `127.0.0.1:58439`                                 | Deferred standalone Google setup helper only, not deployed; must not be a production endpoint                                              |

No public health or temporary fixture HTTP route was found. `admin.provisionAcceptance` is internal but still included in source and guarded by a flag; production exclusion/hard denial must be addressed before release. No arbitrary server URL fetch was found in the reviewed app paths: providers use fixed Resend, OpenAI and Google endpoints. Google remains disabled; source-authoritative conflict handling is retained.

## HTTP, rendering and limits

React renders notes, AI results, templates and search text as text; no `dangerouslySetInnerHTML` was found in the application scan. The one intentional unsubscribe HTML page is a fixed string and does not interpolate the token or user text. M9 email remains plain text. No general HTML ingestion/sanitizer is needed for current features.

Current CSP blocks framing, objects, arbitrary base tags and foreign form targets but is not a complete script/style allowlist. HSTS now requires explicit production/HTTPS readiness; no preload or subdomain assumption. A nonce CSP must be implemented and browser-tested with the actual Next.js/Convex needs. No wildcard credentialed CORS header is added by these changes. Cookie-based auth CSRF assurance remains a separate review item; token POST unsubscribe is a deliberately public preference capability rather than a session-authorized business write.

| Operation                    | Current distributed limit / remaining issue                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Credential/code verification | Framework `authRateLimits`, configured five failures/hour; reset initiation review pending                                          |
| Unsubscribe POST             | Convex row, 120/minute; 8 KiB body, bounded token                                                                                   |
| Webhook verification         | Convex row, 300/minute after bounded body/header validation; 64 KiB body, ten-second read deadline; perimeter flood control pending |
| M8 AI                        | Existing persisted user/global budgets, concurrency and request size limits; fresh flood matrix pending                             |
| M9 send                      | Existing user/category/recipient fatigue buckets, queue/lease, retry/circuit protections                                            |
| M7 rules                     | Bounded queues/scans and deterministic dedupe; production global execution guard review pending                                     |
| Search/reconciliation        | Bounded inputs/pages; general per-user expensive-query abuse budgets not yet established                                            |

Shared webhook budget protects processing, not network volume. A malicious burst can consume it; provider retries and monitoring/edge controls must be validated. A limit-store failure now produces generic 503 before protected public work. Internal read-only workflows do not share these ingress buckets.

## Storage, privacy and classification

No application `generateUploadUrl`, `storage.store`, `storage.getUrl` or `storage.delete` path was found. Current media/document references are metadata, not a general arbitrary upload pipeline. Do not add scanning infrastructure for an absent upload feature. Future private file delivery needs authorization, MIME/size restrictions, malware handling and signed access before activation; external URL references are not a guarantee of private blob storage.

| Class                             | Examples / handling                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| Public                            | Published brand and domain verification records; no private client identifiers                                |
| Internal                          | Inventory taxonomy, operational status, room/checklist data; role restrictions                                |
| Confidential business             | Negotiation, pricing governance, design/access notes, analytics; source-level authorization                   |
| Personal contact information      | Realtor/seller email, phone, address; minimized DTOs, restricted exports/provider disclosure                  |
| Financial operational             | Quotes, invoices, payments, audit trails; exact money values, reversals, no ordinary destructive deletion     |
| Sensitive authentication/security | Password hashes, sessions, reset codes, signing/provider credentials; server-only stores, no logs/AI payloads |

OpenAI context is selected through current source authorization; prompts/answers may still contain confidential business data and require an approved retention/provider policy. Resend receives only the frozen approved recipient/content and necessary correlation. Google receives nothing while disabled. No monitoring provider is configured or fed customer payloads. Logger utilities emit fixed event/safe code metadata rather than arbitrary errors; framework/platform log privacy still requires deployment review.

## Retention boundary

The supplied Section 78 is incomplete. No retention duration or destructive purge policy has been invented. CRM, projects, financial records, audits, AI threads/usage and Communications need an approved schedule, legal holds, deletion authority, provider/backup treatment and recoverability before enabling new retention jobs. Existing M8 retention behavior must be reviewed against that complete policy; it is not automatically evidence of a compliant company-wide retention model.
