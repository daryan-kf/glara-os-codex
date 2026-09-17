import type { Metadata } from "next";
import "./globals.css";
import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexProvider } from "@/components/convex-provider";
import { isConfigured } from "@/lib/env";
import { connection } from "next/server";
export const metadata: Metadata = {
  title: { default: "Glara OS", template: "%s · Glara OS" },
  description: "The private workspace for Glara Home Staging.",
  robots: { index: false, follow: false },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  return (
    <html lang="en-CA">
      <body>
        {isConfigured() ? (
          <ConvexAuthNextjsServerProvider
            storage="inMemory"
            shouldHandleCode={false}
          >
            <ConvexProvider>{children}</ConvexProvider>
          </ConvexAuthNextjsServerProvider>
        ) : (
          children
        )}
      </body>
    </html>
  );
}
