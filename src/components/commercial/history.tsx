"use client";
import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Panel, Loading, label } from "./shared";
import { Pager } from "@/components/sales/shared";
export function CommercialHistory({
  id,
}: {
  id:
    | Id<"agreements">
    | Id<"invoices">
    | Id<"payments">
    | Id<"damage_charge_assessments">
    | Id<"package_extensions">;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    data = useQuery(api.commercial.history, {
      id,
      paginationOpts: { cursor, numItems: 20 },
    });
  return (
    <details className="print:hidden rounded-xl border p-4">
      <summary className="cursor-pointer text-sm font-medium">
        Audit history
      </summary>
      <Panel title="Audit history">
        {!data ? (
          <Loading />
        ) : (
          <>
            <ol className="space-y-4">
              {data.page.map((log) => (
                <li key={log._id} className="border-b pb-3 text-sm">
                  <p className="capitalize">
                    {label(log.action.toLowerCase())}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {log.actor_name} · {log.created_at}
                  </p>
                  <details className="mt-2">
                    <summary className="cursor-pointer">
                      Recorded changes
                    </summary>
                    <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-muted p-3 text-xs">
                      {JSON.stringify(
                        { before: log.old_value, after: log.new_value },
                        null,
                        2,
                      )}
                    </pre>
                  </details>
                </li>
              ))}
            </ol>
            <Pager
              done={data.isDone}
              onReset={() => setCursor(null)}
              onNext={() => setCursor(data.continueCursor)}
            />
          </>
        )}
      </Panel>
    </details>
  );
}
