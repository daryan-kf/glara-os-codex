import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";
import { NextResponse, NextRequest, type NextFetchEvent } from "next/server";
import { productionCapabilityAllowed } from "@/lib/security/preflight";
import { isConfigured } from "@/lib/env";
import { readLimitedBody, RequestBodyError } from "@/lib/security/http";
import { contentSecurityPolicy } from "@/lib/security/csp";
import { campaignPathAllowed } from "@/lib/campaigns/public-deployment";
const authProxy = convexAuthNextjsMiddleware(undefined, {
  cookieConfig: { maxAge: 7 * 24 * 60 * 60 },
  shouldHandleCode: false,
});
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  const campaignOnly = process.env.GLARA_PUBLIC_CAMPAIGN_ONLY === "true";
  if (campaignOnly && !campaignPathAllowed(request.nextUrl.pathname))
    return new NextResponse("Not found", {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  if (
    process.env.GLARA_ENVIRONMENT === "production" &&
    (process.env.GLARA_PRODUCTION_APPROVED !== "true" ||
      process.env.GLARA_RECOVERY_MODE === "true")
  )
    return new NextResponse("Glara OS is not open for access yet.", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  if (request.nextUrl.pathname.replace(/\/$/, "") === "/api/auth") {
    const failure = (status: number) =>
      NextResponse.json(
        { error: "Authentication request unavailable." },
        { status, headers: { "Cache-Control": "no-store" } },
      );
    if (request.method !== "POST") return failure(405);
    if (request.headers.get("origin") !== request.nextUrl.origin)
      return failure(403);
    if (
      !["application/json", "text/plain"].includes(
        (request.headers.get("content-type") ?? "").split(";")[0].trim(),
      )
    )
      return failure(415);
    try {
      const body = await readLimitedBody(request.clone(), 8192);
      const parsed: unknown = JSON.parse(body);
      if (!parsed || typeof parsed !== "object" || !("action" in parsed))
        return failure(400);
      if (parsed.action !== "auth:signIn" && parsed.action !== "auth:signOut")
        return failure(400);
      // The supported SDK omits args for sign-out. Normalize only this action.
      const args = "args" in parsed ? parsed.args : undefined;
      if (
        parsed.action === "auth:signIn" &&
        (!args || typeof args !== "object" || Array.isArray(args))
      )
        return failure(400);
      if (
        args !== undefined &&
        (!args || typeof args !== "object" || Array.isArray(args))
      )
        return failure(400);
      request = new NextRequest(request, {
        body: JSON.stringify({ action: parsed.action, args: args ?? {} }),
      });
    } catch (error) {
      return failure(error instanceof RequestBodyError ? error.status : 400);
    }
  }
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(
    nonce,
    process.env.NEXT_PUBLIC_CONVEX_URL,
    process.env.NODE_ENV === "development",
    process.env.GLARA_RECOVERY_MODE !== "true" &&
      productionCapabilityAllowed(process.env, "address_lookup"),
  );
  // Replace untrusted client headers before Next extracts the request nonce.
  request.headers.set("x-nonce", nonce);
  request.headers.set("Content-Security-Policy", csp);
  let response =
    isConfigured() && !campaignOnly
      ? await authProxy(request, event)
      : NextResponse.next({ request: { headers: request.headers } });
  if (
    response &&
    request.nextUrl.pathname.replace(/\/$/, "") === "/api/auth" &&
    response.status >= 400
  ) {
    response = new NextResponse(
      JSON.stringify({ error: "Authentication request unavailable." }),
      { status: response.status, headers: response.headers },
    );
  }
  if (response) {
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Content-Security-Policy", csp);
  }
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
