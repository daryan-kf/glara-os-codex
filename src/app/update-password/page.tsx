import { AuthForm } from "@/components/auth-form";
import { AuthLayout } from "@/components/auth-layout";
import { isConfigured } from "@/lib/env";
export default function Page() {
  return (
    <AuthLayout
      title="Set your password."
      description="Enter your email verification code and a unique password with at least 6 characters."
    >
      <AuthForm mode="update" disabled={!isConfigured()} />
    </AuthLayout>
  );
}
