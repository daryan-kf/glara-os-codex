# Final email / SMTP acceptance addendum

Date: 2026-09-13 UTC. Reviewed source: `2f5734e` on `daryan-kf/glara-os-codex`.

## Email Provider

**UNKNOWN — EXTERNAL SMTP CONFIGURATION REQUIRED.**

Read README, the hosted acceptance report/procedure, operations guidance, Auth configuration, both email templates and the confirmation handler. Local environment files contain only the Supabase URL and publishable key; no SMTP/provider environment variables were available. A read-only CLI configuration comparison targeted only disposable project `jymmquptpbzwpionmhvj` and exposed no configured SMTP provider details. This does not identify the provider hosting `glarahome.com` or prove that the mailbox is verified.

The previous acceptance run encountered the Free project's default email-provider template restriction. No new provider, SMTP credentials or controlled deliverable inbox has been supplied since that run. Following the user's explicit stop condition, no provider was guessed, no SMTP/DNS settings were changed, and no email was sent.

## Sender

Intended sender: `Support@glarahome.com`.

Intended display name: `Glara Home Support`.

Provider acceptance, sender verification and domain alignment are **not yet verified**. An email address alone is not an SMTP credential.

## SMTP Status

**MANUAL ACTION REQUIRED — EXTERNAL SMTP CONFIGURATION REQUIRED.**

Required before continuation:

1. Identify the actual email/SMTP provider for the intended sender, or provide access to its existing administration.
2. Supply its documented SMTP host, port, encryption mode and username.
3. Configure its SMTP password/app password/provider credential directly in the disposable Supabase project's secret settings, or make it available through a secure local environment. Do not put secrets in chat, Git, templates or public configuration.
4. Confirm the provider permits and verifies `Support@glarahome.com` as the sender.
5. Provide one controlled, deliverable disposable test inbox or alias and a way to inspect its messages. It must not belong to an employee, customer, Realtor or personal contact. The previous `.example.test` accounts cannot be used for delivery.
6. Provide provider/domain administration evidence or access for SPF, DKIM and DMARC review. No DNS record values can be specified responsibly until the provider and its actual verification records are known.

Configure only `glara-os-acceptance` (`jymmquptpbzwpionmhvj`), never production. Keep public signup disabled, email/password enabled, confirmations enabled and the minimum password length at 12.

## Delivery and Link Results

| Acceptance item                            | Result                     | Reason                                                 |
| ------------------------------------------ | -------------------------- | ------------------------------------------------------ |
| Invitation delivery                        | NOT TESTED                 | SMTP/provider and controlled inbox unavailable         |
| Invitation password setup                  | NOT TESTED                 | No delivered invitation                                |
| Invitation reuse                           | NOT TESTED                 | No consumed delivered invitation                       |
| Recovery delivery                          | NOT TESTED                 | SMTP/provider and controlled inbox unavailable         |
| Password change through delivered recovery | NOT TESTED                 | No delivered recovery link                             |
| Old password rejection after recovery      | NOT TESTED                 | Recovery password change not performed                 |
| Recovery reuse                             | NOT TESTED                 | No consumed delivered recovery link                    |
| Expired link                               | MANUAL ACCEPTANCE REQUIRED | Delivery prerequisites unavailable                     |
| Redirect security, delivered-email flow    | NOT TESTED                 | No delivered invitation/recovery flow; no PASS claimed |

For expiration acceptance after SMTP setup: obtain a fresh delivered link, retain it privately without opening it, wait beyond the project's confirmed email OTP expiry, then open it in a fresh signed-out browser context. Verify safe rejection, no session cookie and an appropriate retry path. Never record the link/token. Expiration acceptance remains outstanding and is not waived.

## Redirect and Template Review

The source confirmation handler accepts only `invite` and `recovery`, verifies the token with Supabase, and uses fixed same-origin destinations: `/update-password` on success and `/login?status=invalid-link` on failure. It does not read a caller-provided destination. This is a source review, not proof of delivered-link or provider redirect behavior.

Both templates use `.SiteURL` plus `/auth/confirm` and `.TokenHash` with the appropriate type. Their purposes are clear and their wording is minimal. They do not currently include support-contact text; adding `Support@glarahome.com` and installing the reviewed templates belongs to the SMTP continuation after the required provider information is available. No live template update was attempted after the stop condition.

No SPF, DKIM, DMARC or sender-alignment PASS is claimed. No DNS changes were proposed using guessed values.

## Current Application Health

No application source, migrations or Auth/SMTP configuration changed in this stage.

- `npm run typecheck`: PASS.
- `npm run lint`: PASS.
- `npm test`: PASS, 15 tests.
- `npm run build`: PASS using existing hosted development configuration.
- Hosted Auth browser checks: PASS, 6 desktop/mobile tests; 4 double-only tests skipped as designed. These verify existing login/logout, protected routes, navigation and recovery-page layout, not email delivery.
- `npm run format:check`: PASS.

The earlier 61 hosted API and 20 hosted CRM/role browser passes remain historical evidence; they were not rerun or relabelled as delivered-email acceptance here.

## Final Release Decision

**RELEASE GATE PENDING EXTERNAL ACTION**

Real invitation, recovery, password-change, link reuse, expiration and delivered-flow redirect acceptance remain incomplete. No release approval or M2 readiness approval is issued. M2 was not started.
