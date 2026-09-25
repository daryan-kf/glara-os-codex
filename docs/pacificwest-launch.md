# PacificWest 2026 launch handoff

Canonical public and QR URL: **https://glarahome.com/win** (no query string required).

Prepared, not published. No QR pointing at development is approved. The existing development campaign is `zh7ff069fkks1vz221ws40vdzx8f26fr`, slug `pacificwest-2026`, on `woozy-jaguar-392`. `/win` internally rewrites to `/giveaway/pacificwest-2026`, preserving the visible URL and query attribution. It does not create another campaign. Canonical metadata on either path identifies `/win`.

## Final campaign content

`pacificwest-campaign.json` contains the approved campaign content, not runtime secrets. Contest and privacy contact: `Support@glarahome.com`. Owner confirmed a three-business-day deadline from the first contact attempt to respond and complete verification, and no combining the credit with any other promotion, coupon, discount or promotional credit. All prepared rules/privacy placeholders are resolved. Approval is the product owner's instruction, not a claim of independent legal review.

One non-transferable CAD $2,000 staging credit; no cash redemption; any unused balance remains available until six calendar months after official confirmation. Only licensed BC Realtors, one eligible entry each, optional marketing consent, frozen unweighted pool, cryptographically secure random selection, identity/licence verification and mathematical skill question. Opens `2026-09-28T15:00:00Z`; closes exclusively `2026-09-30T00:00:00Z` (September 28 08:00 / September 29 17:00 Pacific).

The development record remains `draft`, `legal_approved=true`, `GLARA_EXPO_ENABLED=false`. Email and Calendar remain false. Approving text does not publish the page or authorize intake.

## External hosting action required

The existing public site was read-only checked during this task: `https://glarahome.com/` redirects to `https://www.glarahome.com/`, served by Vercel. This repository does not control that website's routing. Its Vercel website administrator must install a path-level mount for the approved Glara OS **production** frontend, not the development backend/site. No DNS change is part of this preparation.

1. Obtain separate production deployment authorization, approve the exact production frontend target, and complete the applicable existing Owner identity/MFA, recovery, origin, security and readiness controls in `production-preparation.md`. Their historical pending statuses are not waived by this campaign rehearsal. The previously recorded isolated production shell is not a deployed/accepted public campaign.
2. Build the approved frontend with `GLARA_PUBLIC_CAMPAIGN_ROUTING=true`. This namespaces its JavaScript/CSS under `/glara-win-assets/_next/static/`, avoiding the marketing site's own Next.js assets. It does not enable registration.
3. On the existing website's Vercel edge, exempt `/win`, `/api/giveaway` and `/glara-win-assets/:path*` from the blanket apex-to-www redirect and route them to that approved frontend. Preserve query strings, POST body/content type, request origin/host, non-cacheable responses and trusted edge client-IP handling. Optionally redirect `www.glarahome.com/win` to the canonical apex URL. Do not forward staff routes or `/api/auth` as part of this public mount, replace the website root, or route all `/_next` assets to Glara OS.
4. In the matched production frontend/backend, configure the approved public origin and a new environment-specific server-only ingress secret. Verify the existing campaign configuration through the controlled production setup process; do not substitute a new slug or re-run campaign creation in shared development. No real registrations or existing real CRM data are migrated by this preparation.
5. With intake still disabled, verify HTTPS, `/win` without redirects away from the apex, canonical metadata, namespaced assets, mobile/desktop hydration and API 503. Before authorizing intake, validate the real edge's exact origin and trusted client-IP behavior in a controlled non-customer acceptance. A plain cross-origin proxy that changes the API request origin is insufficient: the existing endpoint intentionally rejects it. Do not fix a failed edge test by trusting arbitrary forwarded headers, relaxing CSRF checks or enabling rewrite caching.
6. After recorded production/public-intake authorization and all applicable gates, an authorized Owner opens the approved campaign and enables the existing Expo flags in the matched frontend/backend. Server time still prevents entries before the opening instant and at/after the closing instant. Email, Calendar, AI and consequential Automation stay disabled. Scan the final physical QR on a real device only after the route is approved and tested.

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
