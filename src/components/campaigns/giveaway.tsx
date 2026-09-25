"use client";
import { useState, useSyncExternalStore } from "react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { listingRanges } from "@/lib/campaigns/model";
import { Button } from "@/components/ui/button";
const subscribe = () => () => {};
type Campaign = NonNullable<
  FunctionReturnType<typeof api.campaigns.publicCampaign>
>;
const inputClass =
  "mt-2 min-h-12 w-full rounded-lg border bg-background px-3 text-base";
export function Giveaway({ campaign: c }: { campaign: Campaign }) {
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const [started] = useState(() => Date.now()),
    [busy, setBusy] = useState(false),
    [done, setDone] = useState<"received" | "ineligible" | null>(null),
    [error, setError] = useState("");
  async function submit(event: React.SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const f = new FormData(event.currentTarget),
      query = new URLSearchParams(window.location.search),
      source = query.get("source") ?? "direct";
    const safeUtm = (key: string) => {
      const value = query.get(key) ?? "";
      return /^[a-zA-Z0-9_-]{0,80}$/.test(value) ? value : "";
    };
    try {
      const response = await fetch("/api/giveaway", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug: c.slug,
          first_name: f.get("first_name"),
          last_name: f.get("last_name"),
          brokerage: f.get("brokerage"),
          email: String(f.get("email")).trim().toLowerCase(),
          phone: f.get("phone"),
          city: f.get("city"),
          licensed_realtor: f.get("licensed_realtor") === "yes",
          annual_listings: f.get("annual_listings"),
          rules_version: c.rules_version,
          rules_accepted: f.get("rules_accepted") === "on",
          marketing_consent: f.get("marketing_consent") === "on",
          website: f.get("website"),
          started_at: started,
          source: ["expo_qr", "booth", "day_1", "day_2", "direct"].includes(
            source,
          )
            ? source
            : "direct",
          utm_source: safeUtm("utm_source"),
          utm_medium: safeUtm("utm_medium"),
          utm_campaign: safeUtm("utm_campaign"),
        }),
      });
      if (response.ok) {
        const result: { status?: string } = await response.json();
        setDone(result.status === "ineligible" ? "ineligible" : "received");
      } else {
        setError(
          response.status === 409
            ? "This campaign is closed or its rules have changed. Please refresh the page."
            : response.status === 429
              ? "Please wait a moment before trying again, or ask our booth team for help."
              : "We could not submit your entry. Check your details and try again.",
        );
      }
    } catch {
      setError(
        "Connection interrupted. Please try again; duplicate submissions will not create extra entries.",
      );
    } finally {
      setBusy(false);
    }
  }
  if (done === "ineligible")
    return (
      <section role="status" className="rounded-2xl border bg-card p-8">
        <h1 className="text-3xl font-semibold">Registration received</h1>
        <p className="mt-4">
          The professional details you supplied do not meet this giveaway’s
          published licence or market requirements. This registration is not
          eligible for the draw. If you made a mistake, please speak with our
          booth team before registration closes.
        </p>
      </section>
    );
  if (done)
    return (
      <section className="rounded-2xl border bg-card p-8" role="status">
        <h1 className="text-4xl font-semibold">You&apos;re entered!</h1>
        <p className="mt-5 text-lg">
          You&apos;re now entered for a chance to win a{" "}
          {new Intl.NumberFormat("en-CA", {
            style: "currency",
            currency: "CAD",
            maximumFractionDigits: 0,
          }).format(c.value_cents / 100)}{" "}
          {c.prize}.
        </p>
        <p className="mt-4 text-sm text-muted-foreground">
          One entry per Realtor. Entries remain subject to the official rules
          and eligibility verification. Marketing consent does not affect your
          chances.
        </p>
        <a href="https://glarahome.com" className="mt-6 inline-block underline">
          Learn about Glara Staging
        </a>
      </section>
    );
  const date = (ms: number) =>
    new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: c.timezone,
    }).format(ms);
  const prizeValue = new Intl.NumberFormat("en-CA", {
    maximumFractionDigits: 2,
  }).format(c.value_cents / 100);
  return (
    <>
      <header className="mb-8">
        <h1 className="text-4xl font-semibold leading-tight sm:text-5xl">
          {c.title}
        </h1>
        <p className="mt-3 font-semibold text-primary">
          Exclusively for Realtors
        </p>
        <p className="mt-5 whitespace-pre-line text-lg leading-relaxed text-muted-foreground">
          {c.description}
        </p>
        <dl className="mt-6 space-y-3 rounded-2xl border bg-card p-5 text-sm leading-relaxed">
          {[
            ["Prize", `One (1) $${prizeValue} CAD ${c.prize}`],
            ["Number of Prizes", "One (1)"],
            ["Purchase Required", "No"],
            ["Entry Limit", "One eligible entry per Realtor"],
            ["Contest Closes", `${date(c.closes_at)} Pacific Time`],
            [
              "Winner Selection",
              "Random draw from all eligible entries, subject to verification and the Official Rules.",
            ],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="inline font-semibold">{label}: </dt>
              <dd className="inline">{value}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-sm">{c.eligibility_summary}</p>
      </header>
      <section className="mb-6 space-y-3 rounded-2xl border bg-card p-5">
        {[
          ["Official Rules", c.official_rules, "official-rules"],
          ["Prize terms", c.prize_terms, "prize-terms"],
          ["Privacy Notice", c.privacy_notice, "privacy-notice"],
        ].map(([title, body, id]) => (
          <details key={id} id={id} className="scroll-mt-6">
            <summary className="cursor-pointer py-2 font-medium">
              {title}
            </summary>
            <p className="whitespace-pre-wrap pb-4 text-sm leading-7">{body}</p>
          </details>
        ))}
      </section>
      {c.state !== "open" ? (
        <section className="rounded-2xl border p-6" role="status">
          <h2 className="text-xl font-semibold">
            {c.state === "scheduled"
              ? "Registration opens soon"
              : "Registration is closed"}
          </h2>
          <p className="mt-2">Thank you for your interest in Glara Staging.</p>
        </section>
      ) : (
        <form
          method="post"
          action="/api/giveaway"
          onSubmit={submit}
          className="space-y-5 rounded-2xl border bg-card p-5 sm:p-8"
        >
          <h2 className="text-2xl font-semibold">Enter the Giveaway</h2>
          <p className="text-sm text-muted-foreground">
            Complete your Realtor profile below to enter.
          </p>
          <h3 className="font-semibold">Realtor Information</h3>
          <div className="grid gap-5 sm:grid-cols-2">
            {[
              ["first_name", "First Name", "text", "given-name"],
              ["last_name", "Last Name", "text", "family-name"],
              ["brokerage", "Brokerage", "text", "organization"],
              ["email", "Email Address", "email", "email"],
              ["phone", "Mobile Phone", "tel", "tel"],
              ["city", "City / Primary Market", "text", "address-level2"],
            ].map(([name, label, type, auto]) => (
              <label key={name} className="text-sm font-medium">
                {label} <span aria-hidden="true">*</span>
                <input
                  name={name}
                  type={type}
                  autoComplete={auto}
                  required
                  maxLength={
                    name === "email" ? 254 : name === "phone" ? 30 : 160
                  }
                  className={inputClass}
                />
              </label>
            ))}
          </div>
          {[
            {
              name: "licensed_realtor",
              legend: "Are you a licensed Realtor?",
              choices: [
                ["yes", "Yes"],
                ["no", "No"],
              ],
            },
            {
              name: "annual_listings",
              legend:
                "Approximately how many listings do you handle in a typical year?",
              choices: listingRanges.map((range) => [range, range]),
            },
          ].map(({ name, legend, choices }) => (
            <fieldset key={name}>
              <legend className="text-sm font-medium">
                {legend} <span aria-hidden="true">*</span>
              </legend>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {choices.map(([value, label]) => (
                  <label
                    key={value}
                    className="flex min-h-12 cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm"
                  >
                    <input
                      type="radio"
                      name={name}
                      value={value}
                      required
                      className="size-5 accent-primary"
                    />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <div aria-hidden="true" className="absolute -left-[10000px]">
            <label>
              Leave this field empty
              <input name="website" tabIndex={-1} autoComplete="off" />
            </label>
          </div>
          <p className="font-semibold">Required</p>
          <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
            <input
              type="checkbox"
              name="rules_accepted"
              required
              className="mt-1 size-5 shrink-0"
            />
            I have read and agree to the Official Giveaway Rules and acknowledge
            the Privacy Notice.
          </label>
          <p className="font-semibold">Optional</p>
          <label className="flex items-start gap-3 rounded-lg border p-4 text-sm">
            <input
              type="checkbox"
              name="marketing_consent"
              className="mt-1 size-5 shrink-0"
            />
            <span>
              {c.consent_text}
              <span className="mt-2 block text-muted-foreground">
                Optional. You can enter without subscribing.
              </span>
            </span>
          </label>
          {error && (
            <p role="alert" className="rounded-lg border p-3 text-sm">
              {error}
            </p>
          )}
          <Button
            type="submit"
            disabled={busy || !hydrated}
            className="min-h-12 w-full"
          >
            {busy ? "Submitting..." : "ENTER TO WIN"}
          </Button>
        </form>
      )}
      <footer className="mt-6 space-y-4 text-sm leading-relaxed text-muted-foreground">
        <p>
          No purchase necessary. One prize with an approximate retail value of
          CAD ${prizeValue}. One eligible entry per Realtor. Odds of winning
          depend on the number of eligible entries received. Selected entrant
          must satisfy the eligibility requirements, comply with the Official
          Rules
          {c.skill_question_required
            ? " and correctly answer a skill-testing question"
            : ""}{" "}
          before being confirmed as the winner.
        </p>
        <nav
          aria-label="Giveaway terms"
          className="flex flex-wrap gap-x-3 gap-y-2"
        >
          {[
            ["official-rules", "View Official Rules"],
            ["privacy-notice", "Privacy Notice"],
          ].map(([id, label]) => (
            <a
              key={id}
              href={`#${id}`}
              className="underline underline-offset-4"
              onClick={() => {
                const details = document.getElementById(id);
                if (details instanceof HTMLDetailsElement) details.open = true;
              }}
            >
              {label}
            </a>
          ))}
        </nav>
      </footer>
    </>
  );
}
