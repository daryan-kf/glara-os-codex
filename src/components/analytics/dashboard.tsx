"use client";
import { periodInput, resolvePeriod } from "@/lib/analytics/periods";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { ArrowRight, Target } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import type { Role } from "@/lib/permissions";
import { PageTitle, LoadingState, EmptyState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { inputClass, Field } from "@/components/sales/shared";
import { CommercialSummary } from "@/components/commercial/receivables";
import { InventoryAttention } from "@/components/inventory/catalog";
import { SalesSummary } from "@/components/sales/opportunities";
import { OperationsToday, Projects } from "@/components/operations/list";
import { dollars } from "@/lib/commercial/model";
import { day } from "@/lib/operations/model";
import { labelFor } from "@/lib/analytics/catalog";
import { Panel, Metric, amount, percent, useReportingClock } from "./shared";
import {
  Drill,
  Trends,
  Aging,
  Capacity,
  Breakdown,
  Actions,
  SalesDetail,
} from "./overview";
import {
  TargetSettings,
  Reconciliation,
  HistoricalAR,
  Underused,
  DimensionReport,
} from "./reports";
const month = JSON.stringify({ period: "this_month" });
export function AnalyticsDashboard({
  roles,
  report = false,
  enabled = false,
}: {
  roles: Role[];
  report?: boolean;
  enabled?: boolean;
}) {
  const manager = roles.some((r) => r === "owner" || r === "admin"),
    analyst = manager || roles.includes("sales") || roles.includes("marketing");
  if (analyst && !enabled)
    return (
      <>
        <PageTitle
          title="Your workspace"
          description="Reporting is awaiting the M6 development release."
        />
        {manager && (
          <>
            <InventoryAttention />
            <CommercialSummary />
          </>
        )}
        {(manager || roles.includes("sales")) && <SalesSummary />}
        <OperationsToday />
      </>
    );
  if (!analyst)
    return (
      <>
        <PageTitle
          title="Today, thoughtfully planned."
          description="Your assigned projects, crew schedule, and next handoffs."
        />
        <OperationsToday />
        <Projects compact />
      </>
    );
  return <Executive roles={roles} report={report} />;
}
export function Executive({
  roles,
  report,
}: {
  roles: Role[];
  report: boolean;
}) {
  const [selection, setSelection] = useState("this_month"),
    [period, setPeriod] = useState(month),
    [rangeError, setRangeError] = useState(""),
    [metric, setMetric] = useState<string | null>(null);
  const manager = roles.some((r) => r === "owner" || r === "admin"),
    marketing = !manager && !roles.includes("sales");
  const refresh_bucket = useReportingClock();
  const data = useQuery(api.analytics.summary, { period, refresh_bucket }),
    monthly = useQuery(
      api.analytics.summary,
      manager ? { period: month, refresh_bucket } : "skip",
    );
  const title = report
    ? "Performance & reporting"
    : manager
      ? "Executive command center"
      : marketing
        ? "Marketing overview"
        : "Your sales overview";
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle
          title={title}
          description={
            manager
              ? "A clear view of growth, delivery, and the work that needs you."
              : marketing
                ? "Relationship growth and completed staging activity."
                : "Your assigned pipeline, closed outcomes, and follow-ups."
          }
        />
        {roles.includes("owner") && (
          <Button asChild variant="outline">
            <Link href={report ? "/dashboard" : "/reports"}>
              {report ? "Dashboard" : "Reports & targets"}
            </Link>
          </Button>
        )}
      </div>
      <form
        className="flex flex-wrap items-end gap-3 rounded-xl border bg-card p-4"
        onSubmit={(e) => {
          e.preventDefault();
          const d = new FormData(e.currentTarget);
          try {
            const selectionValue = periodInput.parse(
              selection === "custom"
                ? {
                    period: selection,
                    from: d.get("from"),
                    until: d.get("until"),
                  }
                : { period: selection },
            );
            resolvePeriod(selectionValue, new Date().toISOString());
            setRangeError("");
            setPeriod(JSON.stringify(selectionValue));
          } catch {
            setRangeError(
              "Choose valid dates, no more than 366 days, ending no later than today.",
            );
          }
        }}
      >
        <label className="grid min-w-44 gap-2 text-xs font-medium">
          Reporting period
          <select
            className={inputClass}
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
          >
            {[
              ["today", "Today"],
              ["this_week", "This week"],
              ["this_month", "This month"],
              ["previous_month", "Previous month"],
              ["quarter", "Quarter to date"],
              ["year", "Year to date"],
              ["custom", "Custom dates"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {selection === "custom" && (
          <>
            <Field
              label="From"
              name="from"
              type="date"
              required
              value={day()}
            />
            <Field
              label="Through"
              name="until"
              type="date"
              required
              value={day()}
            />
          </>
        )}
        <Button type="submit" variant="outline">
          Apply period
        </Button>
        <p className="ml-auto text-xs leading-6 text-muted-foreground">
          America/Vancouver
          <br />
          Financial amounts in CAD
        </p>
      </form>
      {rangeError && (
        <p role="alert" className="text-sm text-destructive">
          {rangeError}
        </p>
      )}
      {!data ? (
        <LoadingState />
      ) : !data.ready ? (
        <EmptyState
          title="Reporting is being prepared"
          description="Historical source records must finish indexing and reconciliation before these totals can be used. Your operational modules remain available."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
            <span>
              {data.range.from} → {data.range.until} · Compared with{" "}
              {data.previous_range.from} → {data.previous_range.until}
            </span>
            <span>
              Sources through{" "}
              {data.source_through
                ? new Date(data.source_through).toLocaleString("en-CA", {
                    timeZone: "America/Vancouver",
                  })
                : "Not available"}
            </span>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {(manager
              ? [
                  "projects_staged",
                  "opportunities_won",
                  "invoiced_cents",
                  "cash_received_cents",
                  "outstanding_ar_cents",
                ]
              : marketing
                ? [
                    "realtors_created",
                    "opportunities_created",
                    "projects_staged",
                    "projects_listing_live",
                    "projects_sold",
                  ]
                : [
                    "open_opportunities",
                    "pipeline_cents",
                    "weighted_pipeline_cents",
                    "opportunities_won",
                    "opportunities_lost",
                  ]
            ).map((key) => (
              <Metric
                key={key}
                metric={key}
                value={data.current[key] ?? data.flows[key] ?? "0"}
                comparison={data.comparisons[key]}
                onClick={() => setMetric(key)}
                href={
                  marketing
                    ? key.startsWith("projects_")
                      ? "/projects"
                      : "/realtors"
                    : undefined
                }
              />
            ))}
          </div>
          <div className="grid gap-5 xl:grid-cols-3">
            {manager && monthly?.ready && (
              <Panel
                title="Monthly staging target"
                note="Each project counts once, on its first valid completed staging."
              >
                <div className="flex items-baseline gap-3">
                  <strong className="text-4xl font-medium">
                    {monthly.flows.projects_staged ?? "0"}
                  </strong>
                  <span className="text-muted-foreground">
                    / {data.targets?.target} projects
                  </span>
                  <Target className="ml-auto size-6 text-primary" />
                </div>
                <progress
                  className="mt-6 h-3 w-full accent-primary"
                  value={Number(monthly.flows.projects_staged ?? 0)}
                  max={data.targets?.target ?? 35}
                  aria-label="Monthly staging target progress"
                />
                <div className="mt-3 flex justify-between text-xs text-muted-foreground">
                  <span>Minimum {data.targets?.minimum}</span>
                  <span>Stretch {data.targets?.stretch}</span>
                </div>
                <p className="mt-5 text-sm">
                  {Math.max(
                    0,
                    (data.targets?.target ?? 35) -
                      Number(monthly.flows.projects_staged ?? 0),
                  )}{" "}
                  more projects to reach target.
                </p>
              </Panel>
            )}
            {!marketing && (
              <Panel
                title="Pipeline & conversion"
                note="Current open pipeline. Win rate uses won ÷ (won + lost) in the selected period."
              >
                <dl className="space-y-4">
                  {[
                    ...[
                      "pipeline_cents",
                      "weighted_pipeline_cents",
                      "open_opportunities",
                    ].map((k) => [
                      labelFor(k),
                      amount(k, data.current[k] ?? "0"),
                    ]),
                    [
                      "Closed opportunity win rate",
                      percent(data.derived.win_rate_basis_points),
                    ],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between gap-3 text-sm">
                      <dt className="text-muted-foreground">{k}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
                <Link
                  className="mt-6 inline-flex min-h-11 items-center text-sm text-primary"
                  href="/opportunities"
                >
                  Open sales pipeline <ArrowRight className="ml-2 size-4" />
                </Link>
              </Panel>
            )}
            <Panel
              title="Recorded activity"
              note="Event volumes in this period. These counts are not a same-cohort conversion funnel."
            >
              <div className="space-y-2">
                {(marketing
                  ? [
                      "realtors_created",
                      "opportunities_created",
                      "projects_staged",
                    ]
                  : [
                      "opportunities_created",
                      "consultations_completed",
                      "quotes_sent",
                      "opportunities_won",
                      "projects_created",
                    ]
                ).map((k) => (
                  <button
                    key={k}
                    disabled={marketing}
                    onClick={() => setMetric(k)}
                    className="flex min-h-11 w-full items-center justify-between rounded-lg bg-muted/60 px-3 text-left text-sm"
                  >
                    <span>{labelFor(k)}</span>
                    <strong>{data.flows[k] ?? "0"}</strong>
                  </button>
                ))}
              </div>
            </Panel>
          </div>
          {!marketing && (
            <Panel
              title="Pipeline by stage"
              note="Current counts and estimated value. Select a stage to inspect its opportunities."
            >
              <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
                {[
                  "new",
                  "contacted",
                  "interested",
                  "consultation",
                  "quote_sent",
                  "negotiation",
                ].map((s) => (
                  <button
                    key={s}
                    onClick={() => setMetric("stage_" + s)}
                    className="rounded-xl border p-4 text-left hover:bg-muted"
                  >
                    <span className="block text-xs capitalize text-muted-foreground">
                      {s.replaceAll("_", " ")}
                    </span>
                    <strong className="my-3 block text-2xl">
                      {data.current["stage_" + s] ?? "0"}
                    </strong>
                    <span className="text-sm">
                      {dollars(data.current["stage_" + s + "_cents"] ?? "0")}
                    </span>
                  </button>
                ))}
              </div>
            </Panel>
          )}
          {manager && (
            <>
              <Capacity />
              <div className="grid gap-5 xl:grid-cols-2">
                <Trends manager />
                <Aging />
              </div>
              <Panel
                title="Inventory readiness"
                note="Current utilization = eligible staged assets ÷ eligible active assets. Quantity stock is reported separately."
              >
                <div className="mb-6 text-3xl">
                  {percent(data.derived.inventory_utilization_basis_points)}{" "}
                  <span className="text-sm text-muted-foreground">in use</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
                  {[
                    "assets_available",
                    "assets_staged",
                    "assets_inspection",
                    "assets_repair",
                    "assets_damaged",
                    "assets_missing",
                  ].map((k) => (
                    <Metric
                      key={k}
                      metric={k}
                      value={data.current[k] ?? "0"}
                      onClick={() => setMetric(k)}
                    />
                  ))}
                </div>
                <div className="mt-5 grid gap-3 sm:grid-cols-3">
                  {[
                    "quantity_available",
                    "quantity_project_staged",
                    "quantity_inspection",
                  ].map((k) => (
                    <Metric
                      key={k}
                      metric={k}
                      value={data.current[k] ?? "0"}
                      onClick={() => setMetric(k)}
                    />
                  ))}
                </div>
              </Panel>
              <div className="grid gap-5 xl:grid-cols-3">
                <Breakdown
                  period={period}
                  dimension="realtor"
                  metric="invoiced_cents"
                  title="Top realtor partners"
                />
                <Breakdown
                  period={period}
                  dimension="salesperson"
                  metric="opportunities_won"
                  title="Sales team outcomes"
                />
                <Breakdown
                  period={period}
                  dimension="lead_source"
                  metric="opportunities_created"
                  title="Lead sources"
                />
              </div>
            </>
          )}
          {marketing && (
            <div className="grid gap-5 xl:grid-cols-2">
              <Trends manager={false} />
              <Breakdown
                period={period}
                dimension="lead_source"
                metric="opportunities_created"
                title="Lead source activity"
              />
            </div>
          )}
          {!marketing && (
            <>
              <SalesDetail period={period} />
              <Actions />
            </>
          )}
          {manager && (
            <Panel
              title="Commercial detail"
              note="Period flows and current balances answer different questions. Credits and reversals remain in their own event periods."
            >
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  "cash_reversed_cents",
                  "credits_cents",
                  "voided_cents",
                  "current_valid_collected_cents",
                  "unallocated_cents",
                  "customer_credit_cents",
                  "invoiced_extension_cents",
                  "invoiced_assessment_cents",
                  "invoice_discounts_cents",
                  "approved_damage_cents",
                  "extensions_accepted",
                  "damage_waived",
                ].map((k) => (
                  <Metric
                    key={k}
                    metric={k}
                    value={data.current[k] ?? data.flows[k] ?? "0"}
                    onClick={() => setMetric(k)}
                  />
                ))}
              </div>
              <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-3">
                <div>
                  <dt>Net cash in period</dt>
                  <dd className="mt-1 font-semibold">
                    {dollars(data.derived.net_cash_cents ?? "0")}
                  </dd>
                </div>
                <div>
                  <dt>Net invoiced flow in period</dt>
                  <dd className="mt-1 font-semibold">
                    {dollars(data.derived.net_invoiced_cents ?? "0")}
                  </dd>
                </div>
                <div>
                  <dt>
                    Average collectible value per invoiced project · current
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {data.derived.average_project_value_cents === null
                      ? "Not enough data"
                      : dollars(data.derived.average_project_value_cents)}
                  </dd>
                </div>
              </dl>
              <p className="mt-6 text-xs leading-6 text-muted-foreground">
                Historical AR: {data.historical_ar.reason} Refunds:{" "}
                {data.refunds.reason}
              </p>
            </Panel>
          )}
        </>
      )}
      {report && manager && data?.ready && <DimensionReport period={period} />}
      {report && manager && (
        <div className="grid gap-5 xl:grid-cols-2">
          <HistoricalAR />
          <Underused />
        </div>
      )}
      {report && roles.includes("owner") && (
        <div className="grid items-start gap-5 xl:grid-cols-2">
          <TargetSettings />
          <Reconciliation />
        </div>
      )}
      <Dialog
        open={!!metric}
        onOpenChange={(open) => {
          if (!open) setMetric(null);
        }}
      >
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
          <DialogTitle className="pr-10 text-xl font-semibold">
            {metric ? labelFor(metric) : "Records"}
          </DialogTitle>
          <DialogDescription className="mt-2 text-sm text-muted-foreground">
            Authoritative records contributing to this metric. Archived history
            remains included.
          </DialogDescription>
          {metric && (
            <Drill key={metric + period} metric={metric} period={period} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
