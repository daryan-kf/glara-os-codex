> Historical Supabase evidence. The active backend is now Convex; see [current migration report](convex-migration-report.md).

# Glara OS — M0 completion report

Date: 12 September 2026

**Status: M0 implementation delivered and locally verified. Live Supabase acceptance and production provisioning remain outstanding. M1 has not started.**

## A. Summary

Built a private Next.js application with strict TypeScript, Tailwind, local shadcn-style/Radix components, invitation-based Supabase authentication, protected routes, centralized role awareness, and a premium responsive shell.

Includes desktop sidebar, mobile drawer and quick navigation, module search, a New dialog that clearly identifies future actions, profile display, sign-out confirmation, error boundaries, loading states, safe configuration state, and all requested module placeholders plus notifications/profile. No business CRUD, real client data, integrations, or fabricated company metrics were added.

## B. Architecture

App Router server components and a server-only data-access layer enforce authentication. Proxy refreshes tokens; each protected module checks current database roles on the server. React request caching deduplicates identity reads within a request only. RLS independently restricts identity data.

The frontend uses centralized route definitions and grants. Session cookies are HttpOnly and SameSite=Lax, with Secure enabled in production. Server input validation uses Zod. Credentials and unfiltered errors are not logged.

## C. File structure

- `src/app`: routes, authentication actions, confirmation handler, layouts and boundaries.
- `src/components`: shell, auth UI, reusable display/form primitives.
- `src/components/ui`: local Button and accessible Dialog foundations.
- `src/lib`: authorization, environment validation, logging and typed Supabase access.
- `supabase`: migrations, local configuration, Auth email templates.
- `tests`: permission tests, PostgreSQL policy tests, browser tests, isolated Auth contract fixture.
- `docs`: architecture, operations and this report.

## D. Database

One migration: `202609120001_foundation.sql`.

Created profiles, roles, user_roles, and audit_logs, with UUID identifiers, constraints, relationships, indexes, timestamps, profile archiving, RLS, identity provisioning, and audit triggers. Supabase owns auth.users.

No business-domain tables or Storage buckets were created. API writes are intentionally unavailable in M0; role/profile administration uses trusted SQL. This includes owner administration until a reviewed UI/API is implemented.

## E. Authentication and roles

Login, logout, invitation confirmation, password recovery and password change are implemented. No public signup UI or role-from-metadata mechanism exists. Unassigned or archived profiles cannot enter the workspace.

Supported roles: owner, sales, designer, staging_crew, admin, marketing. Owner sees every module. Company reports/settings are owner-only; payments is owner/admin. Each future module must add record- and field-level policies before exposing business data.

## F. Local setup

1. Install Node.js 22.9+ and npm.
2. Run `npm ci` in this repository.
3. Copy `.env.example` to `.env.local` and set both Supabase variables.
4. With the Supabase CLI, run `supabase login`, `supabase link --project-ref YOUR_DEVELOPMENT_PROJECT_REF`, and `supabase db push`.
5. Disable public signup, configure the exact Auth Site URL, install the supplied invite/recovery templates and configure mail delivery.
6. Invite a fictional development user, assign the owner role using the README SQL, and set the password through the invitation link.
7. Run `npm run dev` and visit http://localhost:3000.

Dependencies are installed in the original D: workspace. Temporary installation files were used while that drive lacked free space; the final application has no dependency on that temporary directory.

## G. Environment variables

- NEXT_PUBLIC_SUPABASE_URL: project URL.
- NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: public/publishable API key.

No service-role credential is required. See README for environment separation, Auth configuration and Vercel deployment steps.

## H. Verification

| Check                                                   | Result                                                             |
| ------------------------------------------------------- | ------------------------------------------------------------------ |
| Production Next.js build                                | Passed                                                             |
| Strict TypeScript                                       | Passed                                                             |
| ESLint, zero warnings                                   | Passed                                                             |
| Permission and PostgreSQL migration/RLS tests           | 4 passed                                                           |
| Production browser suite                                | 10 passed                                                          |
| Desktop/mobile login and logout                         | Passed against Auth contract fixture                               |
| All 14 protected route redirects                        | Passed on desktop and mobile                                       |
| Owner dashboard, module navigation and search           | Passed                                                             |
| Mobile drawer and navigation                            | Passed                                                             |
| Sales direct access to owner reports                    | Denied as expected                                                 |
| Invalid credentials, recovery response and invalid link | Passed against fixture                                             |
| HttpOnly, Secure and SameSite=Lax session cookies       | Verified in production browser tests                               |
| Desktop and mobile screenshots                          | Visually inspected                                                 |
| Environment/secret hygiene                              | No real credentials or client data; env/build/dependencies ignored |
| Dependency audit at installation                        | No known vulnerabilities reported                                  |

The browser suite runs the real Supabase SDK against a local HTTP contract double. Database tests execute the actual migration in PGlite with a minimal simulated Supabase Auth schema. These are meaningful local checks, **not a live Supabase certification**.

Next.js emitted request-stream cancellation messages during rapid automated navigation, without failed assertions. The initial development-server run exposed a navigation timing race in the tests; the final suite waits for destination content and runs against the production server.

## I. Known limitations and remaining acceptance

- No Supabase project credentials were supplied; migrations have not been applied to a hosted project.
- Docker is not installed here, so a full local Supabase stack was unavailable.
- Real invitation/recovery email delivery, hosted Auth policies, live session refresh/revocation, and platform-specific deployment behavior need acceptance testing after configuration.
- No production deployment, remote repository or infrastructure backup setup was performed.
- User/profile administration is trusted SQL only in M0.
- Business-level record permissions, private Storage policies, MFA, financial auditing and all M1–M8 functionality remain deferred.

Run the documented live test mode and the operations checklist before treating the application as production-ready.

## J. M1 readiness

The foundation is ready for an explicitly authorized Realtor CRM milestone: reusable UI, typed server data access, route-level permissions, RLS conventions, UUID/timestamp/archive conventions, migration workflow and test harnesses already exist.

M1 should add brokerages, realtors, activities, tasks and follow-ups through new migrations, with appropriate role/field visibility and service-level authorization. **No M1 implementation is included.**
