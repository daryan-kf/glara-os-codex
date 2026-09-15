/** Temporary development fixture recovery; remove from deployed source after acceptance. */
import { internalAction, internalQuery } from "../../convex/functions";
import { makeFunctionReference } from "convex/server";
import { modifyAccountCredentials } from "@convex-dev/auth/server";
const roles = [
  "owner",
  "admin",
  "sales",
  "designer",
  "staging_crew",
  "marketing",
  "unassigned",
  "archived",
] as const;
const url = "https://woozy-jaguar-392.eu-west-1.convex.cloud";
function guard() {
  if (process.env.CONVEX_CLOUD_URL !== url) throw Error("Development only");
}
export const identities = internalQuery({
  args: {},
  handler: async (ctx) => {
    guard();
    const users = await ctx.db.query("users").take(1000);
    return roles.map((role) => {
      const email = "glara-convex-" + role + "@accounts.example.test";
      const user = users.find((x) => x.email === email);
      if (!user) throw Error("Existing fictional identity required");
      return { role, email, id: user._id };
    });
  },
});
export const recover = internalAction({
  args: {},
  handler: async (ctx): Promise<string> => {
    guard();
    const rows = await ctx.runQuery(
      makeFunctionReference<
        "query",
        Record<string, never>,
        { role: string; email: string; id: string }[]
      >("m8AcceptanceIdentity:identities"),
      {},
    );
    const users: Record<
      string,
      { email: string; id: string; password: string }
    > = {};
    for (const row of rows) {
      const password = crypto.randomUUID() + crypto.randomUUID();
      await modifyAccountCredentials(ctx, {
        provider: "password",
        account: { id: row.email, secret: password },
      });
      users[row.role] = { email: row.email, id: row.id, password };
    }
    return JSON.stringify({ url, deployment: "woozy-jaguar-392", users });
  },
});
