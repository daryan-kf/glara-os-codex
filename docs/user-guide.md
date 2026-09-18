# In-app English user guide

Open `/help` after signing in, or select **Help** in the desktop sidebar or mobile navigation. The shared workspace search also finds the guide. All six assigned roles can access the instructions; the existing workspace guard still rejects unauthenticated, archived, or unassigned users. Business-module links follow the existing permission map. Documentation does not grant business-data access.

The guide has 28 chapters covering getting started, daily work, roles, CRM, follow-ups, properties, opportunities, consultations, quotes, project preparation and statuses, finding staged projects, expiry and extensions, internal scheduling, mobile crew work, inventory, reservations and returns, spreadsheet imports and photos, agreements, invoices and payments, destaging, reporting and marketing, automation, Ask Glara, communications, accounts, archiving, troubleshooting, and a glossary.

## User experience

- English language and left-to-right content, using the actual UI labels in the instructions.
- Local search across all chapters, supporting normalized whitespace and case-insensitive English terms. Search text is not sent to a provider.
- Common-topic buttons, a linked table of contents, no-results recovery, and return-to-top links.
- Full-guide printing even when the on-screen results are filtered; no application navigation or search controls in the printed guide.
- The existing application typography, responsive layout, native keyboard-operable controls, labelled search, and live result count.

## Content boundaries

Instructions were checked against the existing CRM, sales, operations, inventory, commercial, automation, analytics, authentication, and communications code. The guide distinguishes Staged from Completed, package extension acceptance from proposal creation, payment recording from collection, and document status from actual email delivery. It explains that inventory reservations need their own review when a package is extended.

The historical Email acceptance decision and deferred Google Calendar integration remain unchanged. The guide does not activate providers, modify data, deploy a backend, or certify production readiness. It contains no customer data, credentials, or live configuration. The description of deferred services reflects the current product decision; update that passage when authorized activation changes it.

## Maintenance and verification

`src/lib/help/guide.ts` is the single content source. `src/components/help/user-guide.tsx` renders and searches it; `src/app/(workspace)/help/page.tsx` applies the existing authenticated module guard. Navigation uses `src/lib/permissions.ts` and the shared shell. Keep the content aligned with workflow changes instead of duplicating it in another manual.

Verification for the English translation: **passed**. The final isolated run completed **22 browser scenarios** (11 desktop and 11 mobile); central authorization completed **4 tests**. Build, typecheck, lint, formatting and secret scan passed. Desktop/mobile screenshots were visually reviewed.

The initial isolated run timed out at the existing expired-recovery assertion before opening the guide. A fresh run after the concurrent build finished passed all 22 scenarios; authentication behavior was not changed.

- TypeScript, ESLint, formatting and production build checks.
- Central permission tests, including help access for each assigned role and denial for unassigned users.
- Secret scan of release candidates.
- Isolated desktop (1280 × 900) and mobile (393 × 851) browser checks using fictional local accounts: menu navigation, LTR, no horizontal overflow, English search with mixed case and extra whitespace, empty results and reset, contents links, role-aware links, print visibility, and unauthenticated rejection. Existing login, logout, and recovery checks run alongside them.

Reproduce the isolated browser checks on the configured Windows development workstation with its existing local Convex rehearsal binary and Edge:

```powershell
$env:GLARA_HELP_REGRESSION = 'yes'
node scripts/isolated-auth-browser.mjs
```

The runner records results in the ignored `.acceptance/m10/auth-browser.json` and screenshots in its timestamped isolated directory. It uses localhost only, makes no provider calls, and leaves shared development and production data untouched. These targeted checks are not a new milestone or go-live acceptance.
