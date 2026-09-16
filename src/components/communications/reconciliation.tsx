"use client";
import type { FunctionReturnType } from "convex/server";
import { useState } from "react";
import { useConvex } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { communicationError } from "@/lib/communications/errors";
export function ReconciliationReview() {
  const client = useConvex(),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState("");
  async function run() {
    setBusy(true);
    setResult("");
    try {
      const counts = {
        communications: 0,
        communication_findings: 0,
        outbox: 0,
        orphan_jobs: 0,
        outbox_findings: 0,
        provider_mappings: 0,
        provider_mapping_findings: 0,
        events: 0,
        event_mismatches: 0,
        projections: 0,
        calendar_findings: 0,
      };
      let cursor: string | null = null;
      do {
        const page: FunctionReturnType<
          typeof api.communications.reconcilePage
        > = await client.query(api.communications.reconcilePage, {
          paginationOpts: { numItems: 25, cursor },
        });
        counts.communications += page.page.length;
        counts.communication_findings += page.page.reduce(
          (n, r) => n + r.issues.length,
          0,
        );
        cursor = page.isDone ? null : page.continueCursor;
      } while (cursor);
      do {
        const page: FunctionReturnType<
          typeof api.communications.outboxReconcilePage
        > = await client.query(api.communications.outboxReconcilePage, {
          paginationOpts: { numItems: 50, cursor },
        });
        counts.outbox += page.page.length;
        counts.orphan_jobs += page.page.filter((r) => r.orphan).length;
        counts.outbox_findings += page.page.reduce(
          (n, r) => n + r.issues.length,
          0,
        );
        cursor = page.isDone ? null : page.continueCursor;
      } while (cursor);
      do {
        const page: FunctionReturnType<
          typeof api.communications.providerReconcilePage
        > = await client.query(api.communications.providerReconcilePage, {
          paginationOpts: { numItems: 25, cursor },
        });
        counts.provider_mappings += page.page.length;
        counts.provider_mapping_findings += page.page.reduce(
          (n, r) => n + r.issues.length,
          0,
        );
        cursor = page.isDone ? null : page.continueCursor;
      } while (cursor);
      do {
        const page: FunctionReturnType<
          typeof api.communications.eventReconcilePage
        > = await client.query(api.communications.eventReconcilePage, {
          paginationOpts: { numItems: 50, cursor },
        });
        counts.events += page.page.length;
        counts.event_mismatches += page.page.filter((r) => r.mismatch).length;
        cursor = page.isDone ? null : page.continueCursor;
      } while (cursor);
      do {
        const page: FunctionReturnType<typeof api.calendarSync.reconcilePage> =
          await client.query(api.calendarSync.reconcilePage, {
            paginationOpts: { numItems: 25, cursor },
          });
        counts.projections += page.page.length;
        counts.calendar_findings += page.page.reduce(
          (n, r) => n + r.issues.length,
          0,
        );
        cursor = page.isDone ? null : page.continueCursor;
      } while (cursor);
      setResult(
        Object.entries(counts)
          .map(([key, value]) => `${key.replaceAll("_", " ")}: ${value}`)
          .join("\n"),
      );
    } catch (e) {
      setResult(communicationError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="space-y-3 rounded-xl border p-4">
      <h3 className="font-semibold">Reconciliation review</h3>
      <p className="text-sm text-muted-foreground">
        Pause delivery and stop edits before collecting counts. This checks
        stored evidence across every page; live provider verification is a
        separate gate. No records are rewritten.
      </p>
      <Button variant="outline" disabled={busy} onClick={() => void run()}>
        {busy ? "Checking…" : "Check stored evidence"}
      </Button>
      <p role="status" className="whitespace-pre-wrap text-sm">
        {result}
      </p>
    </section>
  );
}
