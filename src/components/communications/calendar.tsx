"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { LoadingState, StatusBadge } from "@/components/primitives";
import { communicationError } from "@/lib/communications/errors";
export function CalendarConnections() {
  const list = useQuery(api.calendarSync.list, {}),
    events = useQuery(api.calendarSync.candidates, {}),
    sync = useAction(api.calendarProvider.sync),
    configure = useMutation(api.calendarSync.configure),
    resolve = useMutation(api.calendarSync.resolve),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setNotice("");
    try {
      await work();
      setNotice("Calendar request processed.");
    } catch (e) {
      setNotice(communicationError(e));
    } finally {
      setBusy(false);
    }
  }
  if (!list || !events) return <LoadingState />;
  return (
    <section className="space-y-6 rounded-2xl border bg-card p-6">
      <h2 className="text-xl font-semibold">Development calendar</h2>
      <p className="text-sm text-muted-foreground">
        Glara owns the schedule. External edits require review. No attendees or
        invitations are created.
      </p>
      <Button
        disabled={busy}
        variant="outline"
        onClick={() =>
          void run(() =>
            configure({
              enabled: !list.connection?.enabled,
              version: list.connection?.version ?? 0,
            }),
          )
        }
      >
        {list.connection?.enabled
          ? "Disable calendar sync"
          : "Enable configured calendar"}
      </Button>
      <p role="status">{notice}</p>
      <div className="grid gap-3">
        {events.map((e) => (
          <div
            key={`${e.source.type}:${e.source.id}`}
            className="flex flex-wrap items-center justify-between gap-4 rounded-xl border p-4"
          >
            <div>
              <p className="font-medium">{e.label}</p>
              <p className="text-sm text-muted-foreground">
                {new Date(e.start).toLocaleString("en-CA", {
                  timeZone: "America/Vancouver",
                })}{" "}
                · Vancouver
              </p>
            </div>
            <Button
              variant="outline"
              disabled={busy || !list.connection?.enabled}
              onClick={() => void run(() => sync({ source: e.source }))}
            >
              Sync / check
            </Button>
          </div>
        ))}
      </div>
      <h3 className="font-semibold">Projection history</h3>
      {list.projections.map((p) => (
        <div key={p._id} className="space-y-3 rounded-xl border p-4">
          <div className="flex flex-wrap justify-between gap-2">
            <span>{p.snapshot.title}</span>
            <StatusBadge>{p.status}</StatusBadge>
          </div>
          {p.last_code && (
            <p className="text-sm text-muted-foreground">
              {p.last_code.replaceAll("_", " ")}
            </p>
          )}
          {p.status === "conflict" && (
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <strong>Glara schedule</strong>
                <p>
                  {p.snapshot.start} → {p.snapshot.end}
                </p>
              </div>
              <div>
                <strong>External observation</strong>
                <p>
                  {p.observed?.missing
                    ? "Event missing"
                    : `${p.observed?.start ?? "Unavailable"} → ${p.observed?.end ?? "Unavailable"}`}
                </p>
                {p.observed?.has_attendees && (
                  <p>
                    Unexpected attendees: remove them externally before resync.
                  </p>
                )}
              </div>
            </div>
          )}
          {p.status === "conflict" ? (
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    resolve({
                      id: p._id,
                      version: p.version,
                      resolution: "keep_glara",
                    }),
                  )
                }
              >
                Keep Glara; allow resync
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(() =>
                    resolve({
                      id: p._id,
                      version: p.version,
                      resolution: "ignore",
                    }),
                  )
                }
              >
                Ignore projection
              </Button>
            </div>
          ) : (
            <Button
              variant="outline"
              disabled={busy || !list.connection?.enabled}
              onClick={() => void run(() => sync({ source: p.source }))}
            >
              Sync / reconcile
            </Button>
          )}
        </div>
      ))}
    </section>
  );
}
export function ProjectCalendarStatus({
  id,
}: {
  id: import("../../../convex/_generated/dataModel").Id<"projects">;
}) {
  const rows = useQuery(api.calendarSync.projectStatus, { id });
  if (!rows?.length) return null;
  return (
    <section className="mt-6 space-y-3 rounded-xl border bg-card p-5">
      <h2 className="font-semibold">External calendar status</h2>
      {rows.map((row) => (
        <div
          key={row.id}
          className="flex items-center justify-between gap-3 text-sm"
        >
          <span>{row.type}</span>
          <StatusBadge>{row.status.replaceAll("_", " ")}</StatusBadge>
        </div>
      ))}
      <Link
        className="inline-block min-h-11 py-3 text-sm underline"
        href="/calendar"
      >
        Review calendar sync
      </Link>
    </section>
  );
}
export function ConsultationCalendarStatus({
  id,
}: {
  id: import("../../../convex/_generated/dataModel").Id<"consultations">;
}) {
  const viewer = useQuery(api.profiles.viewer, {});
  const enabled =
    !!viewer?.communications_version &&
    viewer.roles.some((r) => r === "owner" || r === "admin");
  const row = useQuery(
    api.calendarSync.sourceStatus,
    enabled ? { source: { type: "consultation", id } } : "skip",
  );
  if (!enabled) return null;
  return (
    <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
      <StatusBadge>Calendar: {row?.status ?? "not synced"}</StatusBadge>
      <Link href="/calendar" className="min-h-11 py-3 underline">
        Review sync / conflict
      </Link>
    </div>
  );
}
