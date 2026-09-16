export function applicationOrigin(
  value: string | undefined,
  environment?: string,
) {
  if (!value) throw Error("Application origin unavailable");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw Error("Application origin unavailable");
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        loopback &&
        environment !== "production"
      )) ||
    (environment === "production" && loopback)
  )
    throw Error("Application origin unavailable");
  return url.origin;
}
export function authenticationRedirect(
  redirectTo: string,
  base: string | undefined,
  environment?: string,
) {
  const origin = applicationOrigin(base, environment);
  const target = new URL(redirectTo, origin);
  if (
    redirectTo.length > 2048 ||
    target.origin !== origin ||
    target.username ||
    target.password ||
    !["/login", "/update-password", "/dashboard"].includes(target.pathname)
  )
    throw Error("Redirect not allowed");
  return target.toString();
}
export function hstsHeader(environment?: string, httpsReady?: string) {
  return environment === "production" && httpsReady === "true"
    ? [{ key: "Strict-Transport-Security", value: "max-age=31536000" }]
    : [];
}
