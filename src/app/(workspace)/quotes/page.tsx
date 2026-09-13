import { requireModule } from "@/lib/auth";
import { Quotes } from "@/components/sales/quotes";
export default async function Page() {
  const user = await requireModule("quotes");
  void user;
  return <Quotes />;
}
