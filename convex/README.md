# Glara backend

`schema.ts` defines the active Convex data model. `access.ts` centralizes session and role checks; `crm.ts` implements validated transactional M1 operations. `auth.ts` and `http.ts` configure Convex Auth. `admin.ts` contains trusted internal provisioning functions only. Never expose deployment credentials to browser clients.

Run `npm run convex:dev` from the repository root to develop. Commit reviewed schema/functions and regenerated bindings together. The root README documents setup, invitations, deployment and acceptance. Do not run the preserved Supabase migrations against this backend.
