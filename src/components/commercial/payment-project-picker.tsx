"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { dollars } from "./shared";

type ProjectOption = FunctionReturnType<
  typeof api.commercial.paymentProjects
>["page"][number];
function reason(project: ProjectOption) {
  const parts: string[] = [];
  if (BigInt(project.outstanding_cents) > 0n)
    parts.push(
      `${project.partially_paid ? "Partially paid" : "Unpaid invoices"} · ${dollars(project.outstanding_cents)} outstanding`,
    );
  if (project.renewal_days !== null)
    parts.push(
      project.renewal_days < 0
        ? `Package expired · ${project.package_end}`
        : project.renewal_days === 0
          ? "Renewal due today"
          : `Renewal in ${project.renewal_days} ${project.renewal_days === 1 ? "day" : "days"} · ${project.package_end}`,
    );
  return parts.join(" / ");
}

export function PaymentProjectPicker() {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<ProjectOption | null>(null);
  const [active, setActive] = useState(-1);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(selected ? "" : text.trim()), 180);
    return () => clearTimeout(timer);
  }, [text, selected]);
  const { results, status, loadMore } = usePaginatedQuery(
    api.commercial.paymentProjects,
    open ? { q: query } : "skip",
    { initialNumItems: 15 },
  );
  const waiting =
    query !== (selected ? "" : text.trim()) || status === "LoadingFirstPage";
  const options = waiting ? [] : results;
  useEffect(() => {
    if (open && !waiting && status === "CanLoadMore" && results.length < 8)
      loadMore(15);
  }, [open, waiting, status, results.length, loadMore]);
  useEffect(() => {
    if (active >= 0)
      document
        .getElementById(`${id}-option-${active}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [active, id]);
  function choose(project: ProjectOption) {
    setSelected(project);
    setText(project.name);
    setOpen(false);
    setActive(-1);
  }
  return (
    <div className="min-w-0 space-y-3 sm:col-span-2">
      <div
        className="relative"
        onBlur={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) {
            setOpen(false);
            setActive(-1);
          }
        }}
      >
        <label htmlFor={id} className="mb-2 block text-sm">
          Project
        </label>
        <input type="hidden" name="project_id" value={selected?.id ?? ""} />
        <div className="flex gap-2">
          <input
            id={id}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`${id}-options`}
            aria-describedby={`${id}-hint`}
            aria-activedescendant={
              open && active >= 0 && options[active]
                ? `${id}-option-${active}`
                : undefined
            }
            autoComplete="off"
            maxLength={100}
            className="min-h-11 w-full min-w-0 rounded-lg border bg-background px-3 text-sm focus-visible:outline-2"
            placeholder="Choose a project or search by number, address or realtor"
            value={text}
            onFocus={() => {
              setOpen(true);
              setActive(-1);
            }}
            onClick={() => setOpen(true)}
            onChange={(event) => {
              setText(event.target.value);
              setSelected(null);
              setActive(-1);
              setOpen(true);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setOpen(false);
                setActive(-1);
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                setActive((index) =>
                  event.key === "ArrowDown"
                    ? Math.min(index + 1, options.length - 1)
                    : Math.max(0, index - 1),
                );
              }
              if (event.key === "Enter" && open) {
                event.preventDefault();
                if (active >= 0 && options[active]) choose(options[active]);
              }
            }}
          />
          {(selected || text) && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setSelected(null);
                setText("");
                setQuery("");
                setActive(-1);
                setOpen(true);
                document.getElementById(id)?.focus();
              }}
            >
              Clear project
            </Button>
          )}
        </div>
        {open && (
          <div className="absolute inset-x-0 top-full z-20 mt-1 max-h-80 overflow-y-auto rounded-xl border bg-card p-2 shadow-lg">
            <div
              id={`${id}-options`}
              role="listbox"
              aria-label="Projects needing payment or renewal"
              aria-busy={waiting}
            >
              {options.map((project, index) => (
                <button
                  type="button"
                  role="option"
                  aria-selected={selected?.id === project.id}
                  id={`${id}-option-${index}`}
                  key={project.id}
                  className={`block min-h-14 w-full rounded-lg p-3 text-left text-sm hover:bg-muted focus:bg-muted ${active === index ? "bg-muted" : ""}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(project)}
                >
                  <span className="block font-semibold">{project.name}</span>
                  <span className="mt-1 block text-muted-foreground">
                    {project.realtor_name}
                  </span>
                  <span className="mt-1 block text-primary">
                    {reason(project)}
                  </span>
                </button>
              ))}
            </div>
            {waiting ? (
              <p role="status" className="p-3 text-sm">
                Finding projects…
              </p>
            ) : (
              !options.length && (
                <p role="status" className="p-3 text-sm">
                  {status === "Exhausted"
                    ? "No projects match this search with outstanding invoices or a renewal due."
                    : "Looking for matching projects…"}
                </p>
              )
            )}
            {!waiting && status === "CanLoadMore" && (
              <Button
                type="button"
                variant="ghost"
                className="w-full"
                onClick={() => loadMore(15)}
              >
                Load more projects
              </Button>
            )}
            {status === "LoadingMore" && (
              <p role="status" className="p-3 text-sm">
                Loading more projects…
              </p>
            )}
          </div>
        )}
      </div>
      <p id={`${id}-hint`} className="text-xs leading-5 text-muted-foreground">
        Outstanding issued invoices, partially paid invoices, and active
        packages nearing or past their end date. Type to narrow the list. Other
        invoice filters still apply.
      </p>
      {selected && (
        <div className="rounded-lg border bg-muted/40 p-3 text-sm">
          <p>{reason(selected)}</p>
          <Link
            href={`/projects/${selected.id}/commercial`}
            className="mt-2 inline-flex min-h-11 items-center font-medium text-primary hover:underline"
          >
            Open project to record payment or review renewal →
          </Link>
        </div>
      )}
    </div>
  );
}
