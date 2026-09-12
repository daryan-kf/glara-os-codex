# Before production use

M0 establishes the foundation; production readiness also depends on the configured infrastructure.

1. Apply migrations to a development Supabase project, then run the live browser checks. Verify owner, sales, designer, crew, admin and marketing access. Verify an unassigned and archived account cannot access the workspace.
2. Disable signup, set exact application Site URL, install token-hash email templates, configure SMTP and Auth rate limits, and verify invitation/recovery flows in a real mailbox. Test expired and already-used links.
3. Provision the owner through trusted administration. Do not share owner accounts. Keep at least one active owner; review access on employee departure and revoke sessions.
4. Enable the appropriate Supabase backup/PITR plan for the company's recovery requirements. Proposed initial targets for owner approval: RPO 24 hours, RTO 4 hours. Test restoration into a separate project before relying on backups, then quarterly. Supabase Storage files will need a separate backup plan once introduced.
5. Review Vercel/Supabase account access, deploy over HTTPS, use separate environments, and enable platform security notifications. Confirm the actual region, data residency and retention choices before storing client data.
6. Logs intentionally include only allowlisted event names and timestamps. Do not add passwords, tokens, full form data, or personal data to logs. Auth logs live in Supabase; application audit rows cover identity/role changes only.
7. Future financial changes, discounts, payment state and asset movements require transactional business audit events. Database audit records are not proof of real-world payment or physical inventory movement.
8. Configure monitoring and backup failure alerts through platform tooling. No future third-party integration is included in M0.
9. MFA support is deferred; add enrollment, recovery, and assurance-level enforcement before claiming owner/admin two-factor protection.
10. Storage buckets/policies are intentionally absent. Do not introduce public client-document buckets.
