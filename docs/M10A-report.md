# M10A — production hardening checkpoints

Status: **IN PROGRESS — EARLIER HARDENING GATES OPEN; NOT A RELEASE PASS**.

## Current continuation — Sections 131–224AC

Implemented granular Owner-only emergency freezes, server-derived containment audits, supported session/refresh/recovery-code revocation, archived-account fresh-login denial, protected operational health and safe structured logging. Normal Realtor directory/search hydration now occurs after pagination. Clean-build testing also found and fixed an unconfigured `/unauthorized` page crash; the Turbopack project root is explicit.

Added recovery manifest/preflight validation, a reproducible isolated native Convex restore drill, backup/monitoring/supply-chain/migration/performance/retention/authentication procedures, and a machine-checked ownership/evidence model. The [canonical register](M10A-readiness-controls.json) maps all supplied sections, preserves IR-01–IR-07, references the original Calendar deferral, rejects unsupported or stale PASS, and generates [current counts](M10A-readiness-summary.json). Only individually evidenced local/historical controls are closed; **overall M10A is NOT PASSED and M10B entry is blocked**. Current evidence is [M10A-continuation-results.json](M10A-continuation-results.json), indexed by [the evidence register](M10A-evidence-register.json).

Verification:

- Full local suite: **19 Node + 498 Convex = 517 passed**, zero failed. The 14 readiness tests and 19 Node tests were rerun after final relevant changes. TypeScript, lint and formatting passed.
- Real isolated restore: **557 fictional rows across 99 schema tables**, one stored file, exact table/ID/history comparison, financial/Inventory projection comparison, role denial, all recovery freezes and rejection of a second nonempty import. Final measured import: **13,944 ms**. This is not production RTO. Populated M7–M9 recovery and actual protected backup scheduling/retention remain open.
- Clean dependency installation passed using lockfile-SHA-512-verified cache after TLS download failures. The unchanged lockfile was preserved; postinstall auth patch verification passed. Clean optimized build passed without environment credentials. Dependency audit: **zero advisories**, with upstream deprecation/support risks separately retained.
- Clean built-app HTTP: `/login` **200**, `/unauthorized` **200**, unauthenticated `/dashboard` **307**. Frame/nosniff/CSP headers present, no powered-by header and no premature HSTS. Missing-configuration sign-out crash corrected. This is HTTP smoke, not real-browser acceptance.
- Public bundles: **47 files each**, no source maps, no credential-pattern matches in the clean bundle and no known private/provider-value matches in either checked bundle. Source scans and their precise scope/counts are in the artifact; values were never logged.
- Performance: 501 fictional Realtors; page/search integrity and nine local operation baselines with ten measured samples each. These are in-process measurements, not mobile/network/provider SLA evidence. Larger multi-module scale and long-history acceptance remain open.
- Read-only development flags: **M9_EMAIL_ENABLED=false**, **M9_CALENDAR_ENABLED=false**. Email's historical accepted gate and **OWNER CONFIRMED INBOX RECEIPT** remain preserved. Calendar stays **DEFERRED**, non-blocking for M10A only while disabled. No new provider emails or Calendar operations occurred.

Code provenance: core runtime/recovery at `c3ebc082e799205adb0681bf2a8df334b5f5751f`; clean-build correction at `e74cf3d9c178118c5dc4c07cd616c6642935a53a`; final readiness guard at `2f5a554545ca4bf701c9d11e8b00f17b65c8ecd8`. Evidence declares relevant source paths so unrelated documentation does not invalidate a test, while security/dependency/configuration changes require re-verification.

No shared development runtime activation or production modification occurred. Convex codegen uploaded source for development analysis/binding generation; that was not a runtime deployment. Six runtime deployments across three source/target drill attempts were confined to loopback-only isolated databases. Temporary processes stopped. The original restore succeeded, the first reproducible repeat refused an existing export filename, and a fresh unique-file repeat passed; failed setup/build attempts are retained as resolved check failures, not counted as acceptance passes.

Remaining work is explicit: inherited auth/invitation/MFA/Owner recovery, hosted/browser security and runtime acceptance, strict CSP and environment assertions, actual operational monitoring/contacts/store, approved retention and provider policies, full migration tooling/rehearsal/rollback, bounded derived CRM/history queries and realistic hosted/mobile load. The M10A migration document is a preparation plan, **not a completed importer**. Local checks do not waive any of these P1 readiness requirements. Production authentication email/origin requirements remain **DEFERRED — REQUIRED BEFORE PRODUCTION**. No M10B or production work began.

## Historical checkpoints through Section 130

The following records preserve their original test scope and counts; current status is the canonical register above.

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
