import Link from "next/link";
import { StatusBadge } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  label,
  formatDate,
  followupState,
  type Activity,
} from "@/lib/crm/model";
import { CompleteDialog } from "./forms";
export function CrmNav({ operational = true }: { operational?: boolean }) {
  return (
    <nav aria-label="Realtor CRM" className="mb-7 flex flex-wrap gap-2">
      {[
        ["Realtors", "/realtors"],
        ["Follow-ups", "/realtors/followups"],
        ["Brokerages", "/realtors/brokerages"],
        ["Lead sources", "/realtors/sources"],
      ]
        .filter(
          ([, href]) =>
            operational || href === "/realtors" || href === "/realtors/sources",
        )
        .map(([title, href]) => (
          <Link
            key={href}
            href={href}
            className="rounded-lg border bg-card px-4 py-3 text-sm hover:bg-muted"
          >
            {title}
          </Link>
        ))}
    </nav>
  );
}
export function FollowupBadge({
  due,
  status,
}: {
  due: string | null;
  status?: string;
}) {
  if (!due && status === "dormant")
    return (
      <span className="text-xs text-muted-foreground">
        No follow-up planned
      </span>
    );
  const state = followupState(due);
  return (
    <span
      className={
        "inline-flex rounded-full px-2.5 py-1 text-xs font-medium " +
        (state === "Overdue" || state === "No next action"
          ? "bg-amber-100 text-amber-950"
          : state === "Due today"
            ? "bg-blue-50 text-blue-900"
            : "bg-muted text-muted-foreground")
      }
    >
      {state}
    </span>
  );
}
export function ActivityList({
  rows,
  complete = false,
  showRealtor = false,
}: {
  rows: Activity[];
  complete?: boolean;
  showRealtor?: boolean;
}) {
  return (
    <div className="divide-y">
      {rows.map((a) => (
        <article
          key={a.id}
          className="flex flex-wrap items-start justify-between gap-4 py-5"
        >
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap gap-2">
              <StatusBadge>{label(a.type)}</StatusBadge>
              <StatusBadge>{label(a.status)}</StatusBadge>
              {a.priority === "high" && (
                <StatusBadge>High priority</StatusBadge>
              )}
            </div>
            {showRealtor && (
              <Link
                href={"/realtors/" + a.realtor_id}
                className="mb-2 block text-sm underline"
              >
                {a.first_name} {a.last_name}
              </Link>
            )}
            <h3 className="break-words font-medium">{a.title}</h3>
            <p className="mt-2 text-xs text-muted-foreground">
              {a.status === "open"
                ? "Due " + formatDate(a.due_at)
                : formatDate(a.completed_at ?? a.created_at)}
            </p>
            {a.description && (
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-6 text-muted-foreground">
                {a.description}
              </p>
            )}
            {a.status === "open" && (
              <div className="mt-3">
                <FollowupBadge due={a.due_at} />
              </div>
            )}
          </div>
          {complete && a.status === "open" && (
            <CompleteDialog id={a.id} title={a.title} />
          )}
        </article>
      ))}
    </div>
  );
}
export function Pager({
  page,
  hasNext,
  href,
}: {
  page: number;
  hasNext: boolean;
  href: (page: number) => string;
}) {
  return (
    <nav
      aria-label="Pagination"
      className="mt-6 flex items-center justify-between gap-3"
    >
      {page > 1 ? (
        <Button variant="outline" asChild>
          <Link href={href(page - 1)}>Previous</Link>
        </Button>
      ) : (
        <span />
      )}
      <span className="text-sm text-muted-foreground">Page {page}</span>
      {hasNext && page < 800 ? (
        <Button variant="outline" asChild>
          <Link href={href(page + 1)}>Next</Link>
        </Button>
      ) : (
        <span />
      )}
    </nav>
  );
}
