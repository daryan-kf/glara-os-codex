import { fixtureUsers, createTestDatabase, rpc, asUser } from "./database";
// Test-only HTTP contract double. Never imported by the application.
import { createServer } from "node:http";
import { createHmac, randomUUID } from "node:crypto";
const users = fixtureUsers;
const database = createTestDatabase();
const revoked = new Set<string>();
function token(id: string) {
  const encode = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const body =
    encode({ alg: "HS256", typ: "JWT" }) +
    "." +
    encode({
      sub: id,
      aud: "authenticated",
      role: "authenticated",
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
      session_id: randomUUID(),
    });
  return (
    body +
    "." +
    createHmac("sha256", "fictional-test-signing-key")
      .update(body)
      .digest("base64url")
  );
}
createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1:54329");
  const send = (status: number, data: unknown) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(data));
  };
  let raw = "";
  for await (const chunk of request) raw += chunk;
  const body = raw ? (JSON.parse(raw) as Record<string, string>) : {};
  const jwt = request.headers.authorization?.replace("Bearer ", "") ?? "";
  let sub = "";
  try {
    sub = JSON.parse(
      Buffer.from(jwt.split(".")[1], "base64url").toString(),
    ).sub;
  } catch {
    /* Public request. */
  }
  const entry = Object.entries(users).find(([, user]) => user.id === sub);
  const identity = entry
    ? {
        id: entry[1].id,
        email: entry[0],
        aud: "authenticated",
        role: "authenticated",
        created_at: "2026-01-01T00:00:00Z",
        app_metadata: { provider: "email" },
        user_metadata: {},
      }
    : null;
  if (url.pathname === "/health") {
    await database;
    return send(200, { ok: true });
  }
  if (url.pathname === "/auth/v1/token") {
    const user = users[body.email as keyof typeof users];
    if (!user || body.password !== "Fictional-password-123!")
      return send(400, {
        code: "invalid_credentials",
        msg: "Invalid login credentials",
      });
    return send(200, {
      access_token: token(user.id),
      token_type: "bearer",
      expires_in: 3600,
      refresh_token: randomUUID(),
      user: {
        id: user.id,
        email: body.email,
        aud: "authenticated",
        role: "authenticated",
        app_metadata: { provider: "email" },
        user_metadata: {},
        created_at: "2026-01-01T00:00:00Z",
      },
    });
  }
  if (url.pathname === "/auth/v1/recover") return send(200, {});
  if (!identity || revoked.has(jwt))
    return send(401, { code: "bad_jwt", msg: "Not authenticated" });
  if (url.pathname === "/auth/v1/user") return send(200, identity);
  if (url.pathname === "/auth/v1/logout") {
    revoked.add(jwt);
    return send(200, {});
  }
  if (url.pathname.startsWith("/rest/v1/rpc/")) {
    const name = url.pathname.split("/").pop();
    if (name !== "crm_query" && name !== "crm_mutate") return send(404, {});
    try {
      return send(
        200,
        await rpc(await database, identity.id, name, body.p_input),
      );
    } catch (error) {
      const err = error as { message: string; code?: string };
      return send(400, { message: err.message, code: err.code ?? "P0001" });
    }
  }
  if (url.pathname === "/rest/v1/profiles")
    return send(
      200,
      (
        await asUser(await database, identity.id, (tx) =>
          tx.query(
            "select id,display_name,deleted_at from profiles where id=$1",
            [identity.id],
          ),
        )
      ).rows[0] ?? null,
    );
  if (url.pathname === "/rest/v1/user_roles")
    return send(200, [{ role: entry![1].role }]);
  return send(404, { message: "No test fixture for this endpoint" });
}).listen(54329, "127.0.0.1");
