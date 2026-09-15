# M8 — AI Copilot & Intelligence Layer

## Release status

**M8 DEVELOPMENT GATE PENDING EXTERNAL ACTION**

Local implementation and automated checks are separate from full milestone acceptance. Section 160 requires an explicitly authorized live provider to pass development acceptance; mocks cannot satisfy that requirement.

**HOSTED M8 ACCEPTANCE — PENDING DEVELOPMENT DEPLOYMENT AUTHORIZATION.**

**LIVE PROVIDER ACCEPTANCE — PENDING EXTERNAL ACTION.** No real AI provider request has been made. Mock responses prove transport/validation/control behavior, not real-model quality, factuality or provider compatibility. M8 is not production-ready. M9 has not started.

On September 14, 2026, a presence-only check of development deployment `woozy-jaguar-392` found `OPENAI_API_KEY`, `GLARA_AI_MODEL` and `GLARA_AI_SECURITY_APPROVED` absent. No secrets were printed or configured. AI features and task proposals default off. Provider rollout defaults to Owner only; enabling the global flag does not grant AI access to other roles. Navigation Help is deterministic and works without a provider.

Implemented scope now includes supplied sections **1–216**. The continuation adds thread lifecycle/retention, explicit asset context, desktop UX, rollout controls, quality metadata and live acceptance requirements. The latest attachment ends after the section 216 P0 blocker list; no later requirements have been assumed.

## Architecture and security boundaries

One shared copilot supports record briefs, sales drafting, executive analysis, project readiness, inventory questions, commercial explanations, marketing drafts and automation explanations. The router selects a controlled context family; it cannot choose arbitrary tables, queries, tools or mutations.

- `src/lib/ai/model.ts`: strict request/configuration/output schemas, deterministic routing, text minimization, safe errors, evidence validation, exact token-cost arithmetic and SHA-256 context fingerprints.
- `convex/aiContext.ts`: authorization before retrieval, bounded source adapters and current-access checks. Existing M1–M7 queries supply business semantics. Source values remain authoritative.
- `convex/ai.ts`: request deduplication, ownership, configuration, conversation access, budget reservations, results, cancellation, feedback, proposal approval and metadata-only health reporting.
- `convex/aiProvider.ts`: `IntelligenceProvider.generateStructuredInsight`, a server-only OpenAI Responses adapter, strict JSON output, fixed endpoint, no tools, bounded retry and timeout. Model/key come from deployment environment, never client input.
- `src/components/ai/copilot.tsx`: responsive copilot, explicit record selection, periods, availability window/location, source links, editable drafts, proposal approval/rejection, conversation history, Owner configuration and Owner/Admin health. Context links are provided from Realtor, opportunity, project, product, physical asset and invoice records. Desktop conversation history sits beside the main experience; mobile retains touch-friendly controls. The selected entity is named explicitly. Suggested questions only populate the input. Refresh Context performs authorized retrieval without invoking AI. Drafts are labeled DRAFT — NOT SENT and can be edited/copied.

| Role         | Context boundary                                                                                                            |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| Owner/Admin  | Company executive/commercial metrics and operational records; only Owner configures AI or sees provider cost aggregates.    |
| Sales        | Assigned Realtors/opportunities, permitted projects and selected project invoices. No company financial context.            |
| Designer     | Assigned project operational context, inventory catalog and physical assets. No Realtor CRM or financial context.           |
| Staging Crew | Assigned project checklist/readiness/inventory context. No catalog-wide intelligence, CRM, financial data or task creation. |
| Marketing    | M3-authorized publication-stage project number, city and status only. No private CRM, seller, address or financial fields.  |

Authorization is repeated at request, provider claim, response persistence/read and proposal approval. Archived users and expired sessions are denied by existing authentication. Conversations are user-owned and role-stamped, including renamed thread titles. Owner/Admin cannot read, rename or delete another employee’s conversation. They may inspect aggregate quality/audit metadata only. A source/role/assignment change hides stale answers, citations and proposals. IDs supplied by a client or model do not grant access.

The context sends only selected fields, with bounded strings and redaction of obvious credential patterns. Property access instructions, billing identities, bank/payment credentials, documents, storage URLs, files and private reasoning are excluded. Evidence IDs/routes remain server-side references; the provider gets short evidence keys and selected data. Retrieved text and prior answers are explicitly untrusted data. There are no model tools or external navigation capabilities. Output permits only known citation keys and rejects unrecognized action types, outbound URLs and unsupported numeric assertions. These controls reduce risk; they do not prove all natural-language claims correct. Live adversarial/factual evaluation is still required.

## Source consistency and coverage

- M1 Realtor briefs include selected relationship fields and recent activities. Owner/Admin also get M6 Realtor metrics. M2 opportunity briefs include stage, quotes, consultations and activities. Prospect next-action rules are unchanged.
- M3 risk reasons, attention level, room/checklist readiness and task state come from `operations.get`; access codes are excluded. Crew receives its existing assigned-project projection.
- M4 availability calls the actual date-window/location availability query. Alternatives are at most three active staging-eligible same-category products from a bounded sample, with availability for the same window. No reservation is created. Style suitability remains a designer judgment. Acquisition cost/profitability is not invented.
- M5 invoice balances come from `commercial.invoice`; company collections context uses the bounded receivables queue and M6 aggregates. No accounting mutation or external communication is available.
- M6 uses existing exact CAD-cent/basis-point values, current balances, period flows, previous period comparisons and Realtor breakdowns. Analytics must already be initialized/ready. Request timestamps are excluded from freshness hashes; reporting dates, values and source revisions are retained. No M6 arithmetic or source projection was replaced. Integer formatting supplies exact CAD/percentage display values to the provider; invoice overdue-day counts and the Vancouver business date are computed server-side.
- M7 context cites active relevant automation actions and existing task references. Existing work suppresses new proposals. Scans that cannot establish absence of older work also suppress creation. Related opportunity tasks are considered in Realtor briefs.

Maximum context: 20 evidence entries, 6,000 characters per entry and 24 KB of fingerprinted evidence; provider request at most 32 KB. Large requests fail safely and require narrower scope. Lists are samples/pages, not exhaustive rankings. Selected business notes are deliberately minimized; semantic retrieval, arbitrary multi-entity joins, file/image analysis, profitability and causality are not supported.

## Schema, indexes and concurrency

`convex/aiSchema.ts` adds five tables without altering M1–M7 source schemas:

- `ai_settings`: single versioned configuration, indexed by key.
- `ai_conversations`: user, scope, timestamps, archive flag and bounded turn count; indexed by user/archive/update time and purge-state/update time.
- `ai_requests`: user/conversation/request key, selected scope, role/context fingerprints, references, sanitized question, validated answer, state, model/config snapshot, timings/tokens/costs and feedback. Indexes: user/request key, conversation/time, user/day, status/time and creation time. Full retrieved context and provider reasoning are not stored. Request records contain one user question and its validated answer; a separate duplicate ai_messages table is unnecessary. Embedded evidence references are validated against the current context.
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

The adapter uses `store:false`. That does **not** guarantee zero provider retention: OpenAI documents default abuse-monitoring retention of 30 days and additional feature/model exceptions. OpenAI states API data is not used for training by default unless the customer opts in; this account’s sharing/retention configuration has not been verified. The fixed `api.openai.com` endpoint imposes no regional processing constraint. Approved provider project, model, region and account data controls remain prerequisites for live acceptance. See [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) and [structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs).

Conversation retention is configurable by Owner from **7–365 days**, default **30 days** since the last turn. Rename/archive do not extend retention. Expired access is denied by server checks. An hourly private sweep purges at most five current-schema and five legacy conversations per invocation; a large backlog may take multiple runs to clear physically. The policy change applies to existing conversations on subsequent access/sweep. Cleanup health/backlog operations and provider-side deletion requirements must be reviewed before production.

Thread deletion/retention erases question/answer text, embedded convenience evidence and free-text feedback. Pending proposal text is erased and approval expires. Executed business tasks, executed proposal payload/actor/result evidence, metadata counters and business audit remain. The conversation row becomes a minimal tombstone. A late provider response cannot recreate deleted content. System retention audit uses a null/system actor rather than impersonating the employee. Business audit/proposal-execution retention is separate and still requires a production policy.

There is no provider conversation/session ID or hidden model memory. Two still-authorized prior answers may accompany a fresh turn. Ordinal follow-up resolves against the previous answer’s ordered citation list, rechecks source access/freshness, and asks the user to review the newly selected scope before submitting. Unresolvable/synthetic references fail safely; no entity is guessed. Provider requests/errors are not logged raw. Feedback cannot alter business rules.

## Validation

- Focused M8 tests: **46/46 passed** with fictional Convex fixtures and intercepted provider responses. Covers six-role boundaries, Sales assignment, wrong-table IDs, archived users/sessions, stale conversations, safe failures, timeout, request/provider dedupe, rate and concurrent budget limits, cancellation, proposal editing/rejection/races/expiry, M4 window availability, M5 balances and M6 exact metrics, Marketing projection, related task suppression and navigation without AI. Continuation tests cover administrator conversation isolation, role-specific rollout, renamed-title revocation, delete-versus-provider races, audit preservation, bounded retention, quality projection, assets, ordinal reference authorization, indirect injection, financial exfiltration and overflow.
- Final full regression: **13/13 Node tests and 325/325 Vitest tests passed** (279 existing + 46 M8) after sections 141–216. Total: **338 local tests**. The full suite completed in 9.60 seconds. The earlier implementation had one M5 volume-test timeout under competing lint/typecheck work; its standalone rerun passed, and the current full regression also passes.
- Strict TypeScript, zero-warning ESLint, formatting and Next production build: **PASS**. Tracked/nonignored source review scanned **330 files**, including comparison against eight existing fictional acceptance passwords: **zero secret matches and zero private environment files**. Only `.env.example` is tracked.
- Authentication browser regression rerun after sections 141–216 on the M8 frontend with the prior development backend: **10/10 passed**, five scenarios each on desktop and mobile, including `/copilot` protection, login/logout, financial route denial, safe invalid-login errors and recovery UI. These do not prove real recovery email delivery. The first attempt could not launch the absent Playwright Chromium executable; the successful run used installed Microsoft Edge. Invalid-account and early navigation stream diagnostics appeared in server output; user-facing assertions passed.
- `tests/support/m8-hosted-acceptance.ts`: prepared, not yet executed. Requires `GLARA_M8_ACCEPTANCE=yes`, existing guarded fictional credentials and the specifically authorized development deployment. Exercises disabled-provider boundaries, navigation and ownership; does not claim live-model acceptance.
- `tests/e2e/ai.spec.ts`: prepared, not yet executed. Six roles on desktop/mobile, disabled AI, deterministic navigation, explicit scope/refresh, suggestions, evidence, feedback, rename/delete and responsive controls. Live draft/proposal browser acceptance remains dependent on provider enablement.

Browser command: set `PLAYWRIGHT_CHANNEL=msedge` when using the installed Edge browser, then run `node node_modules/@playwright/test/cli.js test tests/e2e/auth.spec.ts --reporter=line` with the existing guarded fictional identity environment.

Local commands: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run format:check`, `npm run build`. Hosted/browser acceptance additionally requires separately authorized development deployment and fictional identity setup used by existing M1–M7 acceptance scripts. Never put test credentials in source or reports.

## Provider data classification and quality

| Classification         | Examples and treatment                                                                                                                               |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Low sensitivity        | Public-safe product names and authorized general project status; still permission-scoped.                                                            |
| Business confidential  | Relationship activities, pipeline and inventory context; minimum selected fields only.                                                               |
| Financial confidential | Authorized invoice/AR and M6 money values; company scope restricted to Owner/Admin.                                                                  |
| Restricted             | Authentication identifiers/keys, property access/security codes, payment credentials and unnecessary personal contact fields; excluded from context. |

Quality reporting exposes aggregate helpful ratings, incorrect/unsafe flags, insufficient-evidence counts, failures and invalid outputs from the latest **200 requests within 30 days**, with a partial-sample flag. It exposes no employee prompts/answers. AI costs are Owner-only and are not posted to commercial accounting. No AI SDK or package dependency was added; the adapter uses existing fetch/Zod facilities and the dependency lockfile is unchanged.

## Acceptance matrix and tested scale

| Gate                                                                                                                                              | Current evidence/status                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local domain/security/transaction tests                                                                                                           | 338 passing, including 46 M8 tests.                                                                                                                                                       |
| Hallucination/structured-output evaluation                                                                                                        | Mocked fabricated citation, amount, URL and forbidden-action responses rejected. Live factual quality is untested.                                                                        |
| Deletion/retention                                                                                                                                | Seven expired fixture threads purge in batches of five then two; pending text is erased and executed audit survives deletion.                                                             |
| Load/cost controls                                                                                                                                | Two simultaneous requests compete for one affordable reservation; two concurrent approvals create one task; 40 KB context rejected before network. Not a production throughput benchmark. |
| M8 hosted disabled-provider checks                                                                                                                | Prepared; awaiting M8 development deployment authorization.                                                                                                                               |
| Live Owner/Sales/Designer/Crew/Marketing                                                                                                          | PENDING EXTERNAL ACTION; no provider credential/model/security approval configured.                                                                                                       |
| Live exact M6/M5/M4 values, insufficient evidence, injection, proposal approval/staleness/revocation, provider failure/timeout/malformed response | PENDING EXTERNAL ACTION; not represented as passed by mocks.                                                                                                                              |
| Full M8 desktop/mobile draft/proposal/settings/health flows                                                                                       | Prepared/required; not run against an M8 backend. Prior 10 authentication browser checks do not satisfy these.                                                                            |
| Hosted M1–M7 regression after M8 deployment                                                                                                       | Pending; existing local regression passes.                                                                                                                                                |
| Post-M8 M6 zero-drift reconciliation and M7 task coordination                                                                                     | Local source semantics retained; hosted reconciliation must run after authorized live acceptance.                                                                                         |

Live acceptance must use fictional identities and data only. Company-wide AI questions require an isolated fictional-only dataset or explicit verification that every included aggregate/source is fictional. Never send an existing mixed development dataset to a provider merely because it is called development. Record the approved provider/model, actual account retention/sharing/region controls, measured latency/tokens/cost, exact numeric comparisons, fixture cleanup and final M6 reconciliation. Any material mismatch or section 216 P0 violation blocks the affected capability and the full gate.

## M9 readiness

Typed context, validated drafts, request metadata, private conversation lifecycle, feature/role flags and approved-task receipts provide reusable boundaries for later work. They do not authorize message delivery or M9 implementation. Complete the live M8 development gate and independent review first.

## Remaining gates and known limits

- M8 hosted deployment/browser acceptance pending authorization; current hosted backend remains the prior milestone.
- Live provider/model configuration, real-model golden/adversarial evaluation, latency/cost verification and enabled draft/proposal browser flows: **PENDING EXTERNAL ACTION**.
- No claim of zero hallucinations, semantic proof, production readiness or complete acceptance from mocks. No known unresolved P0/P1 was found in the tested local boundary; this is not an independent security review.
- Recent history is bounded to two still-current prior answers; there is no shared response cache, streaming or arbitrary historical retrieval. Concurrent native business changes cause safe stale refusal and require a fresh request.
- All financial, inventory, agreement, pricing, schedule, status, role, rule and communication writes remain outside model authority. No M9 implementation.
- Real invitation/onboarding and password recovery delivery, reused/expired links, production redirect/origin verification, transactional email provider and `Support@glarahome.com` sender/domain verification remain **DEFERRED — REQUIRED BEFORE PRODUCTION**.
