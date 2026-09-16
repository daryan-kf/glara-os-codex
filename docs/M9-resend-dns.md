# M9 Resend DNS records for glarahome.com

These exact records were returned by the authorized Resend API for `glarahome.com` on 2026-09-16 UTC. All four were absent during initial setup. The owner subsequently added them; all four now match Google, Cloudflare and both authoritative nameservers, and Resend reports verified (2026-09-16 UTC). This document contains public DNS verification material only, not API keys or signing secrets.

Historical setup location in Hostinger: **Domains → Domain portfolio → glarahome.com → Manage → DNS / Nameservers → DNS records**. The following records are already present; retain them. Hostinger's Name field uses the relative names shown below. Use Auto/default TTL where available; 3600 seconds is suitable if a number is required.

| Type  | Host / Name         | Value / Target                                                                                                                                                                                                               | Priority | Purpose                                 |
| ----- | ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | --------------------------------------- |
| TXT   | `resend._domainkey` | `p=MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDYbAW9aGNoYn8EnyVhfLsqbHovBt/3ZMtTsEz8eerl/VXB/JSdW0VaqEeg/cAj1ib8Ecn8wcU6dGu3EexeD7jqX+BVM/EogsM0G5opGmH0h/6OK10JWn0Ecf8o8AkEoO3DEHlby479pTTJ5WXU7HrRD/PsgRCHle5TPm0xbdSsVQIDAQAB` | —        | Resend DKIM public key                  |
| MX    | `send`              | `feedback-smtp.us-east-1.amazonses.com`                                                                                                                                                                                      | 10       | Resend return-path mail routing         |
| TXT   | `send`              | `v=spf1 include:amazonses.com ~all`                                                                                                                                                                                          | —        | Resend sending-subdomain SPF            |
| CNAME | `rsend`             | `send.forge.rmta.net`                                                                                                                                                                                                        | —        | Resend-issued additional sending record |

Keep the existing root-domain Hostinger MX and SPF records, existing DKIM selectors, nameservers and `_dmarc` record unchanged. The new SPF belongs at **send**, not **@**; do not add a second root SPF record. Receiving through Resend is disabled, so root MX changes are unnecessary.

The existing DMARC record is `v=DMARC1; p=none`; no DMARC edit is required for this setup. Later production policy review remains deferred. No DNS change has been performed by Codex.

DNS setup is complete. Do not recreate these records. Live email acceptance evidence is in `M9-email-acceptance.json`; development sending was restored to disabled afterward.

References: [Hostinger DNS management](https://www.hostinger.com/support/1583249-how-to-manage-dns-records-at-hostinger/) and [Resend domain verification](https://resend.com/docs/dashboard/domains/introduction).
