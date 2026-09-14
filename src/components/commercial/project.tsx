"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
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
  Select,
  Evidence,
  evidence,
  Disclosure,
  dollars,
  linkClass,
} from "./shared";
import { AgreementEditor } from "./agreements";
import { InvoiceEditor, PaymentForm, SourceInvoice } from "./invoices";
export function CommercialProjectLink({ id }: { id: string }) {
  const user = useQuery(api.profiles.viewer, {});
  return user?.roles.some((r) => ["owner", "admin", "sales"].includes(r)) ? (
    <Link className={linkClass} href={`/projects/${id}/commercial`}>
      Commercial summary →
    </Link>
  ) : null;
}
export function CommercialProject({ id }: { id: string }) {
  const p = useQuery(api.commercial.project, {
      project_id: id as Id<"projects">,
    }),
    create = useMutation(api.commercial.createAssessment),
    extension = useMutation(api.commercial.createExtension),
    extensionAction = useMutation(api.commercial.extensionAction),
    router = useRouter();
  if (!p) return <Loading />;
  const agreement = p.agreements.find((a) => a.status === "accepted");
  return (
    <div className="space-y-6">
      <Link className={linkClass} href={`/projects/${id}`}>
        ← Operations
      </Link>
      <PageTitle
        title={`${p.project_number} · Commercial`}
        description={`Package ends ${p.package_end || "not set"}. ${p.project_status.replaceAll("_", " ")}.`}
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {[
          ["Agreement value", p.contract_total_cents],
          ["Required deposit", p.deposit_required_cents],
          ["Outstanding invoices", p.outstanding_cents],
        ].map(([name, value]) => (
          <div key={name} className="rounded-xl border bg-card p-5">
            <p className="text-sm text-muted-foreground">{name}</p>
            <p className="mt-3 text-2xl">{dollars(value)}</p>
          </div>
        ))}
      </div>
      {p.alerts.length > 0 && (
        <Panel title="Commercial attention">
          <ul className="list-inside list-disc space-y-2 text-sm">
            {p.alerts.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </Panel>
      )}
      <Panel title="Agreements">
        <div className="space-y-3">
          {p.agreements.map((a) => (
            <div
              key={a._id}
              className="flex flex-wrap items-center justify-between gap-3 border-b pb-3"
            >
              <Link href={`/agreements/${a._id}`} className="text-primary">
                {a.number}
              </Link>
              <span>{dollars(a.total_cents)}</span>
              <StatusBadge>{a.status}</StatusBadge>
            </div>
          ))}
          {!p.agreements.length && <p>No agreements yet.</p>}
        </div>
        {p.manage &&
          !p.agreements.some((a) =>
            ["draft", "sent", "accepted"].includes(a.status),
          ) && (
            <Disclosure className="mt-4">
              <summary className="cursor-pointer py-3 font-medium">
                Prepare agreement
              </summary>
              <AgreementEditor projectId={id} />
            </Disclosure>
          )}
        {p.manage && agreement && (
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            {(["deposit", "balance"] as const).map((type) => (
              <Disclosure key={type} className="rounded-lg border p-4">
                <summary className="cursor-pointer capitalize">
                  Prepare {type} invoice
                </summary>
                <div className="mt-4">
                  <SourceInvoice
                    projectId={id}
                    sourceId={agreement._id}
                    type={type}
                    customerId={agreement.customer_id}
                  />
                </div>
              </Disclosure>
            ))}
          </div>
        )}
      </Panel>
      <Panel title="Invoices">
        <div className="space-y-3">
          {p.invoices.map((i) => (
            <Link
              key={i._id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4"
              href={`/invoices/${i._id}`}
            >
              <span className="text-primary">
                {i.number} · {i.source_type}
              </span>
              <span>
                {dollars(i.total_cents)} · unpaid {dollars(i.balance_cents)}
              </span>
              <StatusBadge>
                {i.effective_status.replaceAll("_", " ")}
              </StatusBadge>
            </Link>
          ))}
          {!p.invoices.length && <p>No invoices yet.</p>}
        </div>
        {p.manage && (
          <Disclosure className="mt-4">
            <summary className="cursor-pointer py-3 font-medium">
              Prepare manual invoice
            </summary>
            <InvoiceEditor projectId={id} />
          </Disclosure>
        )}
      </Panel>
      <Panel title="Payments">
        <div className="space-y-3">
          {p.payments.map((x) => (
            <Link
              key={x._id}
              className="flex flex-wrap justify-between gap-3 rounded-lg border p-4"
              href={`/payments/${x._id}`}
            >
              <span>
                {x.number} · {x.status}
              </span>
              <span>
                {dollars(x.amount_cents)} · unallocated{" "}
                {dollars(x.unallocated_cents)}
              </span>
            </Link>
          ))}
          {!p.payments.length && <p>No payments recorded.</p>}
        </div>
        {p.manage && (
          <Disclosure className="mt-4">
            <summary className="cursor-pointer py-3 font-medium">
              Record received payment
            </summary>
            <PaymentForm project={p} />
          </Disclosure>
        )}
      </Panel>
      <Panel title="Package extensions">
        <div className="space-y-4">
          {p.extensions.map((x) => (
            <article key={x._id} className="rounded-xl border p-4">
              <h3 className="font-semibold">
                {x.original_end_date} → {x.new_end_date}
              </h3>
              <p className="my-3">
                {dollars(x.total_cents)} · {x.status}
              </p>
              <p className="text-sm">{x.reason}</p>
              {x.approval && (
                <p className="text-sm">
                  Accepted by {x.approval.name}: {x.approval.reference}
                </p>
              )}
              {p.manage && x.status === "pending" && (
                <Form
                  version={x.version}
                  submit="Record extension decision"
                  onSave={(d, version) =>
                    extensionAction({
                      id: x._id,
                      version,
                      accept: d.action === "accept",
                      evidence: d.action === "accept" ? evidence(d) : d.reason,
                    })
                  }
                >
                  <Field
                    label="Extension action"
                    name="action"
                    options={["accept", "cancel"]}
                  />
                  <Field label="Decision reason" name="reason" required />
                  <Evidence />
                </Form>
              )}
              {p.manage && x.status === "accepted" && (
                <Disclosure className="mt-4">
                  <summary>Prepare extension invoice</summary>
                  <SourceInvoice
                    projectId={id}
                    type="extension"
                    sourceId={x._id}
                    customerId={agreement?.customer_id}
                  />
                </Disclosure>
              )}
            </article>
          ))}
          {!p.extensions.length && <p>No extensions recorded.</p>}
        </div>
        {p.manage && agreement && (
          <Disclosure className="mt-4">
            <summary className="cursor-pointer py-3 font-medium">
              Propose extension
            </summary>
            <Form
              version={p.project_version}
              submit="Save extension proposal"
              onSave={(d, version) =>
                extension({
                  agreement_id: agreement._id,
                  project_version: version,
                  input: JSON.stringify({
                    new_end_date: d.new_end_date,
                    type: d.type,
                    rate: d.rate,
                    quantity: Number(d.quantity),
                    taxes: taxes(d),
                    reason: d.reason,
                  }),
                })
              }
            >
              <Field
                label="New package end date"
                name="new_end_date"
                type="date"
                required
              />
              <Field
                label="Extension period"
                name="type"
                options={["monthly", "weekly", "custom"]}
              />
              <Field label="Extension rate (CAD)" name="rate" required />
              <Field
                label="Number of periods"
                name="quantity"
                type="number"
                value={1}
                required
              />
              <Field label="Extension reason" name="reason" required />
              <Taxes />
            </Form>
          </Disclosure>
        )}
      </Panel>
      <Panel title="Damage & missing-item reviews">
        <div className="space-y-3">
          {p.assessments.map((x) => (
            <Link
              className="flex flex-wrap justify-between gap-3 rounded-lg border p-4"
              key={x._id}
              href={`/assessments/${x._id}`}
            >
              <span>
                {x.evidence.product_name} · {x.assessment_type}
              </span>
              <StatusBadge>
                {x.effective_status.replaceAll("_", " ")}
              </StatusBadge>
              <span>{dollars(x.approved_amount_cents)} before tax</span>
            </Link>
          ))}
        </div>
        {p.manage && p.unassessed_incidents.length > 0 && (
          <div className="mt-6">
            <Form
              submit="Create assessment for review"
              onSave={async (d) => {
                const assessment = await create({
                  project_id: p.id,
                  damage_record_id: d.incident_id as Id<"inventory_damage">,
                  agreement_id: agreement?._id,
                });
                router.push(`/assessments/${assessment}`);
              }}
            >
              <Select
                label="Unreviewed inventory incident"
                name="incident_id"
                required
                options={p.unassessed_incidents.map((i) => ({
                  id: i.id,
                  name: `${i.product_name} · ${i.asset_number} · ${i.type} · ${i.severity}`,
                }))}
              />
              <p className="text-sm text-muted-foreground">
                Creating an assessment does not assign liability or create an
                invoice.
              </p>
            </Form>
          </div>
        )}
        {!p.assessments.length && !p.unassessed_incidents.length && (
          <p>No inventory charge reviews.</p>
        )}
      </Panel>
    </div>
  );
}
