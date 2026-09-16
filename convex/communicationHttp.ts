import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
export const webhook = httpAction(async (ctx, request) => {
  if (Number(request.headers.get("content-length") ?? 0) > 65536)
    return new Response("Too large", { status: 413 });
  const payload = await request.text();
  if (payload.length > 65536) return new Response("Too large", { status: 413 });
  const ok = await ctx.runAction(internal.communicationProvider.verifyEvent, {
    payload,
    id: request.headers.get("svix-id") ?? "",
    timestamp: request.headers.get("svix-timestamp") ?? "",
    signature: request.headers.get("svix-signature") ?? "",
  });
  return new Response(ok ? "Accepted" : "Invalid signature", {
    status: ok ? 200 : 400,
  });
});
export const unsubscribe = httpAction(async (ctx, request) => {
  const token = new URL(request.url).searchParams.get("token") ?? "";
  if (request.method === "POST") {
    if (
      !(await ctx.runMutation(internal.communicationDelivery.publicLimit, {}))
    )
      return new Response("Please try again shortly.", {
        status: 429,
        headers: { "Retry-After": "60" },
      });
    await ctx.runAction(internal.communicationProvider.unsubscribe, { token });
    return new Response("Your optional email preference has been processed.", {
      headers: {
        "Content-Type": "text/plain",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  }
  return new Response(
    '<!doctype html><html lang="en"><meta name="viewport" content="width=device-width"><title>Glara email preferences</title><h1>Optional email preferences</h1><p>Stop optional sales and marketing email. Essential service messages are evaluated separately.</p><form method="POST"><button>Unsubscribe from optional email</button></form></html>',
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
        "Content-Security-Policy":
          "default-src 'none'; form-action 'self'; frame-ancestors 'none'",
      },
    },
  );
});
