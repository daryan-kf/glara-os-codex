import { readFileSync } from "node:fs";
export function credentials(role = "owner") {
  const state = JSON.parse(process.env.GLARA_CONVEX_IDENTITIES ?? "{}");
  const url =
    process.env.NEXT_PUBLIC_CONVEX_URL ??
    readFileSync(".env.local", "utf8").match(
      /^NEXT_PUBLIC_CONVEX_URL=["']?([^"'\r\n]+)/m,
    )?.[1];
  if (
    process.env.GLARA_CONVEX_ACCEPTANCE !== "yes" ||
    state.url !== url ||
    !state.deployment ||
    !url?.includes(state.deployment + ".")
  )
    throw new Error(
      "Explicit disposable Convex identity configuration required",
    );
  const user = state.users?.[role] as
    { email: string; password: string; id: string } | undefined;
  if (!user?.email.endsWith("@accounts.example.test"))
    throw new Error("Reserved fictional identity required");
  return user;
}
