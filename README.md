# Glara OS

Private operating system for Glara Home Staging, Metro Vancouver. The active stack is **Next.js, strict TypeScript, Tailwind/shadcn UI and Convex with Convex Auth**. M0 foundation and M1 Realtor CRM are implemented. M2 and later modules remain placeholders.

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

Every CRM function checks the actual session record, its expiry, current profile and roles. Logout therefore denies a previously issued JWT immediately. Archived and unassigned profiles cannot access CRM. Browser navigation permissions are centralized in `src/lib/permissions.ts`; backend permissions are centralized in `convex/access.ts`. Owner has all module access. Sales/Admin operate CRM; Marketing receives a restricted read projection without private notes, scores, listing values, activity history or the operational roster. Designer/Crew are denied CRM functions. Only Owner can query audit records. Clients cannot call internal provisioning or access database tables directly.

User administration remains a trusted deployment operation, with no public role-editing endpoint. To invite a real user after email delivery is configured, run the internal `admin:provision` action from the Convex dashboard Functions panel with `email`, `name`, `roles` (for example `["owner"]`) and `sendInvitation: true`. It creates an unknown random password, assigns the profile and sends a password-setting code. Never pass a real user's password through the CLI. Use internal `admin:setProfile` for role changes or archiving, supplying the actual Convex user ID, name, roles and archived flag. Administration is audited with a null actor representing trusted deployment administration; it does not impersonate an app user.

## Password recovery and invitations

The reset form returns the same response whether an account exists. A configured Resend credential and verified `Support@glarahome.com` sender are required for delivery. Recipients enter their email, single-use code and new password at `/update-password`; codes expire after 15 minutes. Public registration remains disabled. Legacy Supabase recovery URLs do not create Convex sessions.

**Email acceptance: DEFERRED — REQUIRED BEFORE PRODUCTION.** A missing provider is handled safely but is not successful email delivery. Before release, verify invitation and recovery delivery to an authorized test inbox, expiry, reuse rejection, password change and old-session invalidation. No customer email was sent during this migration. MFA/magic-link expansion remains deferred.

## Data and business rules

`convex/schema.ts` defines Auth tables plus profiles, brokerages, lead_sources, realtors, realtor_private, activities and audit_logs. Native Convex IDs replace UUIDs; references are validated in mutations. No financial module was added. Average listing prices are validated decimal strings to preserve cents without floating-point storage; future financial calculations must use an exact decimal representation.

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

Current CRM filtering/derived follow-up sorting performs bounded scans (explicit failure above 10,000 Realtor records), and broad activity/choice queries remain appropriate only for an initial small internal deployment. Indexed cursor pagination and load testing are required before a large import; the UI does not silently truncate Realtor totals. Storage/media workflows, commercial modules, automation and AI are intentionally deferred.

The old Supabase project is untouched. Historical reports describe that backend and do not certify Convex. See [Convex migration acceptance](docs/convex-migration-report.md) for current evidence. Full rollback baseline: commit `a6ee904`; use a separate checkout with its original lockfile/configuration. No M2 work is included.

The product owner has superseded all Supabase-specific acceptance gates. Invitation/recovery delivery, expired/reused code handling, production origin/redirect verification, provider configuration and Support@glarahome.com sender/domain verification are **DEFERRED — REQUIRED BEFORE PRODUCTION**. No M2 implementation may begin before independent migration review.
