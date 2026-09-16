"use client";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { PageTitle, LoadingState, FormField, StatusBadge } from "./primitives";
import { Button } from "./ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import type { Role } from "@/lib/permissions";
import type { Capability } from "../../convex/emergencyModel";
export function SecurityCenter({ roles }: { roles: Role[] }) {
  const state = useQuery(api.emergency.state, {}),
    health = useQuery(api.operationalHealth.health, {}),
    alerts = useQuery(api.operationalHealth.alerts, {});
  const change = useMutation(api.emergency.change),
    refresh = useMutation(api.operationalHealth.refresh),
    acknowledge = useMutation(api.operationalHealth.acknowledge);
  const [selected, setSelected] = useState<{
    capability: Capability;
    frozen: boolean;
    version: number;
  } | null>(null);
  const [reason, setReason] = useState(""),
    [incident, setIncident] = useState(""),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function run(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      await action();
      setSelected(null);
      setMessage("Saved. Current server state is shown below.");
    } catch {
      setMessage(
        "Unable to complete this action. Access or state may have changed. Refresh and review before retrying.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (!state || !health || !alerts) return <LoadingState />;
  return (
    <div className="space-y-8">
      <PageTitle
        title="Security & operations"
        description="Emergency controls and current operational evidence."
      />
      <p role="status">{message}</p>
      <section
        className="rounded-xl border bg-card p-5 space-y-4"
        aria-labelledby="emergency-title"
      >
        <h2 id="emergency-title" className="text-xl font-semibold">
          Emergency controls
        </h2>
        <p className="text-sm text-muted-foreground">
          Owner controls execution freezes. Authorized reads remain available.
          Releasing a freeze does not enable a provider or retry an unknown
          delivery.
        </p>
        {state.map((s) => (
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-t py-3"
            key={s.capability}
          >
            <span className="capitalize">
              {s.capability.replaceAll("_", " ")}
            </span>
            <StatusBadge>
              {s.frozen ? "Frozen" : "Not frozen"}
              {s.recovery_mode ? " Â· Recovery override" : ""}
            </StatusBadge>
            {roles.includes("owner") && (
              <Button
                disabled={busy || s.recovery_mode}
                variant="outline"
                onClick={() => {
                  setReason("");
                  setIncident("");
                  setSelected({
                    capability: s.capability,
                    version: s.version,
                    frozen: !s.frozen,
                  });
                }}
              >
                {s.frozen ? "Release" : "Freeze"} {s.capability}
              </Button>
            )}
          </div>
        ))}
      </section>
      <section
        className="rounded-xl border bg-card p-5 space-y-4"
        aria-labelledby="health-title"
      >
        <h2 id="health-title" className="text-xl font-semibold">
          Operational health
        </h2>
        <p>
          Email:{" "}
          {health.dimensions.email.enabled
            ? "Enabled â€” review controls"
            : "Disabled"}
        </p>
        <p>
          Google Calendar:{" "}
          {health.calendar === "DISABLED_DEFERRED"
            ? "Disabled Â· Acceptance deferred"
            : "Acceptance review required"}
        </p>
        <p>
          Backup verification: {health.dimensions.backup.status}. Financial and
          Inventory integrity require independent reconciliation.
        </p>
        <p className="text-sm text-muted-foreground">
          Bounded samples. External monitoring and backup monitoring are not
          configured. Acknowledgement does not resolve a condition.
        </p>
        <Button disabled={busy} onClick={() => void run(() => refresh({}))}>
          Refresh alert evidence
        </Button>
        <ul className="space-y-3">
          {alerts
            .filter((a) => a.active)
            .map((a) => (
              <li
                key={a._id}
                className="border-t pt-3 flex flex-wrap gap-3 items-center justify-between"
              >
                <span>
                  {a.key.replaceAll(".", " Â· ").replaceAll("_", " ")} â€”{" "}
                  {a.priority} priority
                </span>
                {a.acknowledged_at ? (
                  <StatusBadge>Acknowledged Â· Still active</StatusBadge>
                ) : (
                  <Button
                    disabled={busy}
                    variant="outline"
                    onClick={() =>
                      void run(() =>
                        acknowledge({ id: a._id, version: a.version }),
                      )
                    }
                  >
                    Acknowledge {a.key}
                  </Button>
                )}
              </li>
            ))}
        </ul>
      </section>
      <Dialog
        open={!!selected}
        onOpenChange={(open) => {
          if (!open && !busy) setSelected(null);
        }}
      >
        <DialogContent>
          <DialogTitle className="text-xl font-semibold">
            {selected?.frozen ? "Freeze" : "Release"} {selected?.capability}
          </DialogTitle>
          <DialogDescription className="my-3">
            This changes the server execution boundary. Review the capability
            and reason before confirming.
          </DialogDescription>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              if (selected)
                void run(() =>
                  change({
                    changes: [selected],
                    reason,
                    ...(incident ? { incident } : {}),
                  }),
                );
            }}
          >
            <FormField
              id="freeze-reason"
              label="Reason"
              minLength={10}
              maxLength={500}
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
            />
            <FormField
              id="freeze-incident"
              label="Incident reference (optional)"
              placeholder="INC-... or DRILL-..."
              pattern="(INC|DRILL)-[A-Za-z0-9-]{3,60}"
              value={incident}
              onChange={(e) => setIncident(e.target.value)}
              disabled={busy}
            />
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                disabled={busy}
                onClick={() => setSelected(null)}
              >
                Cancel
              </Button>
              <Button disabled={busy} type="submit">
                {busy ? "Savingâ€¦" : "Confirm change"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
