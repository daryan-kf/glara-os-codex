# PacificWest 2026 launch handoff

Canonical public and QR URL: **https://glarahome.com/win** (no query string required).

Historical preparation state (superseded by the production result below): prepared, not published. No QR pointing at development is approved. The existing development campaign is `zh7ff069fkks1vz221ws40vdzx8f26fr`, slug `pacificwest-2026`, on `woozy-jaguar-392`. `/win` internally rewrites to `/giveaway/pacificwest-2026`, preserving the visible URL and query attribution. It does not create another campaign. Canonical metadata on either path identifies `/win`.

## Production result — September 25, 2026

**LIVE: https://glarahome.com/win. Scheduled registration is armed in both production environments.** Registration remains server-blocked before September 28, 2026 at 08:00 America/Vancouver and at/after September 29 at 17:00. The full page/form is visible now with a disabled button; it refreshes at the opening/closing boundary. No manual activation is needed at opening. The permanent QR payload is `https://glarahome.com/win`.

The Owner explicitly approved the exact isolated production campaign deployment and, separately, both `GLARA_EXPO_ENABLED=true` flags. This is a campaign-only MFA exception; MFA is not verified or passed. No general M10B, staff rollout, provider activation or customer migration is approved.

Production campaign `v5760jp40rejwf5zvh8m30qcen8f2wzr` is the production instance of existing slug `pacificwest-2026`, with the exact approved terms. The existing development campaign is unchanged. One private non-login Owner assignment was provisioned; no password, auth account, session or invitation was created. The provisioning flag is false again.

The isolated frontend `glara-giveaway-production` connects only to `terrific-seahorse-419`. Website repository `daryan-kf/Glara-Design`, commit `8a616082eb96de3176ea4b8eea1b9b81b9d64d0c`, mounts `/win`, `/api/giveaway` and `/glara-win-assets/*`. The apex domain's blanket redirect was replaced with equivalent application redirects for all other pages. DNS was not changed. `www.glarahome.com/win` redirects to the canonical apex URL.

The Vercel rewrite changes the destination host. Only this public Vercel deployment sets server-only `GLARA_EXPO_UPSTREAM_ORIGIN=https://glara-giveaway-production.vercel.app`; the browser Origin must still exactly equal `SITE_URL=https://glarahome.com`. The adapter never uses caller-controlled forwarded-host headers. Ingress still validates Vercel's overwritten client-IP header and signs requests using a production-only secret.

Final acceptance: 21 Node and 618 Vitest tests passed (42 Vitest files), TypeScript, lint, formatting, secret scan and final cloud production builds passed. The existing 29-scenario disposable browser rehearsal covers the full fictional registration/draw/award lifecycle. Final public desktop and mobile tests passed with no overflow, failed resources or browser errors. A valid fictional request through the real domain returned HTTP 409 before opening; foreign origin returned 403; invalid input returned 400. No production entry or CRM customer was created. Public-only login/dashboard/auth/other campaign paths returned 404. Provider execution tables remain empty; Email, Calendar, auth email, AI and Automation flags are false.

The first frontend deployment inherited an unintended development configuration because the CLI ran from the parent working directory. It was contained and replaced before the website mount. The final artifact is built from committed files from its own working directory with an explicit minimal local Vercel configuration and project-scoped production variables. Never deploy this campaign using the repository's development `vercel.json`. Evidence and exact source/deployment identifiers are in `pacificwest-production-launch.json`.

No further action is needed to display the page or trigger its scheduled opening. Separate operational items remain: private backup export awaits the specifically requested Owner approval after automatic review rejected it; no backup/restore acceptance is claimed. Staff/campaign administration and MFA are outside this public-only launch and must be arranged before administering entries or performing the winner draw. Existing deferred production email/auth requirements remain deferred. None of these historical gates is rewritten as passed.

Emergency intake stop: set `GLARA_EXPO_ENABLED=false` on `terrific-seahorse-419` first; this immediately rejects submissions. Mirror false in the Vercel project's production environment and redeploy the same isolated artifact. Keep the information page available and preserve all entries. Do not change the campaign dates, credentials, rules or winner state to stop intake.

## Historical preparation and rehearsal

The following sections record earlier preparation. Current production state is the result above and the machine-readable production launch evidence.

## Final campaign content

`pacificwest-campaign.json` contains the approved campaign content, not runtime secrets. Contest and privacy contact: `Support@glarahome.com`. Owner confirmed a three-business-day deadline from the first contact attempt to respond and complete verification, and no combining the credit with any other promotion, coupon, discount or promotional credit. All prepared rules/privacy placeholders are resolved. Approval is the product owner's instruction, not a claim of independent legal review.

One non-transferable CAD $2,000 staging credit; no cash redemption; any unused balance remains available until six calendar months after official confirmation. Only licensed BC Realtors, one eligible entry each, optional marketing consent, frozen unweighted pool, cryptographically secure random selection, identity/licence verification and mathematical skill question. Opens `2026-09-28T15:00:00Z`; closes exclusively `2026-09-30T00:00:00Z` (September 28 08:00 / September 29 17:00 Pacific).

The owner has authorized advance display: the existing development record is now `scheduled`, `legal_approved=true`, with `GLARA_EXPO_ENABLED=false`. The approved information page is visible at local `/win`; the full form is visible with disabled fields and a disabled ENTER TO WIN button. Email and Calendar remain false. Production routing and public intake remain separate authorization gates.

## External hosting action required

The existing public site was read-only checked during this task: `https://glarahome.com/` redirects to `https://www.glarahome.com/`, served by Vercel. This repository does not control that website's routing. Its Vercel website administrator must install a path-level mount for the approved Glara OS **production** frontend, not the development backend/site. No DNS change is part of this preparation.

1. Obtain separate production deployment authorization, approve the exact production frontend target, and complete the applicable existing Owner identity/MFA, recovery, origin, security and readiness controls in `production-preparation.md`. Their historical pending statuses are not waived by this campaign rehearsal. The previously recorded isolated production shell is not a deployed/accepted public campaign.
2. Build the approved frontend with `GLARA_PUBLIC_CAMPAIGN_ROUTING=true`. This namespaces its JavaScript/CSS under `/glara-win-assets/_next/static/`, avoiding the marketing site's own Next.js assets. It does not enable registration.
3. On the existing website's Vercel edge, exempt `/win`, `/api/giveaway` and `/glara-win-assets/:path*` from the blanket apex-to-www redirect and route them to that approved frontend. Preserve query strings, POST body/content type, request origin/host, non-cacheable responses and trusted edge client-IP handling. Optionally redirect `www.glarahome.com/win` to the canonical apex URL. Do not forward staff routes or `/api/auth` as part of this public mount, replace the website root, or route all `/_next` assets to Glara OS.
4. In the matched production frontend/backend, configure the approved public origin and a new environment-specific server-only ingress secret. Verify the existing campaign configuration through the controlled production setup process; do not substitute a new slug or re-run campaign creation in shared development. No real registrations or existing real CRM data are migrated by this preparation.
5. With intake still disabled, verify HTTPS, `/win` without redirects away from the apex, canonical metadata, namespaced assets, visible approved campaign details/opening time, mobile/desktop hydration and API 503. Before authorizing intake, validate the real edge's exact origin and trusted client-IP behavior in a controlled non-customer acceptance. A plain cross-origin proxy that changes the API request origin is insufficient: the existing endpoint intentionally rejects it. Do not fix a failed edge test by trusting arbitrary forwarded headers, relaxing CSRF checks or enabling rewrite caching.
6. After recorded production/public-intake authorization and all applicable gates, an authorized Owner publishes the approved campaign as scheduled and enables the existing Expo flags in the matched frontend/backend. Server time still prevents entries before the opening instant and at/after the closing instant. Email, Calendar, AI and consequential Automation stay disabled. Scan the final physical QR on a real device only after the route is approved and tested.

Routing template to merge into the **existing website** configuration (not installed here):

```js
// APPROVED_GLARA_PRODUCTION_ORIGIN must be a reviewed production frontend origin.
// Use the platform's origin-preserving path mount; validate the API origin at the edge.
const upstream = process.env.APPROVED_GLARA_PRODUCTION_ORIGIN;
const giveawayRoutes = [
  { source: "/win", destination: `${upstream}/win` },
  { source: "/api/giveaway", destination: `${upstream}/api/giveaway` },
  {
    source: "/glara-win-assets/:path*",
    destination: `${upstream}/glara-win-assets/:path*`,
  },
];
```

This is a routing handoff, not evidence that an uninspected site's redirect precedence or proxy headers are correct. Missing target/access or failed origin/IP acceptance blocks activation. The website operator must preserve the rest of the existing site and its routing. [Next.js multi-zone routing](https://nextjs.org/docs/app/guides/multi-zones) and [Vercel rewrites](https://vercel.com/docs/routing/rewrites) document the underlying routing/asset mechanism.

Initial matched environment settings (all capabilities closed):

```dotenv
GLARA_ENVIRONMENT=production
SITE_URL=https://glarahome.com
GLARA_PUBLIC_CAMPAIGN_ROUTING=true
GLARA_EXPO_ENABLED=false
GLARA_PRODUCTION_EXPO_APPROVED=false
GLARA_PRODUCTION_APPROVED=false
GLARA_RECOVERY_MODE=true
M9_EMAIL_ENABLED=false
M9_CALENDAR_ENABLED=false
AUTH_EMAIL_ENABLED=false
GLARA_AUTOMATION_ENABLED=false
GLARA_AI_SECURITY_APPROVED=false
```

Keep all other existing production capability approvals false. Use the reviewed production Convex URL/site URL, never `woozy-jaguar-392`. Provision `GLARA_EXPO_INGRESS_SECRET` securely and independently in the two matched server environments; never in Git, client bundles or chat. The application-wide production/recovery gate is intentionally not bypassed for `/win`. Existing production authentication origin requirements must be reviewed before changing `SITE_URL`; this document does not authorize that change.

## Rehearsal scope

The existing disposable localhost harness uses fictional identities and excludes external provider credentials. It opens only isolated fixture campaigns, uses the final public copy, and shifts fixture dates solely to exercise live browser entry. Exact September boundaries and confirmation-relative six-month expiry run separately against the committed PacificWest configuration in the Convex tests. No entry, draw or award is made in the real development campaign. The shared campaign stays disabled throughout.

The full unapplied credit is preserved and tied to the verified entrant. Partial credit redemption remains an existing commercial-process limitation; no Payment is fabricated. Real email or Calendar acceptance is neither required nor claimed for this disabled giveaway flow.

Current results are in `pacificwest-acceptance.json`. The QR payload is ready; publication and production intake remain unauthorized.

## Advance display and automatic opening

An approved campaign published as `scheduled` shows its rules, prize, privacy notice and exact opening/closing times before entry intake is enabled. Draft, cancelled and unapproved campaigns remain hidden. Recovery mode and production publication approvals still apply to read access. Scheduling does not require enabling intake or installing an ingress secret; accepting entries still requires both.

When intake is deliberately armed in the matched frontend/backend, both `scheduled` and `open` campaigns accept entries only within the server-authoritative `[starts_at, closes_at)` window. No cron job or manual state change at 08:00 is needed. The page refreshes its server data at both boundaries, enabling the form and button at opening and disabling them again at closing. A bounded time-bucket query argument refreshes Convex's display cache; that argument never supplies the authorization clock. See [Convex query-time caching guidance](https://docs.convex.dev/understanding/best-practices#dont-use-datenow-in-queries). Disabling intake during the entry window pauses the form while retaining approved public information.

The local `.env.local` explicitly identifies `GLARA_ENVIRONMENT=development` and keeps `GLARA_EXPO_ENABLED=false`. That private file is not committed. This task does not arm production or change DNS/website routing. The event dates alone cannot override a disabled safety flag.

## Reference-led visual presentation

The owner-supplied visual reference is implemented as a two-column desktop layout with a Glara wordmark/navigation, serif headline, staging photograph and six campaign facts on the left, and a white registration card on the right. Mobile stacks these regions with a compact native navigation menu. The campaign form remains visible before opening; its fieldset and submit button are disabled, and the exact opening/closing notice is displayed. The submit handler also refuses non-open states; existing backend gates are unchanged.

The photograph is reused from Glara's public portfolio: `https://www.glarahome.com/images/portfolio/glara-living-kitchen-slatwall.jpg`. It is bundled locally as an imported static asset, including the existing optional `/glara-win-assets` prefix. No external image fetch, new tracking integration, new campaign or provider activation is introduced. Full rules, contact details, optional consent wording and prize terms remain unchanged.

## Historical initial publication request — September 25, 2026

The owner explicitly requested public publication now with registration opening and closing at the approved times, after declining MFA enablement. Record this as a requested campaign-scoped exception, **not MFA passed** and not general Glara OS production readiness. Owner identity was supplied privately; no Owner name, email or recovery phone is published in this repository. Recovery-contact independence remains unverified.

Vercel sign-in is now working. The verified website project is `glara-design` (`prj_TTN1Zym3zC9Mernqway3nPvuBEfW`) connected to `daryan-kf/Glara-Design`; `glara-staging` instead serves `crm.glarahome.com`. The apex currently has a project-level 308 redirect to `www.glarahome.com`. No route or DNS setting was changed.

An empty, separate frontend project `glara-giveaway-production` (`prj_tUOWlEfdbt0lD33FTJ3PpUPJyjtk`) was created. No code or environment settings have been deployed to it. The reviewed backend target remains `terrific-seahorse-419`.

Prepared controls:

- `GLARA_PUBLIC_CAMPAIGN_ONLY=true` allows only `/win`, the existing PacificWest page, its registration API and namespaced static assets on this deployment. It does not bypass the existing production/recovery gates.
- The same backend flag denies authenticated staff profiles and password/recovery authentication. Public signed ingress keeps its existing authorization, validation and server-side date checks. Existing development and staff deployments are unchanged when the flag is absent.
- `campaignLaunch:preparePacificWest` is an internal deployment-administrator mutation. It requires a closed production campaign environment and a temporary explicit provisioning flag. It validates the approved input, provisions one non-login Owner assignment and one production instance of the existing campaign slug, audits the action as a platform operation, and refuses conflicting reruns. It creates no password, account, session or invitation; it does not import development CRM data. Remove/disable its provisioning flag immediately after use.
- `vercel.giveaway.json` is a fail-closed configuration for the separate public frontend. It must never replace the development project's configuration or relax the marketing site's other routes.

**Deployment blocked by automatic approval review.** The attempted `node scripts/prepare-production.mjs --deploy` was rejected before execution. The review cited the historical M10A prohibition against production code deployment and unresolved Owner/MFA authorization despite the current campaign publication request. No alternative deployment path was used. Backend code, production data, domain routing and intake remain unchanged.

The next explicit approval must identify this reviewed production backend and isolated public frontend, the requested MFA exception for this campaign only, approved Owner assignment provisioning, `/win` routing, and scheduled intake. This does not authorize Email, Calendar, AI, consequential Automation, staff access or a general M10B pass. After approval, complete the prepared deployment, real-edge origin/IP acceptance and backup/operational readiness checks before arming intake. Do not claim the current request alone has completed those checks.
