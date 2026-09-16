# M9 — Communications & External Integrations

## Release decision

**M9 DEVELOPMENT GATE PENDING EXTERNAL ACTION**.

Implementation scope is the supplied sections 1–164 and entity addendum 164A–164AJ. The second attachment stops at the heading “165. QUEUE HEALTH”; any subsequent requirements have not been supplied. This report does not claim full live-provider acceptance, production readiness, or completion of unseen sections. M10 has not started.

Base: accepted M8 commit `bf785213e246be266aed367737742d5d6438f835`. Changes target `daryan-kf/glara-os-codex`.

## Implemented

- Communications workspace, responsive review screen, purpose selection, source-backed recipients, drafts, immutable versioned templates, consent evidence, preferences, settings, status filtering, and indexed subject search.
- Human approval bound to the exact reviewed recipient, rendered content, signature, source revision and eligibility evidence. A change between review and approval rejects the request. Dispatch repeats authorization and eligibility checks.
- Separate optional sales/marketing and transactional eligibility. Conservative optional-message policy requires evidenced express consent; transactional service/requested-contact evidence is evaluated independently. No inference of express consent from CRM activity.
- Consent history, scoped unsubscribe, address-level suppression, reasoned revocation, immutable approval/dispatch decisions, audit actors from server identity, and source authorization on historical reads.
- Atomic outbox claims, stable send identity, immutable retry payload, bounded retry for known rate-limit rejection, per-user/recipient/category daily limits, recent-contact guard, expired-lease quarantine and unknown-outcome reconciliation.
- Resend adapter with credential isolation, provider-supported Svix signature/timestamp verification, signing-secret rotation, duplicate/out-of-order event handling, early-event correlation, hard-bounce/complaint suppression and narrow public unsubscribe endpoint.
- Google Calendar adapter with dedicated development-calendar configuration, stable event identity, minimal private projections, no attendees/invitations, etag concurrency, explicit sync/reconciliation and conflicts that never overwrite M3 schedules.
- M7 activity and M8 Realtor draft handoffs create drafts only. AI permission/freshness is rechecked on import. Sending does not automatically complete M7 tasks. A hard-bounce callback reopens a linked completed activity through the existing instrumented mutation layer.
- Communication history on Realtor, Quote, Project and Invoice views, with role and deployment compatibility checks.

## Architecture and security

`convex/communicationSchema.ts` defines communications, stable templates, immutable template versions, preferences, consents, eligibility decisions, suppressions, hashed unsubscribe tokens, outbox jobs, provider mappings, append-only delivery events, settings, and rate-limit counters. `convex/calendarSchema.ts` defines calendar connections, projections, sync events and conflicts. Financial facts retain M5 integer-cent strings.

`communicationCore.ts` centralizes source/recipient authorization and eligibility. Owner/Admin can operate commercial and project communication. Sales is restricted to assigned relationships/opportunities. Marketing is restricted to consent-backed marketing-purpose Realtor messages and receives no private Sales/Invoice context. Designer and Staging Crew external communication is disabled in this version. Disabled/archived profiles cannot call protected functions; stored approval actors are rechecked by workers.

`communications.ts` exposes validated queries and human mutations. `communicationDelivery.ts` owns internal claims, provider evidence, reconciliation and unsubscribe writes. `communicationProvider.ts` contains Node actions; `communicationHttp.ts` exposes only verified provider events and opaque recipient unsubscribe. Provider credentials and OAuth refresh tokens stay in Convex environment variables.

Indexes cover requester, source, recipient, status, send key, due jobs, provider message IDs, event IDs, consent/preference scopes, template versions and calendar mappings. Subject search includes permission filters. Date/category filters are bounded post-page filters; an empty filtered page can still have more results. Source pickers show bounded recent records and label that limit.

The reviewed snapshot and dispatch lease define the concurrency boundary. Database transactions cannot atomically encompass an external HTTP request. A timeout or expired lease therefore becomes `delivery_unknown`; it never triggers blind resend. Resend idempotency lasts 24 hours, so it is an additional guard, not an indefinite exactly-once guarantee. Known 429 rejection may retry at most three attempts with backoff. An operator may reconcile an unknown send by supplying a provider ID and reason; Glara retrieves the provider record and checks exact recipient/content/sender plus dispatch-time proximity. It never accepts a client assertion that a message was sent.

Unsubscribe tokens are opaque HMAC values, with hashes stored in the token table. The finalized email payload necessarily contains its unsubscribe URL and is restricted to authorized operator access. Tokens expire after a year and can be revoked. The public endpoint is enumeration-safe, requires a POST confirmation, applies a global 120-per-minute mutation limit, and excludes optional-message preferences from essential transactional eligibility. Invalid tokens cannot create preference records. Production edge rate limiting remains part of the production security review.

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

## Verification

Final local checks: **13 Node tests + 405 Convex tests passed**, including **56 M9 tests**. TypeScript, lint, formatting, build and dependency audit passed. **13 desktop/mobile compatibility and route-guard checks passed against the M8 backend**; these do not test the M9 feature UI. The source scan found no credential-pattern matches or private environment files. Exact local, hosted and browser results are recorded in `docs/M9-local-results.json` and the acceptance sections below. Mock/provider-contract tests are not evidence of actual inbox receipt or external calendar delivery.

Initial full parallel run found a Svix API compatibility defect, corrected by parsing the raw body only after verification, and a pre-existing M5 scale-test timeout at five seconds. A subsequent bounded-concurrency run passed the full suite. The Vitest configuration now defaults to two workers to avoid that local resource-contention timeout. Further targeted tests cover stale approval, cleared addresses, actor spoofing and verified unknown-send reconciliation.

Hosted deployment and browser acceptance: **pending explicit M9 development deployment approval** at the time this report was prepared. Browser suite: `tests/e2e/communications.spec.ts`, gated by `GLARA_M9_ACCEPTANCE=yes`, with fictional credentials loaded through the existing identity helper. It never enables external sending or calendar sync.

## Remaining release dependencies

- Receipt and application of any specification continuation after section 165.
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
