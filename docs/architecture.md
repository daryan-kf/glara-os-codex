# M0 architecture decisions

- Single private company application. No speculative multi-tenancy or microservices.
- App Router server components fetch identity. Client components own only interaction.
- A request-scoped React cache deduplicates identity reads; it does not cache identities across users.
- Proxy handles token refresh. getUser in the server data-access layer checks Auth, including server-side invalidation, before any profile or role access.
- Authentication authorizes identity, not business permissions. Current assignments are queried per server request; metadata cannot elevate access.
- Module definitions and permission grants are centralized. A catch-all module page is strictly allowlisted and rechecks permissions. Unknown paths return 404.
- Supabase RLS is the database boundary. No client-write policy is present in M0.
- Profiles can be archived. Role assignments are explicit access-control links; trusted removal is audited rather than soft-deleted.
- Audit triggers record identity/role changes transactionally. Trusted SQL changes without an Auth JWT have a null actor; correlate those with Supabase administrative logs. This is not yet a business-event or automation system.
- The database currently contains no financial values. Future currency columns use numeric precision and currency codes, not floats.
- All future business identifiers should be UUIDs with unique human-readable codes when appropriate. Project numbers and asset codes are separate identifiers.
- Product catalog records and physical inventory assets remain separate future entities. Asset movement history and date-range reservation conflicts must be designed before inventory CRUD.
- An active opportunity must have an owner, next action, and next-action date; lost opportunities need a reason. Enforce lifecycle invariants at both service and database boundaries in M2.
- Future quote items, agreement templates, generated agreements, invoice/payment records, media metadata, and transactional histories remain separate sources of truth.
- Business tables use created_at/updated_at, appropriate deleted_at, validated foreign keys and uniqueness constraints. Avoid computed metrics as independent editable truth.
- No future tables, AI, email-marketing provider, SMS, calendar integration, mapping integration, automation engine, or business CRUD was built.

## Design primitives

PageTitle, SectionHeading, StatCard, EmptyState, StatusBadge, Avatar, LoadingState, FormField, TableShell, Button, and Dialog establish a small foundation. Sign-out exercises the confirmation pattern; navigation/search use accessible Radix dialogs with focus handling and Escape support. Tables/stat cards are ready for future real data and are not used to imply live metrics.

The desktop sidebar is independently scrollable. Mobile navigation is a drawer plus touch-friendly quick links. The shell uses semantic landmarks, a skip link, active navigation states, reduced-motion support and visible focus indicators.
