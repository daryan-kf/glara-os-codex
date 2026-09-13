import Link from "next/link";
import { SignOutButton } from "@/components/sign-out-button";
import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
export default function Page() {
  return (
    <AuthLayout
      title="Access is restricted."
      description="Your account does not have access to this area. Contact the company owner to review your assigned role."
    >
      <div className="flex gap-3">
        <Button asChild>
          <Link href="/dashboard">Go to dashboard</Link>
        </Button>
        <SignOutButton />
      </div>
    </AuthLayout>
  );
}
