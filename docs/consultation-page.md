# Free consultation page

Published September 25, 2026 at https://www.glarahome.com/consultation. The apex `/consultation` preserves the website's existing redirect to www.

The Owner selected the existing email-and-phone workflow. The English page explains the free consultation, collects enquiry details, opens a prefilled draft in the visitor's email application and offers the existing public telephone/email contacts. The visitor must send that draft. No appointment, CRM record, automatic email or Calendar event is created. The shared contact confirmation now states explicitly that nothing was sent automatically.

Links are present in the homepage hero, homepage contact call-to-action, shared website footer, and giveaway header/footer. Existing design tokens and portfolio photography are reused. The giveaway's dates, eligibility, rules, consent and intake controls were not changed.

## Release identifiers

- Website repository: `daryan-kf/Glara-Design`.
- Website commit: `759012b41d12549a6aaafd5fcc9528aa546ed43c`.
- Website production deployment: `dpl_AhSZV8rxeM1JacrwWVQ8KsmD3kbe`.
- Glara OS link commit: `48d4b43a465b9f9103e516bd54b053ce3d84c7f5`.
- Isolated giveaway production deployment: `dpl_GWfRBzMNML3PauZtEj3rhwjhw8sB`.
- Backend and environment flags: unchanged.

## Verification

Website protected preview ran ESLint and the production Next build including TypeScript successfully. Local website dependency installation failed with `ERR_SSL_CIPHER_OPERATION_FAILED`; the cloud build used the locked dependencies successfully without weakening TLS. Glara OS TypeScript, changed-file lint, formatting, secret scan and final production build passed.

Desktop (1440 px) and mobile (390 px) preview and production checks passed: homepage links, shared footer link, consultation navigation, loaded image, no horizontal overflow, required-field validation, accurate email-draft confirmation and return to form. No HTTP POST or email was sent by these fictional browser tests. Both live giveaway links were followed/verified; the giveaway page remains correctly rendered with its registration button disabled before opening.

The new consultation page also passed direct reduced-motion checks. Navigating from the existing homepage with reduced motion enabled exposed an existing React hydration warning, reproduced on the unchanged production homepage before this release. It is not introduced by this page and was not changed in this scoped task. Normal-motion homepage navigation and both consultation viewports had no page errors or failed resources.

Sanitized results are in `consultation-page-acceptance.json`. Detailed logs and screenshots remain in the ignored local acceptance directory. No live provider test, mail delivery or calendar booking is claimed.
