import { PageTitle } from "@/components/primitives";
import { CrmNav } from "@/components/crm/display";
import { BrokerageForm } from "@/components/crm/forms";
import { requireCrmWrite } from "@/lib/crm/data";
export default async function Page() {
  await requireCrmWrite();
  return (
    <>
      <PageTitle
        title="New brokerage"
        description="Add an office to your relationship network."
      />
      <CrmNav />
      <section className="max-w-3xl rounded-2xl border bg-card p-6">
        <BrokerageForm />
      </section>
    </>
  );
}
