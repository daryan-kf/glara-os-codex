"use client";
import { CommercialHistory } from "./history";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { StatusBadge } from "@/components/primitives";
import {
  Loading,
  Panel,
  Form,
  Field,
  Taxes,
  taxes,
  CustomerSelect,
  Evidence,
  evidence,
  Amounts,
  BillTo,
  Print,
  Document,
  ProjectLink,
  decimal,
  dollars,
  day,
  linkClass,
} from "./shared";
type Agreement = FunctionReturnType<typeof api.commercial.agreement>;
export function AgreementEditor({
  projectId,
  existing,
  replaces,
}: {
  projectId: string;
  existing?: Agreement;
  replaces?: Agreement;
}) {
  const prepared = useQuery(api.commercial.prepareAgreement, {
      project_id: projectId as Id<"projects">,
    }),
    config = useQuery(api.commercial.configuration, {}),
    save = useMutation(api.commercial.saveAgreement),
    router = useRouter();
  if (!prepared || !config) return <Loading />;
  const source = existing ?? replaces,
    t = source?.terms,
    settings = prepared.settings;
  return (
    <Panel title={existing ? "Edit draft agreement" : "Prepare agreement"}>
      <p className="mb-4 text-sm text-muted-foreground">
        Review rates and terms before marking sent.{" "}
        {prepared.quote
          ? `Source: ${prepared.quote.number}. Any pricing change requires an override reason.`
          : "Manual agreement."}
      </p>
      <Form
        version={existing?.version ?? 0}
        submit="Save agreement draft"
        onSave={async (d, version) => {
          const { customer_id, ...fields } = d;
          const input = {
            ...Object.fromEntries(
              Object.entries(fields).filter(([k]) => !k.startsWith("tax_")),
            ),
            taxes: taxes(d),
          };
          const id = await save({
            id: existing?._id,
            project_id: projectId as Id<"projects">,
            customer_id: customer_id as Id<"commercial_customers">,
            source_quote_id: source?.source_quote_id ?? prepared.quote?.id,
            replaces_id: existing?.replaces_id ?? replaces?._id ?? undefined,
            version,
            input: JSON.stringify(input),
          });
          router.push(`/agreements/${id}`);
        }}
      >
        <CustomerSelect rows={config.customers} value={source?.customer_id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Effective date"
            name="effective_date"
            type="date"
            value={t?.effective_date ?? day()}
            required
          />
          <Field
            label="Staging start date"
            name="staging_start_date"
            type="date"
            value={t?.staging_start_date ?? day()}
            required
          />
          <Field
            label="Package end date"
            name="package_end_date"
            type="date"
            value={t?.package_end_date ?? prepared.end}
            required
          />
          <Field
            label="Service description"
            name="description"
            value={t?.description ?? "Home staging service"}
            required
          />
          <Field
            label="Subtotal (CAD)"
            name="subtotal"
            value={decimal(
              source?.subtotal_cents ?? prepared.quote?.subtotal_cents ?? "0",
            )}
            required
          />
          <Field
            label="Discount (CAD)"
            name="discount"
            value={decimal(
              source?.discount_cents ?? prepared.quote?.discount_cents ?? "0",
            )}
          />
          <Field
            label="Deposit type"
            name="deposit_type"
            options={["percentage", "fixed"]}
            value={t?.deposit_type ?? settings.deposit_type}
          />
          <Field
            label="Deposit percentage or amount (CAD)"
            name="deposit_value"
            value={t?.deposit_value ?? settings.deposit_value}
            required
          />
        </div>
        <Taxes
          value={
            source?.tax_lines ??
            (prepared.quote
              ? [
                  {
                    name: "Quote tax",
                    basis_points: prepared.quote.tax_basis_points,
                  },
                ]
              : settings.taxes)
          }
        />
        <Field
          label="Scope of service"
          name="scope"
          value={t?.scope}
          type="textarea"
        />
        {(
          [
            "payment_terms",
            "extension_terms",
            "cancellation_terms",
            "liability_terms",
            "special_terms",
            "override_reason",
          ] as const
        ).map((key) => (
          <Field
            key={key}
            label={key.replaceAll("_", " ")}
            name={key}
            type="textarea"
            value={
              t?.[key] ??
              (key === "payment_terms"
                ? settings.payment_terms
                : key === "extension_terms"
                  ? settings.extension_terms
                  : "")
            }
          />
        ))}
      </Form>
      {!config.customers.length && (
        <Link href="/commercial/settings" className={linkClass}>
          Create a billing customer first
        </Link>
      )}
    </Panel>
  );
}
export function AgreementDetail({ id }: { id: string }) {
  const a = useQuery(api.commercial.agreement, { id: id as Id<"agreements"> }),
    action = useMutation(api.commercial.agreementAction);
  if (!a) return <Loading />;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap gap-3 print:hidden">
        <ProjectLink id={a.project_id} />
        <Print />
      </div>
      {a.manage && <CommercialHistory id={a._id} />}
      <Document>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.3em] text-muted-foreground">
              Staging Agreement
            </p>
            <h1 className="mt-1 font-display text-3xl">{a.number}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {a.identity.project_number} · {a.identity.property_address}
            </p>
          </div>
          <div className="text-right text-sm leading-7">
            <StatusBadge>{a.status}</StatusBadge>
            <p className="mt-2 text-muted-foreground">
              Effective {a.terms.effective_date}
            </p>
          </div>
        </div>
        <div className="mt-6 grid gap-6 border-y py-6 sm:grid-cols-2">
          <BillTo data={a.bill_to} />
          <div className="text-sm leading-7 sm:text-right">
            <p className="mb-1 text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">
              Service period
            </p>
            <p>
              <strong>{a.terms.staging_start_date}</strong> to{" "}
              <strong>{a.terms.package_end_date}</strong>
            </p>
            <p className="text-muted-foreground">
              Staging installation through package end
            </p>
          </div>
        </div>
        <h2 className="mt-6 font-display text-xl leading-8">
          {a.terms.description}
        </h2>
        <Amounts data={a} />
        <p className="ml-auto w-full max-w-sm rounded-xl border border-primary/30 bg-primary/5 px-5 py-3 text-right text-sm">
          Required deposit:{" "}
          <strong className="font-display text-base">
            {dollars(a.deposit_cents)}
          </strong>
        </p>
        <div className="mt-8 space-y-5">
          {(
            [
              "scope",
              "payment_terms",
              "extension_terms",
              "cancellation_terms",
              "liability_terms",
              "special_terms",
            ] as const
          )
            .filter((k) => a.terms[k])
            .map((k) => (
              <section key={k}>
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">
                  {k.replaceAll("_", " ")}
                </h3>
                <p className="whitespace-pre-wrap text-sm leading-7">
                  {a.terms[k]}
                </p>
              </section>
            ))}
        </div>
        {a.acceptance ? (
          <p className="mt-8 border-t pt-5 text-sm">
            Acceptance recorded for {a.acceptance.name} ({a.acceptance.email})
            by {a.acceptance.method.replaceAll("_", " ")} on{" "}
            {a.acceptance.recorded_at}. Reference: {a.acceptance.reference}
          </p>
        ) : (
          <div className="mt-10 grid gap-10 border-t pt-8 sm:grid-cols-2">
            {["Accepted by (client)", "Glara Home Staging"].map((party) => (
              <div key={party} className="text-sm">
                <div className="h-10 border-b" />
                <p className="mt-2 font-medium">{party}</p>
                <p className="text-xs text-muted-foreground">
                  Name, signature and date
                </p>
              </div>
            ))}
          </div>
        )}
        {a.replaces_id && (
          <p className="mt-4 text-xs text-muted-foreground">
            Replaces a prior agreement; its record is retained.
          </p>
        )}
      </Document>
      {a.manage && (
        <div className="space-y-6 print:hidden">
          {a.status === "draft" && (
            <AgreementEditor projectId={a.project_id} existing={a} />
          )}{" "}
          {["draft", "sent"].includes(a.status) && (
            <Panel title="Agreement action">
              <Form
                key={a.version}
                version={a.version}
                submit="Record agreement action"
                onSave={(d, version) =>
                  action({
                    id: a._id,
                    version,
                    action: d.action as
                      "send" | "accept" | "decline" | "cancel",
                    reason: d.reason,
                    evidence: d.action === "accept" ? evidence(d) : undefined,
                  })
                }
              >
                <Field
                  label="Action"
                  name="action"
                  options={
                    a.status === "draft"
                      ? ["send", "cancel"]
                      : ["accept", "decline", "cancel"]
                  }
                />
                <Field label="Action reason" name="reason" required />
                {a.status === "sent" && <Evidence />}
                <p className="text-sm">
                  Marking sent freezes the document. This action does not send
                  an email.
                </p>
              </Form>
            </Panel>
          )}
          {["sent", "accepted", "declined"].includes(a.status) && (
            <details className="rounded-xl border p-5">
              <summary>Prepare a replacement agreement</summary>
              <AgreementEditor projectId={a.project_id} replaces={a} />
            </details>
          )}
        </div>
      )}
    </div>
  );
}
