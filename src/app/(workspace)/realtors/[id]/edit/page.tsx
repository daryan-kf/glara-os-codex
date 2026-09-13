import { notFound } from "next/navigation";
import { z } from "zod";
import { PageTitle } from "@/components/primitives";
import { CrmNav } from "@/components/crm/display";
import { RealtorForm } from "@/components/crm/forms";
import { getChoices, getRealtor, requireCrmWrite } from "@/lib/crm/data";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireCrmWrite();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const [record, choices] = await Promise.all([getRealtor(id), getChoices()]);
  if (!record || record.deleted_at) notFound();
  return (
    <>
      <PageTitle
        title="Edit relationship"
        description={record.first_name + " " + record.last_name}
      />
      <CrmNav />
      <section className="max-w-4xl rounded-2xl border bg-card p-5 sm:p-8">
        <RealtorForm record={record} choices={choices} currentUser={user.id} />
      </section>
    </>
  );
}
