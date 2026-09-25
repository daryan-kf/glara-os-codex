"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import { listingRanges, campaignPacificZone } from "@/lib/campaigns/model";
import { Button } from "@/components/ui/button";
import Image from "next/image";
import {
  ArrowRight,
  CalendarDays,
  FileText,
  Gift,
  Menu,
  ShieldCheck,
  UserRound,
  UsersRound,
} from "lucide-react";
import stagingRoom from "./staging-living-room.jpg";
import styles from "./giveaway.module.css";
const subscribe = () => () => {};
type Campaign = NonNullable<
  FunctionReturnType<typeof api.campaigns.publicCampaign>
>;
const navigation = [
  ["Home", "https://glarahome.com/"],
  ["Staging Services", "https://glarahome.com/services"],
  ["Our Work", "https://glarahome.com/portfolio"],
  ["For Realtors", "#eligibility"],
  ["About", "https://glarahome.com/about"],
  ["Contact", "https://glarahome.com/contact"],
];
function Wordmark() {
  return (
    <span className={styles.wordmark}>
      <span>GLARA</span>
      <small>STAGING</small>
    </span>
  );
}
function openTerms(id: string) {
  const details = document.getElementById(id);
  if (details instanceof HTMLDetailsElement) details.open = true;
}
export function Giveaway({ campaign: c }: { campaign: Campaign }) {
  const router = useRouter();
  useEffect(() => {
    if (c.state !== "scheduled" && c.state !== "open") return;
    const boundary = c.state === "scheduled" ? c.starts_at : c.closes_at;
    const timer = setTimeout(
      () => router.refresh(),
      Math.min(2147483647, Math.max(1000, boundary - Date.now() + 250)),
    );
    return () => clearTimeout(timer);
  }, [c, router]);
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
    if (busy || c.state !== "open") return;
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
          ...(c.eligible_province === "BC"
            ? { licensed_in_bc: f.get("licensed_realtor") === "yes" }
            : {}),
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
  const date = (ms: number) =>
    new Intl.DateTimeFormat("en-CA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: campaignPacificZone(ms),
    }).format(ms);
  const prizeValue = new Intl.NumberFormat("en-CA", {
    maximumFractionDigits: 2,
  }).format(c.value_cents / 100);
  const canEnter = c.state === "open";
  const facts = [
    {
      icon: Gift,
      title: "Prize",
      text: `One (1) $${prizeValue} CAD ${c.prize}`,
    },
    {
      icon: CalendarDays,
      title: "When",
      text: `Opens ${date(c.starts_at)} PT. Closes ${date(c.closes_at)} PT.`,
    },
    {
      icon: UsersRound,
      title: "Who Can Enter",
      text:
        c.eligible_province === "BC"
          ? "Licensed Realtors in British Columbia"
          : c.eligibility_summary,
    },
    {
      icon: FileText,
      title: "Purchase Required",
      text: "No purchase necessary",
    },
    {
      icon: UserRound,
      title: "Entry Limit",
      text: "One eligible entry per Realtor",
    },
    {
      icon: ShieldCheck,
      title: "Winner Selection",
      text: "Random draw, subject to verification",
    },
  ];
  return (
    <div className={styles.site}>
      <a href="#registration" className={styles.skipLink}>
        Skip to registration
      </a>
      <header className={styles.topbar}>
        <a href="https://glarahome.com/" aria-label="Glara Staging home">
          <Wordmark />
        </a>
        <nav className={styles.desktopNav} aria-label="Main navigation">
          {navigation.map(([label, href]) => (
            <a href={href} key={label}>
              {label}
            </a>
          ))}
        </nav>
        <a className={styles.consultation} href="https://glarahome.com/contact">
          Book a Consultation
        </a>
        <details className={styles.mobileMenu}>
          <summary aria-label="Open site navigation">
            <Menu size={24} aria-hidden="true" />
          </summary>
          <nav aria-label="Mobile site navigation">
            {navigation.map(([label, href]) => (
              <a href={href} key={label}>
                {label}
              </a>
            ))}
          </nav>
        </details>
      </header>
      <div className={styles.layout}>
        <section className={styles.story} aria-labelledby="giveaway-title">
          <p className={styles.eyebrow}>
            {c.slug === "pacificwest-2026"
              ? "PacificWest Conference"
              : "Glara Staging Giveaway"}
          </p>
          <h1 id="giveaway-title" className={styles.title}>
            {c.title}
          </h1>
          <div className={styles.goldRule} aria-hidden="true" />
          <h2 className={styles.subtitle}>Exclusively for Realtors</h2>
          <p className={styles.description}>{c.description}</p>
          <figure className={styles.photograph}>
            <Image
              src={stagingRoom}
              alt="A bright living and dining space styled by Glara Home Staging"
              unoptimized
              sizes="(max-width: 800px) 100vw, 50vw"
            />
            <figcaption>
              <span>Staging Sells</span>
              <p>
                Beautiful spaces.
                <br />
                Stronger results.
              </p>
            </figcaption>
          </figure>
          <dl className={styles.facts} id="eligibility">
            {facts.map(({ icon: Icon, title, text }) => (
              <div key={title}>
                <Icon size={30} strokeWidth={1.5} aria-hidden="true" />
                <dt>{title}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </section>
        <section
          className={styles.panel}
          id="registration"
          aria-labelledby="registration-title"
        >
          {done ? (
            <div role="status" className={styles.success}>
              <h2 id="registration-title">
                {done === "ineligible"
                  ? "Registration received"
                  : "You're entered!"}
              </h2>
              <p>
                {done === "ineligible"
                  ? "The professional details you supplied do not meet this giveaway’s published licence or market requirements. This registration is not eligible for the draw. If you made a mistake, please speak with our booth team before registration closes."
                  : `You're now entered for a chance to win a $${prizeValue} CAD ${c.prize}.`}
              </p>
              <p>
                One entry per Realtor. Entries remain subject to the Official
                Rules and eligibility verification. Marketing consent does not
                affect your chances.
              </p>
              <a href="https://glarahome.com/">
                Learn about Glara Staging{" "}
                <ArrowRight size={16} aria-hidden="true" />
              </a>
            </div>
          ) : (
            <>
              <h2 id="registration-title" className={styles.formTitle}>
                Enter the Giveaway
              </h2>
              <p className={styles.formIntro}>
                Complete your Realtor profile below to enter.
              </p>
              {!canEnter && (
                <div
                  className={styles.schedule}
                  role="status"
                  id="registration-schedule"
                >
                  <CalendarDays size={20} aria-hidden="true" />
                  <div>
                    <h3>
                      {c.state === "scheduled"
                        ? "Registration opens soon"
                        : c.state === "paused"
                          ? "Registration is temporarily unavailable"
                          : "Registration is closed"}
                    </h3>
                    <p>
                      {c.state === "scheduled"
                        ? `Entries open ${date(c.starts_at)} Pacific Time and close ${date(c.closes_at)} Pacific Time.`
                        : "Thank you for your interest in Glara Staging."}
                    </p>
                  </div>
                </div>
              )}
              <form
                method="post"
                action="/api/giveaway"
                onSubmit={submit}
                aria-describedby={
                  !canEnter ? "registration-schedule" : undefined
                }
              >
                <fieldset
                  disabled={!canEnter || busy}
                  className={styles.fields}
                >
                  <legend className="sr-only">Realtor Information</legend>
                  {[
                    [
                      "first_name",
                      "First Name",
                      "text",
                      "given-name",
                      "First Name",
                    ],
                    [
                      "last_name",
                      "Last Name",
                      "text",
                      "family-name",
                      "Last Name",
                    ],
                    [
                      "brokerage",
                      "Brokerage",
                      "text",
                      "organization",
                      "Your Brokerage",
                    ],
                    [
                      "email",
                      "Email Address",
                      "email",
                      "email",
                      "you@brokerage.com",
                    ],
                    ["phone", "Mobile Phone", "tel", "tel", "(604) 123–4567"],
                    [
                      "city",
                      "City / Primary Market",
                      "text",
                      "address-level2",
                      "e.g. Vancouver, Burnaby, Surrey",
                    ],
                  ].map(([name, label, type, auto, placeholder]) => (
                    <label key={name} className={styles.textField}>
                      {label}{" "}
                      <span className={styles.required} aria-hidden="true">
                        *
                      </span>
                      <input
                        name={name}
                        type={type}
                        autoComplete={auto}
                        placeholder={placeholder}
                        required
                        maxLength={
                          name === "email" ? 254 : name === "phone" ? 30 : 160
                        }
                      />
                    </label>
                  ))}
                  {[
                    {
                      name: "licensed_realtor",
                      legend:
                        c.eligible_province === "BC"
                          ? "Are you a licensed Realtor in British Columbia?"
                          : "Are you a licensed Realtor?",
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
                    <fieldset key={name} className={styles.choices}>
                      <legend>
                        {legend}{" "}
                        <span className={styles.required} aria-hidden="true">
                          *
                        </span>
                      </legend>
                      <div>
                        {choices.map(([value, label]) => (
                          <label key={value}>
                            <input
                              type="radio"
                              name={name}
                              value={value}
                              required
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
                  <label className={styles.consent}>
                    <input type="checkbox" name="rules_accepted" required />
                    <span>
                      I have read and agree to the{" "}
                      <a
                        href="#official-rules"
                        onClick={() => openTerms("official-rules")}
                      >
                        Official Giveaway Rules
                      </a>{" "}
                      and acknowledge the{" "}
                      <a
                        href="#privacy-notice"
                        onClick={() => openTerms("privacy-notice")}
                      >
                        Privacy Notice
                      </a>
                      .{" "}
                      <span className={styles.required} aria-hidden="true">
                        *
                      </span>
                    </span>
                  </label>
                  <label className={styles.consent}>
                    <input type="checkbox" name="marketing_consent" />
                    <span>
                      {c.consent_text}
                      <small>
                        Optional. You can enter without subscribing.
                      </small>
                    </span>
                  </label>
                </fieldset>
                {error && (
                  <p role="alert" className={styles.error}>
                    {error}
                  </p>
                )}
                <Button
                  type="submit"
                  disabled={!canEnter || busy || !hydrated}
                  className={styles.submit}
                >
                  {busy ? "Submitting..." : "ENTER TO WIN"}
                  <ArrowRight size={21} aria-hidden="true" />
                </Button>
              </form>
              <p className={styles.disclosure}>
                No purchase necessary. One prize with an approximate retail
                value of CAD ${prizeValue}. One eligible entry per Realtor. Odds
                of winning depend on the number of eligible entries received.
                Selected entrant must satisfy the eligibility requirements,
                comply with the Official Rules
                {c.skill_question_required
                  ? " and correctly answer a skill-testing question"
                  : ""}{" "}
                before being confirmed as the winner.
              </p>
            </>
          )}
        </section>
      </div>
      <section className={styles.terms} aria-label="Giveaway terms">
        {[
          ["Official Rules", c.official_rules, "official-rules"],
          ["Prize terms", c.prize_terms, "prize-terms"],
          ["Privacy Notice", c.privacy_notice, "privacy-notice"],
        ].map(([title, body, id]) => (
          <details key={id} id={id}>
            <summary>{title}</summary>
            <p>{body}</p>
          </details>
        ))}
      </section>
      <footer className={styles.footer}>
        <a href="https://glarahome.com/" aria-label="Glara Staging home">
          <Wordmark />
        </a>
        <p>
          Beautiful Spaces.
          <br />
          Stronger Results.
        </p>
        <nav aria-label="Giveaway footer">
          <a href="#official-rules" onClick={() => openTerms("official-rules")}>
            View Official Rules
          </a>
          <a href="#privacy-notice" onClick={() => openTerms("privacy-notice")}>
            Privacy Notice
          </a>
          <a href="mailto:Support@glarahome.com">Contact</a>
        </nav>
      </footer>
    </div>
  );
}
