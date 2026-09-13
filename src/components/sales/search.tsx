"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
export function SalesSearchResults({
  query,
  enabled,
  onSelect,
}: {
  query: string;
  enabled: boolean;
  onSelect: () => void;
}) {
  const [term, setTerm] = useState(query);
  useEffect(() => {
    const timer = setTimeout(() => setTerm(query), 250);
    return () => clearTimeout(timer);
  }, [query]);
  const results = useQuery(
    api.sales.globalSearch,
    enabled && term.trim().length >= 2 ? { q: term } : "skip",
  );
  if (!enabled || query.trim().length < 2) return null;
  return (
    <section className="mt-4 border-t pt-3" aria-label="Sales search results">
      <h3 className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Properties & opportunities
      </h3>
      {results === undefined ? (
        <p role="status" className="p-3 text-sm">
          Searching…
        </p>
      ) : results.length ? (
        results.map((r) => (
          <Link
            key={r.id}
            href={r.href}
            onClick={onSelect}
            className="block rounded-lg p-3 hover:bg-muted"
          >
            <span className="block text-xs text-muted-foreground">
              {r.type}
            </span>
            <span className="text-sm font-medium">{r.title}</span>
          </Link>
        ))
      ) : (
        <p className="p-3 text-sm text-muted-foreground">
          No matching properties or opportunities.
        </p>
      )}
    </section>
  );
}
