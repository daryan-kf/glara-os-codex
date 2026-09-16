"use client";
import { usePaginatedQuery } from "convex/react";
import Link from "next/link";
import type { Doc } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { StatusBadge } from "@/components/primitives";
import { Button } from "@/components/ui/button";
export function CommunicationHistory({
  source,
}: {
  source: Doc<"communications">["source"];
}) {
  const history = usePaginatedQuery(
    api.communications.list,
    { source },
    { initialNumItems: 10 },
  );
  return (
    <section className="mt-8 space-y-4 rounded-2xl border bg-card p-6">
      <h2 className="text-lg font-semibold">Communication history</h2>
      {history.results.length ? (
        history.results.map((r) => (
          <div
            key={r._id}
            className="flex flex-wrap items-center justify-between gap-3 border-t pt-3"
          >
            <Link
              className="text-sm underline"
              href={`/communications?message=${r._id}`}
            >
              {r.subject}
            </Link>
            <StatusBadge>{r.status.replaceAll("_", " ")}</StatusBadge>
          </div>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          No authorized messages to display.
        </p>
      )}
      {history.status === "CanLoadMore" && (
        <Button variant="outline" onClick={() => history.loadMore(10)}>
          Load more messages
        </Button>
      )}
    </section>
  );
}
