"use client";
import { reloadAfterAuth } from "@/lib/auth-navigation";
import { useState } from "react";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/primitives";
import Link from "next/link";
type Props = { mode: "login" | "reset" | "update"; disabled?: boolean };
export function AuthForm(props: Props) {
  return props.disabled ? (
    <Button className="w-full" disabled>
      Sign-in unavailable
    </Button>
  ) : (
    <ConnectedForm {...props} />
  );
}
function ConnectedForm({ mode }: Props) {
  const { signIn, signOut } = useAuthActions();
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function submit(form: FormData) {
    setPending(true);
    setError("");
    setSuccess("");
    const email = String(form.get("email") ?? "")
        .trim()
        .toLowerCase(),
      password = String(form.get("password") ?? "");
    if (
      mode === "update" &&
      (password.length < 12 || password !== form.get("confirm"))
    ) {
      setError(
        "Use at least 12 characters and make sure both passwords match.",
      );
      setPending(false);
      return;
    }
    try {
      if (mode === "login") {
        await signIn("password", { flow: "signIn", email, password });
        reloadAfterAuth("/dashboard");
      } else if (mode === "reset") {
        try {
          await signIn("password", { flow: "reset", email });
        } catch {
          /* Same response for unknown accounts and delivery errors. */
        }
        setSuccess(
          "If an account exists for this email, you will receive a password reset code.",
        );
      } else {
        await signIn("password", {
          flow: "reset-verification",
          email,
          code: String(form.get("code") ?? "").trim(),
          newPassword: password,
        });
        await signOut();
        reloadAfterAuth("/login?status=password-updated");
      }
    } catch {
      setError(
        mode === "login"
          ? "Unable to sign in. Check your details or try again later."
          : "This code is invalid or has expired. Request a new code.",
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <form action={submit} className="space-y-5">
      <FormField
        id="email"
        label="Work email"
        name="email"
        type="email"
        autoComplete="email"
        required
        maxLength={254}
        disabled={pending}
      />
      {mode === "update" && (
        <FormField
          id="code"
          label="Verification code"
          name="code"
          autoComplete="one-time-code"
          required
          maxLength={128}
          disabled={pending}
        />
      )}
      {mode !== "reset" && (
        <FormField
          id="password"
          label={mode === "update" ? "New password" : "Password"}
          name="password"
          type="password"
          autoComplete={mode === "update" ? "new-password" : "current-password"}
          required
          minLength={mode === "update" ? 12 : 1}
          maxLength={128}
          disabled={pending}
        />
      )}
      {mode === "update" && (
        <FormField
          id="confirm"
          label="Confirm password"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          maxLength={128}
          disabled={pending}
        />
      )}
      <div aria-live="polite">
        {error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {error}
          </p>
        )}
        {success && (
          <p
            role="status"
            className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
          >
            {success}
          </p>
        )}
      </div>
      <Button className="w-full" disabled={pending}>
        {pending
          ? "Please wait…"
          : mode === "login"
            ? "Sign in to Glara OS"
            : mode === "reset"
              ? "Send reset code"
              : "Save new password"}
      </Button>
      {mode === "reset" && (
        <Link href="/update-password" className="block text-sm underline">
          I have a verification code
        </Link>
      )}
    </form>
  );
}
