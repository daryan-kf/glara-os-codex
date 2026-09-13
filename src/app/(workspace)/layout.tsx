import { AuthenticatedWorkspace } from "@/components/authenticated-workspace";
import { requireUser } from "@/lib/auth";
import { Shell } from "@/components/shell";
export const dynamic = "force-dynamic";
export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  return (
    <AuthenticatedWorkspace>
      <Shell user={user}>{children}</Shell>
    </AuthenticatedWorkspace>
  );
}
