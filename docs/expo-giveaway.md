# Realtor expo registration and staging-credit giveaway

Implementation scope: the supplied specification through Section 63, where the attachment ends. Continuation was requested; no later sections were available during implementation. This feature extends the accepted Next.js/Convex CRM and does not replace it.

## Status and launch boundary

The feature is prepared for review and controlled acceptance. **Public launch is not approved or enabled by this implementation.** All new activation flags default to false. No real campaign dates, eligibility policy, prize expiry, transferability, redemption policy, or legal approval have been invented. The campaign editor starts with the requested $2,000 headline and value, but the owner must supply the actual business terms.

The existing production approval, environment isolation and recovery controls still apply to the public route. Production Email/Calendar are not activated. The historical email gate and deferred production authentication/email requirements are unchanged. Google Calendar remains deferred and disabled.

## Staff workflow

1. Open **Marketing â†’ Campaigns & giveaways**. Owner/Admin can create and manage campaigns. Marketing can view registration summaries and safe participant details. Sales can see campaign participation on Realtors assigned to them. Designer/Staging Crew and anonymous callers cannot access campaign administration.
2. Create a draft. Enter the two-day expo's actual opening/closing times in **America/Vancouver**, eligible primary markets, rules, privacy notice, separate optional consent wording, prize-use terms and expiry. Assignments initially use the campaign creator; existing CRM reassignment remains available. Drafts reject registration.
3. Obtain the sponsor's business/legal review and record approval in the editor. Configure the secure intake boundary separately. Publishing freezes campaign terms. **Scheduled is a published waiting state; staff must explicitly Open registration.** Open may be set before the start time; the server still rejects entries until that time. The closing timestamp is exclusive.
4. Copy the canonical link shown in the campaign. It comes from the configured `SITE_URL`, not a caller-controlled host. Add only a supported source token, such as `?source=booth`. The source never determines event day, eligibility, privileges or odds. Optional UTM fields accept bounded identifier characters only.
5. During the event, filter registrations by name/email/brokerage/city, event day, consent, eligibility, existing/new relationship, priority or not-contacted status. Search follows bounded indexed pages and continues through empty matching pages. Open the linked Realtor to use existing activities and permitted follow-up workflows. Check communication eligibility before contacting anyone.
6. Resolve pending contact identities **before close**. An Owner/Admin verifies an active matching CRM record and records a reference. The application never silently merges conflicting or archived contacts, nor overwrites existing CRM contact details. Restore an archived Realtor using the existing CRM procedure if appropriate. A duplicate or unresolved entrant can be marked ineligible with a reason.
7. Close the campaign. No more entries or eligibility increases are possible. Pending entries block the draw; they can only be excluded with a documented reason after closure. Once a draw snapshot exists, eligibility editing is locked entirely.
8. Run the audited draw. The selection is **pending verification**, not a confirmed/public winner. Verify identity, licence, published rules and, when required, the skill-testing question. Administer an owner-controlled math question privately; record the verification reference/result, not an identity document or the answer. The app does not provide legal approval or a preselected question policy.
9. Confirm the winner only after verification. A failed selection can be disqualified with a reason; an explicit redraw excludes prior disqualified selections and retains the original snapshot/history. Repeated initial-draw calls return the existing selection. A concurrent retry cannot create a second winner or award.
10. A confirmed award is an **issued, unapplied CAD service credit** with original/remaining cents, approved term version and expiry. It creates no Payment, invoice reduction or journal entry. Commercial application, partial redemption and transfer are intentionally not implemented; apply no discount without a separately approved, traceable commercial workflow.

Marketing priority is transparent: 21+ listings/year = High; 11â€“20 = Medium; other supplied ranges = Standard. It is only a follow-up aid. Every eligible unique entrant has one chance in the draw, independent of priority and consent.

## Data and transaction architecture

- `marketing_campaigns`: reusable campaigns, controlled lifecycle, business dates/timezone, immutable published rules/terms, owner assignment, review and version history.
- `campaign_entries`: campaign/Realtor links, normalized identity keys, entry-time professional eligibility facts, source, server-derived event day, exact rules acceptance and optional marketing consent. New/existing classification is an entry-time fact. Professional contact details are retained separately only while an identity conflict is unresolved, then removed after verification.
- `campaign_draws`: immutable stable eligible entry IDs, eligible count, closed time, rules version, operator, algorithm version and selection history. Redraw links to its preceding draw.
- `campaign_awards`: the confirmed winner's unapplied service credit. No M5 financial records are altered.
- `campaign_rate_windows`: distributed short-lived counters using keyed identity/network hashes, cleaned in bounded batches on intake.

Indexes support slug/status lookup; campaign/date entry pages; campaign/email and campaign/phone duplicate checks; Realtor/campaign history; campaign draw and award history; rate-key and expiry cleanup. Query/mutation validation is strict. Existing timestamp/UUID-style Convex ID and audit conventions are preserved.

The atomic internal registration mutation rechecks campaign state/window/rules, rate limits, email and phone variants, then writes the CRM relationship, source/brokerage if needed, required prospect next action, registration activity, consent evidence and entry. Convex transactional conflict retries enforce uniqueness under concurrent requests; duplicate submissions create no additional activities, consent grants or chances. Existing CRM fields and private sales notes are not enriched from unverified public input.

Public events have a null audit actor and an explicit public-registration action. System-created activities identify `actor_kind=system`; `created_by` retains the campaign's accountable creator. Admin decisions derive actors from authenticated server-side sessions. Public consent evidence has `actor_kind=public_registration` and no fabricated authenticated recorder. Existing M9 consent writers continue recording the authenticated recorder. Consent capture never changes preferences, revocations or suppressions.

Draw preparation and completion are internal authenticated mutations invoked by a Node action. Preparation locks the authoritative pool transactionally. Selection uses `node:crypto.randomInt`, not `Math.random`; completion rechecks the session/role and snapshot and commits only once. A crash between phases leaves a resumable frozen pool. Snapshot and award writes have no public mutation surface.

## Public boundary and deployment preparation

Routes:

- `/giveaway/[slug]`: public, escaped plain-text rules/privacy, accessible professional registration form and success/closed states. No CRM existence, private notes, scores, financial data, entry list or winner identity is returned.
- `/api/giveaway`: same-origin JSON POST, streaming body limit 6,000 bytes, strict validation, canonical-origin check and signed server-to-server submission.
- `/marketing/campaigns`: authenticated management, safe role projections and explicit decisions.

Set the following **server-only** variables in the frontend and matching Convex environment when authorized:

| Variable                         | Purpose                                                       | Default                |
| -------------------------------- | ------------------------------------------------------------- | ---------------------- |
| `GLARA_ENVIRONMENT`              | Explicit development or production boundary                   | Existing configuration |
| `SITE_URL`                       | Canonical approved frontend origin                            | Must be supplied       |
| `GLARA_EXPO_ENABLED`             | Public intake switch                                          | `false` / absent       |
| `GLARA_EXPO_INGRESS_SECRET`      | Shared frontend/backend HMAC secret, at least 32 random bytes | Absent, fail closed    |
| `GLARA_PRODUCTION_EXPO_APPROVED` | Separate production intake approval                           | `false` / absent       |

Generate a different random ingress secret per environment and install it directly into secure environment stores. Never paste it into chat, include it in screenshots, commit it, or prefix it with `NEXT_PUBLIC_`. Rotate both sides together with intake disabled. The configured backend connection must pass existing frontend environment isolation. Existing global production approval and recovery gates are additional requirements, not replaced by these flags.

Hosted intake currently supports **Vercel's trusted `x-vercel-forwarded-for`** header; non-Vercel public hosting fails closed until a reviewed trusted-proxy adapter is added. Localhost uses one shared local network bucket only in local development. Generic caller-supplied forwarding headers are ignored. The frontend signs the exact payload, timestamp and hashed network key; the public Convex action validates the HMAC and one-minute lifetime, then invokes the internal writer. Direct unsigned backend calls cannot write entries.

Abuse controls: independent email and phone counters (8/hour each), shared network allowance (600/hour), campaign allowance (2,000/hour), honeypot, minimum form age and bounded data. Counts persist on denied attempts. The network allowance is not a one-entry-per-IP rule. **This is layered abuse resistance, not proof of personhood.** Before public launch, validate actual booth load and host-edge request/body protections; configure additional edge limits or a reviewed CAPTCHA if required by the expected threat level. No third-party CAPTCHA/provider is enabled here.

Current campaign capacity is deliberately bounded to **5,000 registrations**, with exact fail-closed totals and pools, not silent truncation. Campaign directory shows the newest 100 campaigns. At larger scale, add reviewed indexed reporting/draw chunking before increasing limits. Reports derive counts from authoritative entries. No counters are presented as cash/revenue attribution. Future opportunity/project attribution can follow the existing Realtor/source link without duplicating financial truth.

No QR dependency was added. Once the production hostname and campaign terms are approved, generate a QR from the canonical public URL using the company's approved QR/design tool, then physically scan the printed proof on both major mobile platforms. Do not print localhost or a preview URL. QR printing and real-host acceptance remain launch prerequisites.

## Acceptance and remaining dependencies

Development acceptance passed: **615 automated tests** (21 Node + 594 Vitest, including 21 campaign tests), **46 desktop/mobile scenarios**, and **3 hosted fail-closed checks**. Build, TypeScript, lint, formatting and secret scan passed. The feature was deployed to `woozy-jaguar-392` development only. Expo intake remains unset/disabled; Email and Calendar remain `false`. No production state or customer records were changed. Enabled public intake was exercised only against isolated fictional fixtures; real-host launch acceptance remains outstanding.

See `docs/expo-giveaway-acceptance.json` for exact recorded check results. Reproduce local checks with `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, `npm run format:check`, and `npm run security:secrets`. The isolated browser runner uses only fictional contacts and localhost services. Expo mode builds the production frontend against an ephemeral localhost TLS proxy so the production CSP can remain unchanged. It requires OpenSSL (Git for Windows default path, or `GLARA_TEST_OPENSSL`) to create a one-day certificate stored only in the ignored acceptance directory; no operating-system certificate store is changed:

```powershell
$env:GLARA_EXPO_REGRESSION = 'yes'
$env:GLARA_HELP_REGRESSION = 'yes'
$env:GLARA_PAYMENT_PROJECTS_REGRESSION = 'yes'
$env:GLARA_POST_M10_REGRESSION = 'yes'
node scripts/isolated-auth-browser.mjs
Remove-Item Env:GLARA_EXPO_REGRESSION, Env:GLARA_HELP_REGRESSION, Env:GLARA_PAYMENT_PROJECTS_REGRESSION, Env:GLARA_POST_M10_REGRESSION
```

Browser artifacts, local fixture credentials, database copies and screenshots stay in ignored `.acceptance/m10/`. The runner requires the existing local Convex rehearsal binary and Edge. The frontend uses localhost HTTP and the backend uses isolated HTTPS; these checks do not substitute for real-host HTTPS, edge or printed-QR acceptance. Provider-enabled historical E2E suites still require their separately controlled fixtures and approvals; they are not activated by this runner.

Before launch, the owner must supply/approve the actual expo dates, markets, final official rules, sponsor/contact/privacy/consent details, prize terms/expiry and verification procedure. A production hostname, secure ingress configuration, reviewed deployment and real-host mobile/QR/edge tests are still required. Any missing continuation of the specification must be reconciled before claiming completion of the full original document. No automated email, public winner announcement, prize redemption or broader milestone is authorized by this feature.

Sources used for the preparation checklist: [Competition Bureau promotional contests](https://competition-bureau.canada.ca/en/deceptive-marketing-practices/types-deceptive-marketing-practices/promotional-contests), [CRTC express-consent guidance](https://web.crtc.gc.ca/eng/archive/2012/2012-549.htm), and [Vercel request headers](https://vercel.com/docs/headers/request-headers). These inform implementation boundaries; sponsor/legal review of this particular promotion remains required.

## Owner-supplied page copy

The public form uses the supplied English labels, prize summary, optional consent presentation, radio choices, ENTER TO WIN button and rules/privacy links. New drafts prefill the supplied introduction and marketing-consent wording and default to requiring a skill-testing question. Saved campaign copy and approved terms are preserved. The closing date and prize amount come from campaign configuration; the page never publishes the [DATE]/[TIME] placeholders. Actual dates, final rules/privacy details and launch configuration remain required. The footer reflects the saved skill-testing requirement.

## Scheduled public information

Owner/Admin may publish an approved campaign as scheduled with intake disabled. Scheduled public details require an explicit supported environment, legal approval, no recovery mode, and the existing production approvals where applicable. Drafts and cancelled campaigns remain hidden. `GLARA_EXPO_ENABLED=false` blocks entries, not approved scheduled information. When both server environments are deliberately armed, a scheduled campaign accepts entries only within the backend-authoritative opening/closing window; the browser refreshes at each boundary. Public query display cache refresh keys cannot override the server clock. See the current PacificWest launch handoff.
