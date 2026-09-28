# PacificWest registration confirmation email

The product owner requested automatic email following giveaway registration on September 27, 2026. This authorizes the fixed transactional registration receipt for the existing PacificWest campaign. It does not enable general M9 messaging, marketing campaigns, Calendar, auth email, AI, or consequential Automation. Printed files remain unchanged.

## Behaviour

A newly accepted, self-declared eligible entry with an unambiguous CRM identity creates one `campaign_receipts` outbox row in the same database transaction as the entry. The minute worker sends the versioned English receipt from and with replies to `Support@glarahome.com`. Marketing opt-in is not required and is never changed. Duplicate submissions do not enqueue another message. Pending identity-review and ineligible entries receive no automatic receipt. Historical entries are not automatically mailed.

The message confirms receipt only, gives the campaign closing date and rules/privacy link, and explicitly does not confirm eligibility, winner status or a gift card. Exact template: `src/lib/campaigns/receipt.ts`. There is no user-authored subject, body, sender, or arbitrary recipient dispatch endpoint.

## Security and delivery

The new pathway reuses the Resend provider adapter, signed M9 webhook verifier, delivery-event ledger, suppression records, and emergency email control. It has a dedicated send-only production key and explicit campaign-specific flags. `GLARA_PRODUCTION_EMAIL_APPROVED=true` grants the email capability for this approved pathway; `M9_EMAIL_ENABLED=false` keeps the general M9 outbox closed. The existing manual M9 review rules remain intact.

Each receipt has a permanent entry-derived idempotency key, immutable content snapshot and atomic claim. The worker rechecks source identity, rules, eligibility, archive state, environment, emergency freeze and suppression before dispatch. Optional marketing unsubscribe stays untouched; transactional/all-email unsubscribe, hard bounce and complaints block delivery. Signed bounce/complaint events also create suppression. Delivery events received before the provider response are reconciled when its ID is saved. Older events cannot overwrite a bounce or complaint with delivered.

Only explicit provider rate limiting is retried, up to three attempts. Transport uncertainty, server ambiguity and expired dispatch claims become `unknown`, never automatically resent. Outbox failure does not remove the registration. Provider acceptance is not proof of inbox receipt. The current implementation records unknown delivery for administrator investigation; it does not provide a new staff UI or automatic unknown-delivery replay. Pending receipts older than 24 hours are blocked. Normal dispatch is on a one-minute interval with up to five receipts per tick; queueing/provider delays can extend delivery time.

## Configuration and operations

Production deployment: `terrific-seahorse-419`; existing campaign: `pacificwest-2026`.

Required: `GLARA_EXPO_RECEIPTS_ENABLED=true`, `GLARA_EXPO_RECEIPTS_MODE=live`, `GLARA_EXPO_RECEIPTS_VERIFIED=true`, `GLARA_PRODUCTION_EXPO_RECEIPTS_APPROVED=true`, the existing production approval and email capability approval, dedicated `GLARA_EXPO_RESEND_KEY`, and `M9_RESEND_WEBHOOK_SECRET`. Defaults remain disabled. Development requires an exact test-inbox allowlist; production test mode cannot enqueue real entrants.

Emergency stop: set `GLARA_EXPO_RECEIPTS_ENABLED=false`, or freeze the existing email emergency capability. This stops email while leaving campaign registration enabled. Do not change campaign dates to stop email. Pause/recovery handling never retries an uncertain provider dispatch.

An internal fixed-recipient owner test can run only with explicit test approval and a configured owner inbox. It uses a stable test key, is visibly labelled TEST, and creates no campaign entry, CRM customer, or payment. Remove test approval after acceptance. Do not publish test-recipient personal details or secrets in evidence.

Acceptance evidence is recorded separately in `pacificwest-registration-email-acceptance.json`. General staff rollout, MFA, production recovery readiness, and other deferred gates are not represented as passed by this feature.

Provider references: [sending-only API keys](https://resend.com/docs/api-reference/api-keys/create-api-key), [provider idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys). Permanent application outbox state prevents duplicate retries beyond the provider's idempotency window.
