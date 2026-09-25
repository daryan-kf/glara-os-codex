import { isConfigured } from "@/lib/env";
import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { fetchAction } from "convex/nextjs";
import { api } from "../../../../convex/_generated/api";
import { registrationInput, intakeEnabled } from "@/lib/campaigns/model";
import { readLimitedBody, RequestBodyError } from "@/lib/security/http";
import { applicationOrigin } from "@/lib/security/origin";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const response = (status: string, code: number) =>
    Response.json(
      { status },
      { status: code, headers: { "Cache-Control": "no-store" } },
    );
  const secret = process.env.GLARA_EXPO_INGRESS_SECRET;
  if (
    !isConfigured() ||
    !intakeEnabled(process.env) ||
    !secret ||
    secret.length < 32
  )
    return response("unavailable", 503);
  try {
    const origin = applicationOrigin(
      process.env.SITE_URL,
      process.env.GLARA_ENVIRONMENT === "production"
        ? "production"
        : "development",
    );
    if (
      request.headers.get("origin") !== origin ||
      new URL(request.url).origin !== origin
    )
      return response("unavailable", 403);
    if (!request.headers.get("content-type")?.startsWith("application/json"))
      return response("invalid", 415);
    const input = await readLimitedBody(request, 6000),
      raw: unknown = JSON.parse(input);
    if (!registrationInput.safeParse(raw).success)
      return response("invalid", 400);
    // Vercel overwrites x-vercel-forwarded-for at its edge. Never trust a caller's generic forwarding header.
    // Other hosting requires an explicit trusted-proxy adapter before public intake can be used.
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(
      new URL(origin).hostname,
    );
    const ip =
      process.env.VERCEL === "1"
        ? request.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim()
        : loopback
          ? "127.0.0.1"
          : undefined;
    if (!ip || !isIP(ip)) return response("unavailable", 503);
    const timestamp = Date.now(),
      network_key = createHmac("sha256", secret).update(ip).digest("hex");
    const signature = createHmac("sha256", secret)
      .update(JSON.stringify([timestamp, network_key, input]))
      .digest("hex");
    const result = await fetchAction(api.campaignActions.submit, {
      input,
      network_key,
      timestamp,
      signature,
    });
    return response(
      result.status,
      ["received", "ineligible"].includes(result.status)
        ? 200
        : result.status === "retry"
          ? 429
          : result.status === "closed"
            ? 409
            : 503,
    );
  } catch (error) {
    return response(
      "unavailable",
      error instanceof RequestBodyError ? error.status : 503,
    );
  }
}
