import Link from "next/link";
import { z } from "zod";
import { PageTitle, EmptyState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { CrmNav, Pager } from "@/components/crm/display";
import { getBrokerages, requireCrmWrite } from "@/lib/crm/data";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>;
}) {
  await requireCrmWrite();
  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 100);
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(800)
    .catch(1)
    .parse(params.page ?? 1);
  const result = await getBrokerages(q, page);
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle
          title="Brokerages"
          description="The offices behind your relationships."
        />
        <Button asChild>
          <Link href="/realtors/brokerages/new">New brokerage</Link>
        </Button>
      </div>
      <CrmNav />
      <form className="mb-6 flex gap-3">
        <label className="sr-only" htmlFor="q">
          Search brokerages
        </label>
        <input
          id="q"
          name="q"
          defaultValue={q}
          placeholder="Search brokerages"
          className="min-h-11 min-w-0 flex-1 rounded-lg border bg-card px-3"
        />
        <Button>Search</Button>
      </form>
      {result.rows.length ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {result.rows.map((b) => (
            <article key={b.id} className="rounded-xl border bg-card p-6">
              <h2 className="text-lg font-semibold">{b.name}</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {[b.office_name, b.city].filter(Boolean).join(" · ")}
              </p>
              <div className="mt-5 flex flex-wrap gap-3">
                <Link
                  href={"/realtors/brokerages/" + b.id}
                  className="py-2 text-sm underline"
                >
                  Edit brokerage
                </Link>
                <Link
                  href={"/realtors?brokerage_id=" + b.id}
                  className="py-2 text-sm underline"
                >
                  View realtors
                </Link>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <EmptyState
          title="Build your brokerage network"
          description="Add a brokerage, then connect the realtors who work there."
        />
      )}
      <Pager
        page={page}
        hasNext={result.rows.length === 25}
        href={(p) =>
          "/realtors/brokerages?q=" + encodeURIComponent(q) + "&page=" + p
        }
      />
    </>
  );
}
