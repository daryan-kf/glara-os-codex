"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import {
  useQuery,
  useMutation,
  useAction,
  usePaginatedQuery,
} from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { Id, Doc } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { PageTitle, LoadingState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { campaignPacificZone } from "@/lib/campaigns/model";
import { vancouverLocal, vancouverUtc } from "@/lib/operations/time";
const field =
  "mt-1 min-h-11 w-full rounded-lg border bg-background px-3 py-2 text-base";
const panel = "rounded-2xl border bg-card p-5 sm:p-6";
const money = (cents: number) =>
  new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(
    cents / 100,
  );
const date = (time: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: campaignPacificZone(time),
    dateStyle: "medium",
    timeStyle: "short",
  }).format(time);
function failure(error: unknown) {
  // Only show the controlled Convex message; do not expose stack traces or transport metadata.
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    error.data &&
    typeof error.data === "object" &&
    "message" in error.data &&
    typeof error.data.message === "string"
  )
    return error.data.message;
  return "This action could not be completed. Refresh and try again.";
}
function CampaignForm({
  owner,
  existing,
  onDone,
}: {
  owner: Id<"users">;
  existing?: Doc<"marketing_campaigns">;
  onDone: (id: Id<"marketing_campaigns">) => void;
}) {
  const save = useMutation(api.campaigns.save),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget),
      str = (key: string) => String(f.get(key) ?? "");
    try {
      const id = await save({
        id: existing?._id,
        version: existing?.version ?? 0,
        input: JSON.stringify({
          name: str("name"),
          slug: str("slug"),
          public_title: str("public_title"),
          public_description: str("public_description"),
          prize_name: str("prize_name"),
          prize_value_cents: Math.round(Number(str("prize_value")) * 100),
          starts_at: Date.parse(vancouverUtc(str("starts_at"))),
          closes_at: Date.parse(vancouverUtc(str("closes_at"))),
          eligibility_summary: str("eligibility_summary"),
          ...(existing?.eligible_province
            ? { eligible_province: existing.eligible_province }
            : {}),
          eligible_cities: str("eligible_cities")
            .split(",")
            .map((x) => x.trim())
            .filter(Boolean),
          official_rules: str("official_rules"),
          rules_version: str("rules_version"),
          privacy_notice: str("privacy_notice"),
          consent_text: str("consent_text"),
          prize_terms: str("prize_terms"),
          prize_terms_version: str("prize_terms_version"),
          ...(existing?.expiry_months_after_confirmation === 6
            ? { expiry_months_after_confirmation: 6 }
            : {
                prize_expires_at: Date.parse(
                  vancouverUtc(str("prize_expires_at")),
                ),
              }),
          skill_question_required: f.get("skill_question_required") === "on",
          assigned_to: existing?.assigned_to ?? owner,
          legal_approved: f.get("legal_approved") === "on",
        }),
      });
      onDone(id);
    } catch (e) {
      setError(
        e instanceof Error && e.message.startsWith("Choose an unambiguous")
          ? e.message
          : failure(e),
      );
    } finally {
      setBusy(false);
    }
  }
  const defaults: Record<string, string> = {
    name: existing?.name ?? "Realtor Expo — $2,000 Glara Staging Giveaway",
    slug: existing?.slug ?? "realtor-expo",
    public_title: existing?.public_title ?? "WIN A $2,000 GLARA STAGING CREDIT",
    public_description:
      existing?.public_description ??
      "Visit Glara Staging at the show and enter for your chance to win a $2,000 CAD Glara Staging Credit toward an eligible home staging project.\n\nWhether you're preparing your next listing or planning ahead, we'd love to introduce you to Glara Staging and show you how professional staging can help transform a property for market.",
    consent_text:
      existing?.consent_text ??
      "Yes, I'd like to receive staging tips, special offers, event updates and other marketing communications from Glara Staging. I understand that I can unsubscribe at any time.",
    prize_name: existing?.prize_name ?? "Glara Staging Credit",
    prize_value: String((existing?.prize_value_cents ?? 200000) / 100),
    rules_version: existing?.rules_version ?? "1",
    prize_terms_version: existing?.prize_terms_version ?? "1",
    eligible_cities: existing?.eligible_cities.join(", ") ?? "",
  };
  return (
    <form onSubmit={submit} className={panel + " space-y-5"}>
      <h2 className="text-2xl font-semibold">
        {existing ? "Edit draft" : "Create a draft campaign"}
      </h2>
      <p className="text-sm text-muted-foreground">
        Dates use Vancouver time. Drafts cannot accept entries. Confirm business
        and legal terms before publishing; no policy has been assumed for prize
        use, expiry or transfer.
      </p>
      {existing?.eligible_province === "BC" && (
        <p className="text-sm">
          Eligibility: licensed Realtors in British Columbia; all BC primary
          markets.
        </p>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          ["name", "Internal campaign name"],
          ["slug", "Public URL slug"],
          ["public_title", "Public headline"],
          ["prize_name", "Prize name"],
          ["prize_value", "Prize value (CAD)"],
          ["rules_version", "Rules version"],
          ["prize_terms_version", "Prize terms version"],
          ["eligible_cities", "Eligible cities / markets, separated by commas"],
        ].map(([name, label]) => (
          <label key={name} className="text-sm font-medium">
            {label}
            <input
              name={name}
              required={
                name !== "eligible_cities" ||
                existing?.eligible_province !== "BC"
              }
              disabled={
                name === "eligible_cities" &&
                existing?.eligible_province === "BC"
              }
              maxLength={name === "eligible_cities" ? 3000 : 160}
              type={name === "prize_value" ? "number" : "text"}
              min={name === "prize_value" ? 1 : undefined}
              step={name === "prize_value" ? "0.01" : undefined}
              defaultValue={defaults[name]}
              className={field}
            />
          </label>
        ))}
        {(["starts_at", "closes_at", "prize_expires_at"] as const).map(
          (name) =>
            name === "prize_expires_at" &&
            existing?.expiry_months_after_confirmation === 6 ? (
              <p key={name} className="text-sm">
                Prize expiry: six calendar months after winner confirmation
                (Vancouver time).
              </p>
            ) : (
              <label key={name} className="text-sm font-medium">
                {
                  {
                    starts_at: "Entry window opens",
                    closes_at: "Entry window closes",
                    prize_expires_at: "Prize expires",
                  }[name]
                }
                <input
                  type="datetime-local"
                  required
                  name={name}
                  defaultValue={
                    existing?.[name]
                      ? vancouverLocal(new Date(existing[name]!).toISOString())
                      : ""
                  }
                  className={field}
                />
              </label>
            ),
        )}
      </div>
      {(
        [
          "public_description",
          "eligibility_summary",
          "official_rules",
          "privacy_notice",
          "consent_text",
          "prize_terms",
        ] as const
      ).map((name) => (
        <label key={name} className="block text-sm font-medium">
          {
            {
              public_description: "Public description",
              eligibility_summary: "Eligibility summary",
              official_rules: "Complete official rules (plain text)",
              privacy_notice: "Privacy notice",
              consent_text:
                "Optional marketing consent wording (identify sender, contact details and withdrawal)",
              prize_terms: "Complete prize-use terms",
            }[name]
          }
          <textarea
            name={name}
            rows={name === "official_rules" ? 10 : 3}
            defaultValue={existing?.[name] ?? defaults[name] ?? ""}
            maxLength={
              name === "official_rules"
                ? 20000
                : name === "public_description"
                  ? 2000
                  : name === "eligibility_summary" || name === "consent_text"
                    ? 3000
                    : 6000
            }
            className={field}
          />
        </label>
      ))}
      <label className="flex gap-3 text-sm">
        <input
          type="checkbox"
          name="skill_question_required"
          defaultChecked={existing?.skill_question_required ?? true}
          className="size-5"
        />
        Approved rules require a skill-testing question before winner
        confirmation.
      </label>
      <label className="flex gap-3 text-sm">
        <input
          type="checkbox"
          name="legal_approved"
          defaultChecked={existing?.legal_approved ?? false}
          className="size-5"
        />
        The sponsor has approved these dates, eligibility, official rules,
        privacy, consent wording and prize terms for publication.
      </label>
      <p className="text-sm text-muted-foreground">
        New prospects use the campaign’s assigned CRM owner. Change staff
        assignment through the existing CRM workflow when needed.
      </p>
      {error && <p role="alert">{error}</p>}
      <Button disabled={busy} type="submit">
        {busy ? "Saving…" : "Save draft"}
      </Button>
    </form>
  );
}
export function CampaignCenter({
  owner,
  manage,
}: {
  owner: Id<"users">;
  manage: boolean;
}) {
  const list = useQuery(api.campaigns.list),
    [creating, setCreating] = useState(false),
    [selected, setSelected] = useState<Id<"marketing_campaigns"> | null>(null);
  if (selected)
    return (
      <CampaignDetail
        id={selected}
        owner={owner}
        back={() => setSelected(null)}
      />
    );
  return (
    <>
      <PageTitle
        title="Campaigns & giveaways"
        description="Meet Realtors, build relationships, and run an accountable prize draw."
      />
      {manage && (
        <Button onClick={() => setCreating(!creating)} variant="outline">
          {creating ? "Close draft form" : "New campaign"}
        </Button>
      )}
      {creating && (
        <div className="mt-5">
          <CampaignForm
            owner={owner}
            onDone={(id) => {
              setCreating(false);
              setSelected(id);
            }}
          />
        </div>
      )}
      <div className="mt-6 grid gap-4">
        {!list ? (
          <LoadingState />
        ) : list.length ? (
          list.map((c) => (
            <button
              key={c._id}
              onClick={() => setSelected(c._id)}
              className={panel + " text-left hover:border-primary"}
            >
              <span className="text-xs uppercase tracking-wide text-muted-foreground">
                {c.status}
              </span>
              <h2 className="mt-2 text-xl font-semibold">{c.name}</h2>
              <p className="mt-2 text-sm">
                {date(c.starts_at)} – {date(c.closes_at)} ·{" "}
                {money(c.prize_value_cents)} service credit
              </p>
            </button>
          ))
        ) : (
          <p className={panel}>
            No campaigns yet. Create a draft to prepare an event.
          </p>
        )}
      </div>
    </>
  );
}
function CampaignDetail({
  id,
  owner,
  back,
}: {
  id: Id<"marketing_campaigns">;
  owner: Id<"users">;
  back: () => void;
}) {
  const detail = useQuery(api.campaigns.detail, { id }),
    transition = useMutation(api.campaigns.transition),
    draw = useAction(api.campaignActions.draw),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [intent, setIntent] = useState<
      "scheduled" | "open" | "closed" | "cancelled" | "draw" | "redraw" | null
    >(null),
    [reason, setReason] = useState("");
  if (!detail) return <LoadingState />;
  const c = detail.campaign,
    last = detail.draws.at(-1);
  async function apply() {
    if (!intent || !detail) return;
    setBusy(true);
    setError("");
    try {
      if (intent === "draw" || intent === "redraw")
        await draw({ id, redraw: intent === "redraw", reason });
      else await transition({ id, version: c.version, to: intent });
      setIntent(null);
      setReason("");
    } catch (e) {
      setError(failure(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Button variant="ghost" onClick={back}>
        ← All campaigns
      </Button>
      <PageTitle
        title={c.name}
        description={`${c.status} · ${date(c.starts_at)} – ${date(c.closes_at)} · Vancouver time`}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {Object.entries(detail.counts).map(([key, value]) => (
          <div className={panel} key={key}>
            <p className="text-xs capitalize text-muted-foreground">
              {key.replaceAll("_", " ")}
            </p>
            <p className="mt-2 text-2xl font-semibold">{value}</p>
          </div>
        ))}
      </div>
      <section className={panel + " mb-6 space-y-3"}>
        <h2 className="font-semibold">Public registration link</h2>
        <p className="break-all text-sm">
          {detail.public_url ??
            "Configure the canonical application origin before generating a QR code."}
        </p>
        <p className="text-sm text-muted-foreground">
          Use the approved public hostname for printed QR codes. This link works
          only after intake is configured and the campaign is open. No attendee
          details belong in the QR URL.
        </p>
        <Link
          href={`/giveaway/${c.slug}?source=booth`}
          target="_blank"
          className="inline-block underline"
        >
          Open registration page
        </Link>
      </section>
      {detail.manage && (
        <section className={panel + " mb-6"}>
          <h2 className="mb-4 font-semibold">Campaign controls</h2>
          <div className="flex flex-wrap gap-3">
            {c.status === "draft" && (
              <Button variant="outline" onClick={() => setIntent("scheduled")}>
                Publish as scheduled
              </Button>
            )}
            {["draft", "scheduled"].includes(c.status) && (
              <Button onClick={() => setIntent("open")}>
                Open registration
              </Button>
            )}
            {["open", "scheduled"].includes(c.status) && (
              <Button variant="outline" onClick={() => setIntent("closed")}>
                Close campaign
              </Button>
            )}
            {["draft", "scheduled", "open"].includes(c.status) && (
              <Button variant="outline" onClick={() => setIntent("cancelled")}>
                Cancel campaign
              </Button>
            )}
            {c.status === "closed" && (
              <Button onClick={() => setIntent("draw")}>
                Run audited draw
              </Button>
            )}
            {c.status === "drawn" && (
              <Button variant="outline" onClick={() => setIntent("redraw")}>
                Request redraw
              </Button>
            )}
          </div>
          {intent && (
            <div className="mt-5 rounded-lg border p-4">
              <p className="font-semibold">Confirm: {intent}</p>
              <p className="mt-2 text-sm">
                Publishing freezes the rules. Closing freezes eligibility
                increases. A draw gives every eligible entry equal odds; lead
                priority and consent do not affect selection.
              </p>
              {intent === "redraw" && (
                <label className="mt-3 block text-sm">
                  Reason for redraw
                  <textarea
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    minLength={10}
                    maxLength={1000}
                    className={field}
                  />
                </label>
              )}
              <div className="mt-4 flex gap-3">
                <Button
                  disabled={
                    busy || (intent === "redraw" && reason.trim().length < 10)
                  }
                  onClick={() => void apply()}
                >
                  Confirm action
                </Button>
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => setIntent(null)}
                >
                  Keep current state
                </Button>
              </div>
            </div>
          )}
          {error && (
            <p role="alert" className="mt-3">
              {error}
            </p>
          )}
          {last && (
            <p className="mt-4 text-sm">
              Latest draw: {last.eligible_count} frozen entries ·{" "}
              {last.algorithm} ·{" "}
              {last.completed_at
                ? date(last.completed_at)
                : "Selection pending — retry the draw to finish"}
              .
            </p>
          )}
          {detail.awards.map((a) => (
            <p key={a._id} className="mt-4 text-sm font-medium">
              Award issued: {money(a.original_cents)} service credit; unapplied.
              Expires {date(a.expires_at)}. No payment or invoice adjustment has
              been created.
            </p>
          ))}
        </section>
      )}
      {detail.manage && c.status === "draft" && (
        <CampaignForm
          key={c.version}
          owner={owner}
          existing={c}
          onDone={() => {}}
        />
      )}
      <EntryTable id={id} detail={detail} />
    </>
  );
}
type Detail = NonNullable<FunctionReturnType<typeof api.campaigns.detail>>;
type Entry = FunctionReturnType<typeof api.campaigns.entryList>["page"][number];
function EntryTable({
  id,
  detail,
}: {
  id: Id<"marketing_campaigns">;
  detail: Detail;
}) {
  const [q, setQ] = useState(""),
    [filter, setFilter] = useState("");
  const { results, status, loadMore } = usePaginatedQuery(
    api.campaigns.entryList,
    { id, q, filter },
    { initialNumItems: 25 },
  );
  useEffect(() => {
    if ((q || filter) && results.length < 10 && status === "CanLoadMore")
      loadMore(25);
  }, [q, filter, results.length, status, loadMore]);
  return (
    <section className={panel + " mt-6"}>
      <h2 className="text-xl font-semibold">Registrations & follow-up</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Priority uses listing volume only (21+ High, 11–20 Medium). It never
        changes draw odds. Pending identities require staff review. Contact
        permission must still be checked in Communications.
      </p>
      <div className="my-5 grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Search registrations
          <input
            value={q}
            maxLength={100}
            onChange={(e) => setQ(e.target.value)}
            className={field}
            placeholder="Name, email, brokerage or city"
          />
        </label>
        <label className="text-sm">
          Filter
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className={field}
          >
            <option value="">All entries</option>
            {[
              "eligible",
              "pending",
              "ineligible",
              "selected_pending_verification",
              "confirmed_winner",
              "disqualified",
              "new",
              "existing",
              "review",
              "day_1",
              "day_2",
              "High",
              "Medium",
              "Standard",
              "opt_in",
              "not_contacted",
            ].map((x) => (
              <option key={x} value={x}>
                {x.replaceAll("_", " ")}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="space-y-3">
        {results.map((e) => (
          <article key={e.id} className="rounded-lg border p-4">
            <div className="flex flex-wrap justify-between gap-3">
              <div>
                <h3 className="font-semibold">
                  {e.first_name} {e.last_name}
                </h3>
                <p className="text-sm">
                  {e.brokerage} · {e.city}
                </p>
              </div>
              <span className="text-sm">
                {e.eligibility.replaceAll("_", " ")}
              </span>
            </div>
            <p className="mt-2 break-all text-sm">
              {e.email} · {e.phone}
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              {date(e.entered_at)} · {e.event_day} · {e.source} · {e.origin} ·{" "}
              {e.annual_listings} listings · {e.priority} priority · opt-in:{" "}
              {e.marketing_consent ? "yes" : "no"} ·{" "}
              {e.contacted ? "contacted" : "not contacted"}
            </p>
            {e.realtor_id && (
              <Link
                href={`/realtors/${e.realtor_id}`}
                className="mt-3 inline-block text-sm underline"
              >
                Open Realtor & follow-up history
              </Link>
            )}
            {detail.manage && (
              <>
                <IdentityReview entry={e} campaign={detail.campaign} />
                <EntryReview entry={e} campaign={detail.campaign} />
              </>
            )}
          </article>
        ))}
        {!results.length && status !== "LoadingFirstPage" && (
          <p className="py-4 text-sm">
            No matching registrations in the loaded entries.
          </p>
        )}
      </div>
      {status === "CanLoadMore" && (
        <Button variant="outline" className="mt-4" onClick={() => loadMore(25)}>
          Load more entries
        </Button>
      )}
      {["LoadingFirstPage", "LoadingMore"].includes(status) && (
        <p role="status" className="mt-4">
          Loading entries…
        </p>
      )}
    </section>
  );
}
function EntryReview({
  entry: e,
  campaign: c,
}: {
  entry: Entry;
  campaign: Detail["campaign"];
}) {
  const review = useMutation(api.campaigns.reviewEligibility),
    verify = useMutation(api.campaigns.verifyWinner),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const selected = e.eligibility === "selected_pending_verification",
    editable =
      ["open", "scheduled", "closed"].includes(c.status) &&
      ["pending", "eligible", "ineligible"].includes(e.eligibility);
  if (!selected && !editable) return null;
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget),
      note = String(f.get("note") ?? "");
    try {
      if (selected)
        await verify({
          id: e.id,
          version: e.version,
          decision: f.get("decision") === "confirm" ? "confirm" : "disqualify",
          identity_verified: f.get("identity") === "on",
          license_verified: f.get("license") === "on",
          rules_verified: f.get("rules") === "on",
          skill_question_passed: f.get("skill") === "on",
          note,
        });
      else
        await review({
          id: e.id,
          version: e.version,
          eligible: f.get("decision") === "eligible",
          reason: note,
        });
    } catch (error) {
      setError(failure(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="mt-4">
      <summary className="cursor-pointer py-2 text-sm font-medium">
        {selected ? "Verify selected entrant" : "Review eligibility"}
      </summary>
      <form
        onSubmit={submit}
        className="mt-3 space-y-4 rounded-lg bg-muted p-4"
      >
        {selected && (
          <>
            <p className="text-sm">
              Verify the selected entrant privately. If required by the approved
              rules, administer an owner-controlled math question and record a
              verification reference. Never paste identity documents or the
              answer here.
            </p>
            {[
              ["identity", "Identity verified"],
              ["license", "Realtor licence verified"],
              ["rules", "Official rules and prize terms verified"],
              ["skill", "Required skill-testing question passed"],
            ].map(([name, label]) => (
              <label className="flex gap-3 text-sm" key={name}>
                <input name={name} type="checkbox" className="size-5" />
                {label}
              </label>
            ))}
          </>
        )}
        <label className="block text-sm">
          Decision
          <select name="decision" className={field}>
            {selected ? (
              <>
                <option value="disqualify">Disqualify (reason required)</option>
                <option value="confirm">
                  Confirm winner and issue unapplied credit
                </option>
              </>
            ) : (
              <>
                <option value="ineligible">Ineligible</option>
                {c.status !== "closed" && (
                  <option value="eligible">
                    Eligible under the published rules
                  </option>
                )}
              </>
            )}
          </select>
        </label>
        <label className="block text-sm">
          Review reason / verification reference
          <textarea
            name="note"
            required
            minLength={10}
            maxLength={1000}
            className={field}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <Button disabled={busy} type="submit">
          {busy ? "Saving…" : "Record reviewed decision"}
        </Button>
      </form>
    </details>
  );
}
export function CampaignHistory({ id }: { id: Id<"realtors"> }) {
  const rows = useQuery(api.campaigns.realtorHistory, { id });
  if (!rows?.length) return null;
  return (
    <section className={panel + " my-6"}>
      <h2 className="text-lg font-semibold">Campaign participation</h2>
      <ul className="mt-3 space-y-3">
        {rows.map((e) => (
          <li key={e.id} className="text-sm">
            <strong>{e.name}</strong> · {date(e.entered_at)} ·{" "}
            {e.eligibility.replaceAll("_", " ")} · marketing opt-in:{" "}
            {e.marketing_consent ? "yes" : "no"}
          </li>
        ))}
      </ul>
    </section>
  );
}

function IdentityReview({
  entry: e,
  campaign: c,
}: {
  entry: Entry;
  campaign: Detail["campaign"];
}) {
  const candidates = useQuery(
      api.campaigns.identityCandidates,
      e.origin === "review" && c.status === "open" ? { id: e.id } : "skip",
    ),
    resolve = useMutation(api.campaigns.resolveIdentity),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  if (e.origin !== "review" || c.status !== "open") return null;
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const f = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await resolve({
        id: e.id,
        version: e.version,
        realtor_id: String(f.get("realtor")) as Id<"realtors">,
        note: String(f.get("note")),
      });
    } catch (error) {
      setError(failure(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="mt-4">
      <summary className="cursor-pointer py-2 text-sm font-medium">
        Resolve identity conflict
      </summary>
      <form onSubmit={submit} className="space-y-3 rounded-lg bg-muted p-4">
        <p className="text-sm">
          Contact the entrant privately and verify which existing record belongs
          to them. No CRM details will be overwritten. Archived contacts must
          first be reviewed and restored through the CRM.
        </p>
        <label className="block text-sm">
          Verified matching Realtor
          <select required name="realtor" defaultValue="" className={field}>
            <option value="" disabled>
              Select the verified contact
            </option>
            {candidates?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} · {r.email} · {r.phone}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          Verification reference
          <textarea
            name="note"
            minLength={10}
            maxLength={1000}
            required
            className={field}
          />
        </label>
        {error && <p role="alert">{error}</p>}
        <Button disabled={busy || !candidates?.length} type="submit">
          Link verified registration
        </Button>
      </form>
    </details>
  );
}
