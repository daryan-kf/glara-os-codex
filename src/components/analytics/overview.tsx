"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowUpRight } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { LoadingState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { dollars } from "@/lib/commercial/model";
import { labelFor } from "@/lib/analytics/catalog";
import { ratio } from "@/lib/analytics/model";
import { Panel, amount, percent, useReportingClock } from "./shared";
export function Drill({ metric, period }: { metric: string; period: string }) {
  const [cursor, setCursor] = useState<string | null>(null),
    data = useQuery(api.analytics.drill, {
      metric,
      period,
      pagination: { cursor, numItems: 15 },
    });
  if (!data) return <LoadingState />;
  return (
    <div className="mt-6">
      <div className="divide-y">
        {data.page.map((r) => (
          <Link
            key={r.id}
            href={r.href}
            className="flex min-h-16 items-center justify-between gap-3 py-3 text-sm hover:text-primary"
          >
            <div>
              <strong>{r.label}</strong>
              <p className="mt-1 text-xs text-muted-foreground">
                {r.scope === "current" ? "Current balance" : r.event_at} ·{" "}
                {r.precision === "business_date"
                  ? "Business date"
                  : "Timestamp"}
              </p>
            </div>
            <span>{amount(metric, r.value)}</span>
          </Link>
        ))}
      </div>
      {!data.page.length && (
        <p className="py-6 text-sm text-muted-foreground">
          No contributing records in this page.
        </p>
      )}
      <div className="mt-4 flex gap-3">
        <Button
          variant="outline"
          disabled={!cursor}
          onClick={() => setCursor(null)}
        >
          First page
        </Button>
        <Button
          variant="outline"
          disabled={data.isDone}
          onClick={() => setCursor(data.continueCursor)}
        >
          Next page
        </Button>
      </div>
    </div>
  );
}
export function Trends({ manager }: { manager: boolean }) {
  const rows = useQuery(api.analytics.trends, {
    refresh_bucket: useReportingClock(),
  });
  return (
    <Panel
      title={manager ? "Invoiced & collected" : "Staging activity"}
      note="Six calendar months. The current month is through today; earlier months are complete."
    >
      {!rows ? (
        <LoadingState />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Monthly event totals</caption>
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                <th className="pb-3">Month</th>
                <th className="pb-3">
                  {manager ? "Gross invoiced" : "Staged"}
                </th>
                <th className="pb-3">
                  {manager ? "Net cash" : "Listing live"}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.month} className="border-b last:border-0">
                  <th className="py-4 font-medium">{r.month}</th>
                  <td>
                    {manager
                      ? dollars(r.metrics.invoiced_cents ?? "0")
                      : (r.metrics.projects_staged ?? "0")}
                  </td>
                  <td>
                    {manager
                      ? dollars(
                          String(
                            BigInt(r.metrics.cash_received_cents ?? "0") -
                              BigInt(r.metrics.cash_reversed_cents ?? "0"),
                          ),
                        )
                      : (r.metrics.projects_listing_live ?? "0")}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
export function Aging() {
  const data = useQuery(api.analytics.aging, {
    refresh_bucket: useReportingClock(),
  });
  return (
    <Panel
      title="Receivables aging"
      note="Current outstanding balances, aged from invoice due date in Vancouver."
    >
      {!data ? (
        <LoadingState />
      ) : (
        <div className="space-y-4">
          {Object.entries(data.buckets).map(([k, v]) => (
            <Link
              href="/payments"
              key={k}
              className="flex min-h-9 items-center justify-between text-sm"
            >
              <span className="capitalize text-muted-foreground">
                {k.replaceAll("_", " ")}
              </span>
              <strong>{dollars(v)}</strong>
            </Link>
          ))}
        </div>
      )}
    </Panel>
  );
}
export function Capacity() {
  const [days, setDays] = useState(7),
    data = useQuery(api.analyticsOperations.forecast, {
      days,
      refresh_bucket: useReportingClock(),
    });
  return (
    <Panel
      title="Delivery capacity"
      note="Upcoming scheduled work, using the operations calendar and configured daily limits."
    >
      <div className="mb-5 flex flex-wrap gap-2">
        {[7, 14, 30].map((n) => (
          <Button
            key={n}
            variant={n === days ? "default" : "outline"}
            onClick={() => setDays(n)}
          >
            Next {n} days
          </Button>
        ))}
      </div>
      {!data ? (
        <LoadingState />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4 xl:grid-cols-7">
            {data.rows.map((r) => (
              <Link
                key={r.date}
                href="/calendar"
                className={`rounded-xl border p-3 text-xs ${r.stagings > r.max_stagings || r.destagings > r.max_destagings ? "border-amber-300 bg-amber-50" : ""}`}
              >
                <strong>{r.date.slice(5)}</strong>
                <p className="mt-3">
                  Staging {r.stagings}/{r.max_stagings}
                </p>
                <p className="mt-1">
                  Destaging {r.destagings}/{r.max_destagings}
                </p>
              </Link>
            ))}
          </div>
          {data.partial && (
            <p className="mt-4 text-sm text-amber-800">
              Some days exceed the calendar reporting limit. Open the calendar
              for details.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
export function Breakdown({
  period,
  metric,
  dimension,
  title,
}: {
  period: string;
  metric: string;
  dimension: string;
  title: string;
}) {
  const rows = useQuery(api.analytics.breakdown, { period, metric, dimension });
  return (
    <Panel
      title={title}
      note={`Ranked by ${labelFor(metric).toLowerCase()}. Historical ownership is retained.`}
    >
      {!rows ? (
        <LoadingState />
      ) : (
        <>
          <div className="space-y-4">
            {rows.rows.slice(0, 10).map((r) => (
              <div key={r.id} className="flex justify-between gap-3 text-sm">
                <span>
                  {r.href ? (
                    <Link
                      href={r.href}
                      className="text-primary hover:underline"
                    >
                      {r.label}
                    </Link>
                  ) : (
                    r.label
                  )}
                </span>
                <strong>{amount(metric, r.value)}</strong>
              </div>
            ))}
          </div>
          {!rows.rows.length && (
            <p className="text-sm text-muted-foreground">
              No recorded activity in this period.
            </p>
          )}
          <p className="mt-5 text-xs text-muted-foreground">
            {rows.member_count} attributed groups · Unknown:{" "}
            {amount(metric, rows.unknown)}
          </p>
        </>
      )}
    </Panel>
  );
}
export function Actions() {
  const data = useQuery(api.analyticsOperations.actionCenter, {
    refresh_bucket: useReportingClock(),
  });
  return (
    <Panel
      title="Action center"
      note="Prioritized by severity, financial impact, then due date. Every alert links to its source."
    >
      {!data ? (
        <LoadingState />
      ) : (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            {data.actions.map((a) => (
              <Link
                key={a.domain + a.id}
                href={a.href}
                className={`rounded-xl border-l-4 p-4 ${a.severity === "red" ? "border-l-red-700 bg-red-50" : "border-l-amber-500 bg-amber-50"}`}
              >
                <div className="flex justify-between gap-2 text-xs">
                  <span className="uppercase tracking-wide">
                    {a.domain} ·{" "}
                    {a.severity === "red" ? "Needs attention" : "Review"}
                  </span>
                  <ArrowUpRight className="size-4" />
                </div>
                <h3 className="mt-2 text-sm font-semibold">{a.label}</h3>
                <p className="mt-2 text-sm leading-6">{a.reason}</p>
                {a.impact_cents !== "0" && (
                  <p className="mt-2 text-sm font-medium">
                    {dollars(a.impact_cents)}
                  </p>
                )}
              </Link>
            ))}
          </div>
          {!data.actions.length && (
            <p className="text-sm text-muted-foreground">
              No alerts in the current review queue.
            </p>
          )}
          {data.partial && (
            <p className="mt-5 text-xs text-muted-foreground">
              This is a prioritized, bounded review queue, not a complete
              company exception count. Open the source modules for all records.
            </p>
          )}
        </>
      )}
    </Panel>
  );
}
export function SalesDetail({ period }: { period: string }) {
  const data = useQuery(api.analytics.summary, { period }),
    stages = useQuery(api.analytics.pipelineDetails, {
      refresh_bucket: useReportingClock(),
    });
  return (
    <Panel
      title="Sales performance detail"
      note="Stage age uses actual recorded entry time. Cohort conversion counts current won outcomes against opportunities created in the selected period."
    >
      {!data || !stages ? (
        <LoadingState />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">
                Opportunity creation cohort
              </p>
              <p className="mt-2 text-2xl">
                {data.flows.cohort_opportunities ?? "0"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Won from this creation cohort
              </p>
              <p className="mt-2 text-2xl">{data.flows.cohort_won ?? "0"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">
                Completed activities in period
              </p>
              <p className="mt-2 text-2xl">
                {data.flows.activities_completed ?? "0"}
              </p>
            </div>
          </div>
          <div className="mb-6 grid gap-3 sm:grid-cols-3">
            {[
              "contacted",
              "interested",
              "consultation",
              "quote_sent",
              "negotiation",
            ].map((stage) => (
              <div key={stage} className="rounded-lg bg-muted p-3 text-sm">
                <p className="capitalize">
                  Reached {stage.replaceAll("_", " ")}
                </p>
                <strong>
                  {data.flows["cohort_reached_" + stage] ?? "0"} ·{" "}
                  {percent(
                    ratio(
                      data.flows["cohort_reached_" + stage] ?? "0",
                      data.flows.cohort_opportunities ?? "0",
                    ),
                  )}
                </strong>
              </div>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b text-xs text-muted-foreground">
                  <th className="pb-3">Current stage</th>
                  <th>Average days in stage</th>
                  <th>Overdue next actions</th>
                </tr>
              </thead>
              <tbody>
                {stages.map((s) => (
                  <tr key={s.stage} className="border-b last:border-0">
                    <th className="py-4 font-medium capitalize">
                      {s.stage.replaceAll("_", " ")}
                    </th>
                    <td>{s.average_days ?? "Insufficient data"}</td>
                    <td>
                      {s.partial ? "At least " : ""}
                      {s.overdue}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-6 grid gap-2 sm:grid-cols-3">
            {Object.entries(data.flows)
              .filter(([k]) => k.startsWith("lost_reason_"))
              .map(([k, v]) => (
                <div key={k} className="rounded-lg bg-muted p-3 text-sm">
                  <span className="capitalize">
                    {k.replace("lost_reason_", "").replaceAll("_", " ")}
                  </span>
                  : <strong>{v}</strong>
                </div>
              ))}
          </div>
        </>
      )}
    </Panel>
  );
}
