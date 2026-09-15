# M8 — AI Copilot & Intelligence Layer

## Release status

**M8 LOCAL DEVELOPMENT CHECKS — PASS for supplied sections 1–140.**

**HOSTED M8 ACCEPTANCE — PENDING DEVELOPMENT DEPLOYMENT AUTHORIZATION.**

**LIVE PROVIDER ACCEPTANCE — PENDING EXTERNAL ACTION.** No real AI provider request has been made. Mock responses prove transport/validation/control behavior, not real-model quality, factuality or provider compatibility. M8 is not production-ready. M9 has not started.

On September 14, 2026, a presence-only check of development deployment `woozy-jaguar-392` found `OPENAI_API_KEY`, `GLARA_AI_MODEL` and `GLARA_AI_SECURITY_APPROVED` absent. No secrets were printed or configured. AI features and task proposals default off. Navigation Help is deterministic and works without a provider.

The supplied specification ends at section 140. These two attachments form the implemented scope. Additional requirements, if supplied, require review before calling the full milestone accepted.

## Architecture and security boundaries

One shared copilot supports record briefs, sales drafting, executive analysis, project readiness, inventory questions, commercial explanations, marketing drafts and automation explanations. The router selects a controlled context family; it cannot choose arbitrary tables, queries, tools or mutations.

- `src/lib/ai/model.ts`: strict request/configuration/output schemas, deterministic routing, text minimization, safe errors, evidence validation, exact token-cost arithmetic and SHA-256 context fingerprints.
- `convex/aiContext.ts`: authorization before retrieval, bounded source adapters and current-access checks. Existing M1–M7 queries supply business semantics. Source values remain authoritative.
- `convex/ai.ts`: request deduplication, ownership, configuration, conversation access, budget reservations, results, cancellation, feedback, proposal approval and metadata-only health reporting.
- `convex/aiProvider.ts`: `IntelligenceProvider.generateStructuredInsight`, a server-only OpenAI Responses adapter, strict JSON output, fixed endpoint, no tools, bounded retry and timeout. Model/key come from deployment environment, never client input.
- `src/components/ai/copilot.tsx`: responsive copilot, explicit record selection, periods, availability window/location, source links, editable drafts, proposal approval/rejection, conversation history, Owner configuration and Owner/Admin health. Context links are provided from Realtor, opportunity, project, product and invoice records.

| Role         | Context boundary                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Owner/Admin  | Company executive/commercial metrics and operational records; only Owner configures AI or sees provider cost aggregates.    |
| Sales        | Assigned Realtors/opportunities, permitted projects and selected project invoices. No company financial context.            |
| Designer     | Assigned project operational context and inventory catalog. No Realtor CRM or financial context.                            |
| Staging Crew | Assigned project checklist/readiness/inventory context. No catalog-wide intelligence, CRM, financial data or task creation. |
| Marketing    | M3-authorized publication-stage project number, city and status only. No private CRM, seller, address or financial fields.  |

Authorization is repeated at request, provider claim, response persistence/read and proposal approval. Archived users and expired sessions are denied by existing authentication. Conversations are user-owned and role-stamped. A source/role/assignment change hides stale answers, citations and proposals. IDs supplied by a client or model do not grant access.

The context sends only selected fields, with bounded strings and redaction of obvious credential patterns. Property access instructions, billing identities, bank/payment credentials, documents, storage URLs, files and private reasoning are excluded. Evidence IDs/routes remain server-side references; the provider gets short evidence keys and selected data. Retrieved text and prior answers are explicitly untrusted data. There are no model tools or external navigation capabilities. Output permits only known citation keys and rejects unrecognized action types, outbound URLs and unsupported numeric assertions. These controls reduce risk; they do not prove all natural-language claims correct. Live adversarial/factual evaluation is still required.

## Source consistency and coverage

- M1 Realtor briefs include selected relationship fields and recent activities. Owner/Admin also get M6 Realtor metrics. M2 opportunity briefs include stage, quotes, consultations and activities. Prospect next-action rules are unchanged.
- M3 risk reasons, attention level, room/checklist readiness and task state come from `operations.get`; access codes are excluded. Crew receives its existing assigned-project projection.
- M4 availability calls the actual date-window/location availability query. Alternatives are at most three active staging-eligible same-category products from a bounded sample, with availability for the same window. No reservation is created. Style suitability remains a designer judgment. Acquisition cost/profitability is not invented.
- M5 invoice balances come from `commercial.invoice`; company collections context uses the bounded receivables queue and M6 aggregates. No accounting mutation or external communication is available.
- M6 uses existing exact CAD-cent/basis-point values, current balances, period flows, previous period comparisons and Realtor breakdowns. Analytics must already be initialized/ready. Request timestamps are excluded from freshness hashes; reporting dates, values and source revisions are retained. No M6 arithmetic or source projection was replaced.
- M7 context cites active relevant automation actions and existing task references. Existing work suppresses new proposals. Scans that cannot establish absence of older work also suppress creation. Related opportunity tasks are considered in Realtor briefs.

Maximum context: 20 evidence entries, 6,000 characters per entry and 24 KB of fingerprinted evidence; provider request at most 32 KB. Large requests fail safely and require narrower scope. Lists are samples/pages, not exhaustive rankings. Selected business notes are deliberately minimized; semantic retrieval, arbitrary multi-entity joins, file/image analysis, profitability and causality are not supported.

## Schema, indexes and concurrency

`convex/aiSchema.ts` adds five tables without altering M1–M7 source schemas:

- `ai_settings`: single versioned configuration, indexed by key.
- `ai_conversations`: user, scope, timestamps, archive flag and bounded turn count; indexed by user/archive/update time.
- `ai_requests`: user/conversation/request key, selected scope, role/context fingerprints, references, sanitized question, validated answer, state, model/config snapshot, timings/tokens/costs and feedback. Indexes: user/request key, conversation/time, user/day, status/time. Full retrieved context and provider reasoning are not stored.
- `ai_usage`: exact micros, reservations, tokens, requests, failures and latency by company day/month, user/day, feature/day and model/day; indexed by key.
- `ai_action_proposals`: validated original/edited payload, rationale, source references, expiry, state, actor/result reference and timestamps; indexed by request and user/status/time.

Convex transactions implement read-before-insert uniqueness and provider claims. Budget reservation and limit checks occur atomically before dispatch, including concurrent users. The reserve covers two worst-case bounded requests at configured prices. Actual reported tokens settle the reserve; unknown usage conservatively charges the full reserve. Limits and prices must be verified against the chosen provider model. These are application estimates, not a guarantee about an external provider invoice. Cancellation discards results but cannot guarantee that a dispatched provider request is unbilled. A private scheduled timeout closes abandoned requests after two minutes and conservatively settles uncertain spend. Late results cannot overwrite a completed request.

Only `create_activity` is executable. It requires explicit approval, current permission, an unchanged context, no existing task, a valid future due date and expiry within 24 hours. Approval calls the existing CRM/sales/project mutation as a Convex subtransaction, and stores the execution receipt in the same parent transaction. Existing permissions, assignee checks, limits, auditing and M6/M7 instrumentation remain authoritative. Concurrent approvals return the same result; separate stale proposals cannot create duplicate work after the source changes. Editing cannot change the action type or source entity. Rejection does not mutate business records.

No AI file/storage tables, embeddings, vector database, autonomous communications or model-triggered business jobs were introduced.

## Authentication, retention and provider setup

Convex Auth and current profiles/roles remain unchanged. No Supabase component is reintroduced.

1. Deploy reviewed source to an explicitly authorized development environment and complete disabled-provider hosted/browser checks.
2. Approve the provider/model, data-transfer/privacy terms, retention policy, verified pricing and security evaluation plan.
3. Configure `OPENAI_API_KEY` and `GLARA_AI_MODEL` in the **Convex deployment environment**, not Next public variables or source files. A private key in local Next `.env.local` alone does not configure hosted Convex functions.
4. Set `GLARA_AI_SECURITY_APPROVED=true` only after the actual security review. Owner must acknowledge retention and configure accurate token prices, budgets, features and proposal policy in AI settings before enabling.
5. Run fictional live-provider evaluations for all roles, indirect injection, unsupported claims, schema compatibility, recovery, concurrency, latency and cost before production.

The adapter uses `store:false`. That does **not** guarantee zero provider retention: OpenAI abuse monitoring and other retention terms remain subject to the selected account/provider agreement. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Application conversations/validated responses remain stored until an approved retention/deletion policy is implemented; archiving hides a conversation and does not erase it. No automatic training occurs. This limitation must be resolved before production activation. Provider responses/errors are not logged raw. Feedback is user-submitted and cannot alter business rules.

## Validation

- Focused M8 tests: **33/33 passed** with fictional Convex fixtures and intercepted provider responses. Covers six-role boundaries, Sales assignment, wrong-table IDs, archived users/sessions, stale conversations, safe failures, timeout, request/provider dedupe, rate and concurrent budget limits, cancellation, proposal editing/rejection/races/expiry, M4 window availability, M5 balances and M6 exact metrics, Marketing projection, related task suppression and navigation without AI.
- Final full regression: **13/13 Node tests and 312/312 Vitest tests passed** (279 existing + 33 M8). One M5 volume test exceeded its five-second timeout while lint/typecheck/formatting competed for CPU; the unchanged full suite passed alone in 9.99 seconds. The focused M8 suite also passed after the final M3 risk consistency assertion.
- Strict TypeScript, zero-warning ESLint, formatting and Next production build: **PASS**. Tracked/nonignored source review scanned **330 files**, including comparison against eight existing fictional acceptance passwords: **zero secret matches and zero private environment files**. Only `.env.example` is tracked.
- Existing authentication browser regression on the M8 frontend with the prior development backend: **10/10 passed**, five scenarios each on desktop and mobile, including `/copilot` protection, login/logout, financial route denial, safe invalid-login errors and recovery UI. These do not prove real recovery email delivery. The first attempt could not launch the absent Playwright Chromium executable; the successful run used installed Microsoft Edge. Invalid-account and early navigation stream diagnostics appeared in server output; user-facing assertions passed.
- `tests/support/m8-hosted-acceptance.ts`: prepared, not yet executed. Requires `GLARA_M8_ACCEPTANCE=yes`, existing guarded fictional credentials and the specifically authorized development deployment. Exercises disabled-provider boundaries, navigation and ownership; does not claim live-model acceptance.
- `tests/e2e/ai.spec.ts`: prepared, not yet executed. Six roles on desktop/mobile, disabled AI, deterministic navigation, evidence, feedback and responsive controls. Live draft/proposal browser acceptance remains dependent on provider enablement.

Browser command: set `PLAYWRIGHT_CHANNEL=msedge` when using the installed Edge browser, then run `node node_modules/@playwright/test/cli.js test tests/e2e/auth.spec.ts --reporter=line` with the existing guarded fictional identity environment.

Local commands: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run format:check`, `npm run build`. Hosted/browser acceptance additionally requires separately authorized development deployment and fictional identity setup used by existing M1–M7 acceptance scripts. Never put test credentials in source or reports.

## Remaining gates and known limits

- M8 hosted deployment/browser acceptance pending authorization; current hosted backend remains the prior milestone.
- Live provider/model configuration, real-model golden/adversarial evaluation, latency/cost verification and enabled draft/proposal browser flows: **PENDING EXTERNAL ACTION**.
- No claim of zero hallucinations, semantic proof, production readiness or complete acceptance from mocks. No known unresolved P0/P1 was found in the tested local boundary; this is not an independent security review.
- Recent history is bounded to two still-current prior answers; there is no shared response cache, streaming or arbitrary historical retrieval. Concurrent native business changes cause safe stale refusal and require a fresh request.
- All financial, inventory, agreement, pricing, schedule, status, role, rule and communication writes remain outside model authority. No M9 implementation.
- Real invitation/onboarding and password recovery delivery, reused/expired links, production redirect/origin verification, transactional email provider and `Support@glarahome.com` sender/domain verification remain **DEFERRED — REQUIRED BEFORE PRODUCTION**.
