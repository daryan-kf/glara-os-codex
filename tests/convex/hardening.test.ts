import { createHmac } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { operationsFixture } from "../support/operations-unit-fixture";
import { internal } from "../../convex/_generated/api";
import { readLimitedBody } from "../../src/lib/security/http";
import {
  applicationOrigin,
  authenticationRedirect,
  hstsHeader,
} from "../../src/lib/security/origin";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
it("M10A webhook rejects multi-byte bodies by bytes before signature work", async () => {
  const f = await operationsFixture();
  const r = await f.t.fetch("/m9/webhook", {
    method: "POST",
    body: "é".repeat(40000),
    headers: {
      "svix-id": "test",
      "svix-timestamp": "1",
      "svix-signature": "test",
    },
  });
  expect(r.status).toBe(413);
});
it("M10A webhook rejects malformed length headers safely", async () => {
  const f = await operationsFixture();
  const r = await f.t.fetch("/m9/webhook", {
    method: "POST",
    body: "{}",
    headers: { "content-length": "not-a-number" },
  });
  expect(r.status).toBe(400);
  expect(r.headers.get("Cache-Control")).toBe("no-store");
});
it("M10A webhook respects its distributed processing budget", async () => {
  const f = await operationsFixture();
  await f.t.run((ctx) =>
    ctx.db.insert("communication_public_limits", {
      key: "webhook",
      count: 300,
      window: Math.floor(Date.now() / 60000),
    }),
  );
  const r = await f.t.fetch("/m9/webhook", {
    method: "POST",
    body: "{}",
    headers: {
      "svix-id": "test",
      "svix-timestamp": "1",
      "svix-signature": "test",
    },
  });
  expect(r.status).toBe(429);
  expect(r.headers.get("Retry-After")).toBe("60");
});
it("M10A unsubscribe rejects oversized ignored POST body", async () => {
  const f = await operationsFixture();
  const r = await f.t.fetch("/m9/unsubscribe?token=invalid", {
    method: "POST",
    body: "x".repeat(8193),
  });
  expect(r.status).toBe(413);
  expect(r.headers.get("Referrer-Policy")).toBe("no-referrer");
});

it("M10A streamed byte limit cancels before consuming an unbounded body", async () => {
  let cancelled = false;
  let chunks = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      chunks++;
      controller.enqueue(new Uint8Array(1000));
    },
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://test.invalid/", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  await expect(readLimitedBody(request, 1024)).rejects.toMatchObject({
    status: 413,
  });
  expect(cancelled).toBe(true);
  expect(chunks).toBeLessThan(5);
});
it("M10A stalled body fails within the deadline and is cancelled", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    cancel() {
      cancelled = true;
    },
  });
  const request = new Request("https://test.invalid/", {
    method: "POST",
    body: stream,
    duplex: "half",
  } as RequestInit);
  await expect(readLimitedBody(request, 1024, 10)).rejects.toMatchObject({
    status: 408,
  });
  expect(cancelled).toBe(true);
});
it("M10A byte reader preserves valid signed text and rejects malformed UTF-8", async () => {
  expect(
    await readLimitedBody(
      new Request("https://test.invalid/", { method: "POST", body: "é" }),
      2,
    ),
  ).toBe("é");
  await expect(
    readLimitedBody(
      new Request("https://test.invalid/", {
        method: "POST",
        body: new Uint8Array([255]),
      }),
      2,
    ),
  ).rejects.toMatchObject({ status: 400 });
});
it("M10A webhook budget and unsubscribe budget are isolated", async () => {
  const f = await operationsFixture();
  await f.t.run((ctx) =>
    ctx.db.insert("communication_public_limits", {
      key: "webhook",
      count: 300,
      window: Math.floor(Date.now() / 60000),
    }),
  );
  expect(
    await f.t.mutation(internal.communicationDelivery.publicLimit, {
      scope: "webhook",
    }),
  ).toBe(false);
  expect(
    await f.t.mutation(internal.communicationDelivery.publicLimit, {}),
  ).toBe(true);
});
it("M10A public preference GET remains non-mutating and token text is not reflected", async () => {
  const f = await operationsFixture();
  const r = await f.t.fetch(
    "/m9/unsubscribe?token=%3Cscript%3Esecret%3C/script%3E",
  );
  expect(r.status).toBe(200);
  expect(await r.text()).not.toContain("secret");
  expect(r.headers.get("Content-Security-Policy")).toContain(
    "frame-ancestors 'none'",
  );
  expect(
    await f.t.run((ctx) =>
      ctx.db.query("communication_public_limits").collect(),
    ),
  ).toEqual([]);
});
it("M10A auth origins reject insecure non-loopback, credentials and production loopback", () => {
  for (const base of [
    "http://example.test",
    "https://user:pass@example.test",
    "https://example.test/path",
    "https://example.test?x=1",
    "http://localhost:3000",
  ])
    expect(() => applicationOrigin(base, "production")).toThrow();
  expect(applicationOrigin("http://localhost:3000", "development")).toBe(
    "http://localhost:3000",
  );
  expect(applicationOrigin("https://example.test", "production")).toBe(
    "https://example.test",
  );
});
it("M10A redirects reject foreign origins, credentials and unapproved paths", () => {
  for (const target of [
    "https://attacker.invalid/login",
    "//attacker.invalid/dashboard",
    "https://user:pass@example.test/login",
    "/admin",
    "javascript:alert(1)",
  ])
    expect(() =>
      authenticationRedirect(target, "https://example.test", "production"),
    ).toThrow();
  expect(
    authenticationRedirect("/dashboard", "https://example.test", "production"),
  ).toBe("https://example.test/dashboard");
});
it("M10A HSTS needs explicit production HTTPS readiness and never preloads subdomains", () => {
  expect(hstsHeader(undefined, undefined)).toEqual([]);
  expect(hstsHeader("development", "true")).toEqual([]);
  expect(hstsHeader("production", "false")).toEqual([]);
  expect(hstsHeader("production", "true")).toEqual([
    { key: "Strict-Transport-Security", value: "max-age=31536000" },
  ]);
});

it("M10A signed Unicode HTTP webhook is accepted once; altered content is rejected", async () => {
  const f = await operationsFixture();
  const secretBytes = Buffer.from("fictional-m10a-signing-fixture-32");
  vi.stubEnv(
    "M9_RESEND_WEBHOOK_SECRET",
    "whsec_" + secretBytes.toString("base64"),
  );
  const id = "fictional-m10a-http-event";
  const timestamp = String(Math.floor(Date.now() / 1000));
  const payload = JSON.stringify({
    type: "email.delivered",
    created_at: new Date().toISOString(),
    data: { email_id: "fictional-m10a-email", subject: "Fictional café" },
  });
  const headers = {
    "svix-id": id,
    "svix-timestamp": timestamp,
    "svix-signature":
      "v1," +
      createHmac("sha256", secretBytes)
        .update(`${id}.${timestamp}.${payload}`)
        .digest("base64"),
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await f.t.fetch("/m9/webhook", {
      method: "POST",
      headers,
      body: payload,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  }
  const altered = await f.t.fetch("/m9/webhook", {
    method: "POST",
    headers,
    body: payload.replace("café", "changed"),
  });
  expect(altered.status).toBe(400);
  expect(
    await f.t.run((ctx) =>
      ctx.db.query("communication_delivery_events").collect(),
    ),
  ).toHaveLength(1);
});
it("M10A signed body reader preserves the byte-order mark rather than stripping it", async () => {
  const payload = "\uFEFF{}";
  expect(
    await readLimitedBody(
      new Request("https://test.invalid/", {
        method: "POST",
        body: payload,
      }),
      8,
    ),
  ).toBe(payload);
});
