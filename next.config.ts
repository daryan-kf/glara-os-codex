import { hstsHeader } from "./src/lib/security/origin";
import type { NextConfig } from "next";
const config: NextConfig = {
  poweredByHeader: false,
  assetPrefix:
    process.env.GLARA_PUBLIC_CAMPAIGN_ROUTING === "true"
      ? "/glara-win-assets"
      : undefined,
  turbopack: { root: process.cwd() },
  async rewrites() {
    return [{ source: "/win", destination: "/giveaway/pacificwest-2026" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          ...hstsHeader(
            process.env.GLARA_ENVIRONMENT,
            process.env.GLARA_HTTPS_READY,
          ),
          {
            key: "Content-Security-Policy",
            value:
              "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};
export default config;
