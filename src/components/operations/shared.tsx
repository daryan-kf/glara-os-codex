"use client";
import { useState, Children } from "react";
import { Button } from "@/components/ui/button";
import { Field, inputClass, Panel, Pager } from "@/components/sales/shared";
export { Field, inputClass, Panel, Pager };
export function Loading() {
  return (
    <p role="status" className="rounded-xl border p-8 text-muted-foreground">
      Loading operations…
    </p>
  );
}
export function label(value: string) {
  return value.replaceAll("_", " ");
}
export function dateTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en-CA", {
        timeZone: "America/Vancouver",
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Not scheduled";
}
export {
  vancouverLocal as localTime,
  vancouverUtc as toUtc,
} from "@/lib/operations/time";
const messages: Record<string, string> = {
  FORBIDDEN: "Your account cannot perform this action.",
  CONFLICT: "This record changed. Reload the page before saving.",
  UNAVAILABLE: "This record is closed, archived or unavailable.",
  INVALID_INPUT: "Review the fields and try again.",
  INVALID_TRANSITION:
    "This action is not available in the current project stage.",
  PLANNING_GATE:
    "Complete preparation, the room plan, primary team and package end date first.",
  CHECKLIST_GATE:
    "Complete the required checklist for this stage. Required items cannot be skipped or reversed after their gate.",
  SCHEDULE_CONFLICT:
    "This project or assigned lead already has an overlapping event.",
  CAPACITY: "The daily staging or destaging capacity is full.",
  DEPENDENCY:
    "Resolve linked tasks, assignments or events before making this change.",
  DUPLICATE: "A linked record already exists. Open it to make changes.",
  LIMIT:
    "This operation exceeds the configured limit. Contact your administrator.",
};
export function errorMessage(error: unknown) {
  if (error && typeof error === "object" && "data" in error) {
    const d = error.data;
    if (d && typeof d === "object" && "code" in d && typeof d.code === "string")
      return (
        messages[d.code] ??
        "Unable to save. Please retry or contact your administrator."
      );
  }
  if (
    error instanceof Error &&
    error.message.startsWith("Choose an unambiguous")
  )
    return error.message;
  return "Unable to save. Please retry or contact your administrator.";
}
export function Form({
  children,
  onSave,
  submit,
  version,
}: {
  children: React.ReactNode;
  onSave: (data: Record<string, string>, version: number) => Promise<unknown>;
  submit: string;
  version?: number;
}) {
  const [loaded, setLoaded] = useState(version ?? 0),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [saved, setSaved] = useState(false);
  return (
    <form
      className="space-y-4"
      onSubmit={async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(
          [...new FormData(e.currentTarget)].filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
          ),
        );
        setPending(true);
        setError("");
        setSaved(false);
        try {
          await onSave(data, loaded);
          setLoaded((v) => v + 1);
          setSaved(true);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setPending(false);
        }
      }}
    >
      {children}
      {error && (
        <p
          role="alert"
          className="rounded-lg bg-red-50 p-3 text-sm text-red-900"
        >
          {error}
        </p>
      )}
      {saved && (
        <p role="status" className="text-sm text-primary">
          Saved successfully.
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : submit}
      </Button>
    </form>
  );
}
export function Action({
  children,
  onClick,
  variant = "outline",
}: {
  children: React.ReactNode;
  onClick: () => Promise<unknown>;
  variant?: "outline" | "default";
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <div>
      <Button
        variant={variant}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await onClick();
          } catch (e) {
            setError(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Saving…" : children}
      </Button>
      {error && (
        <p role="alert" className="mt-2 text-sm text-red-800">
          {error}
        </p>
      )}
    </div>
  );
}
export function Select({
  label,
  name,
  value = "",
  options,
  required = false,
}: {
  label: string;
  name: string;
  value?: string | null;
  options: { id: string; name: string }[];
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium">
      {label}
      <select
        name={name}
        defaultValue={value ?? ""}
        required={required}
        className={inputClass}
      >
        <option value="">Not assigned</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    </label>
  );
}

export function Disclosure({
  children,
  open = false,
  className,
}: {
  children: React.ReactNode;
  open?: boolean;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(open);
  const parts = Children.toArray(children);
  return (
    <details
      className={className}
      open={expanded}
      onToggle={(e) => setExpanded(e.currentTarget.open)}
    >
      {parts[0]}
      {expanded && parts.slice(1)}
    </details>
  );
}
