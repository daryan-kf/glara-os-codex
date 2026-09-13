import "server-only";
// All M0 auth is server-side; no browser client needs to read session tokens.
export const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
