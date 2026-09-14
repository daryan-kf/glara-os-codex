# Glara OS

Private operating system for Glara Home Staging, Metro Vancouver. The active stack is **Next.js, strict TypeScript, Tailwind/shadcn UI and Convex with Convex Auth**. M0 foundation, M1 Realtor CRM, M2 Sales CRM, M3 Staging Operations and M4 Inventory Management are implemented. M4 passed its development gate; see [the M4 report](docs/M4-report.md) for the exact evidence, limits and deferred production requirements. M5 Commercial Operations has passed its development gate on the authorized Convex environment; see [the M5 report](docs/M5-report.md) for exact results, initial failures and limitations. M6 has not started.

## Local setup

Requires Node.js 22.9+, npm and access to the Daryan Convex team.

```powershell
npm ci
Copy-Item .env.example .env.local
npx convex dev --once --configure existing
```

Select the `daryan-kamalifar` team, `glara-os` project and your development deployment. The CLI writes the deployment URLs to `.env.local` and deploys schema/functions. Use a separate development deployment for independent work. The existing acceptance deployment already has signing keys and fictional users; do not replace its signing keys.

For a new deployment, configure `JWT_PRIVATE_KEY` and `JWKS` using the [Convex Auth manual setup](https://labs.convex.dev/auth/setup/manual), then set its application origin:

```powershell
npx convex env set SITE_URL http://localhost:3000
npx convex run admin:initializeSources '{}'
npm run dev
```

In another terminal run `npm run convex:dev` while changing backend functions. Open http://localhost:3000 and sign in with a provisioned account. There is no public signup or demo bypass. Without a Convex URL the app shows a setup state and disables login.

## Configuration

| Variable                    | Location                      | Purpose                                       |
| --------------------------- | ----------------------------- | --------------------------------------------- |
| CONVEX_DEPLOYMENT           | `.env.local`                  | CLI deployment selection                      |
| NEXT_PUBLIC_CONVEX_URL      | `.env.local` / Vercel         | Public backend URL                            |
| NEXT_PUBLIC_CONVEX_SITE_URL | `.env.local` / Vercel         | Public Convex HTTP endpoint written by CLI    |
| CONVEX_SITE_URL             | Convex automatic environment  | Auth issuer domain                            |
| SITE_URL                    | Convex environment            | Exact application origin, HTTPS in production |
| JWT_PRIVATE_KEY             | Convex environment only       | Secret RS256 signing key                      |
| JWKS                        | Convex environment            | Matching public verification keys             |
| AUTH_RESEND_KEY             | Convex environment only       | Optional verified email delivery credential   |
| CONVEX_DEPLOY_KEY           | Vercel build environment only | Secret deployment authorization               |

No Supabase environment variables or runtime dependencies remain. Never put private keys, deploy keys, passwords or email credentials in `NEXT_PUBLIC_*`, source control or browser logs. Environment files and test artifacts are Git-ignored.

## Identity and authorization

Convex Auth handles password hashing, tokens, refresh rotation and logout. Public `signUp` is rejected. Passwords must have 12–128 characters. Sessions last up to seven days with one-day refresh inactivity; JWTs last one hour. Cookies are HttpOnly and SameSite=Lax, with Secure and `__Host-` names outside localhost. Auth changes reload the document to discard cached workspace/provider state.

Every CRM function checks the actual session record, its expiry, current profile and roles. Logout therefore denies a previously issued JWT immediately. Archived and unassigned profiles cannot access CRM. Browser navigation permissions are centralized in `src/lib/permissions.ts`; backend permissions are centralized in `convex/access.ts`. Owner has all module access. Sales/Admin operate CRM; Marketing receives a restricted read projection without private notes, scores, listing values, activity history or the operational roster. Designer/Crew are denied CRM functions. Only Owner can query global/CRM audit records. M3 project management can read the restricted audit timeline for its authorized projects. Clients cannot call internal provisioning or access database tables directly.

User administration remains a trusted deployment operation, with no public role-editing endpoint. To invite a real user after email delivery is configured, run the internal `admin:provision` action from the Convex dashboard Functions panel with `email`, `name`, `roles` (for example `["owner"]`) and `sendInvitation: true`. It creates an unknown random password, assigns the profile and sends a password-setting code. Never pass a real user's password through the CLI. Use internal `admin:setProfile` for role changes or archiving, supplying the actual Convex user ID, name, roles and archived flag. Administration is audited with a null actor representing trusted deployment administration; it does not impersonate an app user.

## Password recovery and invitations

The reset form returns the same response whether an account exists. A configured Resend credential and verified `Support@glarahome.com` sender are required for delivery. Recipients enter their email, single-use code and new password at `/update-password`; codes expire after 15 minutes. Public registration remains disabled. Legacy Supabase recovery URLs do not create Convex sessions.

**Email acceptance: DEFERRED — REQUIRED BEFORE PRODUCTION.** A missing provider is handled safely but is not successful email delivery. Before release, verify invitation and recovery delivery to an authorized test inbox, expiry, reuse rejection, password change and old-session invalidation. No customer email was sent during this migration. MFA/magic-link expansion remains deferred.

## Data and business rules

`convex/schema.ts` defines Auth tables plus profiles, brokerages, lead_sources, realtors, realtor_private, activities and audit_logs. Native Convex IDs replace UUIDs; references are validated in mutations. M2 adds properties, opportunities, consultations, quotes/items and sales counter/metric/settings tables. M3 adds the operational tables composed from `convex/operationsSchema.ts`; dates remain canonical in operations events and ad hoc project tasks extend Activities. See `docs/M2-report.md` for implementation, acceptance results and outstanding production gates. Average listing prices are validated decimal strings to preserve cents without floating-point storage; future financial calculations must use an exact decimal representation.

Mutations validate inputs on the backend and commit business changes and audit events atomically. Prospect creation requires a dated next action; completion/cancellation cannot remove the last one without replacement. Rescheduling preserves the original due date, cancels the original and links its replacement. Case-normalized emails and normalized phone numbers prevent active duplicates. Version checks reject stale Realtor and brokerage edits. Archiving retains activity history; restoring requires Owner/Admin and rechecks next-action, assignment and contact invariants. Clients cannot supply audit actors.

Schema/index definitions and generated bindings are version controlled. For future schema changes use additive fields and indexes first, then an internal, paginated, idempotent backfill before requiring new fields. Do not use destructive resets as a migration method. Reference deletions and invariant checks belong in the same mutation. Current source initialization is repeatable and inserts only reusable source labels.

## Structure

| Directory         | Purpose                                                                        |
| ----------------- | ------------------------------------------------------------------------------ |
| src/app           | Protected App Router pages, auth screens, server actions and search route      |
| src/components    | Responsive shell, accessible primitives and CRM forms                          |
| src/lib/crm       | Shared input/output contracts, permissions, data adapter and safe errors       |
| convex            | Schema, Auth, centralized authorization, transactional CRM and audit functions |
| convex/_generated | Generated typed backend bindings                                               |
| tests/convex      | Transactional backend/security tests using convex-test                         |
| tests/e2e         | Real hosted desktop/mobile browser workflows                                   |
| tests/support     | Disposable identity checks and hosted API runner                               |
| legacy/supabase   | Preserved SQL migrations, adapters and old test harness                        |
| docs              | Architecture, operations and dated acceptance evidence                         |

## Verification

```powershell
npm run typecheck
npm run lint
npm test
npm run format:check
npm run build
npm audit
```

Hosted tests require an explicitly selected disposable deployment and eight fictional role accounts. Set `GLARA_CONVEX_ACCEPTANCE=yes`, `PLAYWRIGHT_CHANNEL=chrome` (or install Playwright Chromium), and inject `GLARA_CONVEX_IDENTITIES` from a secret store. Its shape is `{deployment,url,users:{owner:{email,password,id},sales:{...},admin:{...},marketing:{...},designer:{...},staging_crew:{...},unassigned:{...},archived:{...}}}`. Email addresses must end in `@accounts.example.test`; the runner verifies that the selected URL matches `.env.local`. Never commit this JSON.

```powershell
node tests/support/convex-hosted-acceptance.mjs
npm run test:e2e
```

The browser runner builds production Next.js and tests the actual Convex backend. No fake auth server is used. Tests create fictional records and preserve audit history. Direct test-password provisioning is an internal function gated by `GLARA_ACCEPTANCE_MODE=true` and reserved fictional email addresses. This flag is unnecessary for normal operation and should remain unset outside a disposable test deployment.

## Deployment and remaining limits

Vercel remains the frontend target. Use a separate production Convex deployment with its own signing keys, verified email provider and exact HTTPS `SITE_URL`. Scope the secret `CONVEX_DEPLOY_KEY` to its Vercel environment and use `npx convex deploy --cmd 'npm run build'`. Configure the matching public URLs and complete hosted acceptance for that environment before inviting staff. See the [official Vercel deployment guide](https://docs.convex.dev/production/hosting/vercel).

The current hosted backend is a **development deployment in eu-west-1**, not Canada. Only fictional test records were created; no company data was transferred. Production deployment, regional placement, backups/restoration testing and email acceptance are not complete.

Current CRM filtering/derived follow-up sorting performs bounded scans (explicit failure above 10,000 Realtor records), and broad activity/choice queries remain appropriate only for an initial small internal deployment. Indexed cursor pagination and load testing are required before a large import; the UI does not silently truncate Realtor totals. Storage/media workflows, automation and AI are intentionally deferred; M5 implements agreements, invoices and recorded payments. M3 operational bounds are documented in its report.

The old Supabase project is untouched. Historical reports describe that backend and do not certify Convex. See [Convex migration acceptance](docs/convex-migration-report.md) for current evidence. Full rollback baseline: commit `a6ee904`; use a separate checkout with its original lockfile/configuration. That historical rollback baseline predates M2; the current repository includes M2 and M3.

The product owner has superseded all Supabase-specific acceptance gates. Invitation/recovery delivery, expired/reused code handling, production origin/redirect verification, provider configuration and Support@glarahome.com sender/domain verification are **DEFERRED — REQUIRED BEFORE PRODUCTION**. Later authorized milestones supersede the historical migration stop condition; M4 and M5 were subsequently authorized. Do not begin M6.

## M2 Sales CRM development

The M2 implementation is deployed to the approved Convex development environment and has passed hosted API and desktop/mobile acceptance. Read [the M2 report](docs/M2-report.md) for the earlier sales acceptance. Sales schemas and money rules are in `src/lib/sales`, backend functions in `convex/sales.ts`, and UI in `src/components/sales`. After an approved development deployment, run the internal paginated `admin:backfillSalesSearch` function for existing Realtors.

With the existing fictional acceptance identities configured (never commit credentials), run `node tests/support/m2-hosted-acceptance.mjs` and `npm run test:e2e`. Both require `GLARA_CONVEX_ACCEPTANCE=yes`; browser tests can use `PLAYWRIGHT_CHANNEL=chrome`. The browser runner builds and starts a production Next server on port 3000, so stop any current server first. Production email/auth gates remain deferred and required before production.

## Convex Auth memory-storage compatibility fix

`@convex-dev/auth` is pinned to `0.0.95`. Its memoized in-memory storage captures the initial React state, so later token reads can return an empty value during a forced WebSocket refresh. `scripts/patch-convex-auth.mjs` replaces only that storage helper with a ref-backed implementation in the SDK source and distribution. `npm ci` runs this idempotent postinstall fix; version and original-source hashes fail closed if the upstream implementation changes. Review/remove the fix when upgrading the SDK. Do not install with lifecycle scripts disabled unless you subsequently run `npm run postinstall`.

Workspace client queries also wait for Convex authentication confirmation. Backend session/profile/role checks remain mandatory. Access tokens remain in memory, refresh credentials remain in HttpOnly cookies, and no auth token is persisted to local storage. Browser regression checks cover the live sales summary, navigation/search, cookie attributes, empty auth local storage and logout. See [Convex authentication guidance](https://docs.convex.dev/client/nextjs/app-router/) and the installed SDK source for context.

## M3 Staging Operations development

Owner/Admin can create a staging project from a won opportunity, then manage rooms, checklist gates, assignments, calendar, package dates, restricted access, notes and tasks. Sales sees related projects; assigned Sales project managers receive explicit project management access. Designers and crew are restricted to assigned operations; Marketing receives a safe content-stage projection. Read [the M3 report](docs/M3-report.md) for the exact permission matrix and limits.

Deploy additive M3 schema/functions with `npx convex dev --once --env-file .env.local` against your authorized development target. No M3 backfill or new environment variable is required. The first project safely creates the default checklist template; Owner/Admin can configure it and capacity at `/projects/settings`. Event inputs/displays use Vancouver time; timestamps are stored in UTC.

With the existing fictional acceptance environment, run `npx tsx tests/support/m3-hosted-acceptance.ts` and `npm run test:e2e`. The hosted M3 runner is guarded to the named development deployment. Browser tests cancel/archive their fictional projects while preserving commercial/audit history. Stop any running Next production server before building or running the standard browser runner. Production requirements remain **DEFERRED — REQUIRED BEFORE PRODUCTION**.

## M4 Inventory development

Read [the M4 report](docs/M4-report.md) before release. This milestone adds products, serialized assets, quantity stock, configurable categories and locations, date-aware room reservations, picking, installation, returns, inspection, damage/missing records, transfers, retail availability and an immutable movement ledger. No new package, secret or external integration is needed.

1. Sign in as Owner/Admin. Open Inventory → Categories & locations, and configure the actual categories and source locations.
2. Create a Product with an explicit SKU and serialized/quantity tracking. Each variation is a separate SKU. Receive physical inventory with a location, condition and reason.
3. Open an assigned Project → Inventory. Designers or Owner/Admin choose a room, source and inclusive reservation dates; pick dates must fall within that window. Planned demand does not allocate inventory.
4. Assigned crew use the mobile Pick list, confirm quantities or asset numbers, and explicitly record installation. Unused picked items can return directly; installed pieces require the destaging workflow.
5. Returns enter inspection. Owner/Admin records inspection, cleaning/repair release, missing recovery or write-off. Project status never makes items available automatically.
6. Preserve the ledger. Correct stock through traced movements, never database edits. Archive products only after their owned stock and reservations are reconciled.

M4 uses existing Convex sessions and server-side project access. Owner/Admin manages stock. Designers receive the catalog and their assigned project allocations. Crew receives assigned project inventory actions. Sales and Marketing cannot invoke inventory functions. No acquisition costs or prices are stored in M4.

Run local regression with `npm run test`, `npm run typecheck`, `npm run lint`, `npm run format:check` and `npm run build`. Hosted M4 acceptance is `npx tsx tests/support/m4-hosted-acceptance.ts`; it requires the existing fictional identity opt-in and the explicitly authorized development deployment. Additional hosted quantity acceptance is `npx tsx tests/support/m4-quantity-hosted.ts`. Browser coverage is in `tests/e2e/inventory.spec.ts` and `tests/e2e/inventory-mixed.spec.ts`. Never run a production build over a running Next server: stop it first, build, then restart.

Both M4 attachments (sections 1–130) are covered by the report, including explicit limits and optional features. M5 was subsequently implemented under its separate authorization. Invitation/recovery email delivery, production auth/origin verification and sender/provider configuration remain **DEFERRED — REQUIRED BEFORE PRODUCTION**.

## M5 commercial operations

Owner/Admin can manage billing customers and defaults under Payments → Billing customers & defaults. Open a Project → Commercial for agreements, source/manual invoices, received payments, extensions and inventory-charge assessments. Assigned Sales has read-only commercial access. Designer, Crew and Marketing are denied commercial data. All issued amounts are snapshots and balances derive from immutable payment/credit records. No email or money transfer is performed by these workflows.

M5 is deployed to the explicitly authorized Convex development deployment `woozy-jaguar-392`. The corrected production frontend build is used for desktop/mobile acceptance. See [the M5 report](docs/M5-report.md) for results and corrections. No additional environment secret is required for M5. Production email/auth requirements remain **DEFERRED — REQUIRED BEFORE PRODUCTION**. M6 has not started.
