"use client";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
export function InventorySearchResults({
  query,
  enabled,
  onSelect,
}: {
  query: string;
  enabled: boolean;
  onSelect: () => void;
}) {
  const rows = useQuery(
    api.inventory.search,
    enabled && query.trim().length >= 2
      ? { q: query.trim().slice(0, 100) }
      : "skip",
  );
  return (
    <>
      {rows?.map((r) => (
        <Link
          key={r.id}
          href={r.href}
          onClick={onSelect}
          className="block rounded-lg p-3 text-sm hover:bg-muted"
        >
          <span className="block text-xs text-muted-foreground">{r.kind}</span>
          {r.name}
        </Link>
      ))}
    </>
  );
}
