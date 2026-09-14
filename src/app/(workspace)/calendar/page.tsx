import { requireModule } from "@/lib/auth";
import { OperationsCalendar } from "@/components/operations/list";
export default async function Page() {
  await requireModule("calendar");
  return <OperationsCalendar />;
}
