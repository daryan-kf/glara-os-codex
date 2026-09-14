"use client";
import { CommercialHistory } from "./history";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PageTitle, StatusBadge } from "@/components/primitives";
import { paymentMethods } from "@/lib/commercial/model";
import {
  Loading,
  Panel,
  Form,
  Field,
  CustomerSelect,
  Dates,
  Items,
  items,
  Amounts,
  BillTo,
  Print,
  Document,
  ProjectLink,
  dollars,
  day,
  linkClass,
} from "./shared";
type Invoice = FunctionReturnType<typeof api.commercial.invoice>;
type Project = FunctionReturnType<typeof api.commercial.project>;
export function InvoiceEditor({
  projectId,
  existing,
}: {
  projectId: string;
  existing?: Invoice;
}) {
  const config = useQuery(api.commercial.configuration, {}),
    save = useMutation(api.commercial.saveInvoice),
    router = useRouter();
  if (!config) return <Loading />;
  return (
    <Panel title={existing ? "Edit invoice draft" : "New manual invoice"}>
      <Form
        version={existing?.version ?? 0}
        submit="Save invoice draft"
        onSave={async (d, version) => {
          const id = await save({
            id: existing?._id,
            version,
            project_id: projectId as Id<"projects">,
            customer_id: d.customer_id as Id<"commercial_customers">,
            input: JSON.stringify({
              issue_date: d.issue_date,
              due_date: d.due_date,
              notes: d.notes,
              items: items(d),
            }),
          });
          router.push(`/invoices/${id}`);
        }}
      >
        <CustomerSelect rows={config.customers} value={existing?.customer_id} />
        <Dates issue={existing?.issue_date} due={existing?.due_date} />
        <Items value={existing?.items} />
        <Field
          label="Invoice notes"
          name="notes"
          value={existing?.notes}
          type="textarea"
        />
      </Form>
    </Panel>
  );
}
export function SourceInvoice({
  projectId,
  type,
  sourceId,
  customerId,
}: {
  projectId: string;
  type: "deposit" | "balance" | "extension" | "assessment";
  sourceId: string;
  customerId?: string;
}) {
  const config = useQuery(api.commercial.configuration, {}),
    save = useMutation(api.commercial.sourceInvoice),
    router = useRouter();
  if (!config) return <Loading />;
  return (
    <Form
      submit={`Prepare ${type} invoice`}
      onSave={async (d) => {
        const id = await save({
          project_id: projectId as Id<"projects">,
          customer_id: d.customer_id as Id<"commercial_customers">,
          source_type: type,
          agreement_id: ["deposit", "balance"].includes(type)
            ? (sourceId as Id<"agreements">)
            : undefined,
          extension_id:
            type === "extension"
              ? (sourceId as Id<"package_extensions">)
              : undefined,
          assessment_id:
            type === "assessment"
              ? (sourceId as Id<"damage_charge_assessments">)
              : undefined,
          issue_date: d.issue_date,
          due_date: d.due_date,
        });
        router.push(`/invoices/${id}`);
      }}
    >
      <CustomerSelect rows={config.customers} value={customerId} />
      <Dates />
      <p className="text-sm text-muted-foreground">
        The amount and taxes come from the approved source. Review the resulting
        draft before issuing.
      </p>
    </Form>
  );
}
export function InvoiceDetail({ id }: { id: string }) {
  const a = useQuery(api.commercial.invoice, { id: id as Id<"invoices"> }),
    action = useMutation(api.commercial.invoiceAction),
    credit = useMutation(api.commercial.creditInvoice);
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
        <StatusBadge>{a.effective_status.replaceAll("_", " ")}</StatusBadge>
        <BillTo data={a.bill_to} />
        <p className="mb-5 text-sm">
          Issue: {a.issue_date} · Due: {a.due_date} · Currency: CAD
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="p-3">Description</th>
                <th className="p-3">Qty</th>
                <th className="p-3">Unit</th>
                <th className="p-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {a.items.map((i) => (
                <tr key={i._id} className="border-b">
                  <td className="p-3">{i.description}</td>
                  <td className="p-3">{i.quantity}</td>
                  <td className="p-3">{dollars(i.unit_amount_cents)}</td>
                  <td className="p-3">{dollars(i.total_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Amounts data={a} />
        <div className="border-t py-4 text-sm leading-7">
          <p>
            Paid: {dollars(a.paid_cents)} · Credits: {dollars(a.credit_cents)}
          </p>
          <strong>Outstanding: {dollars(a.balance_cents)}</strong>
          {BigInt(a.credit_balance_cents) > 0n && (
            <p className="text-amber-800">
              Credit balance {dollars(a.credit_balance_cents)} — refund or
              reallocation review required.
            </p>
          )}
        </div>
        <p className="whitespace-pre-wrap text-sm">{a.notes}</p>
        {a.status === "void" && (
          <p className="mt-4">
            Voided {a.voided_at}: {a.void_reason}
          </p>
        )}
      </Document>
      <Panel title="Payment allocations">
        {a.allocations.map((x) => (
          <p key={x._id} className="py-2 text-sm">
            <Link href={`/payments/${x.payment_id}`} className="text-primary">
              Payment receipt
            </Link>{" "}
            · {dollars(x.amount_cents)} · {x.created_at}
          </p>
        ))}
        {!a.allocations.length && (
          <p className="text-sm">No allocations recorded.</p>
        )}
        <p className="text-xs text-muted-foreground">
          Reversed payment allocations remain in history and are excluded from
          Paid.
        </p>
      </Panel>
      <Panel title="Credit history">
        {a.credits.map((c) => (
          <p key={c._id} className="py-2 text-sm">
            {c.number} · {dollars(c.amount_cents)} · {c.reason}
          </p>
        ))}
        {!a.credits.length && <p className="text-sm">No credits recorded.</p>}
      </Panel>
      {a.manage && (
        <div className="space-y-6 print:hidden">
          {a.status === "draft" && a.source_type === "manual" && (
            <InvoiceEditor projectId={a.project_id} existing={a} />
          )}{" "}
          {a.status !== "void" && (
            <Panel title="Invoice action">
              <Form
                key={a.version}
                version={a.version}
                submit="Confirm invoice action"
                onSave={(d, version) =>
                  action({
                    id: a._id,
                    version,
                    action: d.action as "issue" | "void",
                    reason: d.reason,
                  })
                }
              >
                <Field
                  label="Action"
                  name="action"
                  options={a.status === "draft" ? ["issue", "void"] : ["void"]}
                />
                <Field label="Action reason" name="reason" required />
                <p className="text-sm">
                  Issuing freezes this invoice. Voiding requires all payments
                  and credits to be resolved.
                </p>
              </Form>
            </Panel>
          )}
          {a.status === "issued" && (
            <Panel title="Issue credit note">
              <Form
                submit="Confirm credit note"
                onSave={(d) =>
                  credit({
                    invoice_id: a._id,
                    amount: d.amount,
                    reason: d.reason,
                  })
                }
              >
                <Field
                  label="Credit amount (CAD, including tax)"
                  name="amount"
                  required
                />
                <Field label="Credit reason" name="reason" required />
                <p className="text-sm">
                  The invoice is retained. A credit after payment creates a
                  visible credit balance for reconciliation.
                </p>
              </Form>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
function AllocationFields({ rows }: { rows: Project["invoices"] }) {
  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <legend>Allocate to issued invoices</legend>
      <p className="text-xs text-muted-foreground">
        Leave an amount empty to retain that part of the payment as unallocated.
      </p>
      {rows
        .filter((i) => i.status === "issued" && BigInt(i.balance_cents) > 0n)
        .map((i) => (
          <Field
            key={i._id}
            label={`${i.number} · unpaid ${dollars(i.balance_cents)}`}
            name={`allocate_${i._id}`}
          />
        ))}
      {!rows.some(
        (i) => i.status === "issued" && BigInt(i.balance_cents) > 0n,
      ) && <p className="text-sm">No unpaid issued invoices.</p>}
    </fieldset>
  );
}
function allocations(d: Record<string, string>) {
  return Object.entries(d)
    .filter(([k, v]) => k.startsWith("allocate_") && v.trim())
    .map(([k, amount]) => ({
      invoice_id: k.slice(9) as Id<"invoices">,
      amount,
    }));
}
export function PaymentForm({ project }: { project: Project }) {
  const config = useQuery(api.commercial.configuration, {}),
    save = useMutation(api.commercial.recordPayment),
    router = useRouter();
  const [requestKey] = useState(() => crypto.randomUUID());
  if (!config) return <Loading />;
  return (
    <Panel title="Record received payment">
      <Form
        submit="Record payment"
        onSave={async (d) => {
          const id = await save({
            project_id: project.id,
            customer_id: d.customer_id as Id<"commercial_customers">,
            amount: d.amount,
            method: d.method as (typeof paymentMethods)[number],
            received_date: d.received_date,
            external_reference: d.external_reference,
            notes: d.notes,
            allocations: allocations(d),
            request_key: requestKey,
          });
          router.push(`/payments/${id}`);
        }}
      >
        <CustomerSelect rows={config.customers} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Received amount (CAD)" name="amount" required />
          <Field
            label="Payment method"
            name="method"
            options={paymentMethods}
            value="e_transfer"
          />
          <Field
            label="Received date"
            name="received_date"
            type="date"
            value={day()}
            required
          />
          <Field label="Payment reference" name="external_reference" />
          <Field label="Payment notes" name="notes" />
        </div>
        <p className="text-sm text-muted-foreground">
          Record funds already received. Do not enter card numbers, security
          codes, passwords or banking credentials.
        </p>
        <AllocationFields rows={project.invoices} />
      </Form>
    </Panel>
  );
}
export function PaymentDetail({ id }: { id: string }) {
  const a = useQuery(api.commercial.payment, { id: id as Id<"payments"> }),
    p = useQuery(
      api.commercial.project,
      a ? { project_id: a.project_id } : "skip",
    ),
    reverse = useMutation(api.commercial.reversePayment),
    allocate = useMutation(api.commercial.allocatePayment);
  if (!a || !p) return <Loading />;
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
          description={`Payment receipt · ${p.project_number}`}
        />
        <StatusBadge>{a.status}</StatusBadge>
        <BillTo data={a.payer} />
        <p className="text-3xl">{dollars(a.amount_cents)} CAD</p>
        <p className="my-4 text-sm">
          {a.received_date} · {a.method.replaceAll("_", " ")} ·{" "}
          {a.external_reference}
        </p>
        <p className="text-sm">{a.notes}</p>
        <p className="my-4">Allocated: {dollars(a.allocated_cents)}</p>
        <p className="my-4">Unallocated: {dollars(a.unallocated_cents)}</p>
        {a.allocations.map((x) => (
          <p key={x._id} className="py-2 text-sm">
            <Link className={linkClass} href={`/invoices/${x.invoice_id}`}>
              Invoice
            </Link>{" "}
            · {dollars(x.amount_cents)}
          </p>
        ))}
        {a.reversal && (
          <p className="mt-5">
            Reversed {a.reversal.created_at}: {a.reversal.reason}. Original
            evidence is retained.
          </p>
        )}
      </Document>
      {a.manage && !a.reversal && (
        <div className="space-y-6 print:hidden">
          <Panel title="Allocate remaining payment">
            <Form
              submit="Confirm allocation"
              onSave={(d) =>
                allocate({ id: a._id, allocations: allocations(d) })
              }
            >
              <AllocationFields
                rows={p.invoices.filter((i) => i.customer_id === a.customer_id)}
              />
            </Form>
          </Panel>
          <Panel title="Reverse payment record">
            <Form
              submit="Confirm reversal"
              onSave={(d) => reverse({ id: a._id, reason: d.reason })}
            >
              <Field label="Reversal reason" name="reason" required />
              <p className="text-sm">
                Reversal removes this payment from invoice balances and retains
                its evidence. This does not transfer or refund funds.
              </p>
            </Form>
          </Panel>
        </div>
      )}
    </div>
  );
}
