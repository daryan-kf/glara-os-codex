# Glara OS

Private operating system for Glara Home Staging, Metro Vancouver. **M1 — Realtor CRM** extends the M0 authentication, authorization and responsive shell. Brokerages, Realtor relationships, manual activities, tasks and follow-ups are functional. M2 and later modules remain placeholders.

## Run locally

Requirements: Node.js 22.9+, npm, Git and a development Supabase project.

1. Clone the repository and open its root.
2. Run `npm ci`.
3. Copy `.env.example` to `.env.local`.
4. Set the Supabase URL and publishable key.
5. Apply both migrations and configure invite-only Auth below.
6. Run `npm run dev`; open http://localhost:3000.
7. Sign in as an invited user with an active profile and an assigned role.
8. Open Realtors. Create a brokerage if needed, then a fictional development Realtor. Prospects require an initial next action with a date.

```powershell
npm ci
Copy-Item .env.example .env.local
# Edit .env.local, configure Supabase and apply migrations.
npm run dev
```

Without environment variables, login displays a setup state, sign-in is disabled, and protected routes redirect to login. There is no demo-access bypass.

## Environment

| Variable                             | Purpose                                                       | Exposure                           |
| ------------------------------------ | ------------------------------------------------------------- | ---------------------------------- |
| NEXT_PUBLIC_SUPABASE_URL             | Supabase project HTTPS URL; HTTP permitted for local Supabase | Public configuration               |
| NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY | Project publishable key                                       | Public by design; RLS governs data |

Never use a service-role or secret key in these variables. No service-role key is required by the app. Environment files, logs, browser traces and build outputs are ignored by Git. No additional environment variables are needed for M1.

## Database setup

Install the Supabase CLI, then link a **development** project:

```sh
supabase login
supabase link --project-ref YOUR_DEVELOPMENT_PROJECT_REF
supabase db push
```

Verify the linked project before pushing. Review its schema and backup before applying changes to an existing environment. An existing M0 installation needs only the new M1 migration; do not reset it.

For a fully local backend, install Docker and the Supabase CLI, then run `supabase start`. Use its local URL and publishable/anon key. `supabase db reset` rebuilds local development data from migrations and destroys local records; it is not a production deployment command.

Ordered migrations:

| Migration                    | Purpose                                                                                                               |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| 202609120001_foundation.sql  | Profiles, roles, user_roles, audit_logs, identity provisioning, RLS                                                   |
| 202609130001_realtor_crm.sql | Brokerages, lead_sources, realtors, realtor_private, activities; query/mutation RPCs, RLS and next-action constraints |

M0 migration history is unchanged. Supabase owns `auth.users`; Glara never stores passwords. UUIDs, foreign keys, timestamps, constraints, relevant indexes and audit triggers are reproducible from migrations. M1 seeds only 12 reusable lead-source names; no client or Realtor records are seeded.

## Invite-only authentication

In Supabase administration:

1. Disable public signups.
2. Set Auth Site URL to `http://localhost:3000` for development and the exact HTTPS application origin for production. Keep development and production projects separate.
3. Set minimum password length to 12; enable available breached-password protection and appropriate Auth rate limits.
4. Copy `supabase/templates/invite.html` and `recovery.html` into their email templates. These use token hashes and `/auth/confirm`.
5. Configure a verified SMTP sender for production invitation/recovery delivery.
6. Invite the initial owner.
7. Assign the owner's actual Auth UUID through trusted SQL administration:

```sql
insert into public.user_roles(user_id, role)
values ('REPLACE_WITH_ACTUAL_AUTH_USER_UUID'::uuid, 'owner')
on conflict (user_id, role) do nothing;

update public.profiles
set display_name = 'Your team member name'
where id = 'REPLACE_WITH_ACTUAL_AUTH_USER_UUID'::uuid;
```

8. Follow the invitation, choose a password and sign in.

Invite other users and explicitly assign owner, sales, designer, staging_crew, admin or marketing. Unassigned and archived profiles fail closed. Never derive roles from signup metadata.

Supabase SSR cookies are HttpOnly, SameSite=Lax and Secure in production. Proxy refreshes sessions. The server independently verifies Auth identity and reads current profile/role assignments on requests. Login, logout, invitations and password recovery remain intact. Reset responses do not disclose whether an email exists; password changes end the current session. MFA remains deferred.

## Using the Realtor CRM

- **Realtors:** search name, email or phone; filter status, brokerage, city/area, owner, source and follow-up; sort by name, newest or next action. Lists fetch 25 rows per page.
- **Realtor 360:** contact and relationship information, manual scores, private notes, open next actions, chronological history and clearly labelled future sections.
- **Activities:** manually record a call, email, Instagram DM, SMS, meeting, consultation, note, task or follow-up. Nothing is sent externally.
- **Follow-ups:** due-date queue, everyone/assigned-to-me filters, priority and completion. Dates display in Vancouver time; date fields accept the device's local time.
- **Next-action discipline:** every active prospect must retain an open dated action. Completing its last action requires a replacement in the same transaction, or changing its relationship status first. Dormant and historical relationships need no forced date.
- **Archive:** hides the Realtor and its open actions from active views; history remains. Owner/admin can select Archived only and restore. Duplicate active contacts can block restoration.
- **Brokerages and lead sources:** create/edit offices; owner/admin maintain reusable lead-source names.
- **Global search / New:** bounded Realtor results alongside module navigation, and quick creation of Realtor, brokerage or follow-up/task.

Tasks are specialized activity types, so due dates, ownership and completion have one source of truth. First/last contact and next follow-up are derived from activities. Manual scores are optional; no automated scoring is introduced. Average listing price is stored as PostgreSQL numeric(16,2), in CAD.

## Architecture and directories

| Path                         | Responsibility                                                 |
| ---------------------------- | -------------------------------------------------------------- |
| src/app/(workspace)/realtors | Server-rendered CRM pages and centralized validated mutations  |
| src/app/api/crm/search       | Authorized bounded lookup endpoint                             |
| src/components/crm           | Forms, timeline, follow-up cues, search and pagination         |
| src/components/ui            | Existing local shadcn-style Button / Radix Dialog primitives   |
| src/components/shell.tsx     | Desktop/mobile navigation, global search and New               |
| src/lib/crm/model.ts         | Zod schemas, CRM permission helpers, types and date formatting |
| src/lib/crm/data.ts          | Server-only authorized query layer                             |
| src/lib/auth.ts              | Identity verification and module authorization                 |
| src/lib/permissions.ts       | Central module access matrix                                   |
| src/lib/supabase             | Typed cookie-aware client and RPC contracts                    |
| supabase/migrations          | Ordered schema, constraints, RLS, functions and indexes        |
| tests                        | Validation, actual PostgreSQL migration/RLS and browser tests  |
| docs                         | Architecture, operations, milestone reports and screenshots    |

Strict TypeScript, Next.js App Router, React, Tailwind and Radix remain unchanged. Server Components fetch data; client components own interaction. Mutations explicitly map fields, validate with Zod, then invoke a transactional database operation. The database independently checks authorization and constraints. No arbitrary table, field, actor or role is accepted from the client.

## Permissions

| Role                         | CRM access                                                                                                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Owner                        | Full operational access, archive/restore, sources, owner-only audit logs                                                                                          |
| Sales                        | Operational active Realtor CRM, brokerages, activities and archive; no restore/source configuration                                                               |
| Admin                        | Operational CRM plus archive/restore and source configuration                                                                                                     |
| Marketing                    | Active safe directory: contact details, brokerage name, location, relationship status, owner and source; no private notes, scores, activity history or CRM writes |
| Designer / Staging crew      | No general Realtor CRM data access                                                                                                                                |
| Anonymous / archived profile | No CRM access                                                                                                                                                     |

Role combinations retain explicit grants. Every new table has RLS. Sensitive Realtor fields live in `realtor_private`; Marketing cannot retrieve them even with direct API queries. Brokerage notes are also restricted, with only safe brokerage projections exposed to Marketing. Team roster policies expose active display names and operational role assignments, not Auth email/password data.

Direct authenticated table writes are disabled, including for owners. Narrow RPC operations enforce current identity, active assignees, allowlisted fields, atomic next actions and optimistic Realtor version checks. Audit triggers capture old/new values and server-derived actors. Identity/role administration still requires trusted Supabase administration.

No Storage bucket or media integration is added in M1. Future storage must be private and entity-authorized.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

On a computer with Chrome installed:

```powershell
$env:PLAYWRIGHT_CHANNEL='chrome'
npm run test:e2e
```

Database tests run the actual M0+M1 migrations in PGlite PostgreSQL with a minimal Auth schema harness. Browser tests run the production application and real Supabase SDK against a **test-only HTTP Auth/PostgREST double backed by that same database and RPCs**. This is not a substitute for hosted Supabase acceptance.

The isolated browser runner overrides public Supabase settings at **build time and runtime**, preventing accidental use of a developer's real database. It builds a test-configured `.next`; run `npm run build` with your real environment before using `npm start` for deployment. Test server code is never imported by the application.

For live authentication acceptance in a disposable development project:

```powershell
$env:E2E_LIVE='1'
$env:E2E_EMAIL='fictional-owner-in-your-dev-project@example.test'
$env:E2E_PASSWORD='the-development-users-password'
npm run test:e2e
```

Configure `.env.local` first. Live mode disables the double and skips the isolated CRM mutation fixtures. Manually repeat the M1 workflow with fictional data and role-specific accounts in your disposable project, including direct API RLS checks, then verify actual invitation/recovery email delivery. Never run these tests against real client data.

See [M1 report](docs/M1-report.md), [architecture](docs/architecture.md), and [operations](docs/operations.md). [M0 report](docs/M0-report.md) is a historical foundation report.

## Deployment

Vercel remains the target. Configure the two environment variables separately for preview and production; apply reviewed migrations; configure Supabase origin/email templates; use HTTPS. No hosted deployment or live database migration is performed by the local build.

Complete the live acceptance and backup/restore checklist in `docs/operations.md` before real team use. **M1 stops here; do not begin M2 without explicit authorization.**
