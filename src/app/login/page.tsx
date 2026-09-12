import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { AuthLayout } from "@/components/auth-layout";
import { isConfigured } from "@/lib/env";
const messages: Record<string, string> = {
  "invalid-link":
    "This link is invalid or has expired. Request a new password reset link.",
  "password-updated": "Password updated. Sign in with your new password.",
  "logout-error":
    "Sign out could not be completed. Please try signing out again.",
};
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const { status } = await searchParams;
  const configured = isConfigured();
  return (
    <AuthLayout
      title="Welcome back."
      description="Sign in to your workspace. A considered start to every day."
    >
      {!configured && (
        <p
          role="status"
          className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950"
        >
          Workspace setup is in progress. Your administrator needs to connect
          authentication before sign-in is available.
        </p>
      )}
      {status && messages[status] && (
        <p role="status" className="mb-5 text-sm">
          {messages[status]}
        </p>
      )}
      <AuthForm mode="login" disabled={!configured} />
      <Link
        href="/forgot-password"
        className="mt-5 inline-block py-2 text-sm underline underline-offset-4"
      >
        Forgot password?
      </Link>
    </AuthLayout>
  );
}
