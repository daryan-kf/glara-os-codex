import type { Metadata } from "next";
import { isConfigured } from "@/lib/env";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { Giveaway } from "@/components/campaigns/giveaway";
import {
  intakeEnabled,
  campaignPublicationAllowed,
} from "@/lib/campaigns/model";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  return slug === "pacificwest-2026"
    ? {
        title: { absolute: "Win a $2,000 Glara Staging Credit" },
        description:
          "PacificWest 2026 giveaway for licensed Realtors in British Columbia.",
        alternates: { canonical: "https://glarahome.com/win" },
      }
    : { title: "Glara Staging Giveaway" };
}
async function loadPublicCampaign(slug: string) {
  if (!isConfigured() || !campaignPublicationAllowed(process.env)) return null;
  return fetchQuery(api.campaigns.publicCampaign, {
    slug,
    time_bucket: Math.floor(Date.now() / 1000),
  }).catch(() => null);
}
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const campaign = await loadPublicCampaign(slug);
  return (
    <main className="min-h-screen bg-[#f6f5f2]">
      <div>
        {campaign ? (
          <Giveaway
            // Start a fresh form session when an advance preview opens for entry.
            key={`${campaign.slug}:${campaign.state}`}
            campaign={{
              ...campaign,
              state:
                campaign.state === "open" && !intakeEnabled(process.env)
                  ? "paused"
                  : campaign.state,
            }}
          />
        ) : (
          <section className="mx-auto max-w-2xl rounded-2xl border bg-card p-8">
            <h1 className="text-3xl font-semibold">
              Registration is not available yet
            </h1>
            <p className="mt-4 text-muted-foreground">
              Please check back when the Glara Staging giveaway opens, or speak
              with our team at the booth.
            </p>
          </section>
        )}
      </div>
    </main>
  );
}
