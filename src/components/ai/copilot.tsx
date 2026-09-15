"use client";
import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useQuery, useMutation, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  features,
  scopeSchema,
  errorMessage,
  safeError,
  type Scope,
  type Config,
  type Feature,
} from "@/lib/ai/model";
import type { Role } from "@/lib/permissions";
import { Button } from "@/components/ui/button";
import {
  PageTitle,
  EmptyState,
  LoadingState,
  StatusBadge,
} from "@/components/primitives";
import { Field, inputClass } from "@/components/sales/shared";
export function CopilotLink({
  feature,
  id,
  label = "Ask Glara",
}: {
  feature: Feature;
  id: string;
  label?: string;
}) {
  const viewer = useQuery(api.profiles.viewer, {});
  if (viewer?.ai_version !== 1) return null;
  return (
    <Button variant="outline" asChild>
      <Link
        href={`/copilot?feature=${feature}&entity=${encodeURIComponent(id)}`}
      >
        {label}
      </Link>
    </Button>
  );
}
const names: Record<Feature, string> = {
  general: "Ask Glara OS",
  executive: "Executive Analyst",
  realtor: "Realtor Brief",
  opportunity: "Sales Copilot",
  project: "Project Brief",
  inventory: "Inventory Intelligence",
  commercial: "Commercial Copilot",
  automation: "Automation Explanation",
  marketing: "Marketing Draft",
  navigation: "Navigation Help",
};
export function Copilot({ roles }: { roles: Role[] }) {
  const params = useSearchParams(),
    [scope, setScope] = useState<Scope>(() =>
      scopeSchema.parse({
        feature: features.includes(params.get("feature") as Feature)
          ? params.get("feature")
          : "general",
        entity_id: params.get("entity") ?? "",
      }),
    ),
    [question, setQuestion] = useState(""),
    [term, setTerm] = useState(""),
    [searchTerm, setSearchTerm] = useState(""),
    [requestId, setRequestId] = useState<Id<"ai_requests"> | null>(null),
    [thread, setThread] = useState<Id<"ai_conversations"> | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const settings = useQuery(api.ai.settings, {}),
    history = useQuery(api.ai.history, {}),
    candidates = useQuery(
      api.ai.search,
      searchTerm ? { feature: scope.feature, term: searchTerm } : "skip",
    ),
    turns = useQuery(api.ai.conversation, thread ? { id: thread } : "skip");
  const create = useMutation(api.ai.request),
    generate = useAction(api.aiProvider.generate),
    cancel = useMutation(api.ai.cancel),
    archive = useMutation(api.ai.archive);
  const manager = roles.some((x) => x === "owner" || x === "admin");
  const allowed = features.filter(
    (f) =>
      ["general", "navigation", "automation"].includes(f) ||
      manager ||
      (roles.includes("sales") &&
        ["realtor", "opportunity", "project"].includes(f)) ||
      (roles.includes("designer") && ["project", "inventory"].includes(f)) ||
      (roles.includes("staging_crew") && f === "project") ||
      (roles.includes("marketing") && f === "marketing"),
  );
  function change(next: Scope) {
    setScope(next);
    setThread(null);
    setRequestId(null);
    setSearchTerm("");
    setError("");
  }
  async function send() {
    setError("");
    setBusy(true);
    try {
      const id = await create({
        input: JSON.stringify({
          request_key: crypto.randomUUID(),
          question,
          scope,
          ...(thread ? { conversation_id: thread } : {}),
        }),
      });
      setRequestId(id);
      await generate({ id });
    } catch (e) {
      setError(errorMessage(safeError(e)));
    } finally {
      setBusy(false);
    }
  }
  if (!settings) return <LoadingState />;
  return (
    <>
      <PageTitle
        title="Ask Glara OS"
        description="Clear answers, grounded in your work."
      />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_260px]">
        <section className="min-w-0 space-y-5">
          <div className="rounded-2xl border bg-card p-5 sm:p-7">
            {!settings.enabled && (
              <div
                role="status"
                className="mb-5 rounded-xl bg-muted p-4 text-sm"
              >
                AI is not activated. Provider and data-handling approval are
                required. Navigation Help remains available.
              </div>
            )}
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                void send();
              }}
            >
              <label className="grid gap-2 text-sm font-medium">
                Experience
                <select
                  className={inputClass}
                  value={scope.feature}
                  disabled={busy}
                  onChange={(e) =>
                    change(scopeSchema.parse({ feature: e.target.value }))
                  }
                >
                  {allowed.map((x) => (
                    <option key={x} value={x}>
                      {names[x]}
                    </option>
                  ))}
                </select>
              </label>
              {!["general", "executive", "navigation"].includes(
                scope.feature,
              ) && (
                <div className="space-y-3 rounded-xl border p-4">
                  <p className="text-sm">
                    {scope.entity_id
                      ? "A record is selected. Its sources will appear with the answer."
                      : "Choose a record to keep your question in context."}
                  </p>
                  <div className="flex gap-2">
                    <input
                      className={inputClass}
                      aria-label="Find a record"
                      value={term}
                      onChange={(e) => setTerm(e.target.value)}
                      placeholder={
                        scope.feature === "commercial"
                          ? "Exact invoice number"
                          : "Search by name or project"
                      }
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setSearchTerm(term)}
                    >
                      Find
                    </Button>
                  </div>
                  {candidates?.map((c) => (
                    <Button
                      type="button"
                      variant="outline"
                      key={c.id}
                      className="h-auto min-h-11 w-full justify-start whitespace-normal text-left"
                      onClick={() => change({ ...scope, entity_id: c.id })}
                    >
                      {c.label}
                    </Button>
                  ))}
                  {candidates?.length === 0 && (
                    <p className="text-sm text-muted-foreground">
                      No matching authorized records in this search. Try a more
                      specific name.
                    </p>
                  )}
                </div>
              )}
              {["executive", "commercial"].includes(scope.feature) && (
                <label className="grid gap-2 text-sm">
                  Reporting period
                  <select
                    className={inputClass}
                    value={scope.period}
                    onChange={(e) =>
                      change({
                        ...scope,
                        period: e.target.value as Scope["period"],
                      })
                    }
                  >
                    {[
                      "today",
                      "this_week",
                      "this_month",
                      "previous_month",
                      "quarter",
                      "year",
                      "custom",
                    ].map((x) => (
                      <option key={x} value={x}>
                        {x.replaceAll("_", " ")}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {(scope.period === "custom" || scope.feature === "inventory") && (
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-2 text-sm">
                    From
                    <input
                      className={inputClass}
                      type="date"
                      value={scope.from}
                      onChange={(e) =>
                        change({ ...scope, from: e.target.value })
                      }
                    />
                  </label>
                  <label className="grid gap-2 text-sm">
                    Until
                    <input
                      className={inputClass}
                      type="date"
                      value={scope.until}
                      onChange={(e) =>
                        change({ ...scope, until: e.target.value })
                      }
                    />
                  </label>
                </div>
              )}
              {scope.feature === "inventory" && scope.entity_id && (
                <LocationPicker scope={scope} change={change} />
              )}
              <label className="grid gap-2 text-sm font-medium">
                Your question
                <textarea
                  className={inputClass + " min-h-32"}
                  maxLength={2000}
                  required
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                  placeholder="What needs my attention, and why?"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={
                    busy ||
                    (!settings.enabled && scope.feature !== "navigation")
                  }
                >
                  {busy ? "Preparing your answer…" : "Ask Glara"}
                </Button>
                {busy && requestId && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={async () => {
                      try {
                        await cancel({ id: requestId });
                        setBusy(false);
                      } catch (e) {
                        setError(errorMessage(safeError(e)));
                      }
                    }}
                  >
                    Cancel request
                  </Button>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setThread(null);
                    setRequestId(null);
                    setQuestion("");
                  }}
                >
                  New conversation
                </Button>
              </div>
            </form>
            {error && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>
          {requestId ? (
            <Response key={requestId} id={requestId} onThread={setThread} />
          ) : (
            <EmptyState
              title="A second perspective, with sources"
              description="Ask about recorded facts, request a brief, or draft a follow-up. Proposed tasks require your review and approval."
            />
          )}
        </section>
        <aside className="space-y-5">
          <section className="rounded-2xl border bg-card p-5">
            <h2 className="mb-4 font-semibold">Conversations</h2>
            <div className="space-y-2">
              {history?.map((h) => (
                <div key={h.id} className="flex items-start gap-1">
                  <Button
                    variant="ghost"
                    className="min-h-11 flex-1 justify-start whitespace-normal text-left text-sm"
                    onClick={() => {
                      setScope(scopeSchema.parse(h.scope));
                      setThread(h.id);
                      setRequestId(null);
                    }}
                  >
                    {h.title}
                  </Button>
                  <Button
                    variant="ghost"
                    aria-label={`Archive ${h.title}`}
                    onClick={() =>
                      void archive({ id: h.id })
                        .then(() => {
                          if (thread === h.id) {
                            setThread(null);
                            setRequestId(null);
                          }
                        })
                        .catch((e) => setError(errorMessage(safeError(e))))
                    }
                  >
                    ×
                  </Button>
                </div>
              ))}
            </div>
            {turns && (
              <div className="mt-4 space-y-2 border-t pt-4">
                {turns.map((t) => (
                  <Button
                    variant="outline"
                    key={t.id}
                    className="w-full justify-start"
                    onClick={() => setRequestId(t.id)}
                  >
                    {new Date(t.created_at).toLocaleString()} · {t.status}
                  </Button>
                ))}
              </div>
            )}
          </section>
          {settings.owner && settings.config && (
            <Settings
              config={settings.config}
              version={settings.version}
              model={settings.model ?? ""}
              configured={!!settings.secret_configured}
              approved={!!settings.security_approved}
            />
          )}
          {settings.admin && <Health />}
        </aside>
      </div>
    </>
  );
}
function LocationPicker({
  scope,
  change,
}: {
  scope: Scope;
  change: (s: Scope) => void;
}) {
  const options = useQuery(api.inventory.options, {});
  return (
    <label className="grid gap-2 text-sm">
      Inventory location
      <select
        className={inputClass}
        value={scope.location_id}
        onChange={(e) => change({ ...scope, location_id: e.target.value })}
      >
        <option value="">Choose a location</option>
        {options?.locations.map((x) => (
          <option key={x._id} value={x._id}>
            {x.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function Response({
  id,
  onThread,
}: {
  id: Id<"ai_requests">;
  onThread: (id: Id<"ai_conversations">) => void;
}) {
  const [feedbackError, setFeedbackError] = useState("");
  const r = useQuery(api.ai.result, { id }),
    feedback = useMutation(api.ai.feedback);
  if (!r) return <LoadingState />;
  const out = r.output;
  return (
    <section
      className="space-y-5 rounded-2xl border bg-card p-5 sm:p-7"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <StatusBadge>AI {out?.draft ? "Draft" : "Summary"}</StatusBadge>
        <Button variant="ghost" onClick={() => onThread(r.conversation_id)}>
          Continue this conversation
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Requested {new Date(r.created_at).toLocaleString()} · Recommendation
        based on recorded Glara OS data.
      </p>
      {feedbackError && <p role="alert">{feedbackError}</p>}
      {r.stale && (
        <p role="status">The evidence changed. Ask again for a fresh answer.</p>
      )}
      {r.error && <p role="alert">{errorMessage(r.error)}</p>}
      {["queued", "running"].includes(r.status) && (
        <p role="status">
          Gathering authorized evidence and preparing a response…
        </p>
      )}
      {r.status === "cancelled" && <p>Request cancelled.</p>}
      {out && (
        <>
          <div>
            <h2 className="font-semibold">Answer</h2>
            <p className="mt-2 whitespace-pre-wrap break-words">{out.answer}</p>
          </div>
          <div>
            <h3 className="font-semibold">Why</h3>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm">
              {out.why}
            </p>
          </div>
          <StatusBadge>{out.evidence_state} evidence</StatusBadge>
          {out.draft && (
            <div className="space-y-2 rounded-xl bg-muted p-4">
              <h3 className="font-semibold">Draft · review before use</h3>
              <textarea
                aria-label="Editable AI draft"
                className={inputClass + " min-h-40"}
                defaultValue={out.draft}
              />
              <p className="text-xs text-muted-foreground">
                Edit or copy this draft. Nothing is sent.
              </p>
            </div>
          )}
          {out.recommendations.length > 0 && (
            <div>
              <h3 className="font-semibold">AI Recommendations</h3>
              <ul className="mt-2 list-disc space-y-2 pl-5 text-sm">
                {out.recommendations.map((x, i) => (
                  <li key={i}>{x.text}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <h3 className="font-semibold">Evidence</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {r.evidence
                .filter((e) => out.evidence_ids.includes(e.key))
                .map((e) => (
                  <Link
                    key={e.key}
                    className="rounded-lg border px-3 py-3 text-sm underline underline-offset-4"
                    href={e.route}
                  >
                    {e.label} · {e.kind.replaceAll("_", " ")}
                  </Link>
                ))}
            </div>
          </div>
          {out.limitations.map((x, i) => (
            <p className="text-sm text-muted-foreground" key={i}>
              {x}
            </p>
          ))}
          <label className="grid gap-2 text-sm">
            Was this useful?
            <select
              className={inputClass}
              defaultValue=""
              onChange={(e) => {
                if (e.target.value)
                  void feedback({ id, kind: e.target.value, reason: "" }).catch(
                    (e) => setFeedbackError(errorMessage(safeError(e))),
                  );
              }}
            >
              <option value="">Choose feedback</option>
              {[
                "helpful",
                "not_helpful",
                "incorrect_data",
                "missing_context",
                "bad_recommendation",
                "unsafe_suggestion",
              ].map((x) => (
                <option key={x} value={x}>
                  {x.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
      {r.proposal && <Proposal value={r.proposal} stale={r.stale} />}
    </section>
  );
}
function Proposal({
  value: p,
  stale,
}: {
  value: NonNullable<
    NonNullable<ReturnType<typeof useQuery<typeof api.ai.result>>>["proposal"]
  >;
  stale: boolean;
}) {
  const decide = useMutation(api.ai.decide),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="rounded-xl border-2 p-4">
      <h3 className="font-semibold">Proposed follow-up · {p.status}</h3>
      <p className="my-2 text-sm">{p.rationale}</p>
      <p className="mb-3 text-xs text-muted-foreground">
        No task is created until you approve. Expires{" "}
        {new Date(p.expires_at).toLocaleString()}.
      </p>
      {p.status === "proposed" && (
        <form
          className="space-y-3"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const form = new FormData(e.currentTarget);
            try {
              await decide({
                id: p._id,
                decision: "approve",
                input: JSON.stringify({
                  ...p.payload,
                  title: form.get("title"),
                  description: form.get("description"),
                  due_at: new Date(String(form.get("due_at"))).toISOString(),
                  priority: form.get("priority"),
                }),
              });
            } catch (e) {
              setError(errorMessage(safeError(e)));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field
            label="Task title"
            name="title"
            value={p.payload.title}
            required
          />
          <Field
            label="Description"
            name="description"
            type="textarea"
            value={p.payload.description}
          />
          <Field
            label="Due date and time"
            name="due_at"
            type="datetime-local"
            value={new Date(
              Date.parse(p.payload.due_at) -
                new Date(p.payload.due_at).getTimezoneOffset() * 60000,
            )
              .toISOString()
              .slice(0, 16)}
            required
          />
          <Field
            label="Priority"
            name="priority"
            options={
              p.scope.feature === "realtor" ? ["normal", "high"] : ["normal"]
            }
            value={p.payload.priority}
          />
          <p className="text-sm">
            Assigned to you. Reassign through the normal task workflow if
            needed.
          </p>
          <div className="flex gap-2">
            <Button disabled={busy || stale}>Approve task</Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={async () => {
                try {
                  await decide({ id: p._id, decision: "reject" });
                } catch (e) {
                  setError(errorMessage(safeError(e)));
                }
              }}
            >
              Reject
            </Button>
          </div>
        </form>
      )}
      {p.status === "executed" && (
        <p>Task created through the existing Glara OS workflow.</p>
      )}
      {error && (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
function Settings({
  config,
  version,
  model,
  configured,
  approved,
}: {
  config: Config;
  version: number;
  model: string;
  configured: boolean;
  approved: boolean;
}) {
  const save = useMutation(api.ai.saveSettings),
    [error, setError] = useState("");
  const labels: Partial<Record<keyof Config, string>> = {
    max_output_tokens: "Maximum response tokens",
    timeout_ms: "Timeout (milliseconds)",
    daily_requests: "Requests per person / day",
    per_minute: "Requests per person / minute",
    daily_budget_micros: "Company daily budget (USD micros)",
    monthly_budget_micros: "Company monthly budget (USD micros)",
    input_micros_per_million: "Input price (USD micros / million tokens)",
    output_micros_per_million: "Output price (USD micros / million tokens)",
  };
  return (
    <details className="rounded-2xl border bg-card p-5">
      <summary className="min-h-11 cursor-pointer font-semibold">
        AI settings
      </summary>
      <p className="my-3 text-sm">
        OpenAI · {model}
        <br />
        Secret configured: {configured ? "Yes" : "No"}
        <br />
        Server security approval: {approved ? "Yes" : "No"}
      </p>
      <p className="mb-4 text-xs text-muted-foreground">
        Configure verified provider prices before enabling. 1 USD = 1,000,000
        micros. Retention is subject to your provider agreement.
      </p>
      <form
        key={version}
        className="space-y-3"
        onSubmit={async (e) => {
          e.preventDefault();
          setError("");
          const d = new FormData(e.currentTarget),
            next = {
              ...config,
              enabled: d.has("enabled"),
              proposals: d.has("proposals"),
              retention_acknowledged: d.has("retention_acknowledged"),
              features: d.getAll("features"),
            };
          for (const key of Object.keys(labels))
            Object.assign(next, { [key]: Number(d.get(key)) });
          try {
            await save({ version, input: JSON.stringify(next) });
          } catch (e) {
            setError(errorMessage(safeError(e)));
          }
        }}
      >
        {["enabled", "proposals", "retention_acknowledged"].map((k) => (
          <label className="flex min-h-11 items-center gap-3 text-sm" key={k}>
            <input
              type="checkbox"
              name={k}
              defaultChecked={Boolean(config[k as keyof Config])}
            />
            {k.replaceAll("_", " ")}
          </label>
        ))}
        <fieldset>
          <legend className="text-sm font-medium">Enabled experiences</legend>
          {features
            .filter((x) => x !== "navigation")
            .map((f) => (
              <label
                className="flex min-h-11 items-center gap-3 text-sm"
                key={f}
              >
                <input
                  type="checkbox"
                  name="features"
                  value={f}
                  defaultChecked={config.features.includes(f)}
                />
                {names[f]}
              </label>
            ))}
        </fieldset>
        {Object.entries(labels).map(([key, label]) => (
          <Field
            key={key}
            name={key}
            label={label}
            type="number"
            value={Number(config[key as keyof Config])}
            required
          />
        ))}
        <Button>Save AI settings</Button>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </details>
  );
}
function Health() {
  const h = useQuery(api.ai.health, {});
  return (
    <details className="rounded-2xl border bg-card p-5">
      <summary className="min-h-11 cursor-pointer font-semibold">
        AI health
      </summary>
      <p className="my-3 text-sm">
        Provider configuration: {h?.provider_ready ? "Ready" : "Pending"}
      </p>
      {h?.day && (
        <p className="text-sm">
          Today: {h.day.requests} requests ·{" "}
          {(h.day.charged_micros / 1000000).toFixed(4)} USD charged estimate ·{" "}
          {h.day.input_tokens + h.day.output_tokens} tokens
        </p>
      )}
      {h?.month && (
        <p className="mt-3 text-sm">
          Month: {(h.month.charged_micros / 1000000).toFixed(4)} USD estimated ·{" "}
          {(h.month.reserved_micros / 1000000).toFixed(4)} USD reserved
        </p>
      )}
      {h &&
        [...h.features, ...h.models, ...h.users].map((x) => (
          <p className="mt-3 break-all text-xs" key={x.key}>
            {x.key}: {x.requests} requests ·{" "}
            {(x.charged_micros / 1000000).toFixed(4)} USD · {x.failures}{" "}
            failures · {x.requests ? Math.round(x.latency_ms / x.requests) : 0}{" "}
            ms average provider time
          </p>
        ))}
      {h?.recent_failures.map((x) => (
        <p className="mt-3 text-xs" key={x.id}>
          {x.feature}: {errorMessage(x.error ?? "AI_UNAVAILABLE")}
        </p>
      ))}
    </details>
  );
}
