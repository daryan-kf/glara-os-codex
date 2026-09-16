import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import {
  readLimitedBody,
  RequestBodyError,
  publicResponse,
} from "../src/lib/security/http";
export const webhook = httpAction(async (ctx, request) => {
  try {
    const payload = await readLimitedBody(request, 65536);
    const id = request.headers.get("svix-id") ?? "";
    const timestamp = request.headers.get("svix-timestamp") ?? "";
    const signature = request.headers.get("svix-signature") ?? "";
    if (
      !id ||
      id.length > 256 ||
      !timestamp ||
      timestamp.length > 32 ||
      !signature ||
      signature.length > 2048
    )
      return publicResponse("Invalid signature", 400);
    if (
      !(await ctx.runMutation(internal.communicationDelivery.publicLimit, {
        scope: "webhook",
      }))
    )
      return publicResponse("Please try again shortly.", 429, {
        "Retry-After": "60",
      });
    const ok = await ctx.runAction(internal.communicationProvider.verifyEvent, {
      payload,
      id,
      timestamp,
      signature,
    });
    return publicResponse(
      ok ? "Accepted" : "Invalid signature",
      ok ? 200 : 400,
    );
  } catch (error) {
    return publicResponse(
      "Request could not be processed.",
      error instanceof RequestBodyError ? error.status : 503,
    );
  }
});
export const unsubscribe = httpAction(async (ctx, request) => {
  try {
    const token = new URL(request.url).searchParams.get("token") ?? "";
    if (token.length > 128) return publicResponse("Invalid request.", 400);
    if (request.method === "POST") {
      await readLimitedBody(request, 8192);
      if (
        !(await ctx.runMutation(internal.communicationDelivery.publicLimit, {}))
      )
        return publicResponse("Please try again shortly.", 429, {
          "Retry-After": "60",
        });
      await ctx.runAction(internal.communicationProvider.unsubscribe, {
        token,
      });
      return publicResponse(
        "Your optional email preference has been processed.",
      );
    }
    return publicResponse(
      '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Glara email preferences</title><h1>Optional email preferences</h1><p>Stop optional sales and marketing email. Essential service messages are evaluated separately.</p><form method="POST"><button>Unsubscribe from optional email</button></form></html>',
      200,
      { "Content-Type": "text/html; charset=utf-8" },
    );
  } catch (error) {
    return publicResponse(
      "Request could not be processed.",
      error instanceof RequestBodyError ? error.status : 503,
    );
  }
});
