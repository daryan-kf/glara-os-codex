"use client";
import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import { reloadAfterAuth } from "@/lib/auth-navigation";
import { Button } from "@/components/ui/button";
import { Avatar, FormField, StatusBadge } from "@/components/primitives";
import { roleLabel, type Role } from "@/lib/permissions";
type Identity = { name: string; email: string; roles: readonly Role[] };
function Notice({ error, success }: { error: string; success: string }) {
  return (
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
  );
}
function NameForm({ initialName }: { initialName: string }) {
  const updateName = useMutation(api.profiles.updateName);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function submit(form: FormData) {
    setPending(true);
    setError("");
    setSuccess("");
    const name = String(form.get("name") ?? "").trim();
    if (!name || name.length > 120) {
      setError("Enter a display name of 1 to 120 characters.");
      setPending(false);
      return;
    }
    try {
      await updateName({ name });
      setSuccess("Display name updated.");
    } catch {
      setError("Unable to update your display name. Try again later.");
    } finally {
      setPending(false);
    }
  }
  return (
    <form action={submit} className="space-y-5">
      <FormField
        id="profile-name"
        label="Display name"
        name="name"
        defaultValue={initialName}
        autoComplete="name"
        required
        maxLength={120}
        disabled={pending}
      />
      <Notice error={error} success={success} />
      <Button disabled={pending}>
        {pending ? "Please wait…" : "Save display name"}
      </Button>
    </form>
  );
}
function PasswordForm() {
  const changePassword = useAction(api.profiles.changePassword);
  const { signOut } = useAuthActions();
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function submit(form: FormData) {
    setPending(true);
    setError("");
    const currentPassword = String(form.get("current") ?? ""),
      newPassword = String(form.get("password") ?? "");
    if (newPassword.length < 6 || newPassword !== form.get("confirm")) {
      setError("Use at least 6 characters and make sure both passwords match.");
      setPending(false);
      return;
    }
    if (newPassword === currentPassword) {
      setError("Choose a password different from your current one.");
      setPending(false);
      return;
    }
    try {
      await changePassword({ currentPassword, newPassword });
      // The change signs out every session; clear local auth state and return to login.
      await signOut().catch(() => {});
      reloadAfterAuth("/login?status=password-updated");
    } catch {
      setError(
        "Unable to change the password. Check your current password or try again later.",
      );
      setPending(false);
    }
  }
  return (
    <form action={submit} className="space-y-5">
      <FormField
        id="profile-current-password"
        label="Current password"
        name="current"
        type="password"
        autoComplete="current-password"
        required
        maxLength={128}
        disabled={pending}
      />
      <FormField
        id="profile-new-password"
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={6}
        maxLength={128}
        disabled={pending}
      />
      <FormField
        id="profile-confirm-password"
        label="Confirm new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        maxLength={128}
        disabled={pending}
      />
      <Notice error={error} success="" />
      <Button disabled={pending}>
        {pending ? "Please wait…" : "Change password"}
      </Button>
      <p className="text-sm text-muted-foreground">
        Changing your password signs you out everywhere, and you sign back in
        with the new password.
      </p>
    </form>
  );
}
export function ProfileSettings({ user }: { user: Identity }) {
  const viewer = useQuery(api.profiles.viewer);
  const name = viewer?.name ?? user.name;
  return (
    <div className="max-w-2xl space-y-8">
      <section className="rounded-2xl border bg-card p-8">
        <div className="mb-8 flex items-center gap-4">
          <Avatar name={name} />
          <h2 className="text-xl font-semibold">{name}</h2>
        </div>
        <dl className="space-y-6">
          <div>
            <dt className="text-sm text-muted-foreground">Work email</dt>
            <dd className="mt-1 break-all">{user.email}</dd>
          </div>
          <div>
            <dt className="mb-2 text-sm text-muted-foreground">
              Assigned roles
            </dt>
            <dd className="flex flex-wrap gap-2">
              {user.roles.map((role) => (
                <StatusBadge key={role}>{roleLabel(role)}</StatusBadge>
              ))}
            </dd>
          </div>
        </dl>
        <p className="mt-8 border-t pt-6 text-sm text-muted-foreground">
          Roles and access are managed by your company owner.
        </p>
      </section>
      <section className="rounded-2xl border bg-card p-8">
        <h2 className="mb-6 text-lg font-semibold">Display name</h2>
        <NameForm initialName={name} />
      </section>
      <section className="rounded-2xl border bg-card p-8">
        <h2 className="mb-6 text-lg font-semibold">Change password</h2>
        <PasswordForm />
      </section>
    </div>
  );
}
