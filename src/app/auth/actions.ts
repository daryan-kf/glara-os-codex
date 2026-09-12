"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";
import { logEvent } from "@/lib/logger";
export type AuthState = { error?: string; success?: string };
const emailSchema = z.email().max(254);
export async function login(
  _state: AuthState,
  form: FormData,
): Promise<AuthState> {
  const input = z
    .object({ email: emailSchema, password: z.string().min(1).max(128) })
    .safeParse({ email: form.get("email"), password: form.get("password") });
  if (!input.success)
    return { error: "Enter a valid email address and password." };
  if (!isConfigured())
    return {
      error: "Authentication is not configured. Contact your administrator.",
    };
  const client = await createClient();
  const { error } = await client.auth.signInWithPassword(input.data);
  if (error) {
    logEvent("auth_failed");
    return {
      error: "Unable to sign in. Check your details or try again later.",
    };
  }
  redirect("/dashboard");
}
export async function logout() {
  if (isConfigured()) {
    const client = await createClient();
    const { error } = await client.auth.signOut();
    if (error) {
      logEvent("logout_failed");
      redirect("/login?status=logout-error");
    }
  }
  redirect("/login");
}
export async function resetPassword(
  _state: AuthState,
  form: FormData,
): Promise<AuthState> {
  const email = emailSchema.safeParse(form.get("email"));
  if (!email.success) return { error: "Enter a valid email address." };
  if (!isConfigured())
    return {
      error: "Authentication is not configured. Contact your administrator.",
    };
  const client = await createClient();
  // Always return the same response to avoid exposing registered email addresses.
  await client.auth.resetPasswordForEmail(email.data);
  return {
    success:
      "If an account exists for this email, you will receive a password reset link.",
  };
}
export async function updatePassword(
  _state: AuthState,
  form: FormData,
): Promise<AuthState> {
  const input = z
    .object({ password: z.string().min(12).max(128), confirm: z.string() })
    .refine((data) => data.password === data.confirm)
    .safeParse({
      password: form.get("password"),
      confirm: form.get("confirm"),
    });
  if (!input.success)
    return {
      error: "Use at least 12 characters and make sure both passwords match.",
    };
  const client = await createClient();
  const {
    data: { user },
    error: authError,
  } = await client.auth.getUser();
  if (authError || !user)
    return {
      error: "Your session expired. Request a new password reset link.",
    };
  const { error } = await client.auth.updateUser({
    password: input.data.password,
  });
  if (error)
    return {
      error:
        "Unable to update your password. Try a new link or a different password.",
    };
  await client.auth.signOut();
  redirect("/login?status=password-updated");
}
