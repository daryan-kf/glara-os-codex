# Post-M10A change review and targeted regression

The 31 commits from `9930136` through `94609c7` were reviewed against the accepted M10A baseline. Runtime corrections: `30ae2de5a74a4e009ef539504009bc926a456afe`. Claude's product improvements are preserved.

| Area               | Changes retained                                                                                                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Account            | Display-name/password self-service; six-character development password minimum; Owner displayed as Admin without changing stored permissions                                                     |
| Inventory          | Purchase/rental/sale prices, simplified editing, initial receipt, Excel/CSV import/export, product photos, camera capture, photo-first draft products, inline categories, spreadsheet image URLs |
| Sales              | Staging/rental/sale quotes, monthly line multiplication, inventory product pricing, address suggestions                                                                                          |
| CRM                | Builder contact type, customer/team-member wording, dropdown closing behavior                                                                                                                    |
| Operations         | One-click opportunity/property conversion, project-start panel, commercial/inventory navigation                                                                                                  |
| Marketing/settings | Existing analytics exposed through a Marketing page; configuration shortcuts                                                                                                                     |
| Documents          | Brand letterhead, invoice/agreement layouts, print pagination, one-click finalization with no email send                                                                                         |
| Development        | Hosted development frontend configuration and restricted maintenance functions                                                                                                                   |

## Confirmed corrections

- Spreadsheet import now enforces the existing reservation dependency and archived-category checks. Invalid imports roll back atomically.
- Inventory containment is checked before generating upload URLs or making image download requests. Production image import and address lookup need distinct server-owned approvals; both are OFF.
- Maintenance purges require an explicit development environment. Missing/unknown/production labels fail closed. No purge was executed outside isolated tests.
- A 1,000-row Excel export no longer exceeds JavaScript argument/stack limits.
- Rejected or detached client-supplied storage IDs cannot destroy a photo referenced elsewhere. Physical retention/cleanup remains an explicit limitation, rather than deleting unverified references.
- Address suggestions now work with keyboard activation and cancel pending lookup work on unmount.
- A closed production frontend returns a no-store, restrictive-CSP 503 before authentication processing.

Six new failing regression cases were captured before their fixes. Final checks: 20 Node tests + 563 Vitest tests across 38 files; TypeScript/lint/build pass; 20 isolated desktop/mobile scenarios pass; eight anonymous hosted development authorization checks pass; four optimized-production HTTP closure checks pass. Exact scope and metadata: [production-preparation.json](production-preparation.json).

The fixed backend is deployed to development. Development email was unexpectedly true at inspection; it was restored to false under the existing post-acceptance instruction. Calendar remained false. No messages were sent.

## Boundaries

The existing `vercel.json` continues to describe the hosted DEVELOPMENT frontend. It must never be reused to provision production. `vercel.production.json` is a separate explicitly closed configuration targeting only `terrific-seahorse-419`; no domain or Owner is invented.

Historical full M10A results remain historical. Current source changes invalidate broad prior evidence; this targeted run does not claim full 474-section recertification. In particular, UPLOADS is no longer not-applicable: photo serving is active in development and private-access/expiry/content/retention acceptance remains required before production file enablement. No production deployment, live provider run, real customer import or staff UAT is claimed.

The reconciled register is structurally valid, with zero fabricated current PASS claims: 23 pending verification, 19 pending external action and one deferred Calendar (43 P1-rated readiness controls; zero P0 controls). These counts are acceptance obligations, not 43 newly discovered defects. The six reproduced regressions and additional photo/keyboard defects covered in this review are corrected.
