export const dynamic = "force-dynamic";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { AuthLayout } from "@/components/auth-layout";
import { isConfigured } from "@/lib/env";
export default function Page() {
  return (
    <AuthLayout
      title="A fresh start."
      description="Enter your work email and we’ll send a secure password reset link."
    >
      <AuthForm mode="reset" disabled={!isConfigured()} />
      <Link href="/login" className="mt-5 inline-block py-2 text-sm underline">
        Back to sign in
      </Link>
    </AuthLayout>
  );
}
