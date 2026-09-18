# Payment project selection

The Payments page now combines the former Search project and Project filter controls into one searchable Project field. Clicking or focusing the field opens suggestions immediately. Typing narrows results by project number, property address, or Realtor name, including one-character searches. Each option shows outstanding issued-invoice balances and/or the package expiry reason.

Selecting a project fills the filter and closes the list. Apply receivable filters updates invoice results; existing customer, Realtor, status, and date filters still apply. The selected card also links directly to the project's commercial workspace for recording payment or reviewing an extension, including renewal-only projects without an invoice. Editing or clearing the text removes the old selected ID. Arrow keys, Enter, Escape, touch, and outside blur are supported.

## Data and permissions

`commercial.paymentProjects` requires an active Owner/Admin profile through the existing commercial authorization guard. It excludes archived projects. Outstanding amounts come from issued invoices and the existing allocation, reversal, and credit-note calculations. Drafts, void invoices, fully paid invoices, and fully credited invoices do not create outstanding debt suggestions. This does not infer uninvoiced debt from quotes or agreements.

Renewal-only suggestions use the project's package end date and the largest configured operations alert threshold (defaults: 30, 14, 7 days), including today and expired dates. Sold, destaging, completed, and cancelled projects are excluded from renewal-only suggestions; issued debt can still warrant a payment suggestion. No invoice or payment is created by selecting a project.

The query uses indexed, bounded pages of 15 projects, filters search text before calculating balances, and preserves cursors through empty filtered pages. The UI continues loading until it has at least eight matches or exhausts the source, and offers Load more projects for additional results. Existing commercial per-project invoice limits remain fail-closed rather than returning inaccurate totals. Query results contain only selector fields, not complete financial records. No schema change or backfill is required.

## Verification

- 23 targeted Convex tests passed: 10 new selector tests and 13 existing commercial regression tests. Coverage includes unpaid/partial/paid/reversed/credited balances, date boundaries, configured expiry windows, closed and archived projects, search and cursor continuity, input limits, and direct role/anonymous/archived-user denial.
- 18 isolated browser scenarios passed, nine per desktop/mobile viewport. Six exercise opening the populated list, visible balances and renewal reasons, search narrowing, keyboard selection, filter submission, clearing stale IDs, empty results, renewal navigation, Escape, and overflow. Twelve retain the existing login/logout and recovery checks. Screenshots were visually reviewed.
- TypeScript, lint, production build, formatting, and secret scanning passed. Initial browser fixture setup and selector-scope errors were corrected before the successful final run; no business prerequisites were weakened. Fictional won opportunities are prepared only in a localhost-guarded module generated inside the ignored isolated copy.
- Backend deployed to development `woozy-jaguar-392`. A read-only hosted check confirmed the new function exists and explicitly denies anonymous access. No hosted customer records were altered by acceptance, and no production environment or external capability was enabled.

Reproduce the isolated browser run with the existing local Convex rehearsal binary and Edge:

```powershell
$env:GLARA_PAYMENT_PROJECTS_REGRESSION = 'yes'
node scripts/isolated-auth-browser.mjs
```

Detailed private fixture outputs and screenshots remain under ignored `.acceptance/m10/`. The in-app English guide includes the new selection workflow. This is a targeted improvement, not a new production release-gate decision.
