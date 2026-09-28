"use client";
export default function ErrorPage() {
  return (
    <main className="mx-auto max-w-lg p-8">
      <h1 className="text-2xl font-semibold">Reconnect securely</h1>
      <p className="my-4">
        Your session ended or registrations are temporarily unavailable. Sign in
        again to continue.
      </p>
      <button
        onClick={() => window.location.replace("/campaign-admin")}
        className="inline-flex min-h-11 items-center rounded-lg border px-4"
      >
        Return to sign-in
      </button>
    </main>
  );
}
