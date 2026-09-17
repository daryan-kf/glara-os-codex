"use client";
import Link from "next/link";
import { FinishAction } from "./opportunities";
import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PageTitle, StatusBadge, EmptyState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { Field, Picker, SalesForm, Panel, Loading, Pager } from "./shared";
import { AddressFields } from "./address-fields";
import {
  propertyTypes,
  occupancies,
  dollars,
  decimal,
} from "@/lib/sales/model";
export function Properties({ editable }: { editable: boolean }) {
  const [cursor, setCursor] = useState<string | null>(null),
    [filters, setFilters] = useState({
      q: "",
      city: "",
      property_type: "",
      occupancy: "",
      realtor_id: "",
    });
  const rows = useQuery(api.sales.listProperties, {
    paginationOpts: { cursor, numItems: 25 },
    ...filters,
    realtor_id: filters.realtor_id
      ? (filters.realtor_id as Id<"realtors">)
      : undefined,
  });
  return (
    <>
      <PageTitle
        title="Properties"
        description="Every address is the beginning of an opportunity."
      />
      {editable && (
        <Button asChild>
          <Link href="/properties/new">New property</Link>
        </Button>
      )}
      <form
        className="my-6 grid gap-3 rounded-2xl border bg-card p-4 sm:grid-cols-2 lg:grid-cols-5"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          setCursor(null);
          setFilters({
            q: String(f.get("q")),
            city: String(f.get("city")),
            property_type: String(f.get("property_type")),
            occupancy: String(f.get("occupancy")),
            realtor_id: String(f.get("realtor_id") ?? ""),
          });
        }}
      >
        <Field label="Address or MLS" name="q" />
        {editable && (
          <Picker
            kind="realtors"
            name="realtor_id"
            label="Realtor filter"
            required={false}
          />
        )}
        <Field label="City" name="city" />
        <Field
          label="Property type"
          name="property_type"
          options={["", ...propertyTypes]}
        />
        <Field
          label="Occupancy"
          name="occupancy"
          options={["", ...occupancies]}
        />
        <Button className="self-end" type="submit">
          Filter properties
        </Button>
      </form>
      {!rows ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rows.page.map((p) => (
              <Link
                href={"/properties/" + p._id}
                key={p._id}
                className="rounded-2xl border bg-card p-5 hover:border-primary"
              >
                <StatusBadge>
                  {p.occupancy_status.replaceAll("_", " ")}
                </StatusBadge>
                <h2 className="mt-4 font-display text-xl">
                  {p.address_line_1}
                </h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  {p.city} · {p.property_type}
                </p>
                <p className="mt-3 text-sm">
                  {p.bedrooms ?? "—"} beds · {p.bathrooms ?? "—"} baths ·{" "}
                  {p.square_feet ?? "—"} sq ft
                </p>
              </Link>
            ))}
          </div>
          {!rows.page.length && (
            <EmptyState
              title="No properties on this page"
              description="Adjust your filters, continue to the next page or add your first property."
            />
          )}
          <Pager
            done={rows.isDone}
            onNext={() => setCursor(rows.continueCursor)}
            onReset={() => setCursor(null)}
          />
        </>
      )}
    </>
  );
}
export function PropertyEditor({ id }: { id?: string }) {
  const router = useRouter(),
    save = useMutation(api.sales.saveProperty),
    result = useQuery(
      api.sales.getProperty,
      id ? { id: id as Id<"properties"> } : "skip",
    );
  if (id && !result) return <Loading />;
  const p = result?.commercial ? result.property : undefined;
  return (
    <>
      <PageTitle
        title={id ? "Edit property" : "New property"}
        description="A clear foundation for the sales conversation."
      />
      <Panel title="Property details">
        <SalesForm
          key={p?._id ?? "new"}
          expectedVersion={p?.version ?? 0}
          submit="Save property"
          onSave={async (data, _form, loadedVersion) => {
            const saved = await save({
              id: id as Id<"properties"> | undefined,
              version: loadedVersion ?? 0,
              input: JSON.stringify(data),
            });
            router.push("/properties/" + saved);
          }}
        >
          <div className="grid gap-5 sm:grid-cols-2">
            <AddressFields
              initial={
                p
                  ? {
                      address_line_1: p.address_line_1,
                      city: p.city,
                      province: p.province,
                      postal_code: p.postal_code,
                    }
                  : undefined
              }
            />
            <Field
              label="Unit / address line 2"
              name="address_line_2"
              value={p?.address_line_2}
            />
            <Field
              label="Property type"
              name="property_type"
              value={p?.property_type ?? "detached"}
              options={propertyTypes}
            />
            <Field
              label="Occupancy"
              name="occupancy_status"
              value={p?.occupancy_status ?? "unknown"}
              options={occupancies}
            />
            <Field
              label="Bedrooms"
              name="bedrooms"
              type="number"
              value={p?.bedrooms}
            />
            <Field
              label="Bathrooms"
              name="bathrooms"
              type="number"
              step="0.5"
              value={p?.bathrooms}
            />
            <Field
              label="Square feet"
              name="square_feet"
              type="number"
              value={p?.square_feet}
            />
            <Field
              label="Listing price (CAD)"
              name="listing_price"
              value={
                p?.listing_price_cents ? decimal(p.listing_price_cents) : ""
              }
            />
            <Field label="MLS number" name="mls_number" value={p?.mls_number} />
            <Field
              label="Listing date"
              name="listing_date"
              type="date"
              value={p?.listing_date}
            />
            <Picker
              kind="realtors"
              name="realtor_id"
              label="Primary Realtor"
              initialId={p?.realtor_id}
              initialLabel={p?.realtor_name}
            />
            <Field
              label="Seller name (private)"
              name="seller_name"
              value={p?.seller_name}
            />
          </div>
          <Field
            label="Internal property notes"
            name="notes"
            type="textarea"
            value={p?.notes}
          />
          <p className="text-xs text-muted-foreground">
            Address + unit + city and MLS duplicates are checked before saving.
            The primary Realtor is fixed once opportunities exist.
          </p>
        </SalesForm>
      </Panel>
    </>
  );
}
export function PropertyDetail({
  id,
  editable,
}: {
  id: string;
  editable: boolean;
}) {
  const result = useQuery(api.sales.getProperty, {
      id: id as Id<"properties">,
    }),
    archive = useMutation(api.sales.archive),
    router = useRouter();
  if (result === undefined) return <Loading />;
  if (!result)
    return (
      <EmptyState
        title="Property unavailable"
        description="This property is archived or inaccessible."
      />
    );
  const p = result.property;
  return (
    <>
      <PageTitle
        title={p.address_line_1}
        description={`${p.city}, ${p.province} · ${p.property_type.replaceAll("_", " ")}`}
      />
      {result.commercial && editable && (
        <div className="mb-6 flex flex-wrap gap-3">
          <Button asChild>
            <Link href={"/opportunities/new?property=" + id}>
              New opportunity
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link href={"/properties/" + id + "/edit"}>Edit property</Link>
          </Button>
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Property overview">
          <dl className="grid grid-cols-2 gap-5 text-sm">
            {Object.entries({
              Occupancy: p.occupancy_status,
              Bedrooms: p.bedrooms,
              Bathrooms: p.bathrooms,
              "Square feet": p.square_feet,
              "Postal code": p.postal_code,
              "Primary Realtor": p.realtor_name,
            }).map(([k, v]) => (
              <div key={k}>
                <dt className="text-muted-foreground">{k}</dt>
                <dd className="mt-1 font-medium">{v ?? "Not recorded"}</dd>
              </div>
            ))}
          </dl>
          {result.commercial && (
            <>
              <p className="mt-5">
                Listing price:{" "}
                {result.property.listing_price_cents
                  ? dollars(result.property.listing_price_cents)
                  : "Not recorded"}
              </p>
              <p className="mt-2 text-sm">
                MLS: {result.property.mls_number || "Not recorded"}
              </p>
              <Link
                className="mt-4 inline-block underline"
                href={"/realtors/" + result.property.realtor_id}
              >
                Open Realtor profile
              </Link>
              <p className="mt-4 text-sm">
                Seller: {result.property.seller_name || "Not recorded"}
              </p>
              <p className="mt-4 whitespace-pre-wrap text-sm">
                {result.property.notes}
              </p>
            </>
          )}
        </Panel>
        {result.commercial && (
          <Panel title="Sales opportunities">
            {result.opportunities.map((o) => (
              <Link
                key={o._id}
                className="mb-3 block rounded-lg border p-4 hover:bg-muted"
                href={"/opportunities/" + o._id}
              >
                <StatusBadge>{o.stage.replaceAll("_", " ")}</StatusBadge>
                <p className="mt-2 font-medium">
                  {dollars(o.estimated_value_cents)} · {o.owner_name}
                </p>
                <p className="mt-2 text-sm">
                  {o.next_action?.title ?? "Closed opportunity"}
                </p>
                <span className="text-xs underline">
                  Consultations, quotes and timeline →
                </span>
              </Link>
            ))}
            {!result.opportunities.length && (
              <p className="text-sm text-muted-foreground">
                No sales opportunity yet.
              </p>
            )}
            {result.hasMore && (
              <Link
                href={"/opportunities?property=" + id}
                className="underline"
              >
                View all opportunities
              </Link>
            )}
          </Panel>
        )}
      </div>
      {result.commercial && (
        <>
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <Panel title="Consultations">
              {result.consultations.length ? (
                result.consultations.map((c) => (
                  <p key={c._id} className="mb-3 text-sm">
                    {c.consultation_type} · {c.status} ·{" "}
                    {new Date(c.scheduled_at).toLocaleString()}
                  </p>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">
                  No consultations yet.
                </p>
              )}
            </Panel>
            <Panel title="Recent quotes">
              {result.quotes.length ? (
                result.quotes.map((q) => (
                  <Link
                    key={q._id}
                    href={"/quotes/" + q._id}
                    className="mb-3 block text-sm underline"
                  >
                    {q.number} · {q.status} · {dollars(q.total_cents)}
                  </Link>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">No quotes yet.</p>
              )}
            </Panel>
          </div>
          <div className="mt-6">
            <Panel title="Property activity">
              <PropertyActivity id={id} />
              {result.activities.map((a) => (
                <div key={a._id} className="mt-4 border-t pt-4 text-sm">
                  {a.title} · {a.status} ·{" "}
                  {a.due_at ? new Date(a.due_at).toLocaleString() : ""}
                  {a.status === "open" && <FinishAction id={a._id} />}
                </div>
              ))}
            </Panel>
          </div>
          <details className="mt-6 rounded-xl border p-4">
            <summary className="cursor-pointer text-sm">
              Archive property
            </summary>
            <p className="my-4 text-sm">
              This preserves history. Archive linked opportunities first.
            </p>
            <SalesForm
              submit="Confirm property archive"
              onSave={async () => {
                await archive({
                  kind: "properties",
                  id,
                  version: result.property.version,
                  restore: false,
                });
                router.push("/properties");
              }}
            >
              <span />
            </SalesForm>
          </details>
        </>
      )}
      <p className="mt-8 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        <Link href={`/projects?property=${id}`} className="text-primary">
          View associated staging projects →
        </Link>
      </p>
    </>
  );
}
function PropertyActivity({ id }: { id: string }) {
  const save = useMutation(api.sales.saveAction),
    viewer = useQuery(api.profiles.viewer, {});
  return (
    <details>
      <summary className="cursor-pointer text-sm font-medium">
        Add property follow-up
      </summary>
      <div className="mt-4">
        <SalesForm
          submit="Save property follow-up"
          onSave={async (data) =>
            save({
              input: JSON.stringify({
                ...data,
                property_id: id,
                assigned_to: viewer?.id,
              }),
            })
          }
        >
          <Field label="Action title" name="title" required />
          <Field
            label="Due date"
            name="due_at"
            type="datetime-local"
            required
          />
          <Field label="Activity notes" name="description" type="textarea" />
        </SalesForm>
      </div>
    </details>
  );
}
