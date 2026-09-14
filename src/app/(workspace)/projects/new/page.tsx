import { requireModule } from "@/lib/auth";
import { redirect } from "next/navigation";
import { recordId } from "@/lib/crm/model";
import { ProjectCreate } from "@/components/operations/create";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ opportunity?: string }>;
}) {
  await requireModule("projects");
  const p = await searchParams;
  if (!p.opportunity || !recordId.safeParse(p.opportunity).success)
    redirect("/opportunities");
  return <ProjectCreate opportunity={p.opportunity} />;
}
