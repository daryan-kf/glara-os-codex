import { requireModule } from "@/lib/auth";
import { redirect } from "next/navigation";
import { QuoteEditor } from "@/components/sales/quotes";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ property?: string; opportunity?: string }>;
}) {
  const user = await requireModule("quotes");
  if (!user.roles.some((r) => ["owner", "sales", "admin"].includes(r)))
    redirect("/unauthorized");
  const p = await searchParams;
  return <QuoteEditor opportunityId={p.opportunity} />;
}
