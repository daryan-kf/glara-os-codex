import { CircleDashed } from "lucide-react";
import { cn } from "@/lib/utils";
export function PageTitle({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <header className="mb-8">
      <p className="mb-3 text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">
        Glara Home Staging
      </p>
      <h1 className="font-display text-3xl tracking-tight sm:text-4xl">
        {title}
      </h1>
      <p className="mt-3 text-muted-foreground">{description}</p>
    </header>
  );
}
export function SectionHeading({ children }: { children: React.ReactNode }) {
  return <h2 className="text-lg font-semibold tracking-tight">{children}</h2>;
}
export function StatusBadge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
      {children}
    </span>
  );
}
export function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
    >
      {name
        .split(" ")
        .slice(0, 2)
        .map((part) => part[0])
        .join("")
        .toUpperCase()}
    </span>
  );
}
export function EmptyState({
  title,
  description,
  children,
}: {
  title: string;
  description: string;
  children?: React.ReactNode;
}) {
  return (
    <section className="flex min-h-80 flex-col items-center justify-center rounded-2xl border border-dashed bg-card px-6 py-12 text-center">
      <span className="mb-6 rounded-2xl border bg-background p-4">
        <CircleDashed className="size-7 text-primary" />
      </span>
      <h2 className="font-display text-2xl">{title}</h2>
      <p className="mt-3 max-w-lg text-sm leading-7 text-muted-foreground">
        {description}
      </p>
      {children && <div className="mt-6">{children}</div>}
    </section>
  );
}
export function StatCard({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="my-3 text-3xl font-medium">{value}</p>
      <p className="text-xs text-muted-foreground">{note}</p>
    </div>
  );
}
export function LoadingState() {
  return (
    <div role="status" aria-label="Loading page" className="space-y-6">
      <div className="h-10 w-64 animate-pulse rounded-lg bg-muted" />
      <div className="h-80 animate-pulse rounded-2xl bg-muted" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
export function FormField({
  label,
  className,
  ...props
}: React.ComponentProps<"input"> & { label: string; id: string }) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-medium" htmlFor={props.id}>
        {label}
      </label>
      <input
        className={cn(
          "min-h-12 w-full rounded-lg border bg-card px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}
export function TableShell({
  caption,
  headings,
  children,
}: {
  caption: string;
  headings: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border">
      <table className="w-full text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-muted">
          <tr>
            {headings.map((heading) => (
              <th scope="col" className="px-4 py-3 font-medium" key={heading}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
