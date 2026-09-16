# M10A — hardening and incident-response checkpoints

Status: **IN PROGRESS — EARLIER HARDENING GATES OPEN; NOT A RELEASE PASS**.

Started from `ea50abeb32eb1816097c783eb9b5de210feffc94`. The initial attachment contained Sections 1–78; the continuation now supplies Sections 79–130. The incident-response continuation has been completed locally with explicit readiness gaps. Earlier security, environment, retention and recovery requirements remain open. This report records implemented and verified work only; it does not assert M10A completion.

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

## Initial checkpoint verification

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

Other remaining work includes strict cross-environment provider/acceptance assertions, public auth enumeration and recovery throttling tests, cross-module fresh hosted IDOR matrices, full CSP/browser validation, retention policy completion/approval, secret rotation drills, backup/restore drill, operational monitoring, live incident readiness, migration/rollback evidence and performance measurements. These are unresolved requirements, not waivers. No deletion/retention job was introduced without an approved policy.

The existing Convex Auth beta and Next.js integration need explicit production risk review and supported MFA evaluation. Current framework source, exact pinned auth version and memory-storage patch were inspected; the patch is retained and must be reviewed on upgrades. Sources: [Convex Auth status](https://docs.convex.dev/auth/convex-auth), [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy), [Svix signature verification](https://docs.svix.com/receiving/verifying-payloads/how).

## Sections 79–130 — incident response continuation

Continued from `d8f26d3a5d155080e2528a8c7e6efcbdd21ad105`. Added [incident-response.md](incident-response.md), restricted-use empty incident/contact templates and seven accountable readiness follow-ups. The runbook covers declaration/severity/authority, append-oriented timelines, evidence privacy, existing safe-mode controls, every requested compromise/outage/integrity scenario, rollback/restore decisions, human notification decisions, re-enable criteria, closure and post-incident review. No public emergency endpoint or new application module was added.

**Local incident-response acceptance: PASSED WITH TRACKED READINESS GAPS. Overall M10A: NOT PASSED.** Five fictional technical drills exercised account archival, email pause/storm containment, M5/M6 drift, mocked Resend outage and AI disablement. The rollback tabletop compared the actual source SHAs and found no schema changes; it selected a held rollout/forward-fix strategy rather than removing security fixes. It did not deploy or restore anything. No real credentials were rotated or provider messages sent. See [machine evidence](M10A-incident-drills.json).

Current full local suite: **19 Node + 470 Convex = 489 passed**, zero failed; TypeScript and lint pass. Earlier production build and HTTP smoke remain historical evidence for unchanged runtime source; this continuation changes documentation, test fixtures/drills and ignore rules only. Production/browser/provider acceptance was not rerun. The original communications fixture was extracted for reuse; all 102 M9 tests still pass. Initial drill setup errors were corrected without relaxing the application's contact limits or authorization.

[IR-01 through IR-07](M10A-incident-followups.json) cover complete session/token/Owner recovery, global freeze coverage, attributable platform changes, actual responder/store/monitoring setup, backup/restore and deployment drills, hosted/provider acceptance, and inherited M10A gates. They have accountable roles and pre-M10B deadlines; real people are intentionally unassigned pending readiness review. No issue is waived. M9 Email remains historically passed and disabled; Calendar remains deferred and disabled. Production and M10B remain untouched.

Continuation final checks: formatting passed; 396 release candidates scanned with zero secret-pattern/private-file/known-private-value matches, including comparison against four privately held development provider credentials. Read-only development checks confirmed `M9_EMAIL_ENABLED=false` and `M9_CALENDAR_ENABLED=false`. No values were logged or changed.
