import { requireModule } from "@/lib/auth";
import { redirect } from "next/navigation";

import { InventorySettings } from "@/components/inventory/catalog";
export default async function Page() {
  const user = await requireModule("inventory");
  if (!user.roles.some((r) => ["owner", "admin"].includes(r)))
    redirect("/unauthorized");
  return <InventorySettings />;
}
