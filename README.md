# Glara OS

Private operating system for Glara Home Staging, Metro Vancouver. **Milestone 0 only**: authentication, authorization, database conventions, and a responsive application shell. Business modules are intentionally placeholders.

## Run locally

Requirements: Node.js 22.9+ (24 LTS recommended), npm, Git, a development Supabase project, and several GB of free disk space.

1. Clone the repository and open its root.
2. Run `npm ci`.
3. Copy `.env.example` to `.env.local`.
4. Set the Supabase project URL and **publishable** key from the project's API settings. Do not use a service-role or secret key.
5. Apply the migration and configure Auth using the steps below.
6. Run `npm run dev`, then open http://localhost:3000.
7. Sign in with an invited, role-assigned development user.

Without environment variables the login page shows a setup state, disables sign-in, and protected routes redirect to login. There is no demo-access bypass.

PowerShell:

```powershell
Copy-Item .env.example .env.local
npm ci
npm run dev
```

## Environment

| Variable                             | Purpose                                                 | Exposure             |
| ------------------------------------ | ------------------------------------------------------- | -------------------- |
| NEXT_PUBLIC_SUPABASE_URL             | Supabase project HTTPS URL; local Supabase may use HTTP | Public configuration |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Publishable key; RLS governs database access            | Public by design     |

Environment files and build outputs are ignored by Git. No service-role key is required by this application. Test credentials belong only in local environment variables, never source control. Supabase's Auth Site URL must match the application's origin.

## Database setup

Install the Supabase CLI using its official installation instructions. From this repository:

```sh
supabase login
supabase link --project-ref YOUR_DEVELOPMENT_PROJECT_REF
supabase db push
```

Review the linked project before pushing. Do not apply development migrations to an existing production system without reviewing its schema and backup.

For a fully local backend, install Docker and the Supabase CLI, then run `supabase start`. Use the local URL and publishable/anon key reported by the CLI. `supabase db reset` rebuilds **local development data** from migrations; it destroys local records. Do not use reset against production.

The sole migration is `supabase/migrations/202609120001_foundation.sql`:

- `profiles`: one per `auth.users` account, display name, timestamps, archive timestamp.
- `roles`: six supported roles.
- `user_roles`: explicit, unique user-role assignments.
- `audit_logs`: identity and role changes; no client inserts, updates, or deletes.
- Private, fixed-search-path functions for provisioning, access checks, timestamps, and audit triggers.

Supabase owns `auth.users`; Glara does not duplicate passwords, sessions, or email addresses in profiles. UUID identifiers, foreign keys, constraints, and timezone-aware timestamps are established. The migration also creates profiles for pre-existing Auth users without granting access.

## Invite-only authentication

In the Supabase dashboard:

1. Disable public signups.
2. Set the Auth Site URL to `http://localhost:3000` for development and the exact HTTPS application origin in production. Use separate projects for development and production.
3. Set the minimum password length to 12; enable available breached-password protection and appropriate Auth rate limits.
4. Copy `supabase/templates/invite.html` and `recovery.html` into the corresponding Supabase email templates. They use token hashes and `/auth/confirm`, rather than the default browser-only fragment flow.
5. Configure a verified SMTP sender before relying on production invitation or recovery delivery.
6. Invite the initial owner through Supabase Auth administration.
7. Assign the owner's role using the SQL below, replacing the sample UUID with the invited user's actual Auth UUID.
8. Follow the invitation email, choose a password, and sign in.

```sql
-- Run only in trusted Supabase SQL administration.
insert into public.user_roles(user_id, role)
values ('REPLACE_WITH_ACTUAL_AUTH_USER_UUID'::uuid, 'owner')
on conflict (user_id, role) do nothing;

-- Display-name changes are also trusted administration in M0.
update public.profiles
set display_name = 'Your team member name'
where id = 'REPLACE_WITH_ACTUAL_AUTH_USER_UUID'::uuid;
```

Invite subsequent users and assign only the appropriate roles: owner, sales, designer, staging_crew, admin, marketing. Users without an active profile and explicit role are denied access. Never derive roles from signup metadata.

Login, logout, password recovery, invitation acceptance, and password change use Supabase SSR cookies. Proxy refreshes sessions; the server data-access layer independently verifies the user with Auth and reads current database roles. Page authorization is enforced on every module page, in addition to the protected layout. Future server actions must call the relevant authorization function independently.

Password reset responses do not reveal whether an email is registered. Invalid links show a safe error. Password updates end the current session and return to login. Additional MFA enrollment and assurance-level enforcement are deferred.

## Architecture and directories

| Path                   | Responsibility                                                         |
| ---------------------- | ---------------------------------------------------------------------- |
| src/app                | App Router pages, auth server actions, confirmation route, boundaries  |
| src/app/(workspace)    | Authenticated shell and allowlisted module pages                       |
| src/components/ui      | Local shadcn-style Button and Radix Dialog primitives                  |
| src/components         | Navigation, search, auth form, empty/loading states, design primitives |
| src/lib/auth.ts        | Server-only identity and module authorization                          |
| src/lib/permissions.ts | Single module-access matrix shared by server and UI                    |
| src/lib/supabase       | Typed, cookie-aware server data client                                 |
| supabase/migrations    | Versioned, reproducible schema changes                                 |
| supabase/templates     | Invitation and password recovery email templates                       |
| tests                  | Authorization, PostgreSQL RLS, desktop/mobile browser checks           |
| docs                   | Architecture, operational guidance, milestone report                   |

The frontend uses Next.js App Router, strict TypeScript, React, Tailwind v4, and local shadcn-style primitives built on Radix. No external font or image service is required. The restrained forest/stone palette and serif headings use system fonts.

Every requested module route exists, plus notifications and profile. Search currently navigates modules. New opens a clearly labelled roadmap of future quick-create actions. No fake revenue, client records, working CRUD, or future integrations are included.

## Permissions and storage

Owner has access to all module routes. Others receive explicitly scoped navigation and server access. Reports and settings are owner-only. Payments is owner/admin. Role combinations take the union of explicit grants.

These are **module gates**, not a substitute for future row-level business policies. Crew project assignment restrictions, designer-specific property fields, marketing subsets of realtor information, and financial field visibility must be enforced in M1+ data access and RLS before records are introduced.

All four public tables have RLS. Normal authenticated users can read their own profile and assigned roles; active owners can read identity and audit records. Authenticated API writes are disabled even for owners in M0; trusted SQL administration handles provisioning until a reviewed administrative workflow exists. Archived profiles lose role access on subsequent server requests.

No Storage bucket is created in M0 because there is no file workflow. Future buckets must be private with entity-aware policies and signed URLs; store metadata and references in PostgreSQL, not file blobs.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

Unit/database tests use PGlite's PostgreSQL runtime with a small Auth-schema harness to validate the actual migration and RLS. Browser tests use the real Supabase SDK against a **test-only HTTP contract double** started by Playwright. The double is not an authentication service and is never imported by the application.

Live Supabase acceptance:

```powershell
$env:E2E_LIVE='1'
$env:E2E_EMAIL='fictional-owner-in-your-dev-project@example.test'
$env:E2E_PASSWORD='the-development-users-password'
npm run test:e2e
```

Configure `.env.local` first and use a real deliverable test mailbox when verifying emails. Live mode disables the HTTP double. Do not run against real client data.

See `docs/M0-report.md` for actual results and remaining acceptance checks.

## Deployment and operations

Vercel is the intended target; no deployment is performed by this repository setup. Import the Git repository as a Next.js project, configure the two public environment variables separately for preview and production, and configure Supabase's Site URL/email templates for the intended origin. Use HTTPS. Do not reuse production data in preview environments.

Before production use, complete `docs/operations.md`, run the live acceptance suite, and test invitation and recovery delivery. Future modules require new reviewed migrations, permission policies, validation, and tests. **Do not start M1 automatically.**

Browser tests build and run the production server. If Chromium is not installed through Playwright, set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome in an isolated test profile. Session cookies are HttpOnly, SameSite=Lax, and Secure in production; there is no browser-side Supabase auth client in M0.

Visual references using fictional test identities: [desktop dashboard](docs/screenshots/dashboard-desktop.png) and [mobile dashboard](docs/screenshots/dashboard-mobile.png).
