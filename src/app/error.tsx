"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section
      role="alert"
      className="mx-auto max-w-lg rounded-2xl border bg-card p-8"
    >
      <h1 className="text-2xl font-semibold">Something didn’t load.</h1>
      <p className="my-4 text-muted-foreground">
        Please try again. If this continues, contact your administrator.
      </p>
      <Button onClick={reset}>Try again</Button>
    </section>
  );
}
