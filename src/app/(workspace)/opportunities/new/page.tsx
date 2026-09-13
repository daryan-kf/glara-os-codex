import { requireModule } from "@/lib/auth";
import { redirect } from "next/navigation";
import { OpportunityEditor } from "@/components/sales/opportunities";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; opportunity?: string }>;
}) {
  const user = await requireModule("opportunities");
  if (!user.roles.some((r) => ["owner", "sales", "admin"].includes(r)))
    redirect("/unauthorized");
  const p = await searchParams;
  return <OpportunityEditor propertyId={p.property} />;
}
