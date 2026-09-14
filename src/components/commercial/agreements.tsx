"use client";
import { CommercialHistory } from "./history";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PageTitle, StatusBadge } from "@/components/primitives";
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
        <PageTitle
          title={a.number}
          description={`${a.identity.project_number} · ${a.identity.property_address}`}
        />
        <StatusBadge>{a.status}</StatusBadge>
        <BillTo data={a.bill_to} />
        <h2 className="text-xl">{a.terms.description}</h2>
        <p className="my-4">
          Service: {a.terms.staging_start_date} to {a.terms.package_end_date} ·
          Effective {a.terms.effective_date}
        </p>
        <Amounts data={a} />
        <p className="mb-5 font-medium">
          Required deposit: {dollars(a.deposit_cents)}
        </p>
        {(
          [
            "scope",
            "payment_terms",
            "extension_terms",
            "cancellation_terms",
            "liability_terms",
            "special_terms",
          ] as const
        ).map((k) => (
          <section key={k} className="my-4">
            <h3 className="font-semibold capitalize">
              {k.replaceAll("_", " ")}
            </h3>
            <p className="whitespace-pre-wrap text-sm leading-7">
              {a.terms[k] || "Not specified"}
            </p>
          </section>
        ))}
        {a.acceptance && (
          <p className="border-t pt-5 text-sm">
            Acceptance recorded for {a.acceptance.name} ({a.acceptance.email})
            by {a.acceptance.method.replaceAll("_", " ")} on{" "}
            {a.acceptance.recorded_at}. Reference: {a.acceptance.reference}
          </p>
        )}
        {a.replaces_id && (
          <p className="text-sm">
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
