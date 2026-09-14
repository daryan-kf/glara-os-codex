import { requireModule } from "@/lib/auth";
import { redirect } from "next/navigation";
import { OperationsSettings } from "@/components/operations/settings";
export default async function Page() {
  const u = await requireModule("projects");
  if (!u.roles.some((r) => r === "owner" || r === "admin"))
    redirect("/unauthorized");
  return <OperationsSettings />;
}
