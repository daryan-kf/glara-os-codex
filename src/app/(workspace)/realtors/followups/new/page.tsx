import { PageTitle } from "@/components/primitives";
import { CrmNav } from "@/components/crm/display";
import { ActivityForm } from "@/components/crm/forms";
import { requireCrmWrite, getChoices } from "@/lib/crm/data";
export default async function Page() {
  const user = await requireCrmWrite();
  const choices = await getChoices();
  return (
    <>
      <PageTitle
        title="Plan a follow-up"
        description="Choose a realtor and give the next action a clear owner and due date."
      />
      <CrmNav />
      <section className="max-w-3xl rounded-2xl border bg-card p-5 sm:p-8">
        <ActivityForm choices={choices} currentUser={user.id} followup />
      </section>
    </>
  );
}
