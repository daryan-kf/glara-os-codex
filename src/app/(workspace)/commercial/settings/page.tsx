import { requireModule } from "@/lib/auth";
import { CommercialSettings } from "@/components/commercial/settings";
export default async function Page() {
  await requireModule("payments");
  return <CommercialSettings />;
}
