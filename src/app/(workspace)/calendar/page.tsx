import { CalendarConnections } from "@/components/communications/calendar";
import { requireModule } from "@/lib/auth";
import { OperationsCalendar } from "@/components/operations/list";
export default async function Page() {
  const user = await requireModule("calendar");
  return (
    <>
      <OperationsCalendar />
      {user.communications_version === 1 &&
        user.roles.some((r) => r === "owner" || r === "admin") && (
          <details className="mt-8 rounded-2xl border p-5">
            <summary className="min-h-11 cursor-pointer font-semibold">
              External calendar projections
            </summary>
            <CalendarConnections />
          </details>
        )}
    </>
  );
}
