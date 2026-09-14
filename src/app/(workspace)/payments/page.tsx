import { requireModule } from "@/lib/auth";
import { Receivables } from "@/components/commercial/receivables";
export default async function Page() {
  await requireModule("payments");
  return <Receivables />;
}
