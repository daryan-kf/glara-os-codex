import { requireModule } from "@/lib/auth";
import { notFound } from "next/navigation";
import { recordId } from "@/lib/crm/model";
import { ProjectInventory } from "@/components/inventory/project";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModule("inventory");
  const { id } = await params;
  if (!recordId.safeParse(id).success) notFound();
  return <ProjectInventory id={id} />;
}
