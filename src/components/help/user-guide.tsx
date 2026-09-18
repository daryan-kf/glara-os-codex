"use client";

import Link from "next/link";
import { useState } from "react";
import { BookOpen, Printer, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { canAccess, modules, type Role } from "@/lib/permissions";
import { guideSections, searchGuide } from "@/lib/help/guide";

export function UserGuide({ roles }: { roles: Role[] }) {
  const [query, setQuery] = useState("");
  const matches = searchGuide(query);
  const visibleIds = new Set(matches.map((section) => section.id));

  return (
    <div lang="en" dir="ltr" className="mx-auto max-w-5xl space-y-7 text-start">
      <header id="guide-top" className="scroll-mt-24 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <span className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-2 text-sm font-medium text-primary">
            <BookOpen aria-hidden="true" className="size-4" />
            Glara OS Help Center
          </span>
          <Button
            type="button"
            variant="outline"
            onClick={() => window.print()}
            className="print:hidden"
          >
            <Printer aria-hidden="true" />
            Print full guide
          </Button>
        </div>
        <h1 className="text-3xl font-semibold leading-relaxed sm:text-4xl">
          User guide
        </h1>
        <p className="max-w-3xl text-base leading-8 text-muted-foreground">
          From first contact to destaging and settlement, follow each workflow
          using the labels you see in the app. Search for a topic or open the
          chapter list to get started.
        </p>
      </header>
      <section
        aria-label="Search the guide"
        className="space-y-4 rounded-2xl border bg-card p-5 print:hidden sm:p-6"
      >
        <label htmlFor="guide-search" className="block text-sm font-semibold">
          Search by topic or module name
        </label>
        <div className="flex items-center gap-3 rounded-xl border bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
          <Search
            aria-hidden="true"
            className="size-5 shrink-0 text-muted-foreground"
          />
          <input
            id="guide-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Try extensions, staged projects, invoices, or inventory"
            className="min-h-12 w-full min-w-0 bg-transparent text-base outline-none"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Popular topics:</span>
          {[
            ["Staged projects", "Where to find staged projects"],
            ["Package extensions", "Package expiry and extensions"],
            ["Inventory", "inventory"],
            ["Payments", "received payments"],
          ].map(([label, value]) => (
            <Button
              key={value}
              type="button"
              variant="outline"
              onClick={() => setQuery(value)}
            >
              {label}
            </Button>
          ))}
          {query && (
            <Button type="button" variant="ghost" onClick={() => setQuery("")}>
              Clear search
            </Button>
          )}
        </div>
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-muted-foreground"
        >
          {matches.length.toLocaleString("en-CA")} of{" "}
          {guideSections.length.toLocaleString("en-CA")} chapters
        </p>
      </section>
      {matches.length > 0 && (
        <details className="rounded-2xl border bg-card p-5 print:hidden">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">
            Chapters
          </summary>
          <nav
            aria-label="User guide contents"
            className="mt-3 grid gap-2 sm:grid-cols-2"
          >
            {matches.map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                className="rounded-lg px-3 py-3 text-sm leading-6 hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2"
              >
                {section.title}
              </a>
            ))}
          </nav>
        </details>
      )}
      {matches.length === 0 && (
        <div className="rounded-2xl border p-8 text-center print:hidden">
          <h2 className="text-xl font-semibold">No matching topics</h2>
          <p className="my-4 leading-7 text-muted-foreground">
            Try a shorter phrase or a module name, such as extension or
            inventory.
          </p>
          <Button type="button" variant="outline" onClick={() => setQuery("")}>
            Show all chapters
          </Button>
        </div>
      )}
      <div className="space-y-6">
        {guideSections.map((section, index) => (
          <section
            id={section.id}
            key={section.id}
            aria-labelledby={`${section.id}-title`}
            className={`${visibleIds.has(section.id) ? "block" : "hidden"} scroll-mt-24 rounded-2xl border bg-card p-5 print:block print:rounded-none print:border-0 sm:p-7`}
          >
            <div className="mb-4 flex items-start gap-3">
              <span
                className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-sm font-semibold text-primary"
                aria-hidden="true"
              >
                {(index + 1).toLocaleString("en-CA")}
              </span>
              <div>
                <h2
                  id={`${section.id}-title`}
                  className="text-xl font-semibold leading-9"
                >
                  {section.title}
                </h2>
                <p className="mt-2 text-sm leading-7 text-muted-foreground">
                  {section.summary}
                </p>
              </div>
            </div>
            <ol className="list-decimal space-y-3 ps-6 text-sm leading-8 marker:font-semibold marker:text-primary sm:text-base">
              {section.steps.map((step) => (
                <li key={step} className="break-words ps-1">
                  {step}
                </li>
              ))}
            </ol>
            {section.note && (
              <p className="mt-5 rounded-xl border-s-4 border-primary bg-muted p-4 text-sm leading-8">
                <strong className="font-semibold">Remember: </strong>
                {section.note}
              </p>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t pt-4 print:hidden">
              {section.module && canAccess(roles, section.module) ? (
                <Link
                  href={`/${section.module}`}
                  className="rounded-lg px-2 py-3 text-sm font-semibold text-primary hover:underline focus-visible:outline-2"
                >
                  Go to <bdi>{modules[section.module].title}</bdi>
                </Link>
              ) : (
                <span className="text-xs leading-6 text-muted-foreground">
                  Actions depend on your role and access.
                </span>
              )}
              <a
                href="#guide-top"
                className="rounded-lg px-2 py-3 text-sm text-muted-foreground hover:underline focus-visible:outline-2"
              >
                Back to top
              </a>
            </div>
          </section>
        ))}
      </div>
      <p className="text-sm leading-7 text-muted-foreground">
        This guide does not display customer records or live service status. For
        operational decisions, check the current record and the messages shown
        in the app.
      </p>
    </div>
  );
}
