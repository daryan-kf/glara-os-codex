# Convex architecture

The active backend is Convex. See the root README for deployment and authentication setup.

The Next.js UI calls a server-only adapter (`src/lib/convex.ts`) with a cookie-backed user token. Backend query/mutation functions independently validate identity, active sessions, roles and inputs. Convex Auth owns identity/session tables; profiles own application permissions. Role changes and archived profiles are checked on every business operation.

CRM mutations commit their related documents and audit events together. The private Realtor companion document keeps sensitive attributes out of Marketing projections. Native IDs replace PostgreSQL UUIDs. Decimal price strings preserve exact values; there is no financial module yet. Archive flags and timestamp fields retain the M1 business model.

Backend schema/index declarations are the reproducible foundation. Future data migrations must use bounded, idempotent internal mutations with an additive rollout. Generated API types are checked into source control. There is no public generic table-write or role-provisioning API.

The preserved Supabase architecture and SQL history are under `legacy/supabase`; pre-migration reports are historical evidence only. M2 and later remain unimplemented. See `convex-migration-report.md` for test evidence and explicit release limitations.
