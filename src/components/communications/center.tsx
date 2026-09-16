"use client";
import Link from "next/link";
import { ReconciliationReview } from "./reconciliation";
import { DraftHandoff } from "./handoff";
import { vancouverUtc } from "@/lib/operations/time";
import { useState } from "react";
import {
  useQuery,
  useMutation,
  usePaginatedQuery,
  useAction,
} from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id, Doc } from "../../../convex/_generated/dataModel";
import {
  PageTitle,
  LoadingState,
  EmptyState,
  StatusBadge,
} from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Field, inputClass } from "@/components/sales/shared";
import {
  categories,
  states,
  type State,
  editable,
  type Category,
} from "@/lib/communications/model";
import { communicationError } from "@/lib/communications/errors";
import { CalendarConnections } from "./calendar";
const panel = "rounded-2xl border bg-card p-5 sm:p-7 space-y-4";
function useWork() {
  const [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  return {
    busy,
    notice,
    run: async (work: () => Promise<unknown>) => {
      setBusy(true);
      setNotice("");
      try {
        await work();
        setNotice("Saved.");
      } catch (e) {
        setNotice(communicationError(e));
      } finally {
        setBusy(false);
      }
    },
  };
}
export function CommunicationsCenter({
  activityId,
  aiId,
  messageId,
}: {
  messageId?: Id<"communications">;
  activityId?: Id<"activities">;
  aiId?: Id<"ai_requests">;
}) {
  const config = useQuery(api.communications.configuration, {}),
    [tab, setTab] = useState(activityId || aiId ? "New message" : "Messages"),
    [selected, setSelected] = useState<Id<"communications"> | null>(
      messageId ?? null,
    );
  const [filter, setFilter] = useState<State | "">(""),
    [search, setSearch] = useState("");
  const list = usePaginatedQuery(
    api.communications.list,
    { status: filter || undefined, search: search || undefined },
    { initialNumItems: 20 },
  );
  if (!config) return <LoadingState />;
  return (
    <>
      <PageTitle
        title="Communications"
        description="Thoughtful messages. Clear approvals. A complete delivery history."
      />
      <div className="mb-6 flex flex-wrap gap-2">
        {[
          "Messages",
          "New message",
          ...(config.manager
            ? ["Templates", "Preferences", "Settings", "Calendar"]
            : []),
        ].map((name) => (
          <Button
            variant={tab === name ? "default" : "outline"}
            key={name}
            aria-pressed={tab === name}
            onClick={() => {
              setTab(name);
              setSelected(null);
            }}
          >
            {name}
          </Button>
        ))}
      </div>
      {!config.enabled && (
        <p className="mb-6 rounded-xl border bg-muted p-4 text-sm">
          Email delivery is disabled. You can prepare and review drafts; sending
          requires verified development configuration.
        </p>
      )}
      {tab === "Messages" && (
        <div className="grid gap-6 xl:grid-cols-[minmax(250px,1fr)_2fr]">
          <section className={panel}>
            <h2 className="text-lg font-semibold">Messages</h2>
            <label className="grid gap-2 text-sm">
              Search subject
              <input
                type="search"
                maxLength={100}
                className={inputClass}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <label className="grid gap-2 text-sm">
              Status
              <select
                className={inputClass}
                value={filter}
                onChange={(e) => setFilter(e.target.value as State | "")}
              >
                <option value="">All statuses</option>
                {states.map((s) => (
                  <option key={s} value={s}>
                    {s.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            {list.results.length === 0 ? (
              <EmptyState
                title="Start a conversation"
                description="Create a draft from a relationship or business record."
              />
            ) : (
              list.results.map((row) => (
                <button
                  key={row._id}
                  onClick={() => setSelected(row._id)}
                  className="block w-full rounded-xl border p-4 text-left hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring"
                >
                  <span className="mb-2 block font-medium">{row.subject}</span>
                  <StatusBadge>{row.status.replaceAll("_", " ")}</StatusBadge>
                  <span className="mt-2 block text-xs text-muted-foreground">
                    {new Date(row.created_at).toLocaleDateString()}
                  </span>
                </button>
              ))
            )}
            {list.status === "CanLoadMore" && (
              <Button variant="outline" onClick={() => list.loadMore(20)}>
                Load more
              </Button>
            )}
          </section>
          {selected ? (
            <MessageReview key={selected} id={selected} />
          ) : (
            <EmptyState
              title="Every send starts with a review"
              description="Select a message to check its recipient, source, eligibility, and delivery evidence."
            />
          )}
        </div>
      )}
      {tab === "New message" && (activityId || aiId) && (
        <DraftHandoff
          activityId={activityId}
          aiId={aiId}
          onCreated={(id) => {
            setSelected(id);
            setTab("Messages");
          }}
        />
      )}
      {tab === "New message" && !activityId && !aiId && (
        <Compose
          defaultCategory={config.default_category}
          onCreated={(id) => {
            setSelected(id);
            setTab("Messages");
          }}
        />
      )}
      {tab === "Templates" && <Templates />}
      {tab === "Preferences" && <Preferences />}
      {tab === "Settings" && <Settings />}
      {tab === "Calendar" && <CalendarConnections />}
    </>
  );
}
function Compose({
  onCreated,
  defaultCategory,
}: {
  defaultCategory: Category;
  onCreated: (id: Id<"communications">) => void;
}) {
  const [category, setCategory] = useState<Category>(defaultCategory),
    [sourceIndex, setSourceIndex] = useState(""),
    sources = useQuery(api.communications.sources, { category }),
    templates = useQuery(api.communications.templates, {}),
    create = useMutation(api.communications.create),
    work = useWork();
  return (
    <form
      className={panel + " max-w-3xl"}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget),
          source = sources?.rows[Number(sourceIndex)];
        if (!source || sourceIndex === "") return;
        void work.run(async () =>
          onCreated(
            await create({
              source: source.source,
              recipient: source.recipient,
              subject: String(data.get("subject")),
              body: String(data.get("body")),
              category,
              request_key: crypto.randomUUID(),
              template_version_id: (String(data.get("template")) ||
                undefined) as Id<"communication_template_versions"> | undefined,
            }),
          ),
        );
      }}
    >
      <h2 className="text-xl font-semibold">Prepare a message</h2>
      <label className="grid gap-2 text-sm">
        Purpose
        <select
          aria-label="Purpose"
          className={inputClass}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as Category);
            setSourceIndex("");
          }}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm">
        Recipient and source
        <select
          className={inputClass}
          value={sourceIndex}
          onChange={(e) => setSourceIndex(e.target.value)}
          required
        >
          <option value="">Select a record</option>
          {sources?.rows.map((s, i) => (
            <option key={`${s.source.type}:${s.source.id}`} value={i}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        Recent authorized records are shown. The recipient email comes from the
        source record.
      </p>
      <label className="grid gap-2 text-sm">
        Template
        <select className={inputClass} name="template">
          <option value="">Manual relationship message</option>
          {templates
            ?.filter((t) => t.category === category && t.current)
            .map((t) => (
              <option value={t.current!._id} key={t._id}>
                {t.name} Â· version {t.version}
              </option>
            ))}
        </select>
      </label>
      <p className="text-xs text-muted-foreground">
        Business confirmations use a template with current source facts. Its
        rendered text replaces the working subject and body at review.
      </p>
      <Field name="subject" label="Working subject" required />
      <Field name="body" label="Working message" type="textarea" required />
      <Button disabled={work.busy}>Save draft</Button>
      <p role="status" className="text-sm">
        {work.notice}
      </p>
    </form>
  );
}
function MessageReview({ id }: { id: Id<"communications"> }) {
  const [schedule, setSchedule] = useState("");
  const config = useQuery(api.communications.configuration, {}),
    templates = useQuery(api.communications.templates, {});
  const requestReview = useMutation(api.communications.requestReview),
    unknown = useAction(api.communicationProvider.reconcileUnknown);
  const history = usePaginatedQuery(
    api.communications.deliveryHistory,
    { id },
    { initialNumItems: 20 },
  );
  const data = useQuery(api.communications.get, { id }),
    approve = useMutation(api.communications.approve),
    enqueue = useMutation(api.communications.enqueue),
    cancel = useMutation(api.communications.cancel),
    edit = useMutation(api.communications.edit),
    reconcile = useAction(api.communicationProvider.reconcile),
    work = useWork();
  if (!data) return <LoadingState />;
  const { row, eligibility } = data;
  const preview = editable(row.status)
    ? eligibility
    : (row.snapshot ?? eligibility);
  return (
    <section className={panel}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Message review</h2>
        <StatusBadge>{row.status.replaceAll("_", " ")}</StatusBadge>
      </div>
      <dl className="grid gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Recipient</dt>
          <dd className="break-all">{preview.email}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Purpose</dt>
          <dd>{row.category.replaceAll("_", " ")}</dd>
        </div>
      </dl>
      <div className="rounded-xl border p-4">
        <h3 className="font-semibold">{preview.subject}</h3>
        <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7">
          {preview.body}
        </p>
        <p className="mt-5 whitespace-pre-wrap text-sm text-muted-foreground">
          {preview.signature}
        </p>
      </div>
      {editable(row.status) && (
        <details>
          <summary className="cursor-pointer text-sm font-medium">
            Edit working draft
          </summary>
          <form
            key={row.version}
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void work.run(() =>
                edit({
                  id,
                  version: row.version,
                  subject: String(f.get("subject")),
                  body: String(f.get("body")),
                  template_version_id: (String(f.get("template")) ||
                    undefined) as
                    Id<"communication_template_versions"> | undefined,
                }),
              );
            }}
          >
            <Field
              name="subject"
              label="Subject"
              value={row.subject}
              required
            />
            <Field
              name="body"
              label="Message"
              value={row.body}
              type="textarea"
            />
            <label className="grid gap-2 text-sm">
              Template version
              <select
                className={inputClass}
                name="template"
                defaultValue={row.template_version_id ?? ""}
              >
                <option value="">Manual relationship message</option>
                {templates
                  ?.filter((t) => t.category === row.category && t.current)
                  .map((t) => (
                    <option key={t._id} value={t.current!._id}>
                      {t.name} Â· version {t.version}
                    </option>
                  ))}
              </select>
            </label>
            <Button disabled={work.busy}>Save edits</Button>
          </form>
        </details>
      )}
      <div className="rounded-xl bg-muted p-4 text-sm">
        <strong>
          {eligibility.allowed
            ? "Eligibility checks passed for review"
            : "Review required"}
        </strong>
        {eligibility.basis.map((b, i) => (
          <p key={i}>
            {b.basis.replaceAll("_", " ")} recorded{" "}
            {new Date(b.observed_at).toLocaleDateString()}
          </p>
        ))}
        {eligibility.reasons.map((r) => (
          <p key={r} className="mt-2">
            {r.replaceAll("_", " ")}
          </p>
        ))}
      </div>
      {editable(row.status) && (
        <label className="grid gap-2 text-sm">
          Send after (Vancouver time, optional)
          <input
            className={inputClass}
            type="datetime-local"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
          />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        {editable(row.status) && (
          <Button
            disabled={work.busy || !eligibility.allowed}
            onClick={() =>
              void work.run(() =>
                approve({
                  id,
                  version: row.version,
                  review_token: eligibility.review_token,
                  scheduled_at: schedule
                    ? Date.parse(vancouverUtc(schedule))
                    : undefined,
                }),
              )
            }
          >
            Approve reviewed message
          </Button>
        )}
        {editable(row.status) && (
          <Button
            variant="outline"
            disabled={work.busy}
            onClick={() =>
              void work.run(() => requestReview({ id, version: row.version }))
            }
          >
            Request another reviewer
          </Button>
        )}
        {row.status === "approved" && (
          <Button
            disabled={work.busy}
            onClick={() =>
              void work.run(() => enqueue({ id, version: row.version }))
            }
          >
            Send approved message to {preview.email}
          </Button>
        )}
        {[
          "draft",
          "approved",
          "queued",
          "needs_review",
          "ineligible",
          "suppressed",
        ].includes(row.status) && (
          <Button
            variant="outline"
            disabled={work.busy}
            onClick={() =>
              void work.run(() => cancel({ id, version: row.version }))
            }
          >
            Cancel message
          </Button>
        )}
        {["sent", "delivery_unknown"].includes(row.status) && (
          <Button
            variant="outline"
            disabled={work.busy}
            onClick={() =>
              void work.run(async () => {
                const r = await reconcile({ id });
                if (r.status === "manual_provider_investigation_required")
                  throw new Error("Provider investigation required.");
              })
            }
          >
            Check delivery evidence
          </Button>
        )}
      </div>
      <p role="status" className="text-sm">
        {work.notice}
      </p>
      {row.status === "delivery_unknown" && config?.manager && (
        <form
          className="space-y-3 rounded-xl border p-4"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            void work.run(async () => {
              const r = await unknown({
                id,
                provider_id: String(f.get("provider_id")),
                reason: String(f.get("reason")),
              });
              if (r.status !== "verified_provider_acceptance")
                throw new Error("Evidence did not match.");
            });
          }}
        >
          <h3 className="font-semibold">Reconcile unknown delivery</h3>
          <p className="text-sm">
            Find the email in the provider dashboard. Glara verifies its
            recipient, content, sender and dispatch time before recording
            acceptance. This does not resend.
          </p>
          <Field name="provider_id" label="Provider message ID" required />
          <Field name="reason" label="Investigation evidence" required />
          <Button variant="outline" disabled={work.busy}>
            Verify provider evidence
          </Button>
        </form>
      )}
      <h3 className="font-semibold">Delivery history</h3>
      {history.results.length ? (
        history.results.map((event) => (
          <p key={event._id} className="text-sm">
            {event.kind.replaceAll("_", " ")} Â·{" "}
            {new Date(event.occurred_at).toLocaleString()}
          </p>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          No provider delivery evidence yet.
        </p>
      )}
      {history.status === "CanLoadMore" && (
        <Button variant="outline" onClick={() => history.loadMore(20)}>
          More delivery history
        </Button>
      )}
      <p className="text-xs text-muted-foreground">
        Sending does not automatically complete a linked follow-up. Provider
        acceptance and inbox delivery are recorded separately.
      </p>
    </section>
  );
}
function Templates() {
  const rows = useQuery(api.communications.templates, {}),
    save = useMutation(api.communications.saveTemplate),
    setActive = useMutation(api.communications.setTemplateActive),
    work = useWork();
  return (
    <section className={panel + " max-w-3xl"}>
      <h2 className="text-xl font-semibold">Versioned templates</h2>
      <p className="text-sm text-muted-foreground">
        Fields: recipient_name, number, total_cents, balance_cents, due_date,
        received_date, amount_cents, scheduled_at, project_number, package_end.
        Unsupported fields block approval.
      </p>
      {rows?.map((t) => (
        <details key={t._id}>
          <summary className="cursor-pointer">
            {t.name} Â· version {t.version}
          </summary>
          <pre className="whitespace-pre-wrap py-4 text-sm">
            {t.current?.subject}
            {"\n\n"}
            {t.current?.body}
          </pre>
          <Button
            variant="outline"
            disabled={work.busy}
            onClick={() =>
              void work.run(() =>
                setActive({ id: t._id, version: t.version, active: false }),
              )
            }
          >
            Disable template
          </Button>
        </details>
      ))}
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget),
            key = String(f.get("key")),
            old = rows?.find((t) => t.key === key);
          void work.run(() =>
            save({
              key,
              name: String(f.get("name")),
              category: String(f.get("category")) as Category,
              subject: String(f.get("subject")),
              body: String(f.get("body")),
              version: old?.version ?? 0,
              active: true,
            }),
          );
        }}
      >
        <Field name="key" label="Template key" required />
        <Field name="name" label="Name" required />
        <Field name="category" label="Purpose" options={categories} />
        <Field name="subject" label="Subject template" required />
        <Field name="body" label="Body template" type="textarea" />
        <Button disabled={work.busy}>Publish new version</Button>
        <p role="status">{work.notice}</p>
      </form>
    </section>
  );
}
function Preferences() {
  const suppress = useMutation(api.communications.suppress),
    revokeSuppression = useMutation(api.communications.revokeSuppression);
  const [category, setCategory] = useState<Category>("sales_relationship"),
    [index, setIndex] = useState(""),
    sources = useQuery(api.communications.sources, { category }),
    source = index !== "" ? sources?.rows[Number(index)] : undefined;
  const data = useQuery(
      api.communications.compliance,
      source
        ? { source: source.source, recipient: source.recipient, category }
        : "skip",
    ),
    record = useMutation(api.communications.recordConsent),
    revoke = useMutation(api.communications.revokeConsent),
    preference = useMutation(api.communications.preference),
    work = useWork();
  return (
    <section className={panel + " max-w-3xl"}>
      <h2 className="text-xl font-semibold">
        Recipient preferences & evidence
      </h2>
      <label className="grid gap-2 text-sm">
        Purpose
        <select
          aria-label="Purpose"
          className={inputClass}
          value={category}
          onChange={(e) => {
            setCategory(e.target.value as Category);
            setIndex("");
          }}
        >
          {categories.map((c) => (
            <option key={c} value={c}>
              {c.replaceAll("_", " ")}
            </option>
          ))}
        </select>
      </label>
      <label className="grid gap-2 text-sm">
        Recipient
        <select
          className={inputClass}
          value={index}
          onChange={(e) => setIndex(e.target.value)}
        >
          <option value="">Select a record</option>
          {sources?.rows.map((s, i) => (
            <option key={`${s.source.type}:${s.source.id}`} value={i}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {source && (
        <>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void work.run(() =>
                record({
                  source: source.source,
                  recipient: source.recipient,
                  category,
                  scope: category,
                  basis: String(
                    f.get("basis"),
                  ) as Doc<"communication_consents">["basis"],
                  evidence: String(f.get("evidence")),
                  evidence_source: String(f.get("evidence_source")),
                  observed_at: Date.now(),
                }),
              );
            }}
          >
            <Field
              name="basis"
              label="Documented basis"
              options={
                category === "transactional"
                  ? [
                      "transactional_service",
                      "recipient_requested",
                      "express_consent",
                    ]
                  : ["express_consent"]
              }
            />
            <Field
              name="evidence_source"
              label="Evidence source or reference"
              required
            />
            <Field
              name="evidence"
              label="Evidence description"
              type="textarea"
            />
            <Button disabled={work.busy}>Record evidence</Button>
          </form>
          <form
            className="space-y-4 border-t pt-4"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              void work.run(() =>
                preference({
                  source: source.source,
                  recipient: source.recipient,
                  category,
                  scope: category,
                  status: String(f.get("status")) as "allowed" | "unsubscribed",
                  reason: String(f.get("reason")),
                }),
              );
            }}
          >
            <Field
              name="status"
              label="Preference"
              options={["unsubscribed", "allowed"]}
            />
            <Field name="reason" label="Reason and evidence" required />
            <Button variant="outline" disabled={work.busy}>
              Save preference
            </Button>
            <p className="text-xs text-muted-foreground">
              An allowed preference does not replace consent evidence.
            </p>
          </form>
          {data?.consents.map((c) => (
            <div className="rounded-xl border p-4" key={c._id}>
              <StatusBadge>
                {c.revoked_at ? "Revoked" : c.basis.replaceAll("_", " ")}
              </StatusBadge>
              <p className="my-3 text-sm">{c.evidence}</p>
              {!c.revoked_at && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void work.run(() =>
                      revoke({ id: c._id, reason: String(f.get("reason")) }),
                    );
                  }}
                  className="space-y-3"
                >
                  <Field name="reason" label="Revocation reason" required />
                  <Button variant="outline" disabled={work.busy}>
                    Revoke this evidence
                  </Button>
                </form>
              )}
            </div>
          ))}
          {data && (
            <form
              className="space-y-3 border-t pt-4"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void work.run(() =>
                  suppress({
                    email: data.email,
                    scope: "all",
                    reason: String(f.get("reason")),
                  }),
                );
              }}
            >
              <h3 className="font-semibold">Suppress this address</h3>
              <p className="text-sm">
                Blocks all new email to this address, including service
                messages, until a documented correction.
              </p>
              <Field name="reason" label="Suppression reason" required />
              <Button variant="outline" disabled={work.busy}>
                Suppress address
              </Button>
            </form>
          )}
          {data?.suppressions.map((s) => (
            <div key={s._id} className="space-y-3 rounded-xl border p-4">
              <p className="text-sm">
                Suppression: {s.reason}
                {s.revoked_at ? " (revoked)" : ""}
              </p>
              {!s.revoked_at && (
                <form
                  className="space-y-3"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void work.run(() =>
                      revokeSuppression({
                        id: s._id,
                        reason: String(f.get("reason")),
                      }),
                    );
                  }}
                >
                  <Field
                    name="reason"
                    label="Verified correction and revocation reason"
                    required
                  />
                  <Button variant="outline" disabled={work.busy}>
                    Revoke suppression
                  </Button>
                </form>
              )}
            </div>
          ))}
        </>
      )}
      <p role="status">{work.notice}</p>
    </section>
  );
}
function Settings() {
  const config = useQuery(api.communications.configuration, {}),
    health = useQuery(api.communications.queueHealth, {}),
    operations = useQuery(api.communications.operationsHealth, {}),
    save = useMutation(api.communications.saveSettings),
    work = useWork();
  if (!config) return <LoadingState />;
  return (
    <section className={panel + " max-w-3xl"}>
      <h2 className="text-xl font-semibold">Communication settings</h2>
      <p className="text-sm">Sender: {config.sender} Â· Resend</p>
      <p className="text-sm">
        Live provider acceptance: pending external evidence
      </p>
      <form
        className="space-y-4"
        key={config.config?.version ?? 0}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          void work.run(() =>
            save({
              version: config.config?.version ?? 0,
              signature: String(f.get("signature")),
              secondary_approval: f.get("secondary") === "on",
              paused: f.get("paused") === "on",
              queue_lag_minutes: Number(f.get("lag")),
              transactional_basis: String(f.get("policy")) as
                "documented_service" | "explicit_request_only",
            }),
          );
        }}
      >
        <Field
          name="signature"
          label="Company identity, contact details, and mailing address"
          value={config.config?.signature ?? ""}
          type="textarea"
        />
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            name="secondary"
            defaultChecked={config.config?.secondary_approval}
          />
          Require a second reviewer
        </label>
        <label className="flex min-h-11 items-center gap-3">
          <input
            type="checkbox"
            name="paused"
            defaultChecked={config.config?.paused ?? true}
          />
          Pause outgoing delivery
        </label>
        <Field
          name="lag"
          label="Queue age warning (minutes, 1â€“1440)"
          value={String(config.config?.queue_lag_minutes ?? 15)}
        />
        <label className="grid gap-2 text-sm">
          Transactional eligibility policy
          <select
            name="policy"
            className={inputClass}
            defaultValue={
              config.config?.transactional_basis ?? "documented_service"
            }
          >
            <option value="documented_service">
              Documented service or request
            </option>
            <option value="explicit_request_only">
              Explicit recipient request only
            </option>
          </select>
        </label>
        <Button disabled={work.busy}>Save settings</Button>
        <p role="status">{work.notice}</p>
      </form>
      <ReconciliationReview />
      <h3 className="font-semibold">Queue health</h3>
      {operations && (
        <div className="space-y-2 text-sm">
          <p>
            Delivery {operations.enabled ? "enabled" : "disabled"} Â·{" "}
            {operations.paused ? "paused" : "running"} Â· provider{" "}
            {operations.provider_configured
              ? "configured"
              : "configuration required"}
          </p>
          <p role={operations.lag_warning ? "alert" : undefined}>
            Oldest due job: {operations.lag_minutes} minutes{" "}
            {operations.lag_warning ? "â€” review delayed queue" : ""}
          </p>
          <p>
            Retries waiting: {operations.retry_waiting}
            {operations.partial ? "+" : ""} Â· consecutive provider failures:{" "}
            {operations.consecutive_failures} Â· rejected webhooks:{" "}
            {operations.webhook_failures}
          </p>
          {operations.circuit_reason && (
            <p>
              Paused for {operations.circuit_reason.replaceAll("_", " ")}.
              Correct provider configuration before resuming. Unknown deliveries
              require evidence and will not retry.
            </p>
          )}
          {operations.problems.map((p) => (
            <Link
              key={p.id}
              href={`/communications?messageId=${p.id}`}
              className="block min-h-11 py-3 underline"
            >
              Review {p.status}: {p.code?.replaceAll("_", " ")}
            </Link>
          ))}
        </div>
      )}
      <div className="flex flex-wrap gap-3">
        {health?.map((h) => (
          <StatusBadge key={h.state}>
            {h.state}: {h.count}
            {h.partial ? "+" : ""}
          </StatusBadge>
        ))}
      </div>
    </section>
  );
}
