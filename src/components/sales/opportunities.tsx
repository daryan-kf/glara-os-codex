"use client";
import { CopilotLink } from "@/components/ai/copilot";

import { Handoff } from "@/components/operations/create";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import {
  PageTitle,
  StatusBadge,
  StatCard,
  EmptyState,
} from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Field,
  Picker,
  SalesForm,
  Panel,
  Loading,
  Pager,
  inputClass,
} from "./shared";
import {
  stages,
  transitions,
  active,
  label,
  dollars,
  decimal,
  lossReasons,
  type Stage,
} from "@/lib/sales/model";
type Card = FunctionReturnType<
  typeof api.sales.listOpportunities
>["page"][number];
export function SalesSummary() {
  const s = useQuery(api.sales.summary, {});
  if (!s) return <Loading />;
  return (
    <div className="mb-7 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <StatCard
        label="Open pipeline"
        value={dollars(s.open_value_cents)}
        note={`${s.open_count} opportunities`}
      />
      <StatCard
        label="Quotes awaiting response"
        value={`${s.awaiting}${s.awaiting_limited ? "+" : ""}`}
        note="Recorded sent, still within validity"
      />
      <StatCard
        label="Overdue opportunities"
        value={`${s.overdue}${s.overdue_limited ? "+" : ""}`}
        note="Based on open actions; bounded live check"
      />
      <StatCard
        label="Won this month"
        value={String(s.won)}
        note="Sales closed; no projects created"
      />
      <StatCard
        label="Lost this month"
        value={String(s.lost)}
        note="Reasons retained for review"
      />
    </div>
  );
}
function OpportunityCard({ o }: { o: Card }) {
  const [clock] = useState(() => Date.now());
  const age = Math.max(
    0,
    Math.floor((clock - Date.parse(o.stage_changed_at)) / 86400000),
  );
  return (
    <article className="rounded-xl border bg-card p-4 shadow-sm">
      <Link
        href={"/opportunities/" + o._id}
        className="font-semibold hover:underline"
      >
        {o.address}
      </Link>
      <p className="mt-2 text-xs text-muted-foreground">
        {o.city} · {o.realtor_name}
      </p>
      <p className="mt-3 text-lg font-semibold">
        {dollars(o.estimated_value_cents)}
      </p>
      <p className="mt-2 text-sm">
        {o.next_action?.title ??
          (active(o.stage as Stage) ? "Next action required" : "Closed")}
      </p>
      {o.next_action?.due_at && (
        <p
          className={
            "mt-1 text-xs " +
            (o.next_action.due_at < new Date().toISOString()
              ? "text-red-700"
              : "text-muted-foreground")
          }
        >
          {new Date(o.next_action.due_at).toLocaleDateString()}
        </p>
      )}
      <p className="mt-4 text-xs text-muted-foreground">
        {o.owner_name} · {age} days in stage
      </p>
      <details className="mt-3 border-t pt-3">
        <summary className="cursor-pointer text-xs font-medium">
          Move stage
        </summary>
        <StageControl o={o} />
      </details>
    </article>
  );
}
export function Opportunities({
  propertyId,
  realtorId,
}: {
  propertyId?: string;
  realtorId?: string;
}) {
  const [view, setView] = useState<"board" | "list">(
      propertyId || realtorId ? "list" : "board",
    ),
    [cursor, setCursor] = useState<string | null>(null),
    [filters, setFilters] = useState({
      stage: "",
      realtor_id: realtorId ?? "",
      q: "",
      city: "",
      assigned_to: "",
      source: "",
      overdue: false,
      sort: "newest" as "newest" | "oldest",
    }),
    [mobileStage, setMobileStage] = useState<Stage>("new");
  const board = useQuery(api.sales.pipeline, view === "board" ? {} : "skip"),
    list = useQuery(
      api.sales.listOpportunities,
      view === "list"
        ? {
            paginationOpts: { cursor, numItems: 25 },
            ...filters,
            property_id: propertyId as Id<"properties"> | undefined,
            realtor_id: filters.realtor_id
              ? (filters.realtor_id as Id<"realtors">)
              : undefined,
            stage: filters.stage ? (filters.stage as Stage) : undefined,
            assigned_to: filters.assigned_to
              ? (filters.assigned_to as Id<"users">)
              : undefined,
            source: filters.source
              ? (filters.source as Id<"lead_sources">)
              : undefined,
          }
        : "skip",
    ),
    choices = useQuery(api.crm.read, { input: '{"op":"choices"}' });
  const owners =
    (choices as {
      owners?: { id: string; name: string }[];
      sources?: { id: string; name: string }[];
    }) ?? {};
  return (
    <>
      <PageTitle
        title="Sales pipeline"
        description="Every opportunity. A clear next step."
      />
      <SalesSummary />
      <TopRealtors />
      <div className="mb-6 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/opportunities/new">New opportunity</Link>
        </Button>
        <Button
          variant="outline"
          onClick={() => setView(view === "board" ? "list" : "board")}
        >
          {view === "board" ? "List & filters" : "Pipeline board"}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/properties">Properties</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href="/quotes">Quotes</Link>
        </Button>
      </div>
      {view === "board" ? (
        <>
          <label className="mb-4 grid gap-2 text-sm lg:hidden">
            Stage
            <select
              className={inputClass}
              value={mobileStage}
              onChange={(e) => setMobileStage(e.target.value as Stage)}
            >
              {stages.map((s) => (
                <option key={s} value={s}>
                  {label(s)}
                </option>
              ))}
            </select>
          </label>
          {!board ? (
            <Loading />
          ) : (
            <div className="grid gap-5 lg:grid-cols-4">
              {board.map((column) => (
                <section
                  key={column.stage}
                  className={
                    (column.stage !== mobileStage ? "hidden lg:block " : "") +
                    "rounded-2xl bg-muted/60 p-3"
                  }
                >
                  <div className="mb-4 flex items-center justify-between p-2">
                    <h2 className="text-xs font-semibold uppercase tracking-wider">
                      {label(column.stage)}
                    </h2>
                    <span className="rounded-full bg-card px-2 text-xs">
                      {column.totals?.count ?? 0}
                    </span>
                  </div>
                  <p className="mb-3 px-2 text-xs text-muted-foreground">
                    {dollars(column.totals?.cents ?? "0")}
                  </p>
                  <div className="space-y-3">
                    {column.rows.map((o) => (
                      <OpportunityCard o={o} key={o._id} />
                    ))}
                    {!column.rows.length && (
                      <p className="p-5 text-xs text-muted-foreground">
                        No opportunities here yet.
                      </p>
                    )}
                  </div>
                  {(column.totals?.count ?? 0) > 6 && (
                    <button
                      className="mt-4 text-sm underline"
                      onClick={() => {
                        setFilters({ ...filters, stage: column.stage });
                        setCursor(null);
                        setView("list");
                      }}
                    >
                      View all in stage
                    </button>
                  )}
                </section>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <form
            className="mb-6 grid gap-4 rounded-2xl border bg-card p-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              setCursor(null);
              setFilters({
                q: String(f.get("q")),
                realtor_id: String(f.get("realtor_id") ?? ""),
                city: String(f.get("city")),
                stage: String(f.get("stage")),
                assigned_to: String(f.get("assigned_to")),
                source: String(f.get("source")),
                overdue: f.get("overdue") === "on",
                sort: String(f.get("sort")) as "newest" | "oldest",
              });
            }}
          >
            <Field label="Address or Realtor" name="q" />
            <Picker
              kind="realtors"
              name="realtor_id"
              label="Realtor filter"
              initialId={realtorId}
              required={false}
            />
            <Field label="City" name="city" />
            <Field
              label="Stage filter"
              name="stage"
              value={filters.stage}
              options={["", ...stages]}
            />
            <label className="grid gap-2 text-sm">
              Assigned salesperson
              <select className={inputClass} name="assigned_to">
                <option value="">Anyone</option>
                {owners.owners?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-2 text-sm">
              Source
              <select className={inputClass} name="source">
                <option value="">All sources</option>
                {owners.sources?.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </select>
            </label>
            <Field label="Sort" name="sort" options={["newest", "oldest"]} />
            <label className="flex items-center gap-2 text-sm">
              <input name="overdue" type="checkbox" />
              Overdue next action
            </label>
            <Button type="submit">Filter opportunities</Button>
          </form>
          {!list ? (
            <Loading />
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {list.page.map((o) => (
                  <div key={o._id}>
                    <div className="mb-2">
                      <StatusBadge>{label(o.stage)}</StatusBadge>
                    </div>
                    <OpportunityCard o={o} />
                  </div>
                ))}
              </div>
              {!list.page.length && (
                <p className="rounded-xl border p-6 text-sm">
                  No matches on this page. Continue to search the next page.
                </p>
              )}
              <Pager
                done={list.isDone}
                onNext={() => setCursor(list.continueCursor)}
                onReset={() => setCursor(null)}
              />
            </>
          )}
        </>
      )}
    </>
  );
}
export function OpportunityEditor({
  id,
  propertyId,
}: {
  id?: string;
  propertyId?: string;
}) {
  const router = useRouter(),
    save = useMutation(api.sales.saveOpportunity),
    viewer = useQuery(api.profiles.viewer, {}),
    result = useQuery(
      api.sales.getOpportunity,
      id ? { id: id as Id<"opportunities"> } : "skip",
    ),
    p = useQuery(
      api.sales.getProperty,
      propertyId ? { id: propertyId as Id<"properties"> } : "skip",
    ),
    choices = useQuery(api.crm.read, { input: '{"op":"choices"}' });
  if (
    (id && !result) ||
    viewer === undefined ||
    choices === undefined ||
    (propertyId && p === undefined)
  )
    return <Loading />;
  const o = result?.opportunity;
  const c = choices as
    | {
        owners?: { id: string; name: string }[];
        sources?: { id: string; name: string }[];
      }
    | undefined;
  return (
    <>
      <PageTitle
        title={id ? "Edit opportunity" : "New opportunity"}
        description="Every active deal needs an owner and a dated next action."
      />
      <Panel title="Sales opportunity">
        <SalesForm
          expectedVersion={o?.version ?? 0}
          submit="Save opportunity"
          onSave={async (data, _form, loadedVersion) => {
            const saved = await save({
              id: id as Id<"opportunities"> | undefined,
              version: loadedVersion ?? 0,
              input: JSON.stringify(data),
            });
            router.push("/opportunities/" + saved);
          }}
        >
          {o ? (
            <>
              <input type="hidden" name="property_id" value={o.property_id} />
              <p>{o.address}</p>
            </>
          ) : (
            <Picker
              key={p?.property._id ?? "pick"}
              kind="properties"
              name="property_id"
              label="Property"
              initialId={propertyId}
              initialLabel={p?.property.address_line_1}
            />
          )}
          <div className="grid gap-5 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">
              Assigned salesperson
              <select
                name="assigned_to"
                className={inputClass}
                defaultValue={o?.assigned_to ?? viewer?.id}
                required
              >
                {c?.owners?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
            <Field
              label="Estimated value (CAD)"
              name="estimated_value"
              value={o ? decimal(o.estimated_value_cents) : "0.00"}
              required
            />
            <Field
              label="Probability (%)"
              name="probability"
              type="number"
              value={o?.probability ?? 10}
              required
            />
            <Field
              label="Expected close date"
              name="expected_close_date"
              type="date"
              value={o?.expected_close_date}
            />
            <label className="grid gap-2 text-sm">
              Lead source
              <select
                className={inputClass}
                name="lead_source_id"
                defaultValue={o?.lead_source_id ?? ""}
              >
                <option value="">Not selected</option>
                {c?.sources?.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <Field
            label="Negotiation / sales notes (private)"
            name="notes"
            type="textarea"
            value={o?.notes}
          />
          <Field
            label={id ? "Additional next action (optional)" : "Next action"}
            name="next_action_title"
            required={!id}
          />
          <Field
            label="Next action date"
            name="next_action_date"
            type="datetime-local"
            required={!id}
          />
          <p className="text-xs text-muted-foreground">
            Property and Realtor stay linked. Extra actions are added to the
            timeline; existing follow-ups are not overwritten.
          </p>
        </SalesForm>
      </Panel>
    </>
  );
}
export function StageControl({ o }: { o: Card }) {
  const change = useMutation(api.sales.transition);
  return (
    <div className="mt-4">
      <SalesForm
        submit="Change stage"
        onSave={async (data) =>
          change({ id: o._id, version: o.version, input: JSON.stringify(data) })
        }
      >
        <Field
          label="Move to stage"
          name="stage"
          options={transitions(o.stage as Stage)}
        />
        <Field
          label="Loss reason (required for lost)"
          name="lost_reason"
          options={["", ...lossReasons]}
        />
        <Field label="Loss notes" name="lost_notes" type="textarea" />
        <p className="text-xs text-muted-foreground">
          Quote sent requires an issued quote. Reopening requires an open
          action. Won never creates a project.
        </p>
      </SalesForm>
    </div>
  );
}
export function OpportunityDetail({ id }: { id: string }) {
  const result = useQuery(api.sales.getOpportunity, {
      id: id as Id<"opportunities">,
    }),
    archive = useMutation(api.sales.archive),
    router = useRouter();
  if (result === undefined) return <Loading />;
  if (!result)
    return (
      <EmptyState
        title="Opportunity unavailable"
        description="This record is unavailable or archived."
      />
    );
  const o = result.opportunity;
  return (
    <>
      <PageTitle
        title={o.address}
        description={`${o.realtor_name} · ${o.city}`}
      />
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <StatusBadge>{label(o.stage)}</StatusBadge>
        <CopilotLink feature="opportunity" id={id} />
        <Button variant="outline" asChild>
          <Link href={"/properties/" + o.property_id}>Property overview</Link>
        </Button>
        <Button variant="outline" asChild>
          <Link href={"/realtors/" + o.realtor_id}>Realtor</Link>
        </Button>
        {!o.deleted_at && (
          <Button asChild>
            <Link href={"/opportunities/" + id + "/edit"}>
              Edit opportunity
            </Link>
          </Button>
        )}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Estimated value"
          value={dollars(o.estimated_value_cents)}
          note={`${o.probability}% probability`}
        />
        <StatCard
          label="Next action"
          value={o.next_action?.title ?? "No open action"}
          note={
            o.next_action?.due_at
              ? new Date(o.next_action.due_at).toLocaleString()
              : "Closed deals do not require an action"
          }
        />
        <StatCard
          label="Assigned to"
          value={o.owner_name}
          note={`Source: ${result.source ?? "Not recorded"}`}
        />
      </div>
      {o.stage === "lost" && (
        <p className="mb-6 rounded-xl border bg-muted p-5">
          Lost: {label(o.lost_reason)} · {o.lost_notes}
        </p>
      )}
      {o.stage === "won" && <Handoff id={o._id} />}
      <div className="grid gap-6 xl:grid-cols-2">
        <Panel title="Stage & sales notes">
          <p className="mb-4 whitespace-pre-wrap text-sm">
            {o.notes || "No sales notes recorded."}
          </p>
          <p className="text-xs text-muted-foreground">
            In this stage since{" "}
            {new Date(o.stage_changed_at).toLocaleDateString()} · Expected close{" "}
            {o.expected_close_date || "not recorded"}
          </p>
          {!o.deleted_at && <StageControl key={o.version} o={o} />}
        </Panel>
        <Panel title="Next actions & timeline">
          <ActionEditor id={id} />
          {result.activities.map((a) => (
            <div key={a._id} className="mt-5 border-t pt-4">
              <h3 className="font-medium">{a.title}</h3>
              <p className="mt-1 text-xs text-muted-foreground">
                {a.status} ·{" "}
                {a.due_at ? new Date(a.due_at).toLocaleString() : ""}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm">
                {a.description}
              </p>
              {a.status === "open" && !o.deleted_at && (
                <FinishAction id={a._id} />
              )}
            </div>
          ))}
          {result.history.map((h) => (
            <p key={h._id} className="mt-3 text-xs text-muted-foreground">
              {label(h.action.toLowerCase())} ·{" "}
              {new Date(h.created_at).toLocaleString()}
            </p>
          ))}
        </Panel>
        <Panel title="Consultations">
          <ConsultationEditor id={id} />
          {result.consultations.map((c) => (
            <div key={c._id} className="mt-4 rounded-lg border p-4">
              <p className="font-medium">
                {label(c.consultation_type)} · {label(c.status)}
              </p>
              <p className="mt-2 text-sm">
                {new Date(c.scheduled_at).toLocaleString()}
              </p>
              <p className="mt-2 text-sm">{c.notes}</p>
              {c.status === "scheduled" && (
                <>
                  <ConsultationStatus id={c._id} version={c.version} />
                  <ConsultationEditor key={c._id} id={id} existing={c} />
                </>
              )}
            </div>
          ))}
        </Panel>
        <Panel title="Quotes">
          <Button asChild>
            <Link href={"/quotes/new?opportunity=" + id}>Create quote</Link>
          </Button>
          <p className="mt-3 text-xs text-muted-foreground">
            Recording a sent or accepted quote does not move this opportunity
            automatically. Use Change stage intentionally.
          </p>
          {result.quotes.map((q) => (
            <Link
              key={q._id}
              href={"/quotes/" + q._id}
              className="mt-4 block rounded-lg border p-4 hover:bg-muted"
            >
              <p className="font-medium">
                {q.number} · {label(q.status)}
              </p>
              <p className="mt-2">{dollars(q.total_cents)}</p>
            </Link>
          ))}
        </Panel>
      </div>
      <details className="mt-6 rounded-xl border p-4">
        <summary className="cursor-pointer text-sm">
          {o.deleted_at ? "Restore opportunity" : "Archive opportunity"}
        </summary>
        <p className="my-4 text-sm">
          History is retained. Restoration is limited to Owner/Admin.
        </p>
        <SalesForm
          submit={o.deleted_at ? "Confirm restore" : "Confirm archive"}
          onSave={async () => {
            await archive({
              kind: "opportunities",
              id,
              version: o.version,
              restore: !!o.deleted_at,
            });
            router.push("/opportunities");
          }}
        >
          <span />
        </SalesForm>
      </details>
    </>
  );
}
function ActionEditor({ id }: { id: string }) {
  const save = useMutation(api.sales.saveAction),
    viewer = useQuery(api.profiles.viewer, {});
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold">
        Add next action
      </summary>
      <div className="mt-4">
        <SalesForm
          submit="Save next action"
          onSave={async (data) =>
            save({
              input: JSON.stringify({
                ...data,
                opportunity_id: id,
                assigned_to: viewer?.id,
              }),
            })
          }
        >
          <Field label="Action title" name="title" required />
          <Field
            label="Due date"
            name="due_at"
            type="datetime-local"
            required
          />
          <Field label="Activity notes" name="description" type="textarea" />
        </SalesForm>
      </div>
    </details>
  );
}
export function FinishAction({ id }: { id: Id<"activities"> }) {
  const finish = useMutation(api.sales.finishAction);
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs font-medium">
        Complete / cancel / reschedule
      </summary>
      <div className="mt-3">
        <SalesForm
          submit="Update action"
          onSave={async (d) =>
            finish({
              id,
              status: d.status as "completed" | "cancelled",
              replacement_title: d.replacement_title || undefined,
              replacement_due: d.replacement_due || undefined,
            })
          }
        >
          <Field
            label="Action status"
            name="status"
            options={["completed", "cancelled"]}
          />
          <Field label="Replacement title" name="replacement_title" />
          <Field
            label="Replacement date"
            name="replacement_due"
            type="datetime-local"
          />
          <p className="text-xs text-muted-foreground">
            To reschedule, cancel and provide a replacement. An active deal must
            retain a next action.
          </p>
        </SalesForm>
      </div>
    </details>
  );
}
function ConsultationEditor({
  id,
  existing,
}: {
  id: string;
  existing?: NonNullable<
    FunctionReturnType<typeof api.sales.getOpportunity>
  >["consultations"][number];
}) {
  const save = useMutation(api.sales.saveConsultation),
    viewer = useQuery(api.profiles.viewer, {});
  return (
    <details>
      <summary className="cursor-pointer text-sm font-semibold">
        {existing ? "Reschedule consultation" : "Schedule consultation"}
      </summary>
      <div className="mt-4">
        <SalesForm
          expectedVersion={existing?.version ?? 0}
          submit={
            existing ? "Save rescheduled consultation" : "Save consultation"
          }
          onSave={async (d, _form, loadedVersion) =>
            save({
              id: existing?._id,
              version: loadedVersion ?? 0,
              input: JSON.stringify({
                ...d,
                opportunity_id: id,
                assigned_to: existing?.assigned_to ?? viewer?.id,
              }),
            })
          }
        >
          <Field
            label="Consultation date"
            name="scheduled_at"
            type="datetime-local"
            required
          />
          <Field
            value={existing?.consultation_type}
            label="Consultation type"
            name="consultation_type"
            options={["onsite", "virtual", "phone", "office", "other"]}
          />
          <Field
            label="Consultation notes"
            name="notes"
            type="textarea"
            value={existing?.notes}
          />
        </SalesForm>
      </div>
    </details>
  );
}
function ConsultationStatus({
  id,
  version,
}: {
  id: Id<"consultations">;
  version: number;
}) {
  const save = useMutation(api.sales.consultationStatus);
  return (
    <div className="mt-3">
      <SalesForm
        submit="Update consultation"
        onSave={async (d) =>
          save({
            id,
            version,
            status: d.status as "completed" | "cancelled" | "no_show",
          })
        }
      >
        <Field
          label="Consultation status"
          name="status"
          options={["completed", "cancelled", "no_show"]}
        />
      </SalesForm>
    </div>
  );
}

function TopRealtors() {
  const rows = useQuery(api.sales.topRealtors, {});
  if (!rows?.length) return null;
  return (
    <section className="mb-6 rounded-2xl border bg-card p-5">
      <h2 className="font-semibold">Leading Realtor relationships</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        By total opportunities, excluding archived records
      </p>
      <div className="mt-4 flex flex-wrap gap-4">
        {rows.map((r) => (
          <Link
            className="rounded-lg bg-muted px-4 py-3 text-sm"
            key={r.id}
            href={"/opportunities?realtor=" + r.id}
          >
            {r.name} · {r.count}
          </Link>
        ))}
      </div>
    </section>
  );
}
