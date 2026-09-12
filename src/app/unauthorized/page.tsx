import Link from "next/link";
import { logout } from "@/app/auth/actions";
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
        <form action={logout}>
          <Button variant="outline">Sign out</Button>
        </form>
      </div>
    </AuthLayout>
  );
}
