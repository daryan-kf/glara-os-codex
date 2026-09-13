"use client";
import { reloadAfterAuth } from "@/lib/auth-navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { Button } from "./ui/button";
export function SignOutButton() {
  const { signOut } = useAuthActions();
  return (
    <Button
      variant="outline"
      onClick={async () => {
        try {
          await signOut();
          reloadAfterAuth("/login");
        } catch {
          reloadAfterAuth("/login?status=logout-error");
        }
      }}
    >
      Sign out
    </Button>
  );
}
