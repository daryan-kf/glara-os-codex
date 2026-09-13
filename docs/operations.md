# Convex operations

Use the root README for exact development setup and environment variables. Keep development and production deployments separate. Deploy reviewed schema/functions using the Convex CLI and bind Vercel to the matching backend. Signing keys and deployment credentials are backend/build secrets only.

Provision users through internal `admin:provision`; change roles or archive through internal `admin:setProfile`. Confirm the target deployment before administrative changes. Do not use client metadata as a role source. Email delivery requires a verified sender and provider credential; invitation/recovery acceptance is still pending.

Before schema changes, export a backup using the Convex dashboard or `npx convex export --path <backup-path>`, store it outside the repository in protected storage and test restoration to a separate disposable deployment. A backup or restore drill has not been performed as part of this migration. Never import over a populated production deployment as a routine migration.

CRM audit rows identify app users for business changes and null actors for trusted deployment administration. Safe application error logs exclude payloads and credentials. Do not enable verbose auth token logging. Test reports/traces and `.env.local` are ignored.

The current acceptance deployment contains fictional users/records only and is in eu-west-1. Regional choice, production hosting, backup scheduling, load testing and email delivery must be settled before staff rollout. The previous Supabase project remains available for rollback; the original code is commit `a6ee904` and archived migrations/tests remain in source control.
