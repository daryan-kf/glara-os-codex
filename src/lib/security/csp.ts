export function contentSecurityPolicy(
  nonce: string,
  backend: string | undefined,
  development: boolean,
  addressLookup = false,
) {
  if (!/^[A-Za-z0-9+/=_-]{20,100}$/.test(nonce)) throw Error("Invalid nonce");
  const connections = ["'self'"];
  const images = ["'self'", "data:", "blob:"];
  if (backend) {
    const url = new URL(backend);
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      !(
        url.protocol === "https:" ||
        (development &&
          url.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(url.hostname))
      )
    )
      throw Error("Invalid backend origin");
    connections.push(url.origin, url.origin.replace(/^http/, "ws"));
    // Product and project media are served from Convex storage on the backend origin.
    images.push(url.origin);
  }
  // Address typeahead suggestions (OpenStreetMap/Photon); only typed address text is sent.
  if (addressLookup) connections.push("https://photon.komoot.io");
  if (development) connections.push("ws://localhost:*", "ws://127.0.0.1:*");
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    `img-src ${images.join(" ")}`,
    "font-src 'self'",
    `connect-src ${connections.join(" ")}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
  ].join("; ");
}
