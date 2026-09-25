// The public campaign deployment must never expose staff routes or authentication.
export function campaignPathAllowed(pathname: string) {
  return (
    ["/win", "/giveaway/pacificwest-2026", "/api/giveaway"].includes(
      pathname.replace(/\/$/, ""),
    ) || pathname.startsWith("/glara-win-assets/_next/static/")
  );
}
