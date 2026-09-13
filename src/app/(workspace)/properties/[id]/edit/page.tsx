import { requireModule } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { recordId } from "@/lib/crm/model";
import { PropertyEditor } from "@/components/sales/properties";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireModule("properties");
  const { id } = await params;
  if (!recordId.safeParse(id).success) notFound();
  if (!user.roles.some((r) => ["owner", "sales", "admin"].includes(r)))
    redirect("/unauthorized");
  return <PropertyEditor id={id} />;
}
