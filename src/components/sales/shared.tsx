"use client";
import { useState, useEffect } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { classifyCrmError } from "@/lib/crm/errors";
export const inputClass =
  "min-h-11 w-full rounded-lg border bg-card px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-ring";
export function Field({
  label,
  name,
  value = "",
  type = "text",
  required = false,
  options,
  step,
}: {
  label: string;
  name: string;
  value?: string | number | null;
  type?: string;
  required?: boolean;
  options?: readonly string[];
  step?: string;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      {options ? (
        <select
          className={inputClass}
          name={name}
          defaultValue={value ?? ""}
          required={required}
        >
          {options.map((o) => (
            <option key={o} value={o}>
              {o ? o.replaceAll("_", " ") : "Not selected"}
            </option>
          ))}
        </select>
      ) : type === "textarea" ? (
        <textarea
          className={inputClass}
          name={name}
          defaultValue={value ?? ""}
          rows={3}
        />
      ) : (
        <input
          className={inputClass}
          name={name}
          defaultValue={value ?? ""}
          type={type}
          step={step}
          required={required}
        />
      )}
    </label>
  );
}
export function SalesForm({
  children,
  submit,
  onSave,
  expectedVersion,
}: {
  children: React.ReactNode;
  submit: string;
  expectedVersion?: number;
  onSave: (
    data: Record<string, string>,
    form: FormData,
    loadedVersion?: number,
  ) => Promise<unknown>;
}) {
  // Editable record forms keep the version captured when their fields were loaded.
  const [loadedVersion] = useState(expectedVersion);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(false);
  return (
    <form
      className="space-y-5"
      onSubmit={async (e) => {
        e.preventDefault();
        const form = new FormData(e.currentTarget),
          data: Record<string, string> = {};
        for (const [key, value] of form)
          if (typeof value === "string") data[key] = value;
        for (const key of [
          "next_action_date",
          "scheduled_at",
          "due_at",
          "replacement_due",
        ])
          if (data[key]) data[key] = new Date(data[key]).toISOString();
        setPending(true);
        setError("");
        setSuccess(false);
        try {
          await onSave(data, form, loadedVersion);
          setSuccess(true);
        } catch (failure) {
          const problem = classifyCrmError(failure);
          setError(
            problem.category === "next_action"
              ? "An active opportunity needs an open, dated next action. Add a replacement before closing the last action."
              : problem.category === "duplicate"
                ? "An active record already uses this address, MLS number or property. Review the existing record."
                : problem.message,
          );
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
        >
          {error}
        </p>
      )}
      {success && (
        <p role="status" className="text-sm text-primary">
          Saved successfully.
        </p>
      )}
      <Button disabled={pending} type="submit">
        {pending ? "Saving…" : submit}
      </Button>
    </form>
  );
}
export function Picker({
  kind,
  name,
  label,
  initialId = "",
  initialLabel = "",
  required = true,
}: {
  kind: "realtors" | "properties" | "opportunities";
  name: string;
  label: string;
  initialId?: string;
  initialLabel?: string;
  required?: boolean;
}) {
  const [q, setQ] = useState(initialLabel),
    [term, setTerm] = useState(initialLabel),
    [id, setId] = useState(initialId),
    [open, setOpen] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setTerm(q), 200);
    return () => clearTimeout(t);
  }, [q]);
  const options = useQuery(
    api.sales.options,
    open ? { kind, q: term } : "skip",
  );
  return (
    <div
      className="relative space-y-2"
      onBlur={(e) => {
        // Close when focus leaves the picker entirely (click or tab outside).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <label className="grid gap-2 text-sm font-medium">
        {label}
        <input
          className={inputClass}
          aria-label={label}
          value={q}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQ(e.target.value);
            setId("");
            setOpen(true);
          }}
          placeholder="Search and select…"
          required={required}
        />
      </label>
      <input type="hidden" name={name} value={id} />
      {open && (
        <div className="max-h-52 overflow-auto rounded-lg border bg-card p-2 shadow-lg">
          {options === undefined ? (
            <p className="p-2 text-sm">Searching…</p>
          ) : options.length ? (
            options.map((o) => (
              <button
                type="button"
                key={o.id}
                className="block min-h-11 w-full rounded px-3 text-left text-sm hover:bg-muted"
                onClick={() => {
                  setId(o.id);
                  setQ(o.name);
                  setOpen(false);
                }}
              >
                {o.name}
              </button>
            ))
          ) : (
            <p className="p-2 text-sm">
              No matches. Create the linked record first.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
export function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border bg-card p-5 sm:p-6">
      <h2 className="mb-5 text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}
export function Loading() {
  return (
    <p role="status" className="rounded-2xl border p-8 text-muted-foreground">
      Loading your sales workspace…
    </p>
  );
}
export function Pager({
  done,
  onNext,
  onReset,
}: {
  done: boolean;
  onNext: () => void;
  onReset: () => void;
}) {
  return (
    <div className="mt-6 flex gap-3">
      <Button variant="outline" onClick={onReset}>
        First page
      </Button>
      <Button variant="outline" disabled={done} onClick={onNext}>
        Next page
      </Button>
    </div>
  );
}
