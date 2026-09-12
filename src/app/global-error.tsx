"use client";
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main style={{ padding: 40, fontFamily: "sans-serif" }}>
          <h1>Glara OS could not load</h1>
          <p>Please try again or contact your administrator.</p>
          <button onClick={reset}>Try again</button>
        </main>
      </body>
    </html>
  );
}
