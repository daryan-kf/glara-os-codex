import Link from "next/link";
import { requireModule } from "@/lib/auth";
import { getChoices } from "@/lib/crm/data";
import { canWriteCrm, canManageCrm } from "@/lib/crm/model";
import { PageTitle } from "@/components/primitives";
import { CrmNav } from "@/components/crm/display";
import { SourceForm } from "@/components/crm/forms";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ edit?: string }>;
}) {
  const user = await requireModule("realtors");
  const choices = await getChoices();
  const params = await searchParams;
  const selected = choices.sources.find((s) => s.id === params.edit);
  return (
    <>
      <PageTitle
        title="Lead sources"
        description="Reusable sources for understanding where relationships begin."
      />
      <CrmNav operational={canWriteCrm(user.roles)} />
      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border bg-card p-6">
          <h2 className="mb-4 font-semibold">Configured sources</h2>
          {choices.sources.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between gap-3 border-b py-3 text-sm"
            >
              <span>{s.name}</span>
              {canManageCrm(user.roles) && (
                <Link
                  href={"/realtors/sources?edit=" + s.id}
                  className="py-2 underline"
                >
                  Rename
                </Link>
              )}
            </div>
          ))}
        </section>
        {canManageCrm(user.roles) && (
          <section className="rounded-xl border bg-card p-6">
            <h2 className="mb-5 font-semibold">
              {selected ? "Rename lead source" : "Add lead source"}
            </h2>
            <SourceForm
              key={selected?.id ?? "new"}
              id={selected?.id}
              name={selected?.name}
            />
            {selected && (
              <Link
                href="/realtors/sources"
                className="mt-5 inline-block text-sm underline"
              >
                Add a different source
              </Link>
            )}
          </section>
        )}
      </div>
    </>
  );
}
