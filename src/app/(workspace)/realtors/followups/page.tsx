import Link from "next/link";
import { z } from "zod";
import { PageTitle, EmptyState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { CrmNav, ActivityList } from "@/components/crm/display";
import { getFollowups, requireCrmWrite } from "@/lib/crm/data";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ after?: string; mine?: string }>;
}) {
  const user = await requireCrmWrite();
  const params = await searchParams;
  const after = z
    .string()
    .max(4096)
    .catch("")
    .parse(params.after ?? "");
  const result = await getFollowups(
    1,
    params.mine === "true" ? user.id : "",
    after || null,
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
          title={
            result.next_cursor
              ? "No matching follow-ups on this page"
              : "Nothing waiting here"
          }
          description={
            result.next_cursor
              ? "Continue to the next page of follow-ups."
              : "Open follow-ups and tasks will appear here in due-date order."
          }
        />
      )}
      <nav aria-label="Follow-up pages" className="mt-4 flex gap-4 text-sm">
        {after && (
          <Link
            className="underline"
            href={
              "/realtors/followups" +
              (params.mine === "true" ? "?mine=true" : "")
            }
          >
            First follow-ups
          </Link>
        )}
        {result.next_cursor && (
          <Link
            className="underline"
            href={
              "/realtors/followups?after=" +
              encodeURIComponent(result.next_cursor) +
              (params.mine === "true" ? "&mine=true" : "")
            }
          >
            More follow-ups
          </Link>
        )}
      </nav>
    </>
  );
}
