"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
export function RealtorSearchResults({
  query,
  enabled,
  onSelect,
}: {
  query: string;
  enabled: boolean;
  onSelect: () => void;
}) {
  const [results, setResults] = useState<
    { id: string; name: string; brokerage: string | null }[]
  >([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      if (!enabled || query.trim().length < 2) {
        setResults([]);
        setError(false);
        return;
      }
      setLoading(true);
      try {
        const response = await fetch(
          "/api/crm/search?q=" + encodeURIComponent(query),
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error();
        setResults(await response.json());
        setError(false);
      } catch {
        if (!controller.signal.aborted) {
          setResults([]);
          setError(true);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, enabled]);
  if (!enabled || query.trim().length < 2) return null;
  return (
    <section className="mt-4 border-t pt-3" aria-label="Realtor search results">
      <h3 className="px-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Realtors
      </h3>
      <div aria-live="polite">
        {loading && <p className="p-3 text-sm">Searching…</p>}
        {error && (
          <p className="p-3 text-sm">
            Realtor search is unavailable. Try again.
          </p>
        )}
        {!loading && !error && !results.length && (
          <p className="p-3 text-sm text-muted-foreground">
            No matching realtors.
          </p>
        )}
      </div>
      {!loading &&
        results.map((r) => (
          <Link
            key={r.id}
            href={"/realtors/" + r.id}
            onClick={onSelect}
            className="block rounded-lg p-3 hover:bg-muted"
          >
            <span className="block text-sm font-medium">{r.name}</span>
            <span className="text-xs text-muted-foreground">
              {r.brokerage ?? "Brokerage not recorded"}
            </span>
          </Link>
        ))}
    </section>
  );
}
