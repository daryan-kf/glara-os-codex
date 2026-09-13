import { notFound } from "next/navigation";
import { recordId } from "@/lib/crm/model";
import { PageTitle } from "@/components/primitives";
import { CrmNav } from "@/components/crm/display";
import { BrokerageForm } from "@/components/crm/forms";
import { requireCrmWrite, getBrokerage } from "@/lib/crm/data";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireCrmWrite();
  const { id } = await params;
  if (!recordId.safeParse(id).success) notFound();
  const record = await getBrokerage(id);
  if (!record) notFound();
  return (
    <>
      <PageTitle title="Edit brokerage" description={record.name} />
      <CrmNav />
      <section className="max-w-3xl rounded-2xl border bg-card p-6">
        <BrokerageForm record={record} />
      </section>
    </>
  );
}
