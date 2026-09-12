import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";
import { isRole, canAccess, type Module } from "@/lib/permissions";
import { logEvent } from "@/lib/logger";
export const requireUser = cache(async () => {
  if (!isConfigured()) redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) redirect("/login");
  const [profile, assigned] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, display_name, deleted_at")
      .eq("id", user.id)
      .maybeSingle(),
    supabase.from("user_roles").select("role").eq("user_id", user.id),
  ]);
  if (profile.error || assigned.error) {
    logEvent("profile_load_failed");
    throw new Error("Unable to load account access.");
  }
  if (!profile.data || profile.data.deleted_at) redirect("/unauthorized");
  const roles = (assigned.data ?? [])
    .map((row) => String(row.role))
    .filter(isRole);
  if (!roles.length) redirect("/unauthorized");
  return {
    id: user.id,
    email: user.email ?? "",
    name: String(profile.data.display_name || "Team member"),
    roles,
  };
});
export async function requireModule(module: Module) {
  const user = await requireUser();
  if (!canAccess(user.roles, module)) redirect("/unauthorized");
  return user;
}
