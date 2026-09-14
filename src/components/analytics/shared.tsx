"use client";
import { useState, useEffect } from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { dollars } from "@/lib/commercial/model";
import { labelFor } from "@/lib/analytics/catalog";
import type { change } from "@/lib/analytics/model";
export const percent = (bps: string | null) =>
  bps === null ? "Not enough data" : `${(Number(bps) / 100).toFixed(1)}%`;
export const amount = (metric: string, value: string) =>
  metric.endsWith("_cents")
    ? dollars(value)
    : BigInt(value).toLocaleString("en-CA");
export function Panel({
  title,
  note,
  children,
}: {
  title: string;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-5 sm:p-7">
      <h2 className="text-lg font-semibold">{title}</h2>
      {note && (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">{note}</p>
      )}
      <div className="mt-6">{children}</div>
    </section>
  );
}
export function Metric({
  metric,
  value,
  comparison,
  onClick,
  href,
}: {
  metric: string;
  value: string;
  comparison?: ReturnType<typeof change>;
  onClick: () => void;
  href?: string;
}) {
  const content = (
    <>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs leading-5 text-muted-foreground">
          {labelFor(metric)}
        </span>
        <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
      </div>
      <strong className="my-4 block break-words text-2xl font-medium tracking-tight">
        {amount(metric, value)}
      </strong>
      {comparison && (
        <span className="text-xs text-muted-foreground">
          {comparison.percent_basis_points === null
            ? "No comparable prior baseline"
            : `${percent(comparison.percent_basis_points)} vs preceding period`}
        </span>
      )}
    </>
  );
  return href ? (
    <Link
      href={href}
      className="block rounded-xl border bg-card p-5 hover:border-primary/50"
    >
      {content}
    </Link>
  ) : (
    <button
      onClick={onClick}
      className="rounded-xl border bg-card p-5 text-left transition hover:border-primary/50 focus-visible:outline-2 focus-visible:outline-ring"
    >
      {content}
    </button>
  );
}

export function useReportingClock() {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = setInterval(
      () => setTick(Math.floor(Date.now() / 60000)),
      60000,
    );
    return () => clearInterval(timer);
  }, []);
  return tick;
}
