"use client";
import { useActionState } from "react";
import { login, resetPassword, updatePassword } from "@/app/auth/actions";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/primitives";
export function AuthForm({
  mode,
  disabled = false,
}: {
  mode: "login" | "reset" | "update";
  disabled?: boolean;
}) {
  const action =
    mode === "login"
      ? login
      : mode === "reset"
        ? resetPassword
        : updatePassword;
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-5">
      {mode !== "update" && (
        <FormField
          id="email"
          label="Work email"
          name="email"
          type="email"
          autoComplete="email"
          required
          maxLength={254}
          disabled={disabled || pending}
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
          disabled={disabled || pending}
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
        {state.error && (
          <p
            role="alert"
            className="rounded-lg bg-red-50 p-3 text-sm text-red-800"
          >
            {state.error}
          </p>
        )}
        {state.success && (
          <p className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">
            {state.success}
          </p>
        )}
      </div>
      <Button className="w-full" disabled={disabled || pending}>
        {pending
          ? "Please wait…"
          : mode === "login"
            ? "Sign in to Glara OS"
            : mode === "reset"
              ? "Send reset link"
              : "Save new password"}
      </Button>
    </form>
  );
}
