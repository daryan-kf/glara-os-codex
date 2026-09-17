"use client";
import { useState } from "react";
import Link from "next/link";
import type { Doc } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import {
  Field,
  Panel,
  Form,
  Select,
  Disclosure,
  label,
} from "@/components/operations/shared";
import { decimal, dollars } from "@/lib/commercial/model";
import { day } from "@/lib/operations/model";
export { Field, Panel, Form, Select, Disclosure, label, decimal, dollars, day };
export const linkClass =
  "inline-flex min-h-11 items-center rounded-lg border bg-card px-4 py-2 text-sm text-primary";
export function Loading() {
  return (
    <p role="status" className="p-8">
      Loading commercial records…
    </p>
  );
}
export function ProjectLink({ id }: { id: string }) {
  return (
    <Link className={linkClass} href={`/projects/${id}/commercial`}>
      ← Project commercial summary
    </Link>
  );
}
export type Tax = { name: string; basis_points: number };
export function Taxes({
  value = [],
  prefix = "tax",
}: {
  value?: Tax[];
  prefix?: string;
}) {
  const [rows, setRows] = useState(value.length);
  return (
    <fieldset className="space-y-3 rounded-lg border p-4">
      <legend className="px-2 text-sm">Taxes</legend>
      <p className="text-xs text-muted-foreground">
        Explicit document rates. No tax is applied when this list is empty.
      </p>
      <input type="hidden" name={`${prefix}_count`} value={rows} />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid gap-3 sm:grid-cols-2">
          <Field
            label={`Tax ${i + 1} name`}
            name={`${prefix}_${i}_name`}
            value={value[i]?.name ?? ""}
            required
          />
          <Field
            label={`Tax ${i + 1} rate (%)`}
            name={`${prefix}_${i}_rate`}
            value={value[i] ? String(value[i].basis_points / 100) : "0"}
            type="number"
            step="0.01"
            required
          />
        </div>
      ))}
      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={rows >= 5}
          onClick={() => setRows(rows + 1)}
        >
          Add tax
        </Button>
        {rows > 0 && (
          <Button
            type="button"
            variant="outline"
            onClick={() => setRows(rows - 1)}
          >
            Remove last tax
          </Button>
        )}
      </div>
    </fieldset>
  );
}
export function taxes(d: Record<string, string>, prefix = "tax"): Tax[] {
  return Array.from({ length: Number(d[`${prefix}_count`] ?? 0) }, (_, i) => ({
    name: d[`${prefix}_${i}_name`],
    basis_points: Math.round(Number(d[`${prefix}_${i}_rate`]) * 100),
  }));
}
export function Evidence() {
  return (
    <fieldset className="grid gap-3 rounded-lg border p-4 sm:grid-cols-2">
      <legend>Acceptance evidence</legend>
      <Field label="Accepted by" name="name" />
      <Field label="Acceptance email" name="email" type="email" />
      <Field
        label="Acceptance method"
        name="method"
        value="manual_record"
        options={["manual_record", "electronic_acknowledgement", "other"]}
      />
      <Field label="Evidence reference" name="reference" />
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Name and reference are required when accepting; leave them blank for
        cancellation. Record an existing acknowledgement. This is an internal
        record, not an electronic signing service.
      </p>
    </fieldset>
  );
}
export const evidence = (d: Record<string, string>) =>
  JSON.stringify({
    name: d.name,
    email: d.email,
    method: d.method,
    reference: d.reference,
  });
export function Dates({
  issue = day(),
  due = day(),
}: {
  issue?: string;
  due?: string;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Field
        label="Issue date"
        name="issue_date"
        type="date"
        value={issue}
        required
      />
      <Field
        label="Due date"
        name="due_date"
        type="date"
        value={due}
        required
      />
    </div>
  );
}
export function CustomerSelect({
  rows,
  value,
}: {
  rows: Doc<"commercial_customers">[];
  value?: string;
}) {
  return (
    <Select
      label="Bill to"
      name="customer_id"
      required
      value={value}
      options={rows.map((c) => ({
        id: c._id,
        name: `${c.bill_to.name} · ${c.bill_to.type}`,
      }))}
    />
  );
}
export function Amounts({
  data,
}: {
  data: {
    subtotal_cents: string;
    discount_cents: string;
    tax_cents: string;
    total_cents: string;
    tax_lines: ({ amount_cents: string } & Tax)[];
  };
}) {
  return (
    <dl className="ml-auto my-4 grid w-full max-w-sm grid-cols-2 gap-y-2 rounded-xl border bg-muted/40 px-5 py-4 text-sm">
      <dt className="text-muted-foreground">Subtotal</dt>
      <dd className="text-right">{dollars(data.subtotal_cents)}</dd>
      {data.discount_cents !== "0" && (
        <>
          <dt className="text-muted-foreground">Discount</dt>
          <dd className="text-right">−{dollars(data.discount_cents)}</dd>
        </>
      )}
      {data.tax_lines.map((t) => (
        <div key={t.name} className="contents">
          <dt className="text-muted-foreground">
            {t.name} ({t.basis_points / 100}%)
          </dt>
          <dd className="text-right">{dollars(t.amount_cents)}</dd>
        </div>
      ))}
      <dt className="mt-2 border-t pt-3 font-display text-base font-semibold">
        Total CAD
      </dt>
      <dd className="mt-2 border-t pt-3 text-right font-display text-base font-semibold">
        {dollars(data.total_cents)}
      </dd>
    </dl>
  );
}
export function BillTo({
  data,
}: {
  data: Doc<"commercial_customers">["bill_to"];
}) {
  return (
    <div className="my-5 text-sm leading-7">
      <p className="mb-1 text-xs font-semibold uppercase tracking-[.2em] text-muted-foreground">
        Bill to
      </p>
      <strong className="text-base">{data.name}</strong>
      {data.company && <p>{data.company}</p>}
      <p className="whitespace-pre-line">{data.address}</p>
      {[data.contact, data.email, data.phone].some(Boolean) && (
        <p className="text-muted-foreground">
          {[data.contact, data.email, data.phone].filter(Boolean).join(" · ")}
        </p>
      )}
    </div>
  );
}
export function Print() {
  return (
    <Button
      className="print:hidden"
      variant="outline"
      onClick={() => window.print()}
    >
      Print / save PDF
    </Button>
  );
}
export function Document({ children }: { children: React.ReactNode }) {
  return (
    <article className="commercial-document overflow-hidden rounded-xl border bg-card">
      <header className="flex flex-wrap items-center justify-between gap-4 px-6 pb-5 pt-7 sm:px-10">
        {/* eslint-disable-next-line @next/next/no-img-element -- brand SVG lockup, no optimization needed. */}
        <img
          src="/glara-logo.svg"
          alt="GLARA Home Staging"
          className="h-24 w-auto sm:h-28"
        />
        <div className="text-right text-xs leading-6 text-muted-foreground">
          <p className="font-display text-base tracking-wide text-foreground">
            Glara Home Staging
          </p>
          <p>Metro Vancouver · British Columbia</p>
          <p>Support@glarahome.com · glarahome.com</p>
        </div>
      </header>
      <div
        className="h-1 w-full"
        style={{
          background: "#a9907c",
          printColorAdjust: "exact",
          WebkitPrintColorAdjust: "exact",
        }}
      />
      <div className="px-6 pb-8 pt-6 sm:px-10">{children}</div>
      <footer className="border-t px-6 py-4 text-center text-[.65rem] uppercase tracking-[.2em] text-muted-foreground sm:px-10">
        Glara Home Staging · Beautiful spaces. Thoughtful operations.
      </footer>
    </article>
  );
}
export type ItemValue = {
  description: string;
  quantity: number;
  unit_amount_cents: string;
  discount_cents: string;
  tax_lines: Tax[];
};
export function Items({ value = [] }: { value?: ItemValue[] }) {
  const [count, setCount] = useState(Math.max(value.length, 1));
  return (
    <div className="space-y-4">
      <input name="item_count" type="hidden" value={count} />
      {Array.from({ length: count }, (_, i) => (
        <fieldset
          key={i}
          className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2"
        >
          <legend className="px-2">Item {i + 1}</legend>
          <Field
            label={`Item ${i + 1} description`}
            name={`item_${i}_description`}
            required
            value={value[i]?.description}
          />
          <Field
            label={`Item ${i + 1} quantity`}
            name={`item_${i}_quantity`}
            type="number"
            value={value[i]?.quantity ?? 1}
            required
          />
          <Field
            label={`Item ${i + 1} unit price (CAD)`}
            name={`item_${i}_unit`}
            value={decimal(value[i]?.unit_amount_cents ?? "0")}
            required
          />
          <Field
            label={`Item ${i + 1} discount (CAD)`}
            name={`item_${i}_discount`}
            value={decimal(value[i]?.discount_cents ?? "0")}
          />
          <div className="sm:col-span-2">
            <Taxes prefix={`item_${i}_tax`} value={value[i]?.tax_lines} />
          </div>
        </fieldset>
      ))}
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          disabled={count >= 50}
          onClick={() => setCount(count + 1)}
        >
          Add item
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={count <= 1}
          onClick={() => setCount(count - 1)}
        >
          Remove last item
        </Button>
      </div>
    </div>
  );
}
export function items(d: Record<string, string>) {
  return Array.from({ length: Number(d.item_count) }, (_, i) => ({
    description: d[`item_${i}_description`],
    quantity: Number(d[`item_${i}_quantity`]),
    unit_amount: d[`item_${i}_unit`],
    discount: d[`item_${i}_discount`] || "0",
    taxes: taxes(d, `item_${i}_tax`),
  }));
}
