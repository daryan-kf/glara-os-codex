"use client";
import Link from "next/link";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import type { Id } from "../../../convex/_generated/dataModel";
import { api } from "../../../convex/_generated/api";
import { PageTitle, StatusBadge, EmptyState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Field,
  Picker,
  SalesForm,
  Panel,
  Loading,
  Pager,
  inputClass,
} from "./shared";
import {
  dollars,
  decimal,
  label,
  quoteMath,
  quoteInput,
} from "@/lib/sales/model";
export function Quotes() {
  const [cursor, setCursor] = useState<string | null>(null),
    [status, setStatus] = useState("");
  const result = useQuery(api.sales.listQuotes, {
    paginationOpts: { cursor, numItems: 25 },
    status: status || undefined,
  });
  return (
    <>
      <PageTitle
        title="Quotes"
        description="Clear commercial terms. Every revision preserved."
      />
      <div className="mb-6 flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/quotes/new">New quote</Link>
        </Button>
        <select
          aria-label="Quote status filter"
          className={inputClass + " sm:max-w-xs"}
          value={status}
          onChange={(e) => {
            setStatus(e.target.value);
            setCursor(null);
          }}
        >
          {[
            "",
            "draft",
            "sent",
            "accepted",
            "declined",
            "expired",
            "superseded",
          ].map((s) => (
            <option key={s} value={s}>
              {s ? label(s) : "All statuses"}
            </option>
          ))}
        </select>
      </div>
      {!result ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {result.page.map((q) => (
              <Link
                href={"/quotes/" + q._id}
                key={q._id}
                className="rounded-2xl border bg-card p-5 hover:border-primary"
              >
                <StatusBadge>{label(q.status)}</StatusBadge>
                <h2 className="mt-4 text-lg font-semibold">{q.number}</h2>
                <p className="mt-2 font-display text-2xl">
                  {dollars(q.total_cents)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Valid until {q.valid_until}
                </p>
              </Link>
            ))}
          </div>
          {!result.page.length && (
            <EmptyState
              title="No quotes yet"
              description="Create an itemized quote from an active opportunity."
            />
          )}
          <Pager
            done={result.isDone}
            onNext={() => setCursor(result.continueCursor)}
            onReset={() => setCursor(null)}
          />
        </>
      )}
      <div className="mt-8">
        <DiscountSettings />
      </div>
    </>
  );
}
function DiscountSettings() {
  const viewer = useQuery(api.profiles.viewer, {}),
    settings = useQuery(api.sales.discountSettings, {}),
    save = useMutation(api.sales.setDiscountSettings);
  if (!viewer?.roles.includes("owner")) return null;
  return (
    <details className="rounded-xl border p-5">
      <summary className="cursor-pointer font-medium">
        Discount authority settings
      </summary>
      <p className="my-4 text-sm text-muted-foreground">
        Sales/Admin start with zero discretionary discount. Owner may configure
        authority in basis points (100 = 1%). Owner retains final authority.
        Existing sent terms stay unchanged.
      </p>
      <SalesForm
        key={settings?.version ?? 0}
        submit="Save discount authority"
        onSave={async (d) =>
          save({
            sales_bps: Number(d.sales_bps),
            admin_bps: Number(d.admin_bps),
            version: settings?.version ?? 0,
          })
        }
      >
        <Field
          label="Sales discount authority (basis points)"
          name="sales_bps"
          type="number"
          value={settings?.sales_discount_bps ?? 0}
        />
        <Field
          label="Admin discount authority (basis points)"
          name="admin_bps"
          type="number"
          value={settings?.admin_discount_bps ?? 0}
        />
      </SalesForm>
    </details>
  );
}
export function QuoteEditor({
  id,
  opportunityId,
}: {
  id?: string;
  opportunityId?: string;
}) {
  const record = useQuery(
      api.sales.getQuote,
      id ? { id: id as Id<"quotes"> } : "skip",
    ),
    opportunity = useQuery(
      api.sales.getOpportunity,
      opportunityId ? { id: opportunityId as Id<"opportunities"> } : "skip",
    );
  if (
    (id && record === undefined) ||
    (opportunityId && opportunity === undefined)
  )
    return <Loading />;
  if (id && !record)
    return (
      <EmptyState
        title="Quote unavailable"
        description="This quote cannot be opened."
      />
    );
  if (record && record.quote.status !== "draft")
    return (
      <EmptyState
        title="Issued terms are locked"
        description="Create a revision from the quote detail page."
      />
    );
  return (
    <QuoteForm
      key={record?.quote._id ?? opportunityId ?? "new"}
      record={record ?? undefined}
      opportunityId={opportunityId}
      opportunityLabel={opportunity?.opportunity.address}
    />
  );
}
type QuoteRecord = NonNullable<
  import("convex/server").FunctionReturnType<typeof api.sales.getQuote>
>;
function QuoteForm({
  record,
  opportunityId,
  opportunityLabel,
}: {
  record?: QuoteRecord;
  opportunityId?: string;
  opportunityLabel?: string;
}) {
  const router = useRouter(),
    save = useMutation(api.sales.saveQuote);
  const [items, setItems] = useState(
      record?.items.map((i) => ({
        description: i.description,
        quantity: i.quantity,
        unit_price: decimal(i.unit_price_cents),
      })) ?? [{ description: "", quantity: 1, unit_price: "0.00" }],
    ),
    [discount, setDiscount] = useState(
      record ? decimal(record.quote.discount_cents) : "0.00",
    ),
    [rate, setRate] = useState(
      record ? decimal(BigInt(record.quote.tax_basis_points)) : "0.00",
    );
  const [defaultDate] = useState(() =>
    new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
  );
  let preview: ReturnType<typeof quoteMath> | null = null;
  try {
    preview = quoteMath(
      quoteInput.parse({
        opportunity_id:
          record?.quote.opportunity_id ?? opportunityId ?? "a".repeat(32),
        items,
        discount,
        tax_rate: rate,
        valid_until: "2099-01-01",
      }),
    );
  } catch {}
  return (
    <>
      <PageTitle
        title={record ? "Edit draft quote" : "New quote"}
        description="Itemized CAD pricing, calculated precisely on the server."
      />
      <Panel title={record?.quote.number ?? "Quote terms"}>
        <SalesForm
          expectedVersion={record?.quote.version ?? 0}
          submit="Save quote"
          onSave={async (d, _form, loadedVersion) => {
            const saved = await save({
              id: record?.quote._id,
              version: loadedVersion ?? 0,
              input: JSON.stringify({ ...d, items, discount, tax_rate: rate }),
            });
            router.push("/quotes/" + saved);
          }}
        >
          {record ? (
            <>
              <input
                type="hidden"
                name="opportunity_id"
                value={record.quote.opportunity_id}
              />
              <p className="text-sm">Draft revision of existing opportunity</p>
            </>
          ) : (
            <Picker
              kind="opportunities"
              name="opportunity_id"
              label="Opportunity"
              initialId={opportunityId}
              initialLabel={opportunityLabel}
            />
          )}
          <Field
            label="Valid until"
            name="valid_until"
            type="date"
            value={record?.quote.valid_until ?? defaultDate}
            required
          />
          <div className="space-y-4">
            {items.map((item, i) => (
              <fieldset
                key={i}
                className="grid gap-3 rounded-xl border p-4 sm:grid-cols-[2fr_1fr_1fr_auto]"
              >
                <legend className="px-2 text-xs font-semibold">
                  Item {i + 1}
                </legend>
                <label className="grid gap-2 text-sm">
                  Description {i + 1}
                  <input
                    className={inputClass}
                    value={item.description}
                    required
                    onChange={(e) =>
                      setItems(
                        items.map((v, j) =>
                          j === i ? { ...v, description: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Quantity {i + 1}
                  <input
                    className={inputClass}
                    type="number"
                    min={1}
                    max={1000}
                    value={item.quantity}
                    required
                    onChange={(e) =>
                      setItems(
                        items.map((v, j) =>
                          j === i
                            ? { ...v, quantity: Number(e.target.value) }
                            : v,
                        ),
                      )
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Unit price {i + 1} (CAD)
                  <input
                    className={inputClass}
                    value={item.unit_price}
                    required
                    onChange={(e) =>
                      setItems(
                        items.map((v, j) =>
                          j === i ? { ...v, unit_price: e.target.value } : v,
                        ),
                      )
                    }
                  />
                </label>
                <Button
                  variant="outline"
                  type="button"
                  disabled={items.length === 1}
                  className="self-end"
                  onClick={() => setItems(items.filter((_, j) => i !== j))}
                >
                  Remove
                </Button>
              </fieldset>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={items.length >= 50}
            onClick={() =>
              setItems([
                ...items,
                { description: "", quantity: 1, unit_price: "0.00" },
              ])
            }
          >
            Add line item
          </Button>
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="grid gap-2 text-sm">
              Quote discount (CAD)
              <input
                className={inputClass}
                value={discount}
                onChange={(e) => setDiscount(e.target.value)}
                required
              />
            </label>
            <label className="grid gap-2 text-sm">
              Tax rate (%)
              <input
                className={inputClass}
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                required
              />
            </label>
          </div>
          <p className="text-xs text-muted-foreground">
            Enter the applicable tax explicitly; 0% means no tax entered. The
            saved rate is part of these historical terms. Discounts are checked
            against your configured authority.
          </p>
          <div aria-live="polite" className="rounded-xl bg-muted p-5">
            {preview ? (
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <dt>Subtotal</dt>
                <dd>{dollars(preview.subtotal_cents)}</dd>
                <dt>Discount</dt>
                <dd>{dollars(preview.discount_cents)}</dd>
                <dt>Tax</dt>
                <dd>{dollars(preview.tax_cents)}</dd>
                <dt className="font-semibold">Total CAD</dt>
                <dd className="font-semibold">
                  {dollars(preview.total_cents)}
                </dd>
              </dl>
            ) : (
              <p className="text-sm">
                Complete valid item prices and descriptions to see the total.
              </p>
            )}
          </div>
        </SalesForm>
      </Panel>
    </>
  );
}
export function QuoteDetail({ id }: { id: string }) {
  const result = useQuery(api.sales.getQuote, { id: id as Id<"quotes"> }),
    status = useMutation(api.sales.quoteStatus),
    revise = useMutation(api.sales.reviseQuote),
    archive = useMutation(api.sales.archive),
    router = useRouter();
  if (result === undefined) return <Loading />;
  if (!result)
    return (
      <EmptyState
        title="Quote unavailable"
        description="This quote is not available."
      />
    );
  const q = result.quote;
  const expired = q.valid_until < new Date().toISOString().slice(0, 10);
  return (
    <>
      <PageTitle
        title={q.number}
        description={`Version ${q.version} · All amounts in CAD`}
      />
      <div className="mb-6 flex flex-wrap gap-3">
        <StatusBadge>
          {label(q.status)}
          {q.status === "sent" && expired ? " · validity expired" : ""}
        </StatusBadge>
        <Button variant="outline" asChild>
          <Link href={"/opportunities/" + q.opportunity_id}>
            Open opportunity
          </Link>
        </Button>
        {q.status === "draft" && !q.deleted_at && (
          <Button asChild>
            <Link href={"/quotes/" + id + "/edit"}>Edit draft</Link>
          </Button>
        )}
        {q.revision_of && (
          <Link
            href={"/quotes/" + q.revision_of}
            className="p-3 text-sm underline"
          >
            Previous revision
          </Link>
        )}
      </div>
      <Panel title="Commercial terms">
        <pre className="mb-5 whitespace-pre-wrap rounded-lg bg-muted p-4 font-sans text-sm">
          {Object.entries(
            JSON.parse(q.customer_snapshot) as Record<string, string>,
          )
            .map(([k, v]) => `${label(k)}: ${v}`)
            .join("\n")}
        </pre>
        <div className="space-y-3">
          {result.items
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((item) => (
              <div
                key={item._id}
                className="flex flex-wrap justify-between gap-3 border-b py-3"
              >
                <div>
                  <h3 className="font-medium">{item.description}</h3>
                  <p className="text-sm text-muted-foreground">
                    {item.quantity} × {dollars(item.unit_price_cents)}
                  </p>
                </div>
                <strong>{dollars(item.total_cents)}</strong>
              </div>
            ))}
        </div>
        <dl className="ml-auto mt-5 grid max-w-sm grid-cols-2 gap-3 text-sm">
          <dt>Subtotal</dt>
          <dd>{dollars(q.subtotal_cents)}</dd>
          <dt>Discount</dt>
          <dd>{dollars(q.discount_cents)}</dd>
          <dt>Tax ({decimal(BigInt(q.tax_basis_points))}%)</dt>
          <dd>{dollars(q.tax_cents)}</dd>
          <dt className="font-semibold">Total</dt>
          <dd className="font-semibold">{dollars(q.total_cents)}</dd>
        </dl>
        <p className="mt-5 text-sm">Valid until {q.valid_until}</p>
        <p className="mt-2 text-xs text-muted-foreground">
          Sent: {q.sent_at ?? "Not recorded"} · Accepted:{" "}
          {q.accepted_at ?? "Not recorded"} · Declined:{" "}
          {q.declined_at ?? "Not recorded"}
        </p>
      </Panel>
      {!q.deleted_at && (
        <div className="mt-6 grid gap-6 md:grid-cols-2">
          <Panel title="Record quote status">
            <p className="mb-4 text-sm text-muted-foreground">
              “Sent” records that you shared the quote outside Glara OS. It
              sends no email. Acceptance records the customer’s decision; no
              project or payment is created.
            </p>
            {q.status === "draft" || q.status === "sent" ? (
              <SalesForm
                key={q.version}
                submit="Confirm quote status"
                onSave={async (d) =>
                  status({
                    id: q._id,
                    version: q.version,
                    status: d.status as
                      "sent" | "accepted" | "declined" | "expired",
                  })
                }
              >
                <Field
                  label="Quote status"
                  name="status"
                  options={
                    q.status === "draft"
                      ? ["sent"]
                      : expired
                        ? ["expired", "declined"]
                        : ["accepted", "declined"]
                  }
                />
              </SalesForm>
            ) : (
              <p className="text-sm">These terms are read-only.</p>
            )}
          </Panel>
          {["sent", "declined", "expired"].includes(q.status) && (
            <Panel title="Create a revision">
              <p className="mb-4 text-sm">
                The original is preserved as superseded. A new draft gets a new
                quote number and copies the line items.
              </p>
              <SalesForm
                submit="Create revision"
                onSave={async () => {
                  const saved = await revise({ id: q._id, version: q.version });
                  router.push("/quotes/" + saved + "/edit");
                }}
              >
                <span />
              </SalesForm>
            </Panel>
          )}
        </div>
      )}
      <details className="mt-6 rounded-xl border p-4">
        <summary className="cursor-pointer text-sm">Archive quote</summary>
        <p className="my-4 text-sm">
          Hide from active lists while retaining terms and history.
        </p>
        <SalesForm
          submit="Confirm quote archive"
          onSave={async () => {
            await archive({
              kind: "quotes",
              id,
              version: q.version,
              restore: false,
            });
            router.push("/quotes");
          }}
        >
          <span />
        </SalesForm>
      </details>
    </>
  );
}
