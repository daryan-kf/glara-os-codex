import { notFound } from "next/navigation";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexProvider } from "@/components/convex-provider";
import { CampaignPortal } from "@/components/campaigns/portal";
import { campaignPortalEnabled } from "@/lib/campaigns/portal";
import { isConfigured } from "@/lib/env";
export const dynamic = "force-dynamic";
export const metadata = {
  title: "Live registrations",
  robots: { index: false, follow: false },
};
export default function Page() {
  if (!isConfigured() || !campaignPortalEnabled(process.env)) notFound();
  return (
    <ConvexAuthNextjsServerProvider
      apiRoute="/api/campaign-auth"
      storage="inMemory"
      shouldHandleCode={false}
    >
      <ConvexProvider>
        <CampaignPortal />
      </ConvexProvider>
    </ConvexAuthNextjsServerProvider>
  );
}
