import { requireModule } from "@/lib/auth";
import { Properties } from "@/components/sales/properties";
export default async function Page() {
  const user = await requireModule("properties");
  return (
    <Properties
      editable={user.roles.some((r) => ["owner", "sales", "admin"].includes(r))}
    />
  );
}
