# M10A final acceptance — not approved for go-live

> Current follow-up: see [production preparation](production-preparation.md) and [post-M10A review](post-M10A-review.md). Isolated production infrastructure is now authorized and its empty shell is configured OFF; production code deployment was rejected by automatic approval review. The evidence below describes the historical M10A execution and is not current-HEAD recertification. No go-live is authorized.

M10A PRODUCTION READINESS GATE PENDING EXTERNAL ACTION

Tested runtime source: `755e1c95d99e22a63f474194d63750ed66cf5fa0`. All Codex-completable checks in the documented scope are complete. Human/provider dependencies remain explicit; no production configuration or M10B is authorized.

549 local tests, 144 hosted scenarios, 140 unique desktop/mobile cases, 12 isolated auth browser cases and six real isolated migration scenarios passed. Final reconciliations have zero unexplained findings. Failed attempts and scope limitations remain in the evidence.

## Required final fields

1. **Final pushed SHA:** Tested runtime source 755e1c95d99e22a63f474194d63750ed66cf5fa0. Final documentation/evidence packaging SHA is returned after push; a commit cannot embed its own SHA.
2. **M10A decision:** M10A PRODUCTION READINESS GATE PENDING EXTERNAL ACTION
3. **Production mutation count:** 0
4. **Development deployment used:** woozy-jaguar-392, development, project glara-os.
5. **Local test results:** 549 passed (19 Node + 530 Convex), 0 failed; 31 Vitest files. TypeScript, ESLint and formatting passed.
6. **Hosted test results:** 144 hosted scenarios passed: 95 role/containment, eight extra record/assignment/OCC, 14 commercial, seven quantity and 20 native automation. Zero failed. Eight five-sample performance benchmarks also pass; not counted as 40 independent business cases.
7. **Desktop browser results:** 70 unique desktop cases passed, zero final failures. Failed attempts preserved; all 21 failures from the 138-case run passed on targeted rerun. Final smoke added one desktop double-submit case.
8. **Mobile browser results:** 70 unique mobile cases passed, zero final failures; Pixel 7 emulation on Edge/Chromium. Six additional isolated recovery cases passed per viewport; not physical-device UAT.
9. **Auth/session-revocation result:** Local, hosted and already-open desktop/mobile session revocation passed; archived/unassigned fresh sign-in denied. Restored roles do not resurrect old sessions.
10. **MFA result/status:** Application Owner/Admin MFA not implemented. GitHub, Convex, hosting, Resend, OpenAI and DNS operator MFA each UNVERIFIED.
11. **Safe Mode result:** Seven capability fences, in-flight/claimed dispatch checks, recovery freeze and Owner financial browser freeze/release pass. Human incident ownership remains external.
12. **Authorization/IDOR result:** 95 role/containment and eight direct nested-record/OCC/assignment checks pass, with desktop/mobile malformed IDs, stale assignment, current-role and private DTO tests.
13. **Security red-team result:** Hosted security/record cases 103 passed. Browser security/hardening 36 passed (included in 140). Local public/provider/incident negatives pass. No independent third-party penetration test claimed.
14. **Authentication/onboarding result:** Section 235 controlled operator provisioning plus supported recovery retained; no public signup. Fictional provisioned roles/login and revoked-user denial pass. Real first-access delivery and named operator verification remain pending external action.
15. **Account recovery result:** Eight local recovery cases and 12 actual isolated browser cases pass: expired/mismatched/reused code, valid reset, new login/redirect and logout across both viewports. Isolated code injection is not email delivery; production delivery/origin and independent Owner recovery remain pending.
16. **Owner recovery readiness:** Independent trusted Owner recovery channel/operator proofing UNVERIFIED; IR-01 and IR-04 open.
17. **Privileged-role security result:** Owner/Admin separation and platform role-change session destruction pass; application MFA and independent platform attribution remain open.
18. **Public endpoint security result:** Bounded HTTP body, malformed auth, same-origin/CSRF/CORS, missing/invalid webhook signatures, unsubscribe and direct backend authorization tests pass. Actual production ingress configuration remains external.
19. **CSRF assessment/result:** Exact-origin auth POST, hostile/null/cross-origin inputs and state-changing endpoint review pass in local/optimized browser scope. No production-origin proof inferred.
20. **XSS/sanitization result:** Stored CRM markup renders inert; parser-injected script/event handlers blocked. React output, bounded server-side AI/Communication context and fixed provider destinations reviewed; local provider/content contracts pass.
21. **CSP result:** Nonce, strict-dynamic and script-src-attr none tested in optimized browser run. No production unsafe-eval/inline-script exception. Inline styles allowed for Radix.
22. **Security-header result:** Nonce CSP, frame denial, no-store, nosniff, HTTP-only SameSite auth cookies and cache/prefetch boundaries pass. Actual production HTTPS/HSTS remains a separately authorized origin gate.
23. **CORS/origin validation result:** Exact auth origin and offline invalid-origin tests pass. Production domain/origin verification is an M10B prerequisite.
24. **Rate-limit/abuse result:** Durable direct-backend hourly bounds: 500 global, 50 sign-in/verification per identity, five recovery per identity. Existing limits were not raised for tests; fixture throttling was observed and rerun after natural expiry. Hosting ingress/independent abuse monitors require external configuration.
25. **Frontend secret/network inspection result:** Both final public bundles: 47 files, zero maps and private-value matches. Desktop/mobile role-specific response/cache/prefetch/storage checks pass. No active file download endpoint exists.
26. **Data-classification/privacy result:** DTO minimization, safe errors/logs and authenticated audit identity reviewed/tested. No new bulk export, destructive retention process or provider transmission. Actual retention/legal/provider-account approval remains pending.
27. **Retention-policy status:** Proposed matrix only. PENDING EXTERNAL ACTION: business/privacy/accounting approval.
28. **Provider-retention review status:** Official provider-document review preserved; account-specific retention, contract and setting verification pending. No ZDR/legal approval claimed.
29. **Incident-response result:** Five local fictional incident drills, emergency dispatch tests, 95 hosted role/containment checks and browser revocation/freeze pass. Named human recovery, monitoring, custody and platform MFA remain unverified.
30. **IR-01 through IR-07 final status:** IR-01 pending_external_action; IR-02 passed; IR-03 pending_external_action; IR-04 pending_external_action; IR-05 passed; IR-06 pending_external_action; IR-07 pending_external_action. Original requirements retained.
31. **Incident drill results:** Technical compromised-account, email-storm/unknown-delivery, AI-key containment and bad-release drift repair drills pass. Actual isolated restore, key rotation and migration recovery also pass; independent human/provider-account exercise remains external.
32. **Backup strategy result:** Source/file/config inventory and protected isolated backup/restore tools verified. Business RPO/RTO/retention approval, independent production store/schedule/custody and failure alert are still external.
33. **Isolated restore result:** 672 rows across 103 tables and one file restored; populated M7/M8/M9 included. Exact comparisons and containment pass. Import 25,324 ms; isolated loopback only.
34. **Restore reconciliation result:** Exact IDs/history/bytes, financial/Inventory views, role denial, frozen recovery and nonempty rejection pass. Compatible prior-code reads and forward restore preserve exact data. DPAPI encryption/ACL roundtrip and tamper rejection also pass.
35. **RPO/RTO readiness/status:** Proposed targets require approval; small isolated import time is not production RPO/RTO.
36. **Backup-monitoring status:** NOT VERIFIED: actual backup schedule/freshness/failure monitoring not configured or proven.
37. **Observability/health result:** Owner/Admin health and durable alerts implemented/tested. Backup/integrity dimensions explicitly unknown/not checked; independent outage monitoring pending.
38. **Alerting/dedupe result:** Stable-key dedupe, versioned acknowledgement and condition-driven resolution pass. Acknowledgement never clears an active fault.
39. **Monitoring ownership status:** PENDING EXTERNAL ACTION: named monitoring owner and independent alert route, with private contact evidence.
40. **Dependency audit:** 0 advisories: critical 0, high 0, moderate 0, low 0, info 0; point-in-time npm audit.
41. **Supply-chain review:** Pinned lockfile/patch, clean install/build and zero-advisory audit verified. Convex Auth beta/Next integration and transitive Lucia/Oslo support posture documented. Supported production auth/MFA choice remains a human/provider prerequisite, not a claimed waiver.
42. **GitHub Actions/CI security result:** Immutable pinned actions, read-only token, no deploy/secrets/privileged PR workflow reviewed. GitHub quality run 35168973337 on runtime candidate 755e1c95d99e22a63f474194d63750ed66cf5fa0 succeeded; authenticated actor daryan-kf. Main protection endpoint reported unprotected: external governance prerequisite.
43. **Clean-install result:** Clean npm ci --offline passed using verified cache; no environment files copied; auth patch verified.
44. **Production-build result:** Clean optimized Next.js build passed. Build artifact does not mean production deployment.
45. **Browser-bundle secret scan:** 47 public files in each final workspace/clean build; zero source maps, credential-pattern or known private-value matches.
46. **Source/Git secret scan:** 462 tracked/nonignored release files and 1,465 reachable local Git objects / 884 blobs scanned; zero private paths, credential patterns or known local/test/provider secret values found. Unfetched/unreachable objects excluded; values never logged.
47. **Migration tooling result:** Internal localhost-only migration adapter implemented with explicit opt-in, current Owner identity, native validation/audit and versioned fictional command format; production import is prohibited.
48. **Migration dry-run result:** Atomic dry-run validates all requested native commands then rolls back the full transaction. Whole authoritative snapshot equality verified; invalid parent/money/date/role input rejected without partial writes.
49. **Migration rehearsal result:** Six real isolated scenarios passed against 13 fictional commands: dry-run, invalid-input rollback, checkpoint/resume, exact replay, changed-source conflict and reconciliation. Ten local/security cases also pass.
50. **Migration idempotency result:** Stable IDs, package fingerprint and per-record payload hashes enforce idempotency. Replays preserve completed_at/checkpoint evidence exactly; source changes conflict.
51. **Migration reconciliation result:** 13 committed migration records reconciled with CRM/project/catalog/customer and invoice/payment relationships/balances. Native commands generate current audits/projections; arbitrary historical/real-source mapping not claimed.
52. **Migration rollback/forward-fix readiness:** Transactional dry-run/error rollback, durable checkpoint resume, immutable replay, and compatible-code restore/forward drill passed in isolated environment. Real irreversible effects require separate reconciliation/authorization.
53. **Performance dataset/scenario summary:** 501-Realtor local baseline plus 1000-activity history, 206-reference pagination and 1000-product/3000-asset/1000-ledger tests. Native hosted fixtures and eight query distributions complement local scale.
54. **Performance baseline/result:** Local distributions recorded; eight hosted queries x five samples passed p95 <5s and <1MB, observed max p95 424ms/max payload 18,132 bytes. Development network results are not a production SLA.
55. **Hosted concurrency result:** Native M4 overreservation, M5 numbering/payment/credit/extension, M7 duplicate execution and CRM same-version races pass; one-winner/OCC and replay semantics preserved.
56. **Queue/backpressure result:** Local queue/circuit/unknown-delivery/claimed-dispatch containment and 20 hosted native automation cases pass. No live provider outage induced; original real-email acceptance retained and Calendar disabled.
57. **M1 regression:** M1 local plus full desktop/mobile creation, brokerage selection, activities, follow-up, filtering/search and archive workflows pass; direct assignment/Marketing/stale-session boundaries pass.
58. **M2 regression:** M2 local plus desktop/mobile property→opportunity→consultation→exact quote→won workflow and restricted-role denials pass.
59. **M3 regression:** M3 local plus desktop/mobile won handoff, rooms, checklist, scheduling, crew and private-field boundaries pass.
60. **M4 regression:** M4 local, seven hosted quantity cases, desktop/mobile catalog/reservation/pick/install/return/repair/transfer workflows pass; reference paging past 100 corrected.
61. **M5 regression:** M5 local, 14 hosted concurrency/integrity cases and desktop/mobile agreement/deposit/payment/credit/damage-review workflows pass; final all-page financial checks clean.
62. **M6 regression:** M6 local and desktop/mobile executive/role dashboards pass; final independent authoritative-source and bucket rebuild clean.
63. **M7 regression:** M7 local, 20 native hosted cases, desktop/mobile actions/notifications and final all-page execution/task/link reconciliation pass. Three previously repaired duplicate history rows preserved.
64. **M8 regression:** M8 local and desktop/mobile deterministic navigation/role-aware disabled-provider controls pass. Accepted live development evidence preserved; no new provider calls or production enablement.
65. **M9 regression:** M9 local provider/security contracts, desktop/mobile disabled communication controls and four final all-page reconciliation queries pass. Historical Email PASS preserved; Calendar live gate remains deferred.
66. **Final M4 Inventory reconciliation:** 584 quantity bucket entries, 468 movement entries, 254 reservations and 87 serialized counters checked; zero unexplained drift/parent/overlap findings.
67. **Final M5 financial integrity:** 104 payment entries and 132 invoice entries checked across all pages for signed allocations, parent linkage, overpayment/credit/void integrity; zero findings. This is system consistency, not independent accounting certification.
68. **Final M6 reconciliation:** Independent final rebuild complete: 4768 sources, source drift 0, bucket drift 0.
69. **Final M7 reconciliation:** 248 automation entries checked across 13 pages; zero unexplained duplicate-family/link/parent findings. Three previously repaired historical duplicates explicitly retained.
70. **Final M9 Communication reconciliation:** All pages: six Communications, five outbox jobs, nine events, four provider mappings; zero findings. No replacement emails sent.
71. **Calendar deferred-state verification:** M9 CALENDAR GATE DEFERRED — EXTERNAL OAUTH CONFIGURATION REQUIRED BEFORE ENABLEMENT. M9_CALENDAR_ENABLED=false.
72. **Email disabled-state verification:** M9 EMAIL GATE PASSED in accepted development scope. M9_EMAIL_ENABLED=false; no resend.
73. **AI production-disabled/restricted-state verification:** Explicit production approval fence tested; production AI not authorized/configured/inspected. M8 development evidence preserved.
74. **Automation production-boundary verification:** Production approval fence tested; no broad activation. M10B must approve initial rules.
75. **Acceptance-helper cleanup result:** Isolated helper code and identities remain private/ignored. No temporary privileged helper deployed; existing internal account helper remains development opt-in and production-denied. Fixture identities/history are fictional; no credential is published.
76. **Final development safe-state result:** Read-only final check: all emergency controls normal, crew role restored, zero enabled automation rules, M9 Email/Calendar false, acceptance/auth-email/production approval flags false. Backup monitor truthfully unknown.
77. **Production untouched verification:** Production mutations 0; all eleven production boundary categories NO.
78. **Readiness-control register reconciliation:** 43 controls; valid=true, pass=false, M10B entry=false. 22 passed, one justified not-applicable upload control, 20 open. All 503 frozen section identifiers mapped.
79. **Evidence-register reconciliation:** 93 evidence records; historical records retained and new scoped evidence bound to the tested runtime SHA. No human approval fabricated.
80. **Readiness evidence freshness result:** 28 historical records stale; none used for current closure. Current source-sensitive references validate. New security/schema/dependency/config changes require affected retests.
81. **Controls passed:** 22
82. **Controls open:** 20
83. **Controls failed:** 0
84. **Controls pending external action:** 19
85. **Controls deferred:** 1
86. **Remaining M10A blockers:** 13 unresolved external M10A controls; zero internal Codex-completable P0/P1
87. **Remaining M10B blockers:** 19, including conditional Calendar activation gate
88. **Controls lacking assigned human owner:** 43; accountable roles recorded, actual named human assignments not invented
89. **Controls lacking sufficient evidence:** 19
90. **Deferred integration status:** Calendar intentionally deferred; non-blocking only while disabled; original gate mandatory before enablement.
91. **P0 defect count:** 0 known unresolved P0 defects in executed scope.
92. **P1 defect count:** 0 unresolved internal M10A P1 defects; 19 external P1 readiness controls remain unclosed, not waived.
93. **P2/known limitation summary:** Mobile emulation rather than physical UAT; Radix inline-style CSP exception; aborted-navigation server diagnostics; large reference lists need future searchable UX. Auth/provider support decision remains an external gate.
94. **Defects discovered during M10A:** Earlier assignment/session/CSP/auth-transport gaps, direct-backend auth/recovery abuse gaps, full-history scans, first-100 reference truncation, brokerage label encoding and migration completion-time replay mutation.
95. **Defects fixed during M10A:** Current-profile authorization, session destruction, bounded auth/role eligibility, nonce/body/origin guards, indexed CRM history, complete bounded inventory reference pages, brokerage label and immutable migration checkpoint replay fixed and tested.
96. **Risks explicitly accepted, if any:** None; no P0/P1 waiver or documentation-only approval.
97. **External actions still required:** Exact actions, accountable roles, environment/location, missing evidence and follow-up are listed for every external control in M10A-external-actions.md; no generic configuration claim.
98. **Release-candidate manifest status:** Manifest identifies runtime source 755e1c95d99e22a63f474194d63750ed66cf5fa0, lockfile and final clean build. promotable=false; final documentation commit is returned after push.
99. **M10B handoff status:** M10B handoff prepared; entry blocked on external gate closure, actual named human ownership and independent review. No go-live authorization.
100. **Final rollout boundary:** STOP: no M10B, production/DNS/providers/traffic, real data/staff/customer communication or deferred Calendar setup.

## Canonical blocker table

Original control requirements and blocker flags are retained. These are external acceptance dependencies, not waived production requirements. Named people remain unassigned. See [exact external actions](M10A-external-actions.md).

| Control               | Status                  | M10A blocker | M10B blocker | Accountable role                | Required completion evidence                                                                                                                                                          |
| --------------------- | ----------------------- | ------------ | ------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AUTH-INVITATION       | pending_external_action | true         | true         | Security / Technical Lead       | Redacted provisioning/delivery receipt, expiry/reuse/mismatch results and named operator review.                                                                                      |
| AUTH-RECOVERY         | pending_external_action | true         | true         | Security / Technical Lead       | Actual reset receipt, expiry/reuse/mismatch, old-session rejection and HTTPS redirect/cookie results.                                                                                 |
| AUTH-MFA              | pending_external_action | false        | true         | Security / Technical Lead       | Supported architecture decision, enrollment/recovery evidence for Owner/Admin and GitHub/Convex/hosting/email/AI/DNS operators; Codex will implement/retest the approved integration. |
| ABUSE                 | pending_external_action | true         | true         | Security / Technical Lead       | Redacted rule configuration and controlled deny/alert/recovery evidence; Codex will rerun the endpoint matrix.                                                                        |
| PRIVACY-POLICY        | pending_external_action | false        | true         | Security / Technical Lead       | Dated approval and account-specific review references without private contracts or customer data in Git.                                                                              |
| INCIDENT-RUNBOOK      | pending_external_action | true         | true         | Security / Technical Lead       | Restricted drill timeline, human acknowledgements, store access proof and review; Codex will reconcile IR-01/03/04/06/07.                                                             |
| BACKUP-DESIGN         | pending_external_action | true         | true         | Security / Technical Lead       | Dated policy approval and named accountable owners; Codex will verify the configuration plan against it.                                                                              |
| BACKUP-OPERATIONS     | pending_external_action | true         | true         | Security / Technical Lead       | Store encryption/ACL/retention evidence, successful scheduled backup, controlled failure alert and independent restore receipt.                                                       |
| OBSERVABILITY-LIVE    | pending_external_action | false        | true         | Security / Technical Lead       | Redacted monitor config and received alert/recovery acknowledgements; Codex will validate correlation and dedupe.                                                                     |
| RELEASE-GOVERNANCE    | pending_external_action | true         | true         | Security / Technical Lead       | GitHub protection/check configuration and named reviewer/operator MFA evidence; Codex will re-query controls and link final CI.                                                       |
| SUPPLY-ACCEPTANCE     | pending_external_action | true         | true         | Security / Technical Lead       | Supported auth/provider decision and governance evidence; Codex will apply any approved migration and rerun affected tests.                                                           |
| PLATFORM-ATTRIBUTION  | pending_external_action | true         | true         | Security / Technical Lead       | Restricted platform audit and operator/MFA/recovery evidence; Codex will check coverage without publishing identities/secrets.                                                        |
| CONTACTS-STORE        | pending_external_action | false        | true         | Security / Technical Lead       | Human acknowledgements and redacted ACL/hold evidence; keep contact details outside Git.                                                                                              |
| IR-01                 | pending_external_action | true         | true         | Security/Technical Lead         | Restricted recovery timeline, actor approval and restored authorized access; Codex will rerun relevant revocation gates.                                                              |
| IR-03                 | pending_external_action | true         | true         | Security/Technical Lead         | Verified operator/audit/incident references with independent acknowledgement.                                                                                                         |
| IR-04                 | pending_external_action | false        | true         | Business Owner / Security Owner | Private contact acknowledgements, store ACLs and received controlled alerts.                                                                                                          |
| IR-06                 | pending_external_action | true         | true         | Security/Technical Lead         | Redacted old-key rejection/new-key success, dependent-function recovery and independent custody receipt; Codex will execute/reconcile the approved drill.                             |
| IR-07                 | pending_external_action | true         | true         | Security/Technical Lead         | Linked final approvals and acceptance artifacts; no inherited requirement waived.                                                                                                     |
| M9-CALENDAR           | deferred                | false        | false        | Security / Technical Lead       | Original M9 Calendar live gate before activation; remain disabled.                                                                                                                    |
| PRODUCTION-AUTH-EMAIL | pending_external_action | false        | true         | Security / Technical Lead       | Real designated-recipient confirmation and provider/browser redirect/recovery evidence; Codex will test only the separately authorized recipients.                                    |

## Evidence and boundary

Canonical machine evidence: M10A-final-results.json, M10A-final-acceptance.json, M10A-readiness-controls.json, M10A-evidence-register.json and M10A-readiness-summary.json. Readiness schema/coverage validation passes; the require-pass command intentionally exits 1 because external obligations remain unresolved. Historical evidence is preserved and stale records do not close current controls.

M9 EMAIL GATE PASSED — OWNER CONFIRMED INBOX RECEIPT retained. M9_EMAIL_ENABLED=false; no resend.

M9 CALENDAR GATE DEFERRED — EXTERNAL OAUTH CONFIGURATION REQUIRED BEFORE ENABLEMENT. M9_CALENDAR_ENABLED=false; original gate mandatory before enablement; non-blocking only while disabled.

Production mutations: **0**. No real customer import, staff UAT, real staff/customer communication, provider activation or M10B. No risk acceptance or P0/P1 waiver.
