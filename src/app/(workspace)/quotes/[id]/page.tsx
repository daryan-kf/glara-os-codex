import { CommunicationHistory } from "@/components/communications/history";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { requireModule } from "@/lib/auth";
import { notFound, redirect } from "next/navigation";
import { recordId } from "@/lib/crm/model";
import { QuoteDetail } from "@/components/sales/quotes";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireModule("quotes");
  const { id } = await params;
  if (!recordId.safeParse(id).success) notFound();
  void user;
  void redirect;
  return (
    <>
      <QuoteDetail id={id} />
      {user.communications_version === 1 && (
        <CommunicationHistory
          source={{ type: "quote", id: id as Id<"quotes"> }}
        />
      )}
    </>
  );
}
