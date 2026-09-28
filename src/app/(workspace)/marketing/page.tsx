import { LiveCampaignAccess } from "@/components/campaigns/live-access";
import Link from "next/link";
import { requireModule } from "@/lib/auth";
import { MarketingCenter } from "@/components/analytics/marketing";
import { PageTitle } from "@/components/primitives";
export default async function Page() {
  const user = await requireModule("marketing");
  return (
    <>
      <LiveCampaignAccess roles={user.roles} />
      <nav
        aria-label="Marketing shortcuts"
        className="mb-6 flex flex-wrap gap-3"
      >
        {user.roles.includes("owner") && (
          <a
            href="https://glarahome.com/campaign-admin"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex min-h-11 items-center rounded-lg bg-primary px-5 py-3 font-medium text-primary-foreground"
          >
            Giveaway registrations ↗
          </a>
        )}
        <Link
          href="/marketing/campaigns"
          className="inline-flex min-h-11 items-center rounded-lg border bg-card px-5 py-3 font-medium"
        >
          Campaigns & giveaways →
        </Link>
      </nav>
      {user.roles.some((r) => r === "owner" || r === "marketing") ? (
        <MarketingCenter />
      ) : (
        <PageTitle
          title="Marketing campaigns"
          description="Prepare expo registrations and manage reviewed prize draws."
        />
      )}
    </>
  );
}
