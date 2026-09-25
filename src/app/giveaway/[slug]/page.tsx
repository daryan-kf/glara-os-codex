import { isConfigured } from "@/lib/env";
import { fetchQuery } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { Giveaway } from "@/components/campaigns/giveaway";
import { intakeEnabled } from "@/lib/campaigns/model";
export const metadata = { title: "Glara Staging Giveaway" };
export default async function Page({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const campaign =
    isConfigured() && intakeEnabled(process.env)
      ? await fetchQuery(api.campaigns.publicCampaign, { slug }).catch(
          () => null,
        )
      : null;
  return (
    <main className="min-h-screen bg-background px-4 py-10 sm:py-16">
      <div className="mx-auto max-w-2xl">
        <p className="mb-8 text-xs font-semibold tracking-[0.24em] text-primary">
          GLARA HOME STAGING
        </p>
        {campaign ? (
          <Giveaway campaign={campaign} />
        ) : (
          <section className="rounded-2xl border bg-card p-8">
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
