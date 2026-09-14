import { requireModule } from "@/lib/auth";
import { notFound } from "next/navigation";
import { recordId } from "@/lib/crm/model";
import { ProjectDetail } from "@/components/operations/detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireModule("projects");
  const { id } = await params;
  if (!recordId.safeParse(id).success) notFound();
  return <ProjectDetail id={id} />;
}
