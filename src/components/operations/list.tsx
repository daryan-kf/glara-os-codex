"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { PageTitle, EmptyState, StatusBadge } from "@/components/primitives";
import { Picker } from "@/components/sales/shared";
import { Button } from "@/components/ui/button";
import {
  day,
  addDays,
  statuses,
  type ProjectStatus,
} from "@/lib/operations/model";
import { Loading, Field, Pager, dateTime, label, Select } from "./shared";
import { ConvertToProject } from "@/components/sales/opportunities";
import { dollars } from "@/lib/sales/model";
type Card = FunctionReturnType<typeof api.operations.list>["page"][number];
function StartProjectPanel({ hasProjects }: { hasProjects: boolean }) {
  const rows = useQuery(api.sales.listOpportunities, {
    paginationOpts: { cursor: null, numItems: 25 },
  });
  const open = rows?.page.filter((o) => o.stage !== "lost") ?? [];
  return (
    <details
      className="rounded-2xl border bg-card p-5 sm:p-7"
      open={!hasProjects}
    >
      <summary className="cursor-pointer text-lg font-semibold">
        Start a project from your pipeline
      </summary>
      <p className="mt-2 text-sm text-muted-foreground">
        Pick an opportunity below — converting marks it won and creates the
        staging project with the default checklist. Every project starts from an
        opportunity so the property and Realtor stay linked; create the
        opportunity from a property first if it does not exist yet.
      </p>
      <div className="mt-5 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {!rows ? (
          <Loading />
        ) : (
          open.map((o) => (
            <div key={o._id} className="rounded-xl border p-4">
              <Link
                href={"/opportunities/" + o._id}
                className="font-semibold hover:underline"
              >
                {o.address}
              </Link>
              <p className="mt-1 text-xs text-muted-foreground">
                {o.city} · {o.realtor_name}
              </p>
              <p className="mt-2 text-sm">
                <StatusBadge>{label(o.stage)}</StatusBadge>{" "}
                <span className="ml-2 font-semibold">
                  {dollars(o.estimated_value_cents)}
                </span>
              </p>
              <ConvertToProject opportunityId={o._id} stage={o.stage} />
            </div>
          ))
        )}
      </div>
      {rows && !open.length && (
        <p className="mt-4 rounded-xl border p-5 text-sm">
          No open opportunities yet. Add a{" "}
          <Link href="/properties/new" className="text-primary underline">
            property
          </Link>{" "}
          and start an{" "}
          <Link href="/opportunities" className="text-primary underline">
            opportunity
          </Link>{" "}
          for it, then convert it here.
        </p>
      )}
    </details>
  );
}
export function ProjectCard({ p }: { p: Card }) {
  return (
    <Link
      href={`/projects/${p.id}`}
      className="block rounded-2xl border bg-card p-5 transition hover:border-primary/50"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs font-semibold tracking-wider text-primary">
          {p.project_number}
        </span>
        <StatusBadge>{label(p.status)}</StatusBadge>
      </div>
      <h2 className="text-lg font-semibold">{p.property_address}</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {p.city} · {p.realtor_name}
      </p>
      <dl className="my-5 grid grid-cols-2 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Staging</dt>
          <dd>{dateTime(p.staging_date)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Package end</dt>
          <dd>{p.planned_end_date || "Not set"}</dd>
        </div>
        {p.project_manager_name && (
          <div>
            <dt className="text-muted-foreground">Manager</dt>
            <dd>{p.project_manager_name}</dd>
          </div>
        )}
        {p.designer_name && (
          <div>
            <dt className="text-muted-foreground">Designer</dt>
            <dd>{p.designer_name}</dd>
          </div>
        )}
      </dl>
      <div
        className={`rounded-lg p-3 text-sm ${p.attention_level === "red" ? "bg-red-50 text-red-900" : p.attention_level === "yellow" ? "bg-amber-50 text-amber-900" : "bg-emerald-50 text-emerald-900"}`}
      >
        {p.attention_reasons.length
          ? p.attention_reasons.join(" · ")
          : "No current attention alerts"}
      </div>
      {p.priority !== "normal" && (
        <p className="mt-3 text-xs font-semibold uppercase">
          {p.priority} priority
        </p>
      )}
    </Link>
  );
}
export function Projects({
  propertyId,
  compact = false,
}: {
  propertyId?: string;
  compact?: boolean;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    [filters, setFilters] = useState<Record<string, string>>({});
  const viewer = useQuery(api.profiles.viewer, {}),
    admin = viewer?.roles.some((r) => r === "owner" || r === "admin"),
    options = useQuery(api.operations.options, admin ? {} : "skip");
  const result = useQuery(api.operations.list, {
    paginationOpts: { cursor, numItems: compact ? 6 : 12 },
    status: filters.status ? (filters.status as ProjectStatus) : undefined,
    city: filters.city || undefined,
    staging_day: filters.staging_day || undefined,
    manager: filters.manager ? (filters.manager as Id<"users">) : undefined,
    designer: filters.designer ? (filters.designer as Id<"users">) : undefined,
    realtor: filters.realtor ? (filters.realtor as Id<"realtors">) : undefined,
    property: propertyId as Id<"properties"> | undefined,
    attention: filters.attention || undefined,
    overdue: filters.overdue === "yes",
    archived: filters.archived === "yes",
  });
  return (
    <div className="space-y-6">
      {!compact && (
        <>
          <PageTitle
            title="Staging projects"
            description="Plan every space. Keep every handoff clear."
          />
          <div className="flex flex-wrap gap-3">
            <Button asChild variant="outline">
              <Link href="/calendar">Operations calendar</Link>
            </Button>
            {admin && (
              <Button asChild variant="outline">
                <Link href="/projects/settings">Operations settings</Link>
              </Button>
            )}
          </div>
          {admin && (
            <StartProjectPanel hasProjects={(result?.page.length ?? 0) > 0} />
          )}
        </>
      )}
      {!compact && (
        <details className="rounded-xl border bg-card p-4">
          <summary className="cursor-pointer font-medium">
            Filter projects
          </summary>
          <form
            className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4"
            onSubmit={(e) => {
              e.preventDefault();
              setFilters(
                Object.fromEntries(new FormData(e.currentTarget)) as Record<
                  string,
                  string
                >,
              );
              setCursor(null);
            }}
          >
            <Field name="status" label="Status" options={["", ...statuses]} />
            <Field name="city" label="City" />
            <Field name="staging_day" label="Staging date" type="date" />
            <Field
              name="attention"
              label="Attention"
              options={["", "red", "yellow", "green"]}
            />
            <Field name="overdue" label="Overdue only" options={["", "yes"]} />
            <Field
              name="archived"
              label="Archived records"
              options={["", "yes"]}
            />
            {options && (
              <>
                <Picker
                  kind="realtors"
                  name="realtor"
                  label="Realtor"
                  required={false}
                />
                <Select
                  name="manager"
                  label="Project manager"
                  options={options.staff}
                />
                <Select
                  name="designer"
                  label="Designer"
                  options={options.staff.filter((p) =>
                    p.roles.some((r) =>
                      ["owner", "admin", "designer"].includes(r),
                    ),
                  )}
                />
              </>
            )}
            <Button type="submit">Apply filters</Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">
            Default view shows active projects. Choose a status to find
            completed or cancelled work.
          </p>
        </details>
      )}
      {result === undefined ? (
        <Loading />
      ) : result.page.length ? (
        <div
          className={`grid gap-4 ${compact ? "md:grid-cols-2" : "lg:grid-cols-2 xl:grid-cols-3"}`}
        >
          {result.page.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="No projects on this page"
          description={
            result.isDone
              ? "Projects become available here after a won opportunity is handed to operations. Adjust your filters to find past work."
              : "No matching projects in this batch. Continue to the next page."
          }
        />
      )}
      {result && (
        <>
          <Pager
            done={result.isDone}
            onReset={() => setCursor(null)}
            onNext={() => setCursor(result.continueCursor)}
          />
          {!result.isDone && (
            <p className="text-xs text-muted-foreground">
              More records are available. Filters and access are applied within
              each bounded page.
            </p>
          )}
        </>
      )}
    </div>
  );
}
export function OperationsCalendar({
  todayOnly = false,
}: {
  todayOnly?: boolean;
}) {
  const [mode, setMode] = useState("today"),
    [date, setDate] = useState(day()),
    [cursor, setCursor] = useState<string | null>(null);
  const end = addDays(
      date,
      todayOnly ? 1 : mode === "today" ? 0 : mode === "week" ? 6 : 30,
    ),
    result = useQuery(api.operations.agenda, {
      start_day: date,
      end_day: end,
      paginationOpts: { cursor, numItems: 25 },
    }),
    viewer = useQuery(api.profiles.viewer, {}),
    admin = viewer?.roles.some((r) => ["owner", "admin"].includes(r)),
    capacity = useQuery(api.operations.capacity, admin ? { date } : "skip");
  return (
    <section className="space-y-5">
      {todayOnly ? (
        <h2 className="text-xl font-semibold">Today & tomorrow</h2>
      ) : (
        <PageTitle
          title="Operations calendar"
          description="A shared agenda for staging and destaging. All times are Vancouver time."
        />
      )}
      <div className="flex flex-wrap items-end gap-3">
        {!todayOnly && (
          <>
            <label className="grid gap-2 text-sm">
              Starting date
              <input
                type="date"
                className="min-h-11 rounded-lg border bg-card p-2"
                value={date}
                onChange={(e) => {
                  setDate(e.target.value || day());
                  setCursor(null);
                }}
              />
            </label>
            {["today", "week", "upcoming"].map((m) => (
              <Button
                key={m}
                variant={mode === m ? "default" : "outline"}
                onClick={() => {
                  setMode(m);
                  setCursor(null);
                  if (m === "today") setDate(day());
                }}
              >
                {label(m)}
              </Button>
            ))}
          </>
        )}
        {capacity && (
          <p className="rounded-lg border bg-card p-3 text-sm">
            {date} · Staging {capacity.stagings}/{capacity.max_stagings} ·
            Destaging {capacity.destagings}/{capacity.max_destagings}
          </p>
        )}
      </div>
      {result === undefined ? (
        <Loading />
      ) : (
        <div className="space-y-3">
          {!result.page.length && (
            <EmptyState
              title="No operations on this page"
              description="Schedule staging, destaging and other events from a project. Continue through the agenda if more pages are available."
            />
          )}
          {result.page.map((e) => (
            <Link
              key={e.id}
              href={`/projects/${e.project_id}#schedule`}
              className="flex flex-col gap-3 rounded-xl border bg-card p-5 sm:flex-row sm:items-center sm:justify-between"
            >
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-primary">
                  {label(e.event_type)} · {e.project_number}
                </p>
                <h3 className="mt-2 font-semibold">{e.address}</h3>
                <p className="text-sm text-muted-foreground">
                  {e.city} · {e.lead}
                </p>
              </div>
              <p className="text-sm">
                {dateTime(e.start_at)}
                <br />
                <span className="text-muted-foreground">
                  Until {dateTime(e.end_at)} · {e.status}
                </span>
              </p>
            </Link>
          ))}
        </div>
      )}
      {result && !result.isDone && (
        <Pager
          done={false}
          onNext={() => setCursor(result.continueCursor)}
          onReset={() => setCursor(null)}
        />
      )}
    </section>
  );
}
function AttentionCenter() {
  const result = useQuery(api.operations.attentionQueue, {});
  if (!result) return <Loading />;
  return (
    <div className="space-y-4">
      {result.page.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {result.page.map((p) => (
            <ProjectCard key={p.id} p={p} />
          ))}
        </div>
      ) : (
        <p className="rounded-xl border bg-card p-5 text-sm text-muted-foreground">
          No alerts in the current operational review.
        </p>
      )}
      {result.partial && (
        <p className="text-sm text-amber-900">
          This is a bounded priority review. Open Projects and page through
          attention filters for the complete worklist.
        </p>
      )}
    </div>
  );
}
export function OperationsToday() {
  const viewer = useQuery(api.profiles.viewer, {});
  if (!viewer) return null;
  return (
    <div className="mb-10 space-y-8">
      {!viewer.roles.every((r) => r === "marketing") && (
        <OperationsCalendar todayOnly />
      )}
      <section>
        <div className="mb-5 flex flex-wrap justify-between gap-3">
          <h2 className="text-xl font-semibold">Project action center</h2>
          <Link href="/projects" className="text-sm font-medium text-primary">
            View all projects →
          </Link>
        </div>
        <AttentionCenter />
      </section>
    </div>
  );
}
export function ProjectSearchResults({
  query,
  enabled,
  onSelect,
}: {
  query: string;
  enabled: boolean;
  onSelect: () => void;
}) {
  const rows = useQuery(
    api.operations.search,
    enabled && query.trim().length >= 2
      ? { q: query.trim().slice(0, 100) }
      : "skip",
  );
  return (
    <>
      {rows?.map((r) => (
        <Link
          key={r.id}
          href={`/projects/${r.id}`}
          onClick={onSelect}
          className="block rounded-lg p-3 text-sm hover:bg-muted"
        >
          <span className="block text-xs text-muted-foreground">Project</span>
          {r.name}
        </Link>
      ))}
    </>
  );
}
