import "server-only";
import { fetchQuery, fetchMutation } from "convex/nextjs";
import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "../../convex/_generated/api";
export async function readCrm(input: unknown) {
  return fetchQuery(
    api.crm.read,
    { input: JSON.stringify(input) },
    { token: await convexAuthNextjsToken() },
  );
}
export async function writeCrm(input: unknown) {
  return fetchMutation(
    api.crm.write,
    { input: JSON.stringify(input) },
    { token: await convexAuthNextjsToken() },
  );
}
