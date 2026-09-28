"use client";
import { useEffect, useState } from "react";
import {
  CAMPAIGN_PASSWORD_MIN_LENGTH,
  CAMPAIGN_PASSWORD_MAX_LENGTH,
  campaignPasswordValid,
} from "@/lib/campaigns/portal";
import {
  useConvexAuth,
  useQuery,
  usePaginatedQuery,
  useMutation,
} from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/primitives";

const date = (n: number) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(n);
const label = (s: string) => s.replaceAll("_", " ");
export function CampaignPortal() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const { signOut } = useAuthActions();
  const [check, setCheck] = useState(0);
  useEffect(() => {
    const refresh = () => setCheck((n) => n + 1);
    const timer = setInterval(refresh, 30000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const viewer = useQuery(
    api.campaignPortal.viewer,
    isAuthenticated ? { check } : "skip",
  );
  async function logout() {
    try {
      await signOut();
    } finally {
      window.location.replace("/campaign-admin");
    }
  }
  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-8">
      <header className="mb-8 flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">
            Glara Home Staging
          </p>
          <h1 className="mt-3 font-display text-3xl sm:text-4xl">
            Live registrations
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            PacificWest giveaway · Private Owner access
          </p>
        </div>
        {isAuthenticated && (
          <Button variant="outline" onClick={() => void logout()}>
            Sign out
          </Button>
        )}
      </header>
      {isLoading || (isAuthenticated && viewer === undefined) ? (
        <p role="status">Connecting securely…</p>
      ) : !isAuthenticated ? (
        <PortalSignIn />
      ) : !viewer ? (
        <section role="alert" className="rounded-2xl border bg-card p-6">
          <h2 className="text-xl font-semibold">Access unavailable</h2>
          <p className="mt-3">
            This account is not authorized, or your session has ended. Sign out
            and sign in with the approved Owner account.
          </p>
        </section>
      ) : (
        <Participants check={check} />
      )}
    </main>
  );
}
function PortalSignIn() {
  const { signIn, signOut } = useAuthActions();
  const [mode, setMode] = useState<"login" | "reset" | "code">("login");
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  async function submit(form: FormData) {
    setBusy(true);
    setMessage("");
    const email = String(form.get("email") ?? "")
      .trim()
      .toLowerCase();
    try {
      if (mode === "reset") {
        try {
          await signIn("password", { flow: "reset", email });
        } catch {
          /* Do not disclose whether an account exists. */
        }
        setMessage(
          "If this account is eligible and email setup is complete, a single-use code will arrive. Use the code to set your password.",
        );
      } else if (mode === "code") {
        const password = String(form.get("password") ?? "");
        if (
          !campaignPasswordValid(password) ||
          password !== form.get("confirm")
        ) {
          setMessage(
            `Use at least ${CAMPAIGN_PASSWORD_MIN_LENGTH} characters and matching passwords.`,
          );
          return;
        }
        await signIn("password", {
          flow: "reset-verification",
          email,
          code: String(form.get("code") ?? "").trim(),
          newPassword: password,
        });
        await signOut();
        setMode("login");
        setMessage("Password set. Sign in to continue.");
      } else {
        await signIn("password", {
          flow: "signIn",
          email,
          password: String(form.get("password") ?? ""),
        });
        window.location.replace("/campaign-admin");
      }
    } catch {
      setMessage(
        "Unable to continue. Check your details or request a new code.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mx-auto max-w-md rounded-2xl border bg-card p-6 sm:p-8">
      <h2 className="mb-5 text-2xl font-semibold">
        {mode === "login"
          ? "Owner sign-in"
          : mode === "reset"
            ? "Set or reset your password"
            : "Use your verification code"}
      </h2>
      <form action={submit} className="space-y-5">
        <FormField
          id="portal-email"
          label="Email address"
          name="email"
          type="email"
          autoComplete="username"
          maxLength={254}
          required
          disabled={busy}
        />
        {mode === "code" && (
          <FormField
            id="portal-code"
            label="Verification code"
            name="code"
            autoComplete="one-time-code"
            maxLength={CAMPAIGN_PASSWORD_MAX_LENGTH}
            required
            disabled={busy}
          />
        )}
        {mode !== "reset" && (
          <FormField
            id="portal-password"
            label={mode === "code" ? "New password" : "Password"}
            name="password"
            type="password"
            autoComplete={mode === "code" ? "new-password" : "current-password"}
            minLength={mode === "code" ? CAMPAIGN_PASSWORD_MIN_LENGTH : 1}
            maxLength={CAMPAIGN_PASSWORD_MAX_LENGTH}
            required
            disabled={busy}
          />
        )}
        {mode === "code" && (
          <FormField
            id="portal-confirm"
            label="Confirm new password"
            name="confirm"
            type="password"
            autoComplete="new-password"
            minLength={CAMPAIGN_PASSWORD_MIN_LENGTH}
            maxLength={CAMPAIGN_PASSWORD_MAX_LENGTH}
            required
            disabled={busy}
          />
        )}
        {message && (
          <p role="status" className="rounded-lg bg-muted p-3 text-sm">
            {message}
          </p>
        )}
        <Button className="w-full" disabled={busy}>
          {busy
            ? "Please wait…"
            : mode === "login"
              ? "View registrations"
              : mode === "reset"
                ? "Send setup code"
                : "Set password"}
        </Button>
      </form>
      <div className="mt-5 flex flex-wrap gap-4 text-sm">
        {mode !== "login" && (
          <button
            disabled={busy}
            className="min-h-11 underline"
            onClick={() => {
              setMode("login");
              setMessage("");
            }}
          >
            Back to sign-in
          </button>
        )}
        {mode === "login" && (
          <button
            disabled={busy}
            className="min-h-11 underline"
            onClick={() => {
              setMode("reset");
              setMessage("");
            }}
          >
            Set or reset password
          </button>
        )}
        {mode !== "code" && (
          <button
            disabled={busy}
            className="min-h-11 underline"
            onClick={() => {
              setMode("code");
              setMessage("");
            }}
          >
            I have a code
          </button>
        )}
      </div>
      <p className="mt-4 text-xs text-muted-foreground">
        Invitation only. This page does not create public accounts.
      </p>
    </section>
  );
}
function Participants({ check }: { check: number }) {
  const summary = useQuery(api.campaignPortal.summary, { check });
  const recordAccess = useMutation(api.campaignPortal.recordAccess);
  const [search, setSearch] = useState("");
  const { results, status, loadMore } = usePaginatedQuery(
    api.campaignPortal.registrations,
    { search, check },
    { initialNumItems: 25 },
  );
  useEffect(() => {
    void recordAccess().catch(() => {
      window.location.replace("/campaign-admin");
    });
  }, [recordAccess]);
  useEffect(() => {
    if (search.trim() && results.length < 10 && status === "CanLoadMore")
      loadMore(25);
  }, [search, results.length, status, loadMore]);
  if (summary === undefined)
    return <p role="status">Loading live registrations…</p>;
  if (!summary)
    return <p>Campaign is unavailable. Please contact your administrator.</p>;
  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">{summary.name}</p>
        <span className="rounded-full border bg-card px-3 py-1 text-xs font-medium">
          Live data · View only
        </span>
      </div>
      <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          ["Registrations", summary.total],
          ["Eligible", summary.eligible],
          ["Needs review", summary.review],
          ["Marketing opt-in", summary.optedIn],
        ].map(([name, count]) => (
          <section key={name} className="rounded-xl border bg-card p-4">
            <p className="text-sm text-muted-foreground">{name}</p>
            <p className="mt-2 text-3xl font-semibold">{count}</p>
          </section>
        ))}
      </div>
      <label htmlFor="participant-search" className="block text-sm font-medium">
        Find a participant
      </label>
      <input
        id="participant-search"
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        maxLength={100}
        placeholder="Name, email, phone, brokerage or city"
        className="mb-6 mt-2 min-h-12 w-full rounded-lg border bg-card px-4"
      />
      <div className="grid gap-4">
        {results.map((r) => (
          <article key={r.id} className="rounded-2xl border bg-card p-5 sm:p-6">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="text-xl font-semibold">
                  {r.first_name} {r.last_name}
                </h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {r.brokerage} · {r.city}
                </p>
              </div>
              <span className="rounded-full bg-muted px-3 py-1 text-xs">
                {label(r.eligibility)}
              </span>
            </div>
            <dl className="mt-5 grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
              {[
                ["Email", r.email],
                ["Phone", r.phone],
                ["Registered (Pacific)", date(r.entered_at)],
                ["Licensed Realtor", r.licensed_realtor ? "Yes" : "No"],
                [
                  "Licensed in BC",
                  r.licensed_in_bc === null
                    ? "Not recorded"
                    : r.licensed_in_bc
                      ? "Yes"
                      : "No",
                ],
                ["Listings per year", r.annual_listings],
                [
                  "Marketing consent",
                  r.marketing_consent ? "Opted in" : "Not opted in",
                ],
                ["Confirmation email", label(r.receipt_status)],
                ["CRM linkage", label(r.crm_origin)],
              ].map(([name, value]) => (
                <div key={name}>
                  <dt className="text-muted-foreground">{name}</dt>
                  <dd className="mt-1 break-words font-medium">{value}</dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
      {!results.length && status === "Exhausted" && (
        <p className="rounded-xl border border-dashed p-8 text-center">
          {search
            ? "No matching participants."
            : "No registrations yet. New entries will appear here automatically."}
        </p>
      )}
      {(status === "LoadingFirstPage" || status === "LoadingMore") && (
        <p role="status" className="mt-5">
          Loading participants…
        </p>
      )}
      {status === "CanLoadMore" && (
        <Button variant="outline" className="mt-5" onClick={() => loadMore(25)}>
          Load more participants
        </Button>
      )}
      <p className="mt-6 text-xs text-muted-foreground">
        Marketing permission is separate from giveaway entry. Delivered is the
        email provider’s delivery status, not a read receipt. Pending identities
        require review in the authorized campaign workflow.
      </p>
    </>
  );
}
