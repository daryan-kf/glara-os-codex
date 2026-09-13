import { requireModule } from "@/lib/auth";
import { Opportunities } from "@/components/sales/opportunities";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; realtor?: string }>;
}) {
  const user = await requireModule("opportunities");
  void user;
  const p = await searchParams;
  return <Opportunities propertyId={p.property} realtorId={p.realtor} />;
}
