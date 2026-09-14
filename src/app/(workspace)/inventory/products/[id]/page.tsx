import { requireModule } from "@/lib/auth";
import { redirect, notFound } from "next/navigation";
import { recordId } from "@/lib/crm/model";
import { ProductDetail } from "@/components/inventory/catalog";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireModule("inventory");
  if (!user.roles.some((r) => ["owner", "admin", "designer"].includes(r)))
    redirect("/unauthorized");
  const { id } = await params;
  if (!recordId.safeParse(id).success) notFound();
  return <ProductDetail id={id} />;
}
