import assert from "node:assert/strict";
import test from "node:test";
import {
  authorizationSession,
  scope,
  redirectUri,
} from "../scripts/m9-google-authorize.mjs";
const credentials = {
  clientId: "fictional-client",
  clientSecret: "fictional-secret",
};
function callback(s) {
  const p = new URL(s.authorizeUrl).searchParams;
  return new URLSearchParams({ state: p.get("state"), code: "fictional-code" });
}
test("Google setup requests only app-created Calendar scope, loopback and PKCE", () => {
  const s = authorizationSession({ ...credentials, save: () => {} }),
    u = new URL(s.authorizeUrl);
  assert.equal(u.origin, "https://accounts.google.com");
  assert.equal(u.searchParams.get("scope"), scope);
  assert.equal(u.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.equal(u.searchParams.get("access_type"), "offline");
  assert.ok(!s.authorizeUrl.includes(credentials.clientSecret));
});
test("Google setup rejects callback forgery and replay without provider calls", async () => {
  let calls = 0;
  const s = authorizationSession({
    ...credentials,
    save: () => {},
    request: async () => {
      calls++;
      return Response.json({}, { status: 400 });
    },
  });
  assert.equal(
    await s.callback(new URLSearchParams({ state: "wrong", code: "fake" })),
    "invalid_callback",
  );
  assert.equal(calls, 0);
  assert.equal(await s.callback(callback(s)), "token_exchange_failed");
  assert.equal(calls, 1);
  assert.equal(await s.callback(callback(s)), "invalid_callback");
  assert.equal(calls, 1);
});
test("Google setup refuses missing refresh token and broader grants", async () => {
  for (const tokens of [
    { access_token: "fake", scope },
    {
      access_token: "fake",
      refresh_token: "fake",
      scope: scope + " https://www.googleapis.com/auth/calendar",
    },
  ]) {
    const s = authorizationSession({
      ...credentials,
      save: () => assert.fail("must not save"),
      request: async () => Response.json(tokens),
    });
    assert.equal(await s.callback(callback(s)), "token_or_scope_invalid");
  }
});
test("Google setup creates only a dedicated calendar and saves credentials through private sink", async () => {
  const writes = [];
  let calls = 0;
  const s = authorizationSession({
    ...credentials,
    save: (k, v) => writes.push([k, v]),
    request: async (url, init) => {
      calls++;
      if (calls === 1) {
        assert.equal(url, "https://oauth2.googleapis.com/token");
        assert.equal(init.body.get("code_verifier").length, 64);
        return Response.json({
          access_token: "fictional-access",
          refresh_token: "fictional-refresh",
          scope,
        });
      }
      assert.equal(url, "https://www.googleapis.com/calendar/v3/calendars");
      const body = JSON.parse(init.body);
      assert.equal(body.summary, "Glara OS — Development Acceptance");
      assert.equal(body.timeZone, "America/Vancouver");
      assert.equal(body.attendees, undefined);
      return Response.json({ id: "fictional-dedicated-calendar" });
    },
  });
  assert.equal(await s.callback(callback(s)), "configured_sync_still_disabled");
  assert.deepEqual(writes, [
    ["M9_GOOGLE_REFRESH_TOKEN", "fictional-refresh"],
    ["M9_GOOGLE_CALENDAR_ID", "fictional-dedicated-calendar"],
  ]);
  assert.equal(calls, 2);
});
test("Google setup never retries ambiguous calendar creation or exposes provider errors", async () => {
  let calls = 0;
  const writes = [];
  const s = authorizationSession({
    ...credentials,
    save: (k) => writes.push(k),
    request: async () => {
      if (++calls === 1)
        return Response.json({
          access_token: "fictional-access",
          refresh_token: "fictional-refresh",
          scope,
        });
      throw Error("private provider data must not escape");
    },
  });
  assert.equal(
    await s.callback(callback(s)),
    "setup_requires_private_review_no_automatic_retry",
  );
  assert.equal(await s.callback(callback(s)), "invalid_callback");
  assert.equal(calls, 2);
  assert.deepEqual(writes, ["M9_GOOGLE_REFRESH_TOKEN"]);
});

test("Google callback rejects same-length non-ASCII state safely", async () => {
  const s = authorizationSession({
    ...credentials,
    save: () => assert.fail("must not save"),
    request: async () => assert.fail("must not request"),
  });
  assert.equal(
    await s.callback(
      new URLSearchParams({ state: "é".repeat(43), code: "fake" }),
    ),
    "invalid_callback",
  );
});
