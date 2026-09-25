import Link from "next/link";
import { requireModule } from "@/lib/auth";
import { MarketingCenter } from "@/components/analytics/marketing";
import { PageTitle } from "@/components/primitives";
export default async function Page() {
  const user = await requireModule("marketing");
  return (
    <>
      <Link
        href="/marketing/campaigns"
        className="mb-6 inline-block rounded-lg border bg-card px-5 py-3 font-medium"
      >
        Campaigns & giveaways →
      </Link>
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
