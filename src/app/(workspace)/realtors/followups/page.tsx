import Link from "next/link";
import { z } from "zod";
import { PageTitle, EmptyState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { CrmNav, ActivityList, Pager } from "@/components/crm/display";
import { getFollowups, requireCrmWrite } from "@/lib/crm/data";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; mine?: string }>;
}) {
  const user = await requireCrmWrite();
  const params = await searchParams;
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(800)
    .catch(1)
    .parse(params.page ?? 1);
  const result = await getFollowups(
    page,
    params.mine === "true" ? user.id : "",
  );
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle
          title="Follow-ups"
          description="A clear queue of the next conversations. Dates shown in Vancouver time."
        />
        <Button asChild>
          <Link href="/realtors/followups/new">New follow-up / task</Link>
        </Button>
      </div>
      <CrmNav />
      <div className="mb-5 flex gap-3">
        <Button variant="outline" asChild>
          <Link href="/realtors/followups">Everyone</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/realtors/followups?mine=true">Assigned to me</Link>
        </Button>
      </div>
      {result.rows.length ? (
        <section className="rounded-xl border bg-card p-5">
          <ActivityList rows={result.rows} complete showRealtor />
        </section>
      ) : (
        <EmptyState
          title="Nothing waiting here"
          description="Open follow-ups and tasks will appear here in due-date order."
        />
      )}
      <Pager
        page={page}
        hasNext={result.rows.length === 30}
        href={(p) =>
          "/realtors/followups?page=" +
          p +
          (params.mine === "true" ? "&mine=true" : "")
        }
      />
    </>
  );
}
