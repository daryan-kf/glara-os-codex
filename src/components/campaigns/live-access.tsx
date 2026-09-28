import "server-only";
import type { Role } from "@/lib/permissions";
import { liveCampaignAccess } from "@/lib/campaigns/live-access";

export function LiveCampaignAccess({ roles }: { roles: readonly Role[] }) {
  const links = liveCampaignAccess(roles, process.env);
  if (!links) return null;
  return (
    <section
      aria-labelledby="live-giveaway-title"
      className="mb-6 rounded-2xl border border-primary/20 bg-card p-5 sm:p-6"
    >
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Live website registrations
      </p>
      <h2 id="live-giveaway-title" className="mt-2 text-xl font-semibold">
        PacificWest giveaway participants
      </h2>
      <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
        This workspace uses a separate database. People registering at
        glarahome.com/win are saved in the live campaign and will not appear in
        the campaign list below.
      </p>
      <div className="mt-4 flex flex-wrap gap-3">
        <a
          href={links.registrations}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
        >
          View live registrations ↗
        </a>
        <a
          href={links.realtors}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded-lg border px-4 py-2 text-sm font-medium"
        >
          View live Realtor profiles ↗
        </a>
        <a
          href={links.receipts}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex min-h-11 items-center rounded-lg border px-4 py-2 text-sm font-medium"
        >
          Check confirmation delivery ↗
        </a>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        Opens the secure Convex console. Sign in with the account that has
        access to Glara OS. The console reads the live records directly; no
        customer information is copied here.
      </p>
    </section>
  );
}
