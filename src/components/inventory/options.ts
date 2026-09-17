"use client";
import { useEffect } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
export function useInventoryLocations(projectId?: string) {
  const page = usePaginatedQuery(
    api.inventory.locationOptionsPage,
    projectId ? { project_id: projectId as Id<"projects"> } : {},
    { initialNumItems: 100 },
  );
  const { status, loadMore } = page;
  useEffect(() => {
    if (status === "CanLoadMore") loadMore(100);
  }, [status, loadMore]);
  return page.status === "Exhausted" ? page.results : undefined;
}
export function useInventoryOptions() {
  const base = useQuery(api.inventory.options, {}),
    locations = useInventoryLocations();
  const page = usePaginatedQuery(
    api.inventory.categoryOptionsPage,
    {},
    { initialNumItems: 100 },
  );
  const { status, loadMore } = page;
  useEffect(() => {
    if (status === "CanLoadMore") loadMore(100);
  }, [status, loadMore]);
  return base && locations && page.status === "Exhausted"
    ? { ...base, locations, categories: page.results, partial: false }
    : undefined;
}
