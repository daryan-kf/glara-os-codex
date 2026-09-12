import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: { default: "Glara OS", template: "%s · Glara OS" },
  description: "The private workspace for Glara Home Staging.",
  robots: { index: false, follow: false },
};
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en-CA">
      <body>{children}</body>
    </html>
  );
}
