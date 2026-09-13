import { PageTitle } from "@/components/primitives";
import { CrmNav } from "@/components/crm/display";
import { RealtorForm } from "@/components/crm/forms";
import { getChoices, requireCrmWrite } from "@/lib/crm/data";
export const metadata = { title: "New realtor" };
export default async function Page() {
  const user = await requireCrmWrite();
  const choices = await getChoices();
  return (
    <>
      <PageTitle
        title="A new relationship"
        description="Start with the person. Leave with a clear next step."
      />
      <CrmNav />
      <section className="max-w-4xl rounded-2xl border bg-card p-5 sm:p-8">
        <RealtorForm choices={choices} currentUser={user.id} />
      </section>
    </>
  );
}
