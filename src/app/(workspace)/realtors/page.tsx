import Link from "next/link";
import { requireModule } from "@/lib/auth";
import { listRealtors, getChoices } from "@/lib/crm/data";
import {
  queryInput,
  relationshipStates,
  label,
  formatDate,
  canWriteCrm,
  canManageCrm,
} from "@/lib/crm/model";
import { PageTitle, EmptyState, Avatar } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { CrmNav, FollowupBadge, Pager } from "@/components/crm/display";
import { Lookup } from "@/components/crm/forms";
export const metadata = { title: "Realtors" };
export default async function RealtorsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireModule("realtors");
  const parsed = queryInput.safeParse(await searchParams);
  if (!parsed.success)
    return (
      <EmptyState
        title="Check your filters"
        description="One of the selected filters is invalid."
      >
        <Button asChild>
          <Link href="/realtors">Reset filters</Link>
        </Button>
      </EmptyState>
    );
  const filters = parsed.data;
  const writable = canWriteCrm(user.roles);
  const [result, choices] = await Promise.all([
    listRealtors(filters),
    getChoices(),
  ]);
  const href = (page: number) =>
    "/realtors?" +
    new URLSearchParams({
      ...Object.fromEntries(
        Object.entries(filters).map(([k, v]) => [k, String(v)]),
      ),
      page: String(page),
    }).toString();
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle
          title="Realtor relationships"
          description="Thoughtful connections. A clear next step for every prospect."
        />
        {writable && (
          <Button asChild>
            <Link href="/realtors/new">New realtor</Link>
          </Button>
        )}
      </div>
      <CrmNav operational={writable} />
      <form className="mb-7 space-y-4 rounded-xl border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="space-y-2 text-sm">
            Search
            <input
              name="q"
              defaultValue={filters.q}
              placeholder="Name, email or phone"
              className="block min-h-11 w-full rounded-lg border px-3"
              maxLength={100}
            />
          </label>
          <label className="space-y-2 text-sm">
            Relationship status
            <select
              name="status"
              defaultValue={filters.status}
              className="block min-h-11 w-full rounded-lg border px-3"
            >
              <option value="">All statuses</option>
              {relationshipStates.map((s) => (
                <option value={s} key={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm">
            City or area
            <input
              name="area"
              defaultValue={filters.area}
              maxLength={100}
              className="block min-h-11 w-full rounded-lg border px-3"
              placeholder="Vancouver, Kitsilano…"
            />
          </label>
          {writable && (
            <label className="space-y-2 text-sm">
              Assigned owner
              <select
                name="assigned_to"
                defaultValue={filters.assigned_to}
                className="block min-h-11 w-full rounded-lg border px-3"
              >
                <option value="">Everyone</option>
                {choices.owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Lookup
            name="brokerage_id"
            title="Brokerage"
            kind="brokerages"
            value={filters.brokerage_id}
            selectedName="Selected brokerage"
          />
          <label className="space-y-2 text-sm">
            Lead source
            <select
              name="lead_source_id"
              defaultValue={filters.lead_source_id}
              className="block min-h-11 w-full rounded-lg border px-3"
            >
              <option value="">All sources</option>
              {choices.sources.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-2 text-sm">
            Sort by
            <select
              name="sort"
              defaultValue={filters.sort}
              className="block min-h-11 w-full rounded-lg border px-3"
            >
              <option value="name">Name A–Z</option>
              <option value="newest">Recently added</option>
              {writable && <option value="followup">Next follow-up</option>}
            </select>
          </label>
          {writable && (
            <label className="space-y-2 text-sm">
              Follow-up
              <select
                name="followup"
                defaultValue={filters.followup}
                className="block min-h-11 w-full rounded-lg border px-3"
              >
                <option value="">All follow-ups</option>
                <option value="today">Due today</option>
                <option value="overdue">Overdue</option>
                <option value="missing">Missing next action</option>
              </select>
            </label>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button>Apply filters</Button>
          <Button variant="ghost" asChild>
            <Link href="/realtors">Reset</Link>
          </Button>
          {canManageCrm(user.roles) && (
            <label className="ml-auto flex min-h-11 items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="archived"
                value="true"
                defaultChecked={filters.archived === "true"}
              />
              Archived only
            </label>
          )}
        </div>
      </form>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-semibold">
          {filters.archived === "true"
            ? "Archived relationships"
            : "Your relationship directory"}
        </h2>
        <span className="text-sm text-muted-foreground">
          {result.total} {result.total === 1 ? "realtor" : "realtors"}
        </span>
      </div>
      {!result.rows.length ? (
        <EmptyState
          title={
            filters.q
              ? "No matching relationships"
              : "Room for your next connection"
          }
          description="Create a realtor or adjust your filters. Contact details and relationship history will appear here."
        />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-xl border bg-card md:block">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">
                Realtor relationship directory
              </caption>
              <thead className="bg-muted/60">
                <tr>
                  {[
                    "Realtor / Brokerage",
                    "Area",
                    "Status",
                    "Owner",
                    "Lead source",
                    ...(writable ? ["Last contact", "Next follow-up"] : []),
                  ].map((t) => (
                    <th scope="col" key={t} className="px-4 py-4 font-medium">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {result.rows.map((r) => (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="min-w-52 px-4 py-5">
                      <Link
                        href={"/realtors/" + r.id}
                        className="font-semibold underline-offset-4 hover:underline"
                      >
                        {r.first_name} {r.last_name}
                      </Link>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {r.brokerage_name ?? "Independent / not recorded"}
                      </p>
                    </td>
                    <td className="px-4 py-5">
                      {[r.primary_city, r.primary_area]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-5">
                      {label(r.relationship_status)}
                    </td>
                    <td className="px-4 py-5">
                      {r.owner_name ?? "Unassigned"}
                    </td>
                    <td className="px-4 py-5">{r.lead_source_name ?? "—"}</td>
                    {writable && (
                      <>
                        <td className="px-4 py-5 text-xs">
                          {formatDate(r.last_contact_date, false)}
                        </td>
                        <td className="min-w-44 px-4 py-5">
                          <FollowupBadge
                            due={r.next_followup_date}
                            status={r.relationship_status}
                          />
                          {r.next_followup_date && (
                            <p className="mt-2 text-xs">
                              {formatDate(r.next_followup_date)}
                            </p>
                          )}
                        </td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-3 md:hidden">
            {result.rows.map((r) => (
              <article key={r.id} className="rounded-xl border bg-card p-5">
                <Link
                  href={"/realtors/" + r.id}
                  className="flex items-center gap-3"
                >
                  <Avatar name={r.first_name + " " + r.last_name} />
                  <div>
                    <h3 className="font-semibold">
                      {r.first_name} {r.last_name}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {r.brokerage_name ?? "Brokerage not recorded"}
                    </p>
                  </div>
                </Link>
                <div className="mt-4 flex flex-wrap gap-3 text-sm">
                  <span>{label(r.relationship_status)}</span>
                  <span className="text-muted-foreground">
                    {r.primary_city}
                  </span>
                </div>
                {writable && (
                  <div className="mt-4 border-t pt-4">
                    <FollowupBadge
                      due={r.next_followup_date}
                      status={r.relationship_status}
                    />
                    {r.next_followup_date && (
                      <p className="mt-2 text-xs">
                        {r.next_action} · {formatDate(r.next_followup_date)}
                      </p>
                    )}
                  </div>
                )}
              </article>
            ))}
          </div>
        </>
      )}
      <Pager
        page={filters.page}
        hasNext={filters.page * 25 < result.total}
        href={href}
      />
    </>
  );
}
