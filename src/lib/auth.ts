import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { fetchQuery } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "../../convex/_generated/api";
import { isConfigured } from "./env";
import { canAccess, type Module } from "./permissions";
export const requireUser = cache(async () => {
  if (!isConfigured()) redirect("/login");
  const token = await convexAuthNextjsToken();
  if (!token) redirect("/login");
  const user = await fetchQuery(api.profiles.viewer, {}, { token });
  if (!user || user.deleted_at || !user.roles.length) redirect("/unauthorized");
  return user;
});
export async function requireModule(module: Module) {
  const user = await requireUser();
  if (!canAccess(user.roles, module)) redirect("/unauthorized");
  return user;
}
