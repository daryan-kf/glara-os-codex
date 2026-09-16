# M9 — Communications & External Integrations

## Release decision

**M9 DEVELOPMENT GATE PENDING EXTERNAL ACTION**.

Latest live email acceptance: [M9-email-acceptance.json](M9-email-acceptance.json). **M9 EMAIL GATE PASSED**. DNS/provider verification, live sends, authentic webhooks, unsubscribe, bounce/complaint and reconciliation passed; receipt is now **OWNER CONFIRMED INBOX RECEIPT**. Overall M9 remains pending Calendar and final acceptance.

Latest email setup evidence: [M9-email-readiness.json](M9-email-readiness.json). The email-only development setup described at the end of this report supersedes earlier deployment/configuration stop snapshots. Earlier test counts retain their original scope.

Historical implementation snapshot (later email evidence below supersedes its email-only pending items): the complete specification through section 345 has been received. That revision added the local hardening required by sections 165–345. The local implementation is ready for the authorized hosted acceptance stage; live-provider, full M9 browser, fresh hosted regression and numerical reconciliation gates remain unexecuted. Their results are not inferred from local tests. M10 has not started.

Base: accepted M8 commit `bf785213e246be266aed367737742d5d6438f835`. Changes target `daryan-kf/glara-os-codex`.

## Implemented

- Communications workspace, responsive review screen, purpose selection, source-backed recipients, drafts, immutable versioned templates, consent evidence, preferences, settings, status filtering, and indexed subject search.
- Human approval bound to the exact reviewed recipient, rendered content, signature, source revision and eligibility evidence. A change between review and approval rejects the request. Dispatch repeats authorization and eligibility checks.
- Separate optional sales/marketing and transactional eligibility. Conservative optional-message policy requires evidenced express consent; transactional service/requested-contact evidence is evaluated independently. No inference of express consent from CRM activity.
- Consent history, scoped unsubscribe, address-level suppression, reasoned revocation, immutable approval/dispatch decisions, audit actors from server identity, and source authorization on historical reads.
- Atomic outbox claims, stable send identity, immutable retry payload, bounded retry for known rate-limit rejection, per-user/recipient/category daily limits, recent-contact guard, fenced pre-dispatch lease recovery and unknown-outcome reconciliation.
- Resend adapter with credential isolation, provider-supported Svix signature/timestamp verification, signing-secret rotation, duplicate/out-of-order event handling, early-event correlation, hard-bounce suppression of all messages, complaint suppression of optional messages, and narrow public unsubscribe endpoint.
- Google Calendar adapter with dedicated development-calendar configuration, stable event identity, minimal private projections, no attendees/invitations, etag concurrency, explicit sync/reconciliation and conflicts that never overwrite M3 schedules.
- M7 activity and M8 Realtor draft handoffs create drafts only. AI permission/freshness is rechecked on import. Sending does not automatically complete M7 tasks. A hard-bounce callback reopens a linked completed activity through the existing instrumented mutation layer.
- Communication history on Realtor, Quote, Project and Invoice views, with role and deployment compatibility checks.

## Architecture and security

`convex/communicationSchema.ts` defines communications, stable templates, immutable template versions, preferences, consents, eligibility decisions, suppressions, hashed unsubscribe tokens, outbox jobs, provider mappings, append-only delivery events, settings, and rate-limit counters. `convex/calendarSchema.ts` defines calendar connections, projections, sync events and conflicts. Financial facts retain M5 integer-cent strings.

`communicationCore.ts` centralizes source/recipient authorization and eligibility. Owner/Admin can operate commercial and project communication. Sales is restricted to assigned relationships/opportunities. Marketing is restricted to consent-backed marketing-purpose Realtor messages and receives no private Sales/Invoice context. Designer and Staging Crew external communication is disabled in this version. Disabled/archived profiles cannot call protected functions; stored approval actors are rechecked by workers.

`communications.ts` exposes validated queries and human mutations. `communicationDelivery.ts` owns internal claims, provider evidence, reconciliation and unsubscribe writes. `communicationProvider.ts` contains Node actions; `communicationHttp.ts` exposes only verified provider events and opaque recipient unsubscribe. Provider credentials and OAuth refresh tokens stay in Convex environment variables.

Indexes cover requester, source, recipient, status, send key, due jobs, provider message IDs, event IDs, consent/preference scopes, template versions and calendar mappings. Subject search includes permission filters. Date/category filters are bounded post-page filters; an empty filtered page can still have more results. Source pickers show bounded recent records and label that limit.

The reviewed snapshot and dispatch lease define the concurrency boundary. Database transactions cannot atomically encompass an external HTTP request. A timeout or lease that expires after the committed dispatch fence becomes `delivery_unknown`; it never triggers blind resend. A lease that never crossed that fence can safely return to ready. An old worker cannot dispatch after a new claim because the claim version is checked atomically. Resend idempotency lasts 24 hours, so it is an additional guard, not an indefinite exactly-once guarantee. Known 429 rejection may retry at most three attempts with backoff. An operator may reconcile an unknown send by supplying a provider ID and reason; Glara retrieves the provider record and checks the server-generated SHA-256 send-key correlation tag, exact recipient/content/sender and dispatch-time proximity. A matching arbitrary provider ID or matching text alone is insufficient. It never accepts a client assertion that a message was sent.

Unsubscribe tokens are opaque HMAC values, with hashes stored in the token table. The finalized email payload necessarily contains its unsubscribe URL and is restricted to authorized operator access. Tokens expire after a year and can be revoked individually or by an audited generation increment. Generation revocation preserves existing preferences and invalidates pending optional approvals. Rotate the private HMAC secret as a separate deployment operation after revoking a compromised generation. The public endpoint is enumeration-safe, requires a POST confirmation, applies a global 120-per-minute mutation limit, and excludes optional-message preferences from essential transactional eligibility. Invalid tokens cannot create preference records. Production edge rate limiting remains part of the production security review.

Calendar polling is explicit via Sync/check; no calendar webhook or attendee import is enabled. External edits, missing events and unexpected attendees stop updates for review. Keep Glara/Ignore changes only the projection. Consultations currently have a source start time only; their calendar projection uses a documented 60-minute duration. M3 events retain their authoritative start/end. Date-only payloads remain date-only, and timed payloads use `America/Vancouver`.

## Storage, retention and intentional scope

Plain-text one-recipient email only. No attachments, CC/BCC, arbitrary HTML, inbound mailbox ingestion, open tracking, bulk campaigns, autonomous sends, SMS, payments processing or e-signatures. No additional storage bucket is needed.

Sent snapshots, decisions, consents, suppressions, provider events and calendar history are retained; public mutation endpoints do not hard-delete them. Abandoned drafts can be archived with audit. Raw provider webhook payloads, API responses and secrets are not persisted. Formal retention periods, legal/privacy review and deletion policy remain pre-production requirements. No real customer seed data is added.

Provider settings are disabled by default. Administrative UI configuration cannot independently enable sending: server flags, verified configuration and an exact development recipient allowlist are also required. Calendar activation requires a dedicated configured calendar; `primary` is rejected.

## Configuration and local setup

1. Install dependencies with `npm ci` using the repository’s supported Node version.
2. Copy `.env.example` to `.env.local` and configure only the existing local Convex deployment/public URLs.
3. Run `npm run dev` for the Next.js application. Deploy the M9 backend to the explicitly approved development deployment before exercising the new functions. The frontend shows a deployment-pending state against M8.
4. Keep `M9_EMAIL_ENABLED=false` and `M9_CALENDAR_ENABLED=false` until authorized external acceptance.
5. Configure private provider values in Convex, never in `NEXT_PUBLIC_*`, source, test output, screenshots or Git. `.env.example` lists every M9 variable.
6. Record the real company signature/contact/mailing address in Communications → Settings. Configure versioned templates and documented recipient eligibility through the UI. No fictional evidence may be used to authorize contact with a real recipient.

For approved email acceptance: configure `M9_RESEND_KEY`, verified sender/reply-to, exact `M9_EMAIL_TEST_ALLOWLIST`, `M9_RESEND_WEBHOOK_SECRET`, optional previous rotation secret, `M9_UNSUBSCRIBE_SECRET`, and the development `M9_PUBLIC_HTTP_ORIGIN`. Register `/m9/webhook` as the provider webhook. Verify actual sender/domain, SPF, DKIM and DMARC evidence before setting `M9_EMAIL_VERIFIED=true`.

For approved calendar acceptance: configure `M9_GOOGLE_CALENDAR_ID`, OAuth client ID/secret/refresh token in the development environment, enable the dedicated connection, then set `M9_CALENDAR_ENABLED=true` only for the authorized test window. No attendees are supplied. Reconcile and remove only fictional acceptance projections afterward and disable sync again.

## Initial implementation verification (superseded by the hardening results below)

Final local checks: **13 Node tests + 405 Convex tests passed**, including **56 M9 tests**. TypeScript, lint, formatting, build and dependency audit passed. **13 desktop/mobile compatibility and route-guard checks passed against the M8 backend**; these do not test the M9 feature UI. The source scan found no credential-pattern matches or private environment files. Exact local, hosted and browser results are recorded in `docs/M9-local-results.json` and the acceptance sections below. Mock/provider-contract tests are not evidence of actual inbox receipt or external calendar delivery.

Initial full parallel run found a Svix API compatibility defect, corrected by parsing the raw body only after verification, and a pre-existing M5 scale-test timeout at five seconds. A subsequent bounded-concurrency run passed the full suite. The Vitest configuration now defaults to two workers to avoid that local resource-contention timeout. Further targeted tests cover stale approval, cleared addresses, actor spoofing and verified unknown-send reconciliation.

Hosted deployment and browser acceptance: **pending explicit M9 development deployment approval** at the time this report was prepared. Browser suite: `tests/e2e/communications.spec.ts`, gated by `GLARA_M9_ACCEPTANCE=yes`, with fictional credentials loaded through the existing identity helper. It never enables external sending or calendar sync.

## Remaining release dependencies

- M9 development deployment authorization and hosted/browser acceptance.
- Explicitly designated non-customer inbox and dedicated development calendar.
- Actual email provider and sender/domain/DNS verification; real send, receipt, webhook, unsubscribe and failure acceptance.
- Calendar OAuth configuration and actual create/update/cancel/conflict/timeout/DST acceptance on the designated calendar.
- Independent M9 review. Local tests cannot establish absence of all P0/P1 issues; no live release pass is claimed.

The inherited invitation/onboarding delivery, recovery flow, reused/expired auth-link behavior, production redirect/origin verification, provider setup and `Support@glarahome.com` sender/domain requirements remain **DEFERRED — REQUIRED BEFORE PRODUCTION**. Nothing in M9 marks those requirements passed. Production was not modified.

## Primary implementation references

- [Resend idempotency window](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [Resend webhook verification](https://resend.com/docs/webhooks/verify-webhooks-requests)
- [Google Calendar event insertion](https://developers.google.com/workspace/calendar/api/v3/reference/events/insert)
- [CRTC CASL guidance](https://crtc.gc.ca/eng/com500/guide.htm)

The conservative eligibility implementation is an engineering control, not a legal determination of consent.

## Sections 165–345: hardening and corrections

- Source/purpose compatibility is enforced on creation and eligibility: Realtor messages are optional; opportunity/quote follow-ups use sales-relationship eligibility; consultation/project/invoice/payment communication is transactional and requires its authorized source. A transactional label cannot bypass optional-message consent.
- Transactional policy is configurable between documented service/request evidence and explicit recipient request only. Optional messages still require express consent. Policy revisions invalidate approvals. Formal CASL review remains a production prerequisite.
- Equivalent active M7 handoffs reuse one draft under an indexed transactional lookup, independently of browser request keys. Drafts, unknown sends and queued sends never complete the task. Task completion remains an explicit human action; hard bounces reopen a completed linked task, including events received before provider mapping.
- Dispatch now has a separate atomic fence that repeats actor, role, source, recipient, consent, suppression, policy and rollout checks. Only the holder of the current claim can cross it. Database state committed before the fence wins; no database can atomically revoke an HTTP call already in flight.
- Failed retry source revalidation preserves the original post-dispatch snapshot. Editing or approving a dispatched snapshot is denied. Known rejections may retry the same payload at most three times; unknown outcomes never retry automatically. Reliable provider evidence of “not sent” is not currently available, so a provider 404 is never treated as permission to resend.
- Recipient fatigue budgets are category-specific; optional outreach does not consume the transactional recipient budget. Shared user/category limits still bound abuse. Three consecutive provider failures pause delivery; configuration rejection pauses immediately. Resuming does not release unknown jobs.
- Complaint suppression covers optional messages. Technical hard-bounce and provider complaint suppression cannot be manually overridden. Correcting a bounced address changes source identity and requires new review.
- Malformed, unsupported and unresolved template placeholders block approval. Templates can be disabled by Owner/Admin. Delivery history uses indexed pagination rather than truncating the operator's timeline.
- Owner/Admin can inspect queue age, configurable delay warnings, retry waits, circuit status, webhook rejection count, recent failures and unknown sends. Stored-evidence reconciliation covers communications, jobs, provider events and calendar projections in bounded pages and exposes aggregate counts in the UI. It is read-only and is not a substitute for provider reconciliation.
- Unknown reconciliation requires a provider-returned correlation tag as well as matching content and recipient. Early delivery/bounce events are folded consistently when reconciliation creates the mapping. Indexed event-kind checks preserve decisive evidence beyond one batch; event association continues in bounded internal jobs. A 105-event regression covers this boundary.
- Calendar actions repeat current actor and source checks before provider writes, verify returned event identities, and preserve only minimal observed schedule/attendee-presence information for conflict review. Consultation pages show projection status. External attendees are never imported or invited.
- A new provider contract test exposed a calendar snapshot comparison defect: serialized object ordering could incorrectly mark an unchanged source stale. Explicit typed field comparison fixes this. Contract tests now exercise OAuth exchange and create/update/cancel using a single event identity.
- Archived-source history remains readable by Owner/Admin while fresh send eligibility stays blocked. Revoked Sales access still denies historical IDs.

## Hardening acceptance record (section 345)

| #   | Required result                  | Current evidence                                                                                                                                                                                                                                                                                                                                  |
| --- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Final commit                     | The Git commit containing this report; exact pushed SHA returned in the completion response.                                                                                                                                                                                                                                                      |
| 2   | Development deployment tested    | New M9 backend is **not deployed/tested**. Target remains `woozy-jaguar-392`; explicit M9 deployment approval is pending.                                                                                                                                                                                                                         |
| 3   | Email provider                   | Resend adapter and local contracts. No live M9 provider acceptance.                                                                                                                                                                                                                                                                               |
| 4   | Sender                           | Intended `Support@glarahome.com`; actual M9 provider sender verification pending.                                                                                                                                                                                                                                                                 |
| 5   | SPF / DKIM / DMARC               | NOT VERIFIED for this gate. No DNS success inferred.                                                                                                                                                                                                                                                                                              |
| 6   | Live email                       | NOT RUN; verified provider and designated non-customer inbox required.                                                                                                                                                                                                                                                                            |
| 7   | Webhook                          | Local signature/replay/order tests pass; live callback NOT RUN.                                                                                                                                                                                                                                                                                   |
| 8   | Unsubscribe / suppression        | Local token, revocation, expiry, scope and suppression tests pass; real generated-email link acceptance NOT RUN.                                                                                                                                                                                                                                  |
| 9   | Idempotency / unknown            | Local claims, fencing, stable keys, immutable retry, correlation and unknown quarantine tests pass; live delivery count NOT VERIFIED.                                                                                                                                                                                                             |
| 10  | Calendar provider                | Google Calendar OAuth adapter and local contracts.                                                                                                                                                                                                                                                                                                |
| 11  | Live calendar                    | NOT RUN; dedicated development calendar and private OAuth configuration required.                                                                                                                                                                                                                                                                 |
| 12  | Calendar conflicts / idempotency | Local mapping, conflict, source-authority, DST and stable create/update/cancel contracts pass; live provider gate pending.                                                                                                                                                                                                                        |
| 13  | M7 / M8                          | Local handoff, dedupe, human control and stale-source checks pass. Hosted end-to-end sequence NOT RUN.                                                                                                                                                                                                                                            |
| 14  | Authorization / red team         | Local backend role and revocation tests pass. Fresh hosted full role matrix NOT RUN.                                                                                                                                                                                                                                                              |
| 15  | Desktop / mobile                 | **13 compatibility checks passed on the preceding commit** against the M8 backend. Not rerun or promoted to current M9 desktop/mobile acceptance.                                                                                                                                                                                                 |
| 16  | Local tests                      | 13 Node + 449 Vitest/Convex = **462 passed, 0 failed**; 100 are M9 tests.                                                                                                                                                                                                                                                                         |
| 17  | Hosted M9                        | **0 executed** for this revision; not passed.                                                                                                                                                                                                                                                                                                     |
| 18  | Fresh M1–M8 hosted regression    | **0 executed** after this M9 revision. Historical reports are not reused as acceptance.                                                                                                                                                                                                                                                           |
| 19  | M6 reconciliation                | NOT RUN after M9 hosted acceptance; no claim of zero source/bucket drift.                                                                                                                                                                                                                                                                         |
| 20  | M9 communication reconciliation  | Local query behavior tested; final hosted counts NOT COLLECTED.                                                                                                                                                                                                                                                                                   |
| 21  | Calendar reconciliation          | Local query implemented; final provider/hosted counts NOT COLLECTED.                                                                                                                                                                                                                                                                              |
| 22  | M4 / M5 integrity                | Existing local suites pass; post-M9 hosted integrity counts NOT COLLECTED.                                                                                                                                                                                                                                                                        |
| 23  | Dependency audit                 | `npm audit` and `npm audit --omit=dev`: **0 vulnerabilities**, including no high/critical findings.                                                                                                                                                                                                                                               |
| 24  | Secrets / diff                   | Final tracked-source and private-value scan recorded in `M9-local-results.json`; no acceptance credentials are committed.                                                                                                                                                                                                                         |
| 25  | Defects fixed                    | Purpose relabeling, duplicate M7 handoff, unsafe lease recovery ambiguity, weak reconciliation correlation, malformed placeholders, shared fatigue budget, complaint scope, post-dispatch mutation, early bounce folding, calendar object-order comparison, evidence beyond one page, and definitive failure status under late acceptance events. |
| 26  | Known limitations                | See below; local success is not live or hosted acceptance.                                                                                                                                                                                                                                                                                        |
| 27  | Production prerequisites         | All inherited email/auth, security, privacy and production deployment gates remain deferred and required.                                                                                                                                                                                                                                         |
| 28  | Final rollout                    | Source changes only. No M9 deployment, external messages, calendar writes or production changes. No M10.                                                                                                                                                                                                                                          |

### Remaining prerequisites and limitations

Explicit M9 development deployment authorization remains pending. A designated non-customer test inbox, dedicated non-primary development calendar, sender/DNS verification, webhook configuration and OAuth/provider credentials are still needed for real acceptance. Credentials must be configured privately, never pasted into tracked source. Final hosted role tests, M1–M8 regressions, browser workflows, M6 reconciliation, M9 communication/calendar reconciliation and M4/M5 integrity checks follow that authorized deployment and must produce their own evidence.

Source pickers intentionally show bounded recent records; date/category filters can produce empty intermediate pages. One-recipient plain-text outbound messages only. No inbound mailbox/reply detection, attachments, tracking, bulk export/campaigns, SMS, payment execution or e-signatures. Consultations project a documented 60-minute duration because M2 supplies only a start time. Provider inspection is manual; external edits are discovered during Sync/check. Unknown messages require verified acceptance evidence and are never retried based on a 404 or an operator assertion.

There is no currently reproduced unresolved P0/P1 in the completed local tests. That is not a claim that the unexecuted hosted/live/browser security gates pass. Production invitations/onboarding, recovery delivery, reused/expired links, redirect/origin verification, sender/domain validation, 2FA decision, CASL/privacy/retention review, backups, monitoring, disaster recovery, infrastructure rate limits, staff UAT and migration/rollback planning remain **DEFERRED — REQUIRED BEFORE PRODUCTION**.

Additional provider contract reference: [Resend retrieve-email correlation tags](https://resend.com/docs/api-reference/emails/retrieve-email). A provider-authenticated correlation tag supplements, and does not replace, recipient/content/time checks.

## Final Sections 322–345 continuation

Continued from `6a85b35b7be92bfc1305d748d9bf809c52f9a97c`; M9 was not restarted. The accepted M0–M8 architecture and business mutations were preserved. This continuation changes M9 read-only reconciliation, its existing Owner/Admin review screen, regression tests and release evidence only.

Section 330 now explicitly detects approved/queued optional messages against applicable unsubscribe, missing approval snapshots/decisions, source/recipient key inconsistencies, unsafe ready retries, inconsistent queue state, absent dispatch provenance, provider status inconsistent with verified delivery/failure, orphan/duplicate provider mappings, orphan/duplicate outbox jobs and expired claims. A valid approval awaiting the human Send action does not require an outbox until enqueue; that boundary is tested. Duplicate mappings are returned as findings instead of crashing the event reconciliation query.

Section 331 now detects inconsistent calendar source keys, missing connections, unsafe primary-calendar destinations, missing completed-projection external identities and expired sync leases. Current source existence is checked even for non-synced projections. These queries report problems without repairing or changing M1–M8 truth. The UI includes outbox and provider-mapping finding counts across all pages. Stored checks do not replace actual provider observation or the independent final integrity gates.

A P1 detection gap was reproduced locally before the fix: the test `final reconciliation detects a status that understates verified delivery` expected `delivery_status_mismatch`, but received an empty findings list. The fictional fixture deliberately changed a locally delivered record to Sent; there was no real provider incident. Initial failure output was preserved locally, the missing comparison was fixed, and the complete local suite passed afterward. Fourteen final-gate regression cases were added, bringing M9 to 100 tests and the entire local suite to 462 tests.

### Confirmed external stop condition

A read-only check of **development `woozy-jaguar-392`** found all nine required M9 provider configuration variables absent: Resend credential, webhook secret, unsubscribe secret, test-recipient allowlist, public HTTP origin, dedicated Google Calendar ID, OAuth client ID, client secret and refresh token. Only names/presence and non-secret enable flags were inspected; no credential values were exposed. `M9_EMAIL_ENABLED`, `M9_EMAIL_VERIFIED` and `M9_CALENDAR_ENABLED` are unset, so delivery and sync remain disabled by default.

As requested, external work stopped at this dependency boundary. There was no M9 deployment, live send, external Calendar write, production modification or M10 work. Missing sender/SPF/DKIM/DMARC verification, explicitly designated non-customer inbox, dedicated non-primary calendar and provider acceptance remain unresolved. Existing unrelated authentication/provider configuration is not silently reused as M9 configuration.

Section-by-section status for every requirement from 322 through 345, the safe preflight evidence and uncollected final counts are recorded in `docs/M9-release-gates.json`. Uncollected counts are **null, not zero**. The final pushed SHA is the Git commit containing this report and is returned separately in the completion response. Local quality results are in `docs/M9-local-results.json`.

The next external stage requires private provider configuration and verification, explicit M9 development deployment/live-acceptance authorization, and the designated inbox/calendar. After that, fresh hosted M9 and M1–M8 suites, desktop/mobile workflows, provider acceptance, cleanup, M6 reconciliation and M4/M5 integrity checks must run against the final clean development backend. No historical or mock result satisfies those gates.

## M9 Resend development setup and email readiness

This initial setup snapshot predates account approval. The following **Resend account connected** section and `M9-email-readiness.json` contain the current provider/DNS status.

Continued from `8d03f3e9abde1a79692e31650dfb795e8f10954d` under the owner's explicit email setup authorization. The existing source was deployed to **development `woozy-jaguar-392`**, project `glara-os`, with backend TypeScript checking enabled. No business implementation was rebuilt. Google Calendar configuration and M10 were not started; production was untouched.

**M9 EMAIL GATE PENDING EXTERNAL ACTION**. This is preparation plus focused safety verification, not live delivery acceptance.

| Development variable       | Presence   |
| -------------------------- | ---------- |
| `M9_RESEND_KEY`            | missing    |
| `M9_RESEND_WEBHOOK_SECRET` | missing    |
| `M9_UNSUBSCRIBE_SECRET`    | configured |
| `M9_EMAIL_FROM`            | configured |
| `M9_EMAIL_REPLY_TO`        | configured |
| `M9_EMAIL_TEST_ALLOWLIST`  | configured |
| `M9_PUBLIC_HTTP_ORIGIN`    | configured |
| `M9_EMAIL_ENABLED`         | configured |
| `M9_EMAIL_VERIFIED`        | configured |

Sending and sender-verification guards are both **disabled**. The designated recipient allowlist contains exactly one inbox explicitly selected by the owner in this task. The address is intentionally omitted from the public repository. The intended sender and Reply-To are `Support@glarahome.com`; permission to send from this domain has **not** been verified with Resend.

The private unsubscribe secret was generated with 48 cryptographically random bytes and passed directly to the development environment using CLI stdin. Its value was never displayed, persisted locally, or committed. Existing secrets were not rotated.

The CLI confirmed the deployment's regional hostname. An initial non-regional origin returned 404 and was corrected before any send. The working endpoints are:

- `https://woozy-jaguar-392.eu-west-1.convex.site/m9/webhook`
- `https://woozy-jaguar-392.eu-west-1.convex.site/m9/unsubscribe`

### Existing public DNS — observed, not changed

| Type | Host                   | Observed value/target                         | Priority | Purpose                    |
| ---- | ---------------------- | --------------------------------------------- | -------- | -------------------------- |
| TXT  | `glarahome.com`        | `v=spf1 include:_spf.mail.hostinger.com ~all` | —        | Existing Hostinger SPF     |
| MX   | `glarahome.com`        | `mx1.hostinger.com`                           | 5        | Existing inbound mail      |
| MX   | `glarahome.com`        | `mx2.hostinger.com`                           | 10       | Existing inbound mail      |
| TXT  | `_dmarc.glarahome.com` | `v=DMARC1; p=none`                            | —        | Existing monitoring policy |

No DNS record was changed or duplicated. Nameservers resolve to `solar.dns-parking.com` and `lunar.dns-parking.com`. Actual Resend SPF/return-path and DKIM requirements must come from the authorized provider account; no account-specific records or selectors were invented. Existing DMARC policy was preserved. Production policy and alignment require later review; published DNS alone is not proof of verified sender status. See [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction) and [DMARC guidance](https://resend.com/docs/dashboard/domains/dmarc).

### Provider access and webhook preparation

No usable development Resend key or alternative Resend credential was found. The available browser-control runtime failed during initialization, and no Resend account connector was available. After the owner requested that Codex create the key, a temporary local [official Resend OAuth/PKCE authorization flow](https://resend.com/docs/guides/building-a-resend-oauth-client) was prepared. It binds only to loopback, validates state, keeps tokens in memory, and can create the development key directly in Convex after the account owner approves the correct team. No credentials need to be pasted into chat. The temporary listener expires after ten minutes; it can be restarted if necessary. The one-off helper is not part of the deployed application.

**Next external action:** approve **Glara OS M9 Development Setup** on Resend's official consent screen for the team owning `glarahome.com`. Authorization has not yet completed. This replaces the earlier request to manually copy a key; account ownership approval cannot be completed on the owner's behalf.

The endpoint is deployed, but a real Resend webhook subscription and signing secret remain pending. Intended supported subscriptions are `email.sent`, `email.delivered`, `email.bounced`, `email.complained`, `email.delivery_delayed`, and `email.failed`. Only the actual provider-issued signing secret may be configured. Reference: [Resend webhook events](https://resend.com/docs/webhooks/event-types).

### Verification performed in this setup task

- **100 M9 local tests passed, 0 failed.** Existing contracts cover exact allowlist rejection, approval/dispatch authorization, payload integrity, idempotency, authentic mocked signatures, modified/expired signatures, replay, unsubscribe, bounce/complaint suppression, bounded retries and circuit behavior. Mocked provider evidence is not live evidence.
- **4 hosted HTTP checks passed:** unsubscribe confirmation GET 200 with no-store/no-referrer, unsigned webhook POST 400, invalid-signature POST 400, invalid-token unsubscribe POST 200 with generic response. Because the real signing secret is missing, these rejection checks do not establish authentic provider acceptance.
- **9 hosted read-only role checks passed:** Owner/Admin/Sales/Marketing allowed; Designer/Staging Crew/unassigned/archived/anonymous denied. Email remained disabled. This is not the full mutation/security matrix.
- **13 desktop/mobile route/render checks passed:** six roles across two viewports plus anonymous redirect; no horizontal overflow. These replace only the earlier compatibility smoke scope, not full M9 workflow acceptance.
- Backend TypeScript passed during deployment. No application source changed in this setup task; prior full-suite/build/lint results remain historical and are not represented as rerun.

Live send, inbox receipt, authentic delivery event, live idempotency, real-token unsubscribe and live bounce/complaint acceptance are **NOT RUN**. No email was sent. Provider/DNS verification remains pending. The real key must not be deliberately invalidated for failure tests, and bounce/complaint acceptance must use only official provider mechanisms with appropriate recipient authorization.

Final environment state: development email **disabled**, verified guard **disabled**. Overall M9 remains pending email, Calendar and final hosted acceptance. All inherited production email/auth dependencies remain **DEFERRED — REQUIRED BEFORE PRODUCTION**. The commit containing this report is returned separately after push.

## Resend account connected — DNS administrator action required

The owner's Resend authorization completed. Codex created the requested development API key and stored it directly as `M9_RESEND_KEY` on `woozy-jaguar-392`; no key was displayed or committed. The temporary account-authorization callback completed and its listener stopped.

The provider account initially contained no `glarahome.com` domain or matching development webhook. Codex added the requested domain in Resend's default `us-east-1` sending region, requested enforced TLS, disabled receiving and both open/click tracking, and requested domain verification. The actual Resend domain status is **pending**. The four exact provider-returned DNS records are documented in [M9-resend-dns.md](M9-resend-dns.md); each is currently missing from public DNS. The extra `rsend` CNAME is included because it was returned by the actual provider response, not inferred from examples.

Codex created one webhook for the confirmed regional development endpoint with the six already supported email events, and stored the provider-generated signing secret directly as `M9_RESEND_WEBHOOK_SECRET`. Resend reports the webhook **enabled**. All nine required M9 email environment variables are now **configured**. Email enablement and sender verification guards remain **disabled** until domain verification and controlled acceptance pass.

Six additional hosted signature-boundary checks passed: correctly signed ignored event, repetition of that ignored event, missing signature, invalid signature, modified body and expired signature. These requests were deliberately **synthetic**, signed in memory using the configured secret, and used an ignored event type so they created no communication/delivery mappings. They demonstrate deployed signature verification, not authentic Resend delivery, inbox receipt, or real delivery-event idempotency. Rejection counters were incremented by these negative tests.

No emails were sent. Live send/receipt/delivery/idempotency/unsubscribe/bounce/complaint gates remain **NOT RUN**. Previous 100 local M9 tests, 9 role checks, 4 endpoint checks and 13 browser checks retain their recorded scope and were not falsely represented as rerun in this account-connection follow-up. No application code changed.

**Exact external action:** the DNS administrator must add the four public records in `docs/M9-resend-dns.md` to the `glarahome.com` zone. Codex has no authorized DNS connector, and browser control remains unavailable; Resend authorization alone does not grant Hostinger DNS access. Existing Hostinger MX/SPF, other DKIM selectors, nameservers and DMARC were preserved. The new SPF belongs to the `send` subdomain, so no second root SPF is needed.

After DNS publication, recheck both DNS and actual provider status before setting verification or temporarily enabling development email. Production remains untouched; Calendar configuration and M10 have not started. All production email/auth requirements remain **DEFERRED — REQUIRED BEFORE PRODUCTION**.

**M9 EMAIL GATE PENDING EXTERNAL ACTION**.

The owner explicitly authorized computer control to finish DNS setup. Both available browser control and the separate Windows computer-control runtime failed during initialization with `failed to write kernel assets: The system cannot find the path specified. (os error 3)`. Resetting and retrying the native runtime produced the same error. This is a tooling failure, not missing permission. Resume the already-authorized DNS work once computer control is available, or have the DNS administrator apply the exact prepared records. No secret needs to be shared in chat.

## Email acceptance after owner DNS setup

Continued from `3d7001f905250cae8c0bd478449e32812a616d6d` on development `woozy-jaguar-392` only. Application source was unchanged. This section supersedes prior email/DNS stop conditions; prior evidence remains historical.

**M9 EMAIL GATE PASSED** — the product owner has confirmed receipt of both designated acceptance messages. This confirmation supplements the independent provider delivery evidence; Codex did not inspect the mailbox.

### DNS and provider

All four exact Resend records matched through Google, Cloudflare and both authoritative nameservers. Both existing Hostinger root MX entries, the single root Hostinger SPF and the existing `v=DMARC1; p=none` record also matched: **32/32 DNS comparisons passed**. No DNS edits were made. Resend initially reported partially verified; one re-verification request followed by a bounded recheck returned **verified**, including all SPF/DKIM records. Sending permission for `Support@glarahome.com` was then confirmed by actual accepted sends. Received-message DMARC header alignment was not independently inspected; published policy was preserved without strengthening it.

All required private configuration was present. The regional development origin and explicitly designated single inbox were compared privately. Sender verification was enabled only after actual provider verification. Receiving, open tracking and click tracking remain disabled in Resend.

### Live acceptance results

The normal M9 workflow created fictional Realtor/property/opportunity/consultation records, a versioned transactional template, explicit owner acceptance-consent evidence, reviewed snapshots, approval decisions and outbox jobs. Existing server-side checks and the fenced worker performed delivery; no direct provider-send shortcut or client-supplied actor was used. The owner explicitly authorized the acceptance workflow; backend approval used the existing fictional owner test identity.

| Check               | Actual result                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Transactional send  | One source-backed fictional consultation message accepted and delivered                                                                                                                                |
| Optional send       | One fictional optional-preference message accepted and delivered                                                                                                                                       |
| Recipient exclusion | Non-allowlisted address cancelled before provider I/O; zero attempts and zero mappings                                                                                                                 |
| Reviewed content    | From, Reply-To, recipient, subject and frozen body matched provider retrieval for all four sends; plain text only, no unresolved variables; required signature/unsubscribe suffix verified             |
| Duplicate dispatch  | Duplicate create/enqueue returned the same records/jobs; repeat worker invocation produced no additional attempt or provider mapping                                                                   |
| Authentic webhook   | Nine real Resend-originated events correlated; provider lists successful HTTP 200 attempts for each                                                                                                    |
| Provider replay     | Replayed one actual delivered event; two successful HTTP deliveries, one internal event, unchanged status/version and event count                                                                      |
| Unsubscribe         | Nine checks passed: opaque real token, GET confirmation without mutation, POST update, optional scope, idempotent repeat, blocked later optional approval/enqueue, transactional eligibility preserved |
| Hard bounce         | Official Resend simulator produced a hard-bounce event and `all` technical suppression                                                                                                                 |
| Complaint           | Official Resend simulator produced a complaint and `all_optional` suppression; not promoted to transactional suppression                                                                               |
| Inbox receipt       | **OWNER CONFIRMED INBOX RECEIPT** for both designated messages; no Codex mailbox inspection                                                                                                            |

Exactly four logical provider messages were submitted: two to the designated inbox and two to [official Resend event simulators](https://resend.com/docs/knowledge-base/what-email-addresses-to-use-for-testing). Only the two exact simulator addresses were temporarily added to the development allowlist; the original single-inbox allowlist was restored in `finally`. No random nonexistent address received a provider call. Provider content retrieval and live webhook evidence are distinguished from owner mailbox confirmation. The real API key was not invalidated.

The existing **100 M9 local tests passed again, 0 failed**, including bounded 429 retries, circuit behavior, stale claims and unknown-outcome quarantine. This failure-injection evidence remains local/contract evidence; no live provider failure was fabricated.

The desktop/mobile route smoke suite also passed again: **13/13 checks**, covering six roles across two viewports plus anonymous redirect, with no horizontal overflow. These are rendering/access checks, not full browser workflow acceptance. No application source changed; full build/lint results remain historical rather than falsely represented as rerun.

### Reconciliation and safe state

All four paginated M9 reconciliation queries completed with **zero unexplained findings**. Actual counts: **6 Communications, 5 outbox jobs, 4 provider mappings, 9 delivery events, 0 ready jobs and 0 unknown outcomes**. The sixth communication is the deliberately blocked post-unsubscribe draft; the fifth outbox job is the non-allowlisted denial. No orphan job/mapping, duplicate send key, unsupported Delivered state, inconsistent event mapping or unsafe retry was reported. Final queue health showed zero retry waits, zero problem jobs and zero consecutive provider failures.

`M9_EMAIL_ENABLED=false` was restored immediately after the send window; `M9_EMAIL_VERIFIED=true` is retained following real verification. Credentials, webhook, verified domain and single-inbox allowlist remain configured. Clearly labeled fictional fixtures, approval/audit records and suppression/preferences are retained for review; no acceptance proof was deleted. The acceptance-only company signature is explicitly fictional/test-purpose and requires a real rollout signature before operational use.

The product owner manually confirmed receipt of both **“Glara OS M9 acceptance — fictional consultation”** and **“Glara OS M9 acceptance — optional email preferences.”** Evidence classification: **OWNER CONFIRMED INBOX RECEIPT**. Codex did not inspect the mailbox. No resend was required or performed; independent provider delivery and idempotency evidence already exists.

Machine-readable evidence: `docs/M9-email-acceptance.json`. Google Calendar setup and M10 were not started. Production was untouched. Overall M9 still requires Calendar and final hosted acceptance; inherited production email/auth requirements remain **DEFERRED — REQUIRED BEFORE PRODUCTION**.

Publication checks: formatting and `git diff --check` passed. Secret scanning covered **373 tracked/non-ignored files**, with zero API-key patterns, zero locally available credential matches, zero development email-secret matches and no private environment/acceptance files included. Only report/evidence files changed.

## Email gate closure — owner receipt confirmed

Continued from `514fb64e8aa2c053dbe6c9dbed13803e6766ac01`. Receipt was recorded on 2026-09-16T17:27:57.477197+00:00. All recorded email-gate evidence was re-evaluated, including sender/DNS verification, allowlist and approval boundaries, reviewed content, live delivery, authentic webhooks, idempotency, unsubscribe, bounce/complaint suppression, unknown-outcome protections, clean reconciliation and secret isolation. **M9 EMAIL GATE PASSED**; no known remaining email-specific P0/P1 blocker. Earlier pending decisions above are historical snapshots.

A fresh read-only development check confirmed `M9_EMAIL_ENABLED=false`, verified sender configuration, the original single-inbox allowlist and unchanged counts: 6 Communications, 5 outbox jobs, 4 provider mappings, 9 events, 0 ready jobs, 0 unknown outcomes. No replacement emails, provider changes or application changes were made. Existing 100 local tests and 13 browser smoke checks retain their recorded scope and were not rerun for this documentation-only closure.

This closes the **email gate only**. Overall M9 remains pending Calendar and final overall acceptance. Google Calendar and M10 were not started. Production remains untouched; inherited production email/auth requirements remain **DEFERRED — REQUIRED BEFORE PRODUCTION**.
