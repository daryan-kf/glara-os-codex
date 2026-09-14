import { requireUser } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { recordId } from "@/lib/crm/model";
import { CommercialProject } from "@/components/commercial/project";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (!user.roles.some((r) => ["owner", "admin", "sales"].includes(r)))
    redirect("/unauthorized");
  const { id } = await params;
  if (!recordId.safeParse(id).success) notFound();
  return <CommercialProject id={id} />;
}
