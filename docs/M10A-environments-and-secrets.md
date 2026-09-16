# M10A future environments and secret ownership

Preparation only. No production deployment, database, identity, DNS or provider resource is created by this specification. Actual production hostnames/deployment IDs are **UNASSIGNED — require separate M10B authorization**. Do not fill these from a browser Host header or copy the development environment.

## Environment contract

| Boundary                | Development                                                       | Future production requirement                                                                                          |
| ----------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Convex                  | Existing `woozy-jaguar-392`, project `glara-os`                   | Separate production deployment, separately scoped deploy identity; exact URL recorded only after authorized creation   |
| Frontend                | Local/approved development frontend                               | Separate Vercel production project/environment; approved release artifact and identity                                 |
| App/auth origin         | Explicit server `SITE_URL`; loopback only in development          | Owner-approved HTTPS origin, no credentials/path/query; redirects only to approved paths                               |
| Backend HTTP/issuer     | Deployment-managed `CONVEX_SITE_URL`; regional URL                | Exact production HTTP origin/issuer matched to frontend backend URL and JWT audience                                   |
| Email webhook           | Development `/m9/webhook`                                         | Production origin + distinct provider webhook/secret; disabled send flag until separate authorization                  |
| Unsubscribe             | Explicit `M9_PUBLIC_HTTP_ORIGIN`                                  | Production HTTPS origin; cannot use development token secret or generated URLs                                         |
| Google callback         | Deferred local setup helper                                       | No production callback/activation authorized; original Calendar Gate remains mandatory                                 |
| Environment designation | Proposed server-only `GLARA_ENVIRONMENT=development`              | `production`; exact deployment/origin assertions must be enforced/tested before rollout, not trusted from client input |
| HTTPS readiness         | `GLARA_HTTPS_READY=false`                                         | Set true only after approved HTTPS hostname verification; enables HSTS without preload/subdomains                      |
| Data/rate buckets       | Fictional acceptance only, with protected local identity material | Clean separate tables, counters, sessions and settings; no wholesale development import                                |

The new origin helper validates auth origins, not the entire deployment identity. Cross-deployment provider, automation and acceptance-helper assertions remain unfinished; a single environment label is not sufficient proof of isolation. This is explicitly an open M10A requirement.

Safe initial production policy: Calendar false; Email false; AI disabled/restricted in both settings and provider gate; automation rules off and high-risk execution disabled; acceptance helpers unavailable. No autonomous external communication capability is authorized. All safe flags must be independently checked in a future production preflight; this document does not claim production values have been inspected.

## Release, seed and migration boundary

Only signed-in authorized deployment operators may publish a reviewed commit after local, hosted development, security, backup/restore and readiness gates. Use least-privileged environment-specific Convex/Vercel deploy identities, protected branch/review and operator MFA. Secrets are injected by approved server environment/secret systems; preview PRs must not inherit production secrets.

A future clean bootstrap may contain only approved system taxonomy/settings and explicitly approved owner identity. Never import development users/sessions, credentials, Realtor/customer records, property/project fixtures, inventory/payment/invoice fixtures, analytics fixtures, AI threads/usage, automation actions/acceptance rules, Communications, test consent/suppressions, unsubscribe links, provider mappings or test webhook events. No migration command or production seed runs automatically in this checkpoint.

M10B must record source/target IDs, change window, exact approved record set, backup checkpoint, validation, rollback owner and go/no-go. Rollback must preserve business/audit facts and not replay emails, payments or provider requests. An isolated restore drill and measured recovery objectives are still pending; no untested restore procedure is represented as passed.

## Secret inventory (names and purpose only)

All application/provider secrets require distinct development and future-production values. **Cross-environment reuse is forbidden.** Presence in this list does not mean configured. Deployment operators own assignment/rotation; domain/account owners approve provider/account use.

| Name/category                                               | Purpose/storage                                                   | Classification / rotation                                                                                                    |
| ----------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Convex operator credentials / `CONVEX_DEPLOY_KEY`           | Deployment control; protected CLI/CI secret store, never frontend | Provider-managed identity; environment-scoped, shared forbidden; revoke on personnel/access change                           |
| `JWT_PRIVATE_KEY`                                           | Auth signing; Convex server environment                           | Development/future-production separate; rotation-required; coordinate JWKS/session policy                                    |
| `JWKS`                                                      | Public verification key set                                       | Public cryptographic metadata, not private secret; provider/auth-managed and environment-specific                            |
| `AUTH_RESEND_KEY`                                           | Password recovery/onboarding email                                | Separate server provider key; environment-scoped, shared forbidden, rotation-required                                        |
| `OPENAI_API_KEY`                                            | AI provider                                                       | Separate server project/key, shared forbidden, rotation-required; budget-limited                                             |
| `M9_RESEND_KEY`                                             | M9 transactional/optional email                                   | Separate server provider key, shared forbidden, rotation-required                                                            |
| `M9_RESEND_WEBHOOK_SECRET`, `_PREVIOUS`                     | Current/overlap webhook signature verification                    | Server-only, separate per environment/webhook; rotation-required; bounded overlap                                            |
| `M9_UNSUBSCRIBE_SECRET`                                     | HMAC capability tokens                                            | Server-only, separate per environment; rotation-required with token invalidation plan                                        |
| `M9_GOOGLE_CLIENT_SECRET`, `M9_GOOGLE_REFRESH_TOKEN`        | Deferred Calendar authorization                                   | Not configured; future environment-specific, shared forbidden, rotation-required; never activate during M10A                 |
| `M9_GOOGLE_CLIENT_ID`, `M9_GOOGLE_CALENDAR_ID`              | Deferred client/destination identifiers                           | Configuration, not bearer secrets; server-owned and environment-specific                                                     |
| `GLARA_ACCEPTANCE_PASSWORDS`                                | Disposable fictional acceptance credentials                       | Development only; forbidden in production; remove/revoke after acceptance windows                                            |
| Vercel/deployment operator token (name not yet selected)    | Future frontend deployment                                        | Provider-managed; least privilege, MFA, separate environment access                                                          |
| Monitoring credentials (provider not selected)              | Future telemetry ingestion/admin                                  | Not configured; no invented secret name; server-side scopes and rotation required if introduced                              |
| Auth password hashes, sessions, refresh/verification tokens | Framework-owned auth tables                                       | Sensitive runtime data; never export to logs, browser bundles, AI context or release fixtures; revoke per security lifecycle |

Public frontend configuration is limited to the intended Convex public URL/site URL. `NEXT_PUBLIC_*` must never contain any item carrying authentication authority. Other server configuration includes SITE_URL, model and approval flags, sender/reply-to, test allowlist and exact HTTP origins; these are not interchangeable with secrets and may still contain private account metadata.

## Rotation runbook — preparation, not an executed drill

Before rotation: confirm exact environment, owner, provider, maintenance risk and rollback path. Freeze relevant dispatch first; preserve audit evidence; never dump values into commands/logs/chat. Install replacements through the server secret store, then validate using a fictional development account/recipient in a separately authorized window. Record IDs/timestamps/status only.

- **Auth signing:** review the pinned Convex Auth/JWKS behavior, issue replacement keys using supported tooling, coordinate verification overlap or forced sign-out, revoke sessions where necessary, test refresh/sign-in before removing old material. Current app lacks a completed signing-key rotation drill; do not improvise custom cryptography.
- **Resend API:** disable sends, create least-privileged replacement in the correct provider account/environment, store privately, validate controlled delivery, revoke old key, restore only an explicitly authorized send state. Authentication and M9 email are separate consumers.
- **Webhook signing:** keep old value in `_PREVIOUS` only for a documented overlap while installing the provider-issued current secret. Validate actual signature/replay behavior and provider retries, then remove old material. Never publish signatures or fabricate a live PASS.
- **Unsubscribe HMAC:** inspect the existing token generation/revocation workflow; revoke outstanding capabilities and invalidate pending optional approvals before switching. Already-sent links can stop working, so plan alternative preference handling before rotation. Preserve preferences/suppressions and audit; no blind resend.
- **OpenAI:** disable/restrict AI, install environment-specific replacement, validate fixed endpoint and budget behavior with approved fictional context, revoke old key. Do not log prompts/credentials in diagnostics.
- **Google (deferred):** keep Calendar disabled, rotate/revoke through the authorized owner/provider flow only when reactivation is scheduled. Obtain fresh consent securely; verify dedicated destination and original Calendar Gate before enablement.

Emergency compromise overrides availability: disable relevant capability, revoke exposed material, invalidate sessions/tokens as warranted, assess affected access and preserve evidence. Backup secret stores separately under restricted access; application data snapshots do not replace secret recovery procedures.
