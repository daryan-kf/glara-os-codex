import { requireModule } from "@/lib/auth";
import { InventoryCatalog } from "@/components/inventory/catalog";
import { Projects } from "@/components/operations/list";
import { PageTitle } from "@/components/primitives";
export default async function Page() {
  const user = await requireModule("inventory");
  if (!user.roles.some((r) => ["owner", "admin", "designer"].includes(r)))
    return (
      <>
        <PageTitle
          title="Inventory operations"
          description="Open an assigned project for its pick and return lists."
        />
        <Projects />
      </>
    );
  return <InventoryCatalog />;
}
