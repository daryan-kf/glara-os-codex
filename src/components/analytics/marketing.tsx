"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { PageTitle, LoadingState } from "@/components/primitives";
import { inputClass } from "@/components/operations/shared";
import { Panel, amount } from "./shared";
import { Breakdown, Trends } from "./overview";
import { labelFor } from "@/lib/analytics/catalog";
const tiles = [
  "realtors_created",
  "opportunities_created",
  "projects_staged",
  "projects_listing_live",
  "projects_sold",
] as const;
const periods = [
  ["this_month", "This month"],
  ["previous_month", "Last month"],
  ["quarter", "This quarter"],
  ["year", "This year"],
] as const;
const shortcuts = [
  [
    "/realtors",
    "Realtor relationships",
    "The partners and prospects behind referrals and repeat work.",
  ],
  [
    "/projects",
    "Story-ready projects",
    "Staged projects ready for photography, listings and social stories.",
  ],
  [
    "/communications",
    "Communications",
    "Reviewed outreach with recipient preferences and accountable delivery.",
  ],
  [
    "/reports",
    "Full reporting",
    "The complete performance view shared with the whole team.",
  ],
] as const;
export function MarketingCenter() {
  const [selection, setSelection] = useState("this_month");
  const period = JSON.stringify({ period: selection });
  const data = useQuery(api.analytics.summary, { period });
  return (
    <div className="space-y-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle
          title="Marketing"
          description="Relationship growth, staging stories, and where new business comes from."
        />
        <label className="grid gap-2 text-sm">
          Reporting period
          <select
            className={inputClass}
            value={selection}
            onChange={(e) => setSelection(e.target.value)}
          >
            {periods.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!data ? (
        <LoadingState />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
            {tiles.map((metric) => (
              <div key={metric} className="rounded-2xl border bg-card p-5">
                <p className="text-xs text-muted-foreground">
                  {labelFor(metric)}
                </p>
                <p className="mt-2 font-display text-3xl">
                  {amount(metric, data.flows[metric] ?? "0")}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Previous period:{" "}
                  {amount(metric, data.previous[metric] ?? "0")}
                </p>
              </div>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Breakdown
              period={period}
              metric="realtors_created"
              dimension="lead_source"
              title="New realtor relationships by lead source"
            />
            <Breakdown
              period={period}
              metric="opportunities_created"
              dimension="lead_source"
              title="New opportunities by lead source"
            />
          </div>
          <Trends manager={false} />
        </>
      )}
      <Panel
        title="Marketing workspace"
        note="The catalog, projects and outreach behind every campaign."
      >
        <div className="grid gap-3 sm:grid-cols-2">
          {shortcuts.map(([href, title, description]) => (
            <Link key={href} href={href} className="rounded-xl border p-4">
              <strong>{title}</strong>
              <p className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}
