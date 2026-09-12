export const dynamic = "force-dynamic";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { AuthLayout } from "@/components/auth-layout";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";
export default async function Page() {
  if (!isConfigured()) redirect("/login");
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) redirect("/login?status=invalid-link");
  return (
    <AuthLayout
      title="Set your password."
      description="Choose a unique password with at least 12 characters."
    >
      <AuthForm mode="update" />
    </AuthLayout>
  );
}
