"use client";
import Link from "next/link";
import { useConvexAuth } from "convex/react";
import { Button } from "@/components/ui/button";
export function AuthenticatedWorkspace({
  children,
}: {
  children: React.ReactNode;
}) {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading)
    return (
      <p role="status" className="p-8 text-sm text-muted-foreground">
        Connecting to your workspace…
      </p>
    );
  if (!isAuthenticated)
    return (
      <section className="mx-auto mt-16 max-w-lg rounded-2xl border bg-card p-8">
        <h1 className="text-2xl font-semibold">Reconnect to your workspace</h1>
        <p className="my-4 text-muted-foreground">
          Please sign in again to continue.
        </p>
        <Button asChild>
          <Link href="/login">Sign in</Link>
        </Button>
      </section>
    );
  return children;
}
