import { requireModule } from "@/lib/auth";
import { redirect } from "next/navigation";
import { PropertyEditor } from "@/components/sales/properties";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; opportunity?: string }>;
}) {
  const user = await requireModule("properties");
  if (!user.roles.some((r) => ["owner", "sales", "admin"].includes(r)))
    redirect("/unauthorized");
  await searchParams;
  return <PropertyEditor />;
}
