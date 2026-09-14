"use client";
import { useState } from "react";
import Link from "next/link";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LoadingState, StatusBadge } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { inputClass, Field, SalesForm } from "@/components/sales/shared";
import { dollars, decimal, cents } from "@/lib/commercial/model";
import { day } from "@/lib/operations/model";
import { defaultTargets } from "@/lib/analytics/model";
import { labelFor } from "@/lib/analytics/catalog";
import { classifyCrmError } from "@/lib/crm/errors";
import { Panel, amount, percent } from "./shared";
export function TargetSettings() {
  const config = useQuery(api.analytics.settings, {}),
    save = useMutation(api.analytics.saveSettings);
  return (
    <Panel
      title="Business targets"
      note="Owner-managed targets and transparent review thresholds."
    >
      {!config ? (
        <LoadingState />
      ) : (
        <SalesForm
          key={config.version}
          submit="Save targets"
          expectedVersion={config.version}
          onSave={async (d, _form, version) => {
            await save({
              version: version!,
              input: JSON.stringify(
                Object.fromEntries(
                  Object.keys(defaultTargets).map((k) => [
                    k,
                    k.endsWith("_cents") ? String(cents(d[k])) : Number(d[k]),
                  ]),
                ),
              ),
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            {Object.keys(defaultTargets).map((k) => (
              <Field
                key={k}
                name={k}
                label={
                  k.replace("_cents", "").replaceAll("_", " ") +
                  (k.endsWith("_cents") ? " (CAD)" : "")
                }
                type="number"
                step={k.endsWith("_cents") ? "0.01" : "1"}
                required
                value={
                  k.endsWith("_cents")
                    ? decimal(String(config[k as keyof typeof defaultTargets]))
                    : config[k as keyof typeof defaultTargets]
                }
              />
            ))}
          </div>
        </SalesForm>
      )}
    </Panel>
  );
}
export function Reconciliation() {
  const activate = useMutation(api.analyticsReconciliation.activate),
    start = useMutation(api.analyticsReconciliation.start),
    advance = useAction(api.analyticsMaintenance.reconcileBatch),
    repair = useMutation(api.analyticsReconciliation.repairBucket);
  const [id, setId] = useState<Id<"analytics_reconciliations"> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [cursor, setCursor] = useState<string | null>(null),
    [reason, setReason] = useState("");
  const result = useQuery(
    api.analyticsReconciliation.result,
    id ? { id, pagination: { cursor, numItems: 25 } } : "skip",
  );
  const run = async () => {
    setBusy(true);
    setError("");
    setCursor(null);
    try {
      const key = await start({});
      setId(key);
      let status = "running";
      while (status === "running") {
        status = (await advance({ id: key, pages: 50 })).status;
      }
    } catch (e) {
      setError(classifyCrmError(e).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel
      title="Reconciliation"
      note="Independently compare source records, event contributions, and period totals. Running a check does not repair business or reporting data."
    >
      <Button disabled={busy} onClick={run}>
        {busy ? "Checking source records…" : "Run independent reconciliation"}
      </Button>
      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}
      {result && (
        <div className="mt-5 space-y-4">
          <StatusBadge>{result.run.status}</StatusBadge>
          <p className="text-sm">
            {result.run.scanned} sources checked · {result.run.source_drift}{" "}
            contribution differences · {result.run.bucket_drift} aggregate
            differences
          </p>
          {result.run.status === "stale" && (
            <p className="text-sm text-amber-800">
              Business data changed during the check. Run it again for a
              consistent comparison.
            </p>
          )}
          {result.run.status === "complete" &&
            result.run.source_drift === 0 &&
            result.run.bucket_drift === 0 && (
              <div>
                <p className="text-sm text-emerald-800">
                  Zero drift: source rebuild matches incremental projections.
                </p>
                <Button
                  className="mt-3"
                  variant="outline"
                  onClick={async () => {
                    try {
                      await activate({ id: result.run._id });
                    } catch (e) {
                      setError(classifyCrmError(e).message);
                    }
                  }}
                >
                  Activate verified reporting
                </Button>
              </div>
            )}
          {result.run.bucket_drift > 0 && (
            <label className="grid gap-2 text-sm">
              Reason for targeted repair
              <input
                className={inputClass}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={10}
              />
            </label>
          )}
          {result.page.map((r) => (
            <div key={r._id} className="rounded-lg border p-3 text-sm">
              <strong>
                {labelFor(r.metric)} · {r.period}
              </strong>
              <p className="my-2">
                {r.dimension}: {r.member} · stored {r.actual} / expected{" "}
                {r.value}
              </p>
              <Button
                variant="outline"
                disabled={
                  busy ||
                  reason.trim().length < 10 ||
                  result.run.status !== "complete" ||
                  result.run.source_drift > 0
                }
                onClick={async () => {
                  try {
                    await repair({ id: r._id, reason });
                    setError(
                      "Repair recorded. Run reconciliation again before another repair.",
                    );
                  } catch (e) {
                    setError(classifyCrmError(e).message);
                  }
                }}
              >
                Repair this aggregate
              </Button>
            </div>
          ))}
          {!result.isDone && (
            <Button
              variant="outline"
              onClick={() => setCursor(result.continueCursor)}
            >
              Next comparison page
            </Button>
          )}
        </div>
      )}
    </Panel>
  );
}
export function HistoricalAR() {
  const [asOf, setAsOf] = useState(day()),
    [cursor, setCursor] = useState<string | null>(null),
    data = useQuery(api.analyticsHistory.historicalAR, {
      as_of: asOf,
      pagination: { cursor, numItems: 15 },
    });
  return (
    <Panel
      title="Historical receivables"
      note="Reconstruct issued balances at Vancouver end of day, retaining later credits and reversals in their actual periods."
    >
      <label className="grid gap-2 text-sm">
        Balance as of
        <input
          className={inputClass}
          type="date"
          value={asOf}
          max={day()}
          onChange={(e) => {
            if (
              /^\d{4}-\d{2}-\d{2}$/.test(e.target.value) &&
              e.target.value <= day()
            ) {
              setAsOf(e.target.value);
              setCursor(null);
            }
          }}
        />
      </label>
      {!data ? (
        <LoadingState />
      ) : (
        <>
          <div className="my-5 space-y-4">
            {data.page.map((i) => (
              <Link
                key={i.id}
                href={`/invoices/${i.id}`}
                className="flex justify-between gap-3 text-sm"
              >
                <span>{i.number}</span>
                <strong>{dollars(i.balance_cents)}</strong>
              </Link>
            ))}
          </div>
          <p className="text-sm">
            This page subtotal: {dollars(data.page_subtotal_cents)}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Page subtotal is not total company receivables. Continue through all
            pages for a complete ledger.
          </p>
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
        </>
      )}
    </Panel>
  );
}
export function Underused() {
  const [cursor, setCursor] = useState<string | null>(null),
    data = useQuery(api.analyticsHistory.underused, {
      pagination: { cursor, numItems: 15 },
    });
  return (
    <Panel
      title="Inventory to put back to work"
      note="Eligible serialized assets with no recent installation. Assets with incomplete evidence are identified separately."
    >
      {!data ? (
        <LoadingState />
      ) : (
        <>
          <p className="mb-5 text-sm">
            Review threshold: {data.threshold_days} days
          </p>
          <div className="space-y-4">
            {data.page.map((a) => (
              <Link
                key={a.id}
                href={`/inventory/assets/${a.id}`}
                className="flex justify-between gap-3 text-sm"
              >
                <span>
                  {a.asset_number} · {a.product_name}
                </span>
                <strong>
                  {a.days_unused === null
                    ? "Insufficient history"
                    : `${a.days_unused} days`}
                </strong>
              </Link>
            ))}
          </div>
          {!data.page.length && (
            <p className="text-sm text-muted-foreground">
              No matching assets on this page.
            </p>
          )}
          <div className="mt-5 flex gap-3">
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
        </>
      )}
    </Panel>
  );
}
export function DimensionReport({ period }: { period: string }) {
  const [dimension, setDimension] = useState("realtor"),
    [metric, setMetric] = useState("invoiced_cents"),
    [member, setMember] = useState<{ id: string; label: string } | null>(null);
  const groups = useQuery(api.analytics.breakdown, {
      period,
      dimension,
      metric,
    }),
    detail = useQuery(
      api.analytics.summary,
      member
        ? { period, filter: JSON.stringify({ dimension, member: member.id }) }
        : "skip",
    );
  return (
    <Panel
      title="Explore performance"
      note="Choose a comparison dimension, then a recorded group. Historical attribution remains attached to the original event; unknown history is shown explicitly."
    >
      <div className="mb-5 grid gap-4 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">
          Compare by
          <select
            className={inputClass}
            value={dimension}
            onChange={(e) => {
              setDimension(e.target.value);
              setMember(null);
            }}
          >
            {[
              "realtor",
              "salesperson",
              "lead_source",
              "city",
              "product",
              "method",
            ].map((x) => (
              <option key={x} value={x}>
                {x.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm">
          Rank by
          <select
            className={inputClass}
            value={metric}
            onChange={(e) => {
              setMetric(e.target.value);
              setMember(null);
            }}
          >
            {[
              "invoiced_cents",
              "cash_received_cents",
              "projects_staged",
              "projects_created",
              "opportunities_won",
              "opportunities_created",
              "installed_units",
            ].map((x) => (
              <option key={x} value={x}>
                {labelFor(x)}
              </option>
            ))}
          </select>
        </label>
      </div>
      {!groups ? (
        <LoadingState />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          {groups.rows.map((g) => (
            <button
              key={g.id}
              className="flex min-h-12 justify-between gap-3 rounded-lg border p-3 text-left text-sm hover:bg-muted"
              onClick={() => setMember({ id: g.id, label: g.label })}
            >
              <span>{g.label}</span>
              <strong>{amount(metric, g.value)}</strong>
            </button>
          ))}
        </div>
      )}
      {member && detail && (
        <div className="mt-7 border-t pt-6">
          <h3 className="font-semibold">{member.label}</h3>
          {dimension === "realtor" && member.id !== "unknown" && (
            <RealtorSegment id={member.id} />
          )}
          <dl className="mt-4 grid gap-4 sm:grid-cols-3">
            {[
              "opportunities_created",
              "opportunities_won",
              "projects_created",
              "invoiced_cents",
              "cash_received_cents",
              "outstanding_ar_cents",
            ].map((k) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{labelFor(k)}</dt>
                <dd className="mt-2 text-xl">
                  {amount(k, detail.current[k] ?? detail.flows[k] ?? "0")}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-sm">
            Closed win rate: {percent(detail.derived.win_rate_basis_points)}
          </p>
        </div>
      )}
    </Panel>
  );
}
export function RealtorSegment({ id }: { id: string }) {
  const r = useQuery(api.analytics.realtorProfile, {
    id: id as Id<"realtors">,
  });
  return r ? (
    <div className="my-5 rounded-xl bg-muted p-4">
      <div className="flex flex-wrap gap-2">
        <StatusBadge>{r.segment}</StatusBadge>
        <StatusBadge>{r.relationship_status.replaceAll("_", " ")}</StatusBadge>
        {r.archived && <StatusBadge>Archived</StatusBadge>}
      </div>
      <p className="mt-3 text-sm">{r.definition}</p>
      <p className="mt-2 text-xs text-muted-foreground">
        Last completed activity:{" "}
        {r.last_completed_activity ?? "No recorded activity"} · Lifetime
        projects: {r.projects}
      </p>
    </div>
  ) : null;
}
