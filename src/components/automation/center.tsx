"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, usePaginatedQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";
import {
  PageTitle,
  LoadingState,
  EmptyState,
  StatusBadge,
} from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Field, SalesForm, inputClass } from "@/components/sales/shared";
import { Panel } from "@/components/analytics/shared";
import {
  domains,
  sourceTables,
  template,
  type SourceTable,
} from "@/lib/automation/model";
import { classifyCrmError } from "@/lib/crm/errors";
function SafeButton({
  children,
  run,
}: {
  children: React.ReactNode;
  run: () => Promise<unknown>;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await run();
          } catch (e) {
            setError(classifyCrmError(e).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? "Working…" : children}
      </Button>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
}
function More({ status, load }: { status: string; load: () => void }) {
  return status === "CanLoadMore" ? (
    <Button variant="outline" onClick={load}>
      Load more
    </Button>
  ) : null;
}
export function AutomationCenter() {
  const [tab, setTab] = useState("Rules");
  return (
    <div className="space-y-6">
      <PageTitle
        title="Automation Center"
        description="Clear next steps. Accountable follow-through. Internal reminders only."
      />
      <div aria-label="Automation sections" className="flex flex-wrap gap-2">
        {[
          "Rules",
          "Active Actions",
          "Escalations",
          "Failures",
          "History",
          "Settings",
        ].map((t) => (
          <Button
            key={t}
            variant={tab === t ? "default" : "outline"}
            aria-pressed={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </Button>
        ))}
      </div>
      {tab === "Rules" ? (
        <Rules />
      ) : tab === "Active Actions" || tab === "Escalations" ? (
        <AutomatedTasks manager escalations={tab === "Escalations"} />
      ) : tab === "Failures" ? (
        <Health />
      ) : tab === "History" ? (
        <History />
      ) : (
        <Settings />
      )}
    </div>
  );
}
function Rules() {
  const rows = useQuery(api.automation.rules, {}),
    initialize = useMutation(api.automation.initialize);
  if (!rows) return <LoadingState />;
  return (
    <div className="space-y-6">
      {rows.some((r) => !r.record) && (
        <Panel
          title="Prepare your rule library"
          note="All defaults are disabled. Configure and activate each rule explicitly."
        >
          <SafeButton run={() => initialize({})}>
            Initialize disabled rules
          </SafeButton>
        </Panel>
      )}
      {domains.map((domain) => (
        <Panel key={domain} title={domain[0].toUpperCase() + domain.slice(1)}>
          <div className="grid gap-4 lg:grid-cols-2">
            {rows
              .filter((r) => r.domain === domain)
              .map((r) => (
                <details key={r.key} className="rounded-xl border p-4">
                  <summary className="min-h-11 cursor-pointer font-medium">
                    {r.name}
                    <span className="ml-3 text-xs text-muted-foreground">
                      {r.record?.config.enabled ? "Enabled" : "Disabled"} · v
                      {r.record?.version ?? 1}
                    </span>
                  </summary>
                  <p className="my-3 text-sm text-muted-foreground">
                    {r.description}
                  </p>
                  <p className="mb-5 text-xs">Clock: {r.clock}</p>
                  {r.record ? (
                    <div className="space-y-5">
                      <RuleForm key={r.record.version} rule={r.record} />
                      <RuleStats id={r.record._id} />
                    </div>
                  ) : (
                    <p>Initialize the library to configure this rule.</p>
                  )}
                </details>
              ))}
          </div>
        </Panel>
      ))}
    </div>
  );
}
function RuleForm({ rule }: { rule: Doc<"automation_rules"> }) {
  const team = useQuery(api.automation.team, {});
  const save = useMutation(api.automation.saveRule),
    c = rule.config;
  return (
    <SalesForm
      submit="Save rule version"
      expectedVersion={rule.version}
      onSave={(d) =>
        save({
          id: rule._id,
          version: rule.version,
          config: {
            enabled: d.enabled === "enabled",
            entity_ids: c.entity_ids,
            delay_days: Number(d.delay),
            cooldown_days: Number(d.cooldown),
            priority: d.priority as typeof c.priority,
            assignment: d.assignment as typeof c.assignment,
            user_id: d.user_id || null,
            escalation_days: [d.first, d.second].filter(Boolean).map(Number),
            minimum_cents: d.minimum,
            activation: d.activation as typeof c.activation,
            daily_limit: Number(d.limit),
          },
        })
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="State"
          name="enabled"
          value={c.enabled ? "enabled" : "disabled"}
          options={["disabled", "enabled"]}
        />
        <Field
          label="Delay / advance window (days)"
          name="delay"
          type="number"
          value={c.delay_days}
        />
        <Field
          label="Cooldown (days)"
          name="cooldown"
          type="number"
          value={c.cooldown_days}
        />
        <Field
          label="Priority"
          name="priority"
          value={c.priority}
          options={["normal", "high", "urgent"]}
        />
        <Field
          label="Assign to"
          name="assignment"
          value={c.assignment}
          options={[
            "entity_owner",
            "project_manager",
            "admin",
            "owner",
            "specific_user",
          ]}
        />
        <label className="grid gap-2 text-sm font-medium">
          Specific team member
          <select
            className={inputClass}
            name="user_id"
            defaultValue={c.user_id ?? ""}
          >
            <option value="">Use assignment strategy</option>
            {team?.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} · {u.roles.join(", ")}
              </option>
            ))}
          </select>
        </label>
        <Field
          label="Escalate to Admin after days"
          name="first"
          type="number"
          value={c.escalation_days[0]}
        />
        <Field
          label="Escalate to Owner after days"
          name="second"
          type="number"
          value={c.escalation_days[1]}
        />
        <Field
          label="Minimum amount (CAD cents)"
          name="minimum"
          value={c.minimum_cents}
        />
        <Field
          label="Daily action limit"
          name="limit"
          type="number"
          value={c.daily_limit}
        />
        <Field
          label="Activation scope"
          name="activation"
          value={c.activation}
          options={["current", "future"]}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Current evaluates actionable backlog after an explicit scan. Future
        includes records created after activation. Unavailable assignees fall
        back to Admin, then Owner.
      </p>
    </SalesForm>
  );
}
export function AutomatedTasks({
  manager = false,
  escalations = false,
}: {
  manager?: boolean;
  escalations?: boolean;
}) {
  const { results, status, loadMore } = usePaginatedQuery(
    api.automation.actions,
    { status: "active" },
    { initialNumItems: 20 },
  );
  return (
    <Panel
      title="My automated tasks"
      note="Completing a task records your work. The source condition resolves separately."
    >
      <div className="space-y-4">
        {status === "LoadingFirstPage" ? (
          <LoadingState />
        ) : results.filter((a) => !escalations || a.level > 0).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No matching actions on this page.
          </p>
        ) : (
          results
            .filter((a) => !escalations || a.level > 0)
            .map((a) => <ActionCard key={a._id} action={a} manager={manager} />)
        )}
        <More status={status} load={() => loadMore(20)} />
      </div>
    </Panel>
  );
}
function ActionCard({
  action: a,
  manager,
}: {
  action: Doc<"automation_actions"> & { task?: Doc<"activities"> | null };
  manager: boolean;
}) {
  const change = useMutation(api.automation.changeAction),
    suppress = useMutation(api.automation.suppress),
    [op, setOp] = useState<"complete" | "snooze" | "resolve">("complete");
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setClock(Date.now()), 30000);
    return () => clearInterval(timer);
  }, []);
  return (
    <article data-action-id={a._id} className="rounded-xl border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link
          href={a.href}
          className="font-medium underline-offset-4 hover:underline"
        >
          {a.reason}
        </Link>
        <StatusBadge>
          {a.snoozed_until > clock
            ? `Snoozed until ${new Date(a.snoozed_until).toLocaleDateString("en-CA")}`
            : `${a.priority}${a.level ? ` · escalation ${a.level}` : ""}`}
        </StatusBadge>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        Cycle {a.cycle} · rule v{a.rule_version} ·{" "}
        {new Date(a.created_at).toLocaleDateString("en-CA")}
        {a.task_completed_at || a.task?.status === "completed"
          ? " · task complete, source still open"
          : ""}
      </p>
      {a.task &&
        a.task.status === "open" &&
        (a.task.realtor_id || a.task.opportunity_id) && (
          <Link
            className="mt-3 inline-block min-h-11 rounded-lg border px-3 py-2 text-sm"
            href={`/communications?activity=${a.activity_id}`}
          >
            Prepare communication
          </Link>
        )}
      <details className="mt-4">
        <summary className="min-h-11 cursor-pointer text-sm font-medium">
          Update action
        </summary>
        <div className="mt-3 space-y-4">
          <label className="grid gap-2 text-sm">
            Action
            <select
              className={inputClass}
              value={op}
              onChange={(e) => setOp(e.target.value as typeof op)}
            >
              <option value="complete">Complete task</option>
              <option value="snooze">Snooze</option>
              {manager && (
                <option value="resolve">
                  Resolve exception · suppress 1 day
                </option>
              )}
            </select>
          </label>
          <SalesForm
            submit="Apply action"
            onSave={(d) =>
              change({
                id: a._id,
                updated_at: a.updated_at,
                op,
                reason: d.reason,
                ...(op === "snooze" ? { days: Number(d.days) } : {}),
              })
            }
          >
            <Field label="Reason" name="reason" required />
            {op === "snooze" && (
              <Field
                label="Snooze days (1–30)"
                name="days"
                type="number"
                value={1}
              />
            )}
          </SalesForm>
          {manager && (
            <details>
              <summary className="min-h-11 cursor-pointer text-sm">
                Suppress this condition
              </summary>
              <SalesForm
                submit="Suppress condition"
                onSave={(d) =>
                  suppress({
                    table: a.table,
                    entity_id: a.entity_id,
                    family: a.family,
                    days: Number(d.days),
                    reason: d.reason,
                  })
                }
              >
                <Field
                  label="Suppression days (1–90)"
                  name="days"
                  type="number"
                  value={7}
                />
                <Field label="Suppression reason" name="reason" required />
              </SalesForm>
            </details>
          )}
        </div>
      </details>
    </article>
  );
}
function History() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.automation.history,
    {},
    { initialNumItems: 20 },
  );
  return (
    <Panel
      title="Execution history"
      note="Immutable rule versions and observed outcomes. Revenue causation is not inferred."
    >
      <div className="space-y-3">
        {results.map((r) => (
          <details key={r._id} className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm">
              {r.status.replaceAll("_", " ")} · v{r.rule_version} ·{" "}
              {new Date(r.evaluated_at).toLocaleString()}
            </summary>
            <p className="my-3 text-sm">{r.reason}</p>
            <dl className="text-xs text-muted-foreground">
              <dt>Trigger</dt>
              <dd className="break-all">{r.trigger || "No active trigger"}</dd>
              <dt>Actor</dt>
              <dd>{r.actor_kind}</dd>
              <dt>Policy</dt>
              <dd>
                {r.config.delay_days} days · cooldown {r.config.cooldown_days}{" "}
                days · {r.config.priority}
              </dd>
            </dl>
          </details>
        ))}
        {status === "Exhausted" && !results.length && <p>No executions yet.</p>}
        <More status={status} load={() => loadMore(20)} />
      </div>
    </Panel>
  );
}
function Health() {
  const h = useQuery(api.automation.health, {}),
    retry = useMutation(api.automation.retry);
  if (!h) return <LoadingState />;
  return (
    <Panel
      title="Automation health"
      note="Three bounded retries, then Owner/Admin review. Error details remain server-side."
    >
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        {[
          ["Due queue", `${h.due}${h.more ? "+" : ""}`],
          ["Oldest lag", `${Math.floor(h.lag_ms / 60000)} min`],
          ["Failed sources", `${h.failed.length}${h.failed_more ? "+" : ""}`],
        ].map(([label, value]) => (
          <div className="rounded-xl bg-muted p-4" key={label}>
            <p className="text-xs">{label}</p>
            <strong className="mt-2 block text-2xl">{value}</strong>
          </div>
        ))}
      </div>
      {h.failed.map((f) => (
        <div
          key={f._id}
          className="flex flex-wrap items-center justify-between gap-3 border-t py-4"
        >
          <p>
            {f.table} · {f.last_code} · {f.attempts} attempts
          </p>
          <SafeButton run={() => retry({ id: f._id })}>Retry safely</SafeButton>
        </div>
      ))}
      {h.limited.length > 0 && (
        <p role="status">
          {h.limited.length} recent daily limits reached. Review rule volumes
          before changing limits.
        </p>
      )}
    </Panel>
  );
}
function Settings() {
  const scan = useMutation(api.automation.scanBatch),
    execute = useMutation(api.automation.repair),
    [entity, setEntity] = useState(""),
    [table, setTable] = useState<SourceTable>("opportunities"),
    [target, setTarget] = useState<{
      table: SourceTable;
      entity_id: string;
    } | null>(null),
    preview = useQuery(api.automation.preview, target ?? "skip"),
    [progress, setProgress] = useState("");
  return (
    <div className="space-y-6">
      <Panel
        title="Backlog enrollment"
        note="Each click enrolls up to 20 existing source records. Enabled rules evaluate current actionable conditions. This is resumable; it never changes business facts."
      >
        <SafeButton
          run={async () => {
            const r = await scan({});
            setProgress(
              r.done
                ? "Enrollment complete."
                : `${r.count} records enrolled. Continue the next batch.`,
            );
          }}
        >
          Enroll next batch
        </SafeButton>
        <p role="status" className="mt-3 text-sm">
          {progress}
        </p>
      </Panel>
      <Panel
        title="Preview & reconcile one source"
        note="Preview is read only. Evaluate / repair is an explicit action using the current enabled rules."
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-2 text-sm">
            Source
            <select
              className={inputClass}
              value={table}
              onChange={(e) => setTable(e.target.value as SourceTable)}
            >
              {sourceTables.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </label>
          <label className="grid gap-2 text-sm">
            Record ID
            <input
              className={inputClass}
              value={entity}
              onChange={(e) => setEntity(e.target.value)}
            />
          </label>
        </div>
        <Button
          className="mt-4"
          onClick={() => setTarget({ table, entity_id: entity })}
        >
          Preview conditions
        </Button>
        {preview && (
          <div className="my-5 space-y-3">
            {preview.map((g) => (
              <div key={g.key} className="rounded-lg border p-4">
                <p>
                  {g.family.replaceAll("_", " ")} · {g.drift}
                  {g.suppressed ? " · suppressed" : ""}
                </p>
                {g.rules.map((r) => (
                  <p key={r.key} className="mt-2 text-sm text-muted-foreground">
                    {template(r.key).name}:{" "}
                    {r.eligible ? "eligible" : "not eligible"}
                    {r.enabled ? "" : " · disabled"} — {r.reason}
                  </p>
                ))}
              </div>
            ))}
            {target && (
              <SafeButton run={() => execute(target)}>
                Evaluate / repair this source
              </SafeButton>
            )}
          </div>
        )}
      </Panel>
    </div>
  );
}
export function NotificationCenter() {
  const [resolved, setResolved] = useState(false),
    [filter, setFilter] = useState("all"),
    { results, status, loadMore } = usePaginatedQuery(
      api.automation.notifications,
      { resolved },
      { initialNumItems: 20 },
    ),
    read = useMutation(api.automation.readNotification);
  return (
    <div className="space-y-6">
      <PageTitle
        title="Notifications"
        description="Your internal updates, with a clear next step."
      />
      <div className="flex flex-wrap gap-2">
        {["all", "unread", "urgent", "today", "resolved"].map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            onClick={() => {
              setFilter(f);
              setResolved(f === "resolved");
            }}
          >
            {f[0].toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>
      {status === "LoadingFirstPage" ? (
        <LoadingState />
      ) : !results.length ? (
        <EmptyState
          title="You’re up to date"
          description="Internal reminders will appear here when an enabled rule needs your attention."
        />
      ) : (
        results
          .filter((n) => filter !== "unread" || !n.read_at)
          .filter((n) => filter !== "urgent" || n.priority === "urgent")
          .filter(
            (n) =>
              filter !== "today" ||
              new Date(n.created_at).toDateString() ===
                new Date().toDateString(),
          )
          .map((n) => (
            <article className="rounded-xl border bg-card p-5" key={n._id}>
              <div className="flex flex-wrap justify-between gap-3">
                <h2 className="font-semibold">{n.title}</h2>
                <StatusBadge>{n.priority}</StatusBadge>
              </div>
              <p className="my-3 text-sm text-muted-foreground">{n.message}</p>
              <div className="flex flex-wrap items-center gap-4">
                <Link className="text-sm font-medium underline" href={n.href}>
                  Open source
                </Link>
                {!n.read_at && (
                  <SafeButton run={() => read({ id: n._id })}>
                    Mark read
                  </SafeButton>
                )}
              </div>
            </article>
          ))
      )}
      <More status={status} load={() => loadMore(20)} />
      <AutomatedTasks />
    </div>
  );
}

function RuleStats({ id }: { id: Doc<"automation_rules">["_id"] }) {
  const data = useQuery(api.automation.effectiveness, { rule_id: id });
  if (!data) return null;
  return (
    <div className="border-t pt-4 text-xs text-muted-foreground">
      <p>
        {data.scope}
        {data.partial || data.actions_partial ? " · partial sample" : ""}
      </p>
      <p className="mt-2">
        {data.created} created · {data.completed_tasks} tasks completed ·{" "}
        {data.escalated} escalations · {data.unresolved} unresolved ·{" "}
        {data.suppressed} suppressed
      </p>
      <p className="mt-2">
        Average response:{" "}
        {data.average_response_hours === null
          ? "No completed task yet"
          : data.average_response_hours.toFixed(1) + " hours"}
      </p>
    </div>
  );
}
