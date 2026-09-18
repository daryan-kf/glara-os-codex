"use client";
import { useState } from "react";
import { PaymentProjectPicker } from "./payment-project-picker";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PageTitle, StatusBadge } from "@/components/primitives";
import { Picker, Pager } from "@/components/sales/shared";
import {
  Loading,
  Panel,
  Form,
  Field,
  Select,
  dollars,
  linkClass,
} from "./shared";
export function CommercialSummary() {
  const d = useQuery(api.commercial.dashboard, {});
  const queue = useQuery(api.commercial.reviewQueue, {});
  if (!d) return <Loading />;
  return (
    <Panel title="Commercial overview">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {[
          ["Outstanding invoices", dollars(d.outstanding_cents)],
          ["Overdue invoices", String(d.overdue)],
          ["Deposits awaiting payment", String(d.deposit_unpaid)],
          ["Received this month", dollars(d.collected_cents)],
          ["Invoiced this month", dollars(d.invoiced_cents)],
        ].map(([name, value]) => (
          <div key={name} className="rounded-xl border p-4">
            <p className="text-xs text-muted-foreground">{name}</p>
            <p className="mt-3 text-xl">{value}</p>
          </div>
        ))}
      </div>
      <div className="my-4 flex gap-3">
        <Link className={linkClass} href="/payments">
          Accounts receivable →
        </Link>
        <Link className={linkClass} href="/projects">
          Project commercial reviews →
        </Link>
      </div>
      {queue && (
        <div className="my-5 space-y-2 text-sm">
          {queue.extensions.map((x) => (
            <p key={x.id}>
              <Link
                className="text-primary"
                href={`/projects/${x.project_id}/commercial`}
              >
                {x.reason} · ends {x.new_end_date}
              </Link>
            </p>
          ))}
          {queue.assessments.map((x) => (
            <p key={x.id}>
              <Link className="text-primary" href={`/assessments/${x.id}`}>
                {x.name} · liability review required
              </Link>
            </p>
          ))}
          {queue.unassessed.map((x) => (
            <p key={x.id}>
              <Link
                className="text-primary"
                href={`/projects/${x.project_id}/commercial`}
              >
                Inventory {x.type} incident needs commercial review
              </Link>
            </p>
          ))}
          {queue.partial && (
            <p className="text-xs text-muted-foreground">
              Recent review queue. More records may exist; project commercial
              summaries show their complete outstanding actions.
            </p>
          )}
        </div>
      )}
      {d.charges.length > 0 && (
        <ul className="space-y-2 text-sm">
          {d.charges.map((a) => (
            <li key={a._id}>
              <Link className="text-primary" href={`/assessments/${a._id}`}>
                {a.evidence.product_name}:{" "}
                {a.recovered_conflict
                  ? "Recovered item — review charge"
                  : "Approved charge awaiting invoice"}
              </Link>
            </li>
          ))}
        </ul>
      )}
      {d.partial && (
        <p className="text-xs">
          Showing the first 100 approved charge assessments. Open each project
          for its complete review.
        </p>
      )}
    </Panel>
  );
}
export function Receivables() {
  const config = useQuery(api.commercial.configuration, {}),
    [filter, setFilter] = useState({
      status: "unpaid",
      customer_id: "",
      realtor_id: "",
      project_id: "",
      from: "",
      until: "",
    }),
    [cursor, setCursor] = useState<string | null>(null);
  const result = useQuery(api.commercial.receivables, {
    paginationOpts: { cursor, numItems: 20 },
    status: filter.status,
    customer_id: (filter.customer_id || undefined) as
      Id<"commercial_customers"> | undefined,
    realtor_id: (filter.realtor_id || undefined) as Id<"realtors"> | undefined,
    project_id: (filter.project_id || undefined) as Id<"projects"> | undefined,
    from: filter.from,
    until: filter.until,
  });
  if (!config) return <Loading />;
  return (
    <div className="space-y-6">
      <PageTitle
        title="Payments & receivables"
        description="Issued invoices, received funds, and the next commercial action."
      />
      <Link className={linkClass} href="/commercial/settings">
        Billing customers & defaults
      </Link>
      <CommercialSummary />
      <Panel title="Find receivables">
        <Form
          submit="Apply receivable filters"
          onSave={async (d) => {
            setCursor(null);
            setFilter({
              status: d.status,
              customer_id: d.customer_id,
              realtor_id: d.realtor_id,
              project_id: d.project_id,
              from: d.from,
              until: d.until,
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Invoice status"
              name="status"
              value="unpaid"
              options={[
                "",
                "unpaid",
                "overdue",
                "partially_paid",
                "paid",
                "credited",
                "draft",
                "void",
              ]}
            />
            <Select
              label="Customer filter"
              name="customer_id"
              options={config.customers.map((c) => ({
                id: c._id,
                name: c.bill_to.name,
              }))}
            />
            <Picker
              kind="realtors"
              label="Realtor filter"
              name="realtor_id"
              required={false}
            />
            <PaymentProjectPicker />
            <Field label="Issued from" name="from" type="date" />
            <Field label="Issued until" name="until" type="date" />
          </div>
        </Form>
      </Panel>
      <Panel title="Invoice results">
        {!result ? (
          <Loading />
        ) : (
          <>
            <div className="space-y-3">
              {result.page.map((i) => (
                <Link
                  href={`/invoices/${i._id}`}
                  key={i._id}
                  className="grid gap-3 rounded-xl border p-4 sm:grid-cols-3"
                >
                  <div>
                    <strong className="text-primary">{i.number}</strong>
                    <p className="text-sm">{i.bill_to.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {i.identity.project_number} ·{" "}
                      {i.identity.property_address}
                    </p>
                  </div>
                  <div className="text-sm">
                    <p>
                      Total {dollars(i.total_cents)} · paid{" "}
                      {dollars(i.paid_cents)}
                    </p>
                    <p>Outstanding {dollars(i.balance_cents)}</p>
                    <p>
                      Due {i.due_date} · {i.days_outstanding} days outstanding
                    </p>
                  </div>
                  <div>
                    <StatusBadge>
                      {i.effective_status.replaceAll("_", " ")}
                    </StatusBadge>
                  </div>
                </Link>
              ))}
              {!result.page.length && <p>No matching invoices on this page.</p>}
            </div>
            <Pager
              done={result.isDone}
              onNext={() => setCursor(result.continueCursor)}
              onReset={() => setCursor(null)}
            />
            <p className="mt-3 text-xs text-muted-foreground">
              Filters apply to each indexed page. Continue to the next page if
              more records are available.
            </p>
          </>
        )}
      </Panel>
    </div>
  );
}
