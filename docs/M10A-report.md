# M10A — initial hardening checkpoint

Status: **IN PROGRESS — SPECIFICATION INCOMPLETE; NOT A RELEASE PASS**.

Started from `ea50abeb32eb1816097c783eb9b5de210feffc94`. The supplied attachment contains Sections 1–77 and stops partway through Section 78 after “Communications.” Remaining sections and final acceptance/deliverable criteria have been requested. This report records implemented and verified work only; it does not assert M10A completion.

M0–M8 architecture is retained. M9 Email Gate remains passed with development sending disabled. M9 Calendar remains **DEFERRED — EXTERNAL OAUTH CONFIGURATION REQUIRED BEFORE ENABLEMENT**, non-blocking for M10A only while disabled. The deferred-integration register is unchanged and remains mandatory for M10B. No production creation, deployment, provider enablement, DNS change, migration, customer communication or M10B work occurred. No development deployment or external provider send was performed in this checkpoint.

## Implemented corrections

Four local HTTP regression cases reproduced resource-control gaps before changes:

| Finding                                                  | Prior result                                               | Correction                                                                            |
| -------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Webhook measured characters after fully reading the body | An 80 KB UTF-8 body reached signature handling             | Streaming byte limit of 65,536 bytes, cancellation and ten-second total read deadline |
| Malformed Content-Length accepted into processing        | No consistent safe response headers                        | Reject malformed sizes; common no-store/no-referrer/nosniff/frame-protection headers  |
| Webhook verification had no shared processing budget     | Signature-shaped traffic bypassed an exhausted test budget | Separate Convex transactional webhook budget: 300/minute, HTTP 429 with Retry-After   |
| Unsubscribe ignored arbitrarily large POST bodies        | 8,193-byte body processed successfully                     | Read-bound 8,192-byte POST; bound token length; retain generic preference response    |

These are abuse-resistance gaps; no external incident is asserted. Raw signed UTF-8 content is preserved before Svix verification. Invalid signature header sizes are rejected cheaply. The existing unsubscribe budget remains independent at 120/minute. Database/mutation errors fail closed with generic 503; rate exhaustion is not an accepted delivery response. Global quotas may temporarily delay legitimate requests under attack; an infrastructure ingress/WAF layer remains required before production, rather than claiming application limits eliminate volumetric abuse.

Authentication origin parsing now rejects credentials, non-root origins and non-HTTPS remote origins; development loopback is the only HTTP exception, and is rejected for an explicitly designated production environment. Redirects remain constrained to the configured origin and existing allowed routes. Recovery requests use a 15-second provider timeout. No password/hash/session cryptography was replaced.

HSTS is emitted only when server configuration declares `GLARA_ENVIRONMENT=production` **and** `GLARA_HTTPS_READY=true`. No preload or automatic includeSubDomains. Existing CSP frame/object/base/form restrictions remain; a nonce-based script/style CSP is still unfinished and is not represented as solved by this change.

## Verification

- Initial HTTP reproductions: **4 failed**, then fixed; failure summary retained in `M10A-results.json` without private request data.
- New hardening suite: **14 passed**, covering byte/stream/deadline behavior, malformed UTF-8, rate isolation, non-mutating preference GET, no token reflection, redirect/origin validation and HSTS policy. An authentic fictional Unicode webhook traverses the HTTP handler successfully; its replay creates no duplicate delivery event and altered content is rejected. The reader preserves a byte-order mark rather than silently changing signed text.
- Existing M9 tests: **102 passed**.
- Full local suite: **19 Node + 465 Convex = 484 passed**, zero failed.
- TypeScript, ESLint, production build and repository formatting: passed.
- Secret scans: 389 tracked/non-ignored release candidates; zero credential-pattern matches, private environment files, known local credential matches or matches against four privately read development provider credentials. Values were never logged. This is not a full history or browser-bundle scan.
- Local built-app HTTP smoke: `/login` returned 200; unauthenticated `/dashboard` returned 307 to `/login`. Both had expected frame/nosniff/CSP headers, no powered-by header and no premature HSTS. The temporary smoke server was stopped. This is not browser acceptance; browser/computer-control initialization was unavailable.
- Read-only development configuration check: `M9_EMAIL_ENABLED=false`, `M9_CALENDAR_ENABLED=false`. No configuration was changed.
- These are local results. Hosted regression, provider acceptance and production-header/origin verification have not been run for these changes. Prior accepted evidence retains its historical scope, not an implied redeployment result.

## Readiness review and blockers

See [M10A-security-inventory.md](M10A-security-inventory.md) for authentication, authorization, endpoints, rate limits, data/logging and storage inventory; [M10A-environments-and-secrets.md](M10A-environments-and-secrets.md) for future environments, secret ownership and rotation.

Current onboarding is internal operator provisioning plus password recovery; it is **not** the role-bound expiring invitation lifecycle required by Sections 17–23. No invitation/recovery matrix has been declared passed. Privileged application MFA is not implemented and remains a production blocker until a supported design is selected, implemented and tested. Owner/operator MFA is also required.

Other remaining work includes strict cross-environment provider/acceptance assertions, public auth enumeration and recovery throttling tests, cross-module fresh hosted IDOR matrices, full CSP/browser validation, retention policy completion/approval, secret rotation drills, backup/restore drill, observability/incident procedures, migration/rollback evidence, performance measurements and remaining specification sections. These are unresolved requirements, not waivers. No deletion/retention job was introduced while Section 78 is incomplete.

The existing Convex Auth beta and Next.js integration need explicit production risk review and supported MFA evaluation. Current framework source, exact pinned auth version and memory-storage patch were inspected; the patch is retained and must be reviewed on upgrades. Sources: [Convex Auth status](https://docs.convex.dev/auth/convex-auth), [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy), [Svix signature verification](https://docs.svix.com/receiving/verifying-payloads/how).
