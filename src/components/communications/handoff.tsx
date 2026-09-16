"use client";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { LoadingState } from "@/components/primitives";
import { Field } from "@/components/sales/shared";
import { Button } from "@/components/ui/button";
import { communicationError } from "@/lib/communications/errors";
export function DraftHandoff({
  activityId,
  aiId,
  onCreated,
}: {
  activityId?: Id<"activities">;
  aiId?: Id<"ai_requests">;
  onCreated: (id: Id<"communications">) => void;
}) {
  const task = useQuery(
      api.communications.activityDraft,
      activityId ? { id: activityId } : "skip",
    ),
    ai = useQuery(api.ai.result, aiId ? { id: aiId } : "skip"),
    create = useMutation(api.communications.create),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  if ((activityId && !task) || (aiId && !ai)) return <LoadingState />;
  const aiSource =
      ai &&
      (ai.scope.feature === "realtor"
        ? { type: "realtor" as const, id: ai.scope.entity_id as Id<"realtors"> }
        : null),
    source = task?.source ?? aiSource,
    recipient = task?.recipient ?? aiSource;
  if (!source || !recipient || (ai && (ai.stale || !ai.output?.draft)))
    return <p>Return to the source and prepare a fresh authorized draft.</p>;
  return (
    <form
      className="max-w-3xl space-y-5 rounded-2xl border bg-card p-6"
      onSubmit={async (e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        setBusy(true);
        setError("");
        try {
          onCreated(
            await create({
              source,
              recipient,
              category: task?.category ?? "sales_relationship",
              subject: String(f.get("subject")),
              body: String(f.get("body")),
              request_key: crypto.randomUUID(),
              activity_id: activityId,
              ai_draft_id: aiId,
            }),
          );
        } catch (e) {
          setError(communicationError(e));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-xl font-semibold">Review imported draft</h2>
      <p className="text-sm text-muted-foreground">
        This creates a draft only. Eligibility, human approval, and a separate
        send request are still required.
      </p>
      <Field name="subject" label="Subject" required />
      <Field
        name="body"
        label="Message"
        value={ai?.output?.draft ?? ""}
        type="textarea"
      />
      <Button disabled={busy}>Create communication draft</Button>
      <p role="status">{error}</p>
    </form>
  );
}
