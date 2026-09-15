"use client";
import { CopilotLink } from "@/components/ai/copilot";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PageTitle, StatusBadge } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  Form,
  Field,
  Select,
  Panel,
  Disclosure,
  Action,
  label,
  dateTime,
} from "@/components/operations/shared";
import { conditions, locationTypes, assetStates } from "@/lib/inventory/model";
import { day } from "@/lib/operations/model";
export function Loading() {
  return (
    <p role="status" className="rounded-xl border p-8 text-muted-foreground">
      Loading inventory…
    </p>
  );
}
export function InventoryAttention() {
  const rows = useQuery(api.inventory.exceptions, {});
  if (!rows?.length) return null;
  return (
    <Panel title="Inventory attention">
      <div className="grid gap-3 sm:grid-cols-2">
        {rows.slice(0, 10).map((r) => (
          <Link
            key={r.id}
            href={
              r.project_id
                ? `/projects/${r.project_id}/inventory`
                : `/inventory/products/${r.product_id}`
            }
            className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm"
          >
            <strong>
              {r.product_name} ×{r.quantity}
            </strong>
            <p>
              {label(r.state)} · {r.project_number}
            </p>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Recent unresolved inventory holds. Open a project to reconcile each
        line.
      </p>
    </Panel>
  );
}
export function InventoryCatalog() {
  const options = useQuery(api.inventory.options, {});
  const [filter, setFilter] = useState({
    search: "",
    category: "",
    location: "",
    mode: "",
    status: "",
    condition: "",
    color: "",
    available: false,
    eligible: false,
    archived: false,
  });
  const [cursor, setCursor] = useState<string | null>(null);
  const result = useQuery(api.inventory.list, {
    paginationOpts: { cursor, numItems: 8 },
    search: filter.search,
    category_id: (filter.category || undefined) as
      Id<"inventory_categories"> | undefined,
    location_id: (filter.location || undefined) as
      Id<"inventory_locations"> | undefined,
    mode: (filter.mode || undefined) as "serialized" | "quantity" | undefined,
    status: filter.status || undefined,
    condition: (filter.condition || undefined) as
      (typeof conditions)[number] | undefined,
    color: filter.color || undefined,
    available_only: filter.available,
    staging_only: filter.eligible,
    archived: filter.archived,
  });
  if (!options) return <Loading />;
  return (
    <div className="space-y-6">
      <PageTitle
        title="Inventory"
        description="Every piece. Every location. Every staging."
      />
      <div className="mb-6 flex flex-wrap gap-3">
        <Link className="rounded-lg border px-4 py-3 text-sm" href="/projects">
          Project pick & return lists →
        </Link>
        {options.manage && (
          <Link
            className="rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground"
            href="/inventory/new"
          >
            New product
          </Link>
        )}
        {options.manage && (
          <Link
            className="rounded-lg border px-4 py-3 text-sm"
            href="/inventory/settings"
          >
            Categories & locations
          </Link>
        )}
      </div>
      <InventoryAttention />
      <Panel title="Find inventory">
        <Form
          submit="Apply filters"
          successMessage="Filters applied."
          onSave={async (d) => {
            setCursor(null);
            setFilter({
              search: d.search,
              category: d.category,
              location: d.location,
              mode: d.mode,
              status: d.status,
              condition: d.condition,
              color: d.color,
              available: d.available === "yes",
              eligible: d.eligible === "yes",
              archived: d.archived === "yes",
            });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Search product, SKU or asset number" name="search" />
            <Select
              label="Category"
              name="category"
              options={options.categories.map((c) => ({
                id: c._id,
                name: c.name,
              }))}
            />
            <Select
              label="Location"
              name="location"
              options={options.locations.map((c) => ({
                id: c._id,
                name: c.name,
              }))}
            />
            <Field
              label="Tracking"
              name="mode"
              options={["", "serialized", "quantity"]}
            />
            <Field
              label="Status"
              name="status"
              options={["", "reserved", ...assetStates]}
            />
            <Field
              label="Condition"
              name="condition"
              options={["", ...conditions]}
            />
            <Field label="Color" name="color" />
            <Field
              label="Available now only"
              name="available"
              options={["no", "yes"]}
            />
            <Field
              label="Staging eligible only"
              name="eligible"
              options={["no", "yes"]}
            />
            {options.manage && (
              <Field
                label="Archived products"
                name="archived"
                options={["no", "yes"]}
              />
            )}
          </div>
        </Form>
      </Panel>
      {!result ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            {result.page.map((p) => (
              <Link
                className="rounded-2xl border bg-card p-6 transition hover:border-primary"
                href={
                  p.matched_asset_id
                    ? `/inventory/assets/${p.matched_asset_id}`
                    : `/inventory/products/${p._id}`
                }
                key={p._id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs tracking-wider text-muted-foreground">
                      {p.sku}
                    </p>
                    <h2 className="mt-1 text-xl font-semibold">{p.name}</h2>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {p.category_name} · {p.color || "Color not set"}
                    </p>
                  </div>
                  <StatusBadge>{p.track_mode}</StatusBadge>
                </div>
                <div className="mt-6 grid grid-cols-4 gap-2">
                  {[
                    ["Available", p.available],
                    ["Reserved", p.reserved],
                    ["Installed", p.staged],
                    ["Care", p.care],
                  ].map(([k, n]) => (
                    <div key={k}>
                      <p className="text-xl font-semibold">{n}</p>
                      <p className="text-xs text-muted-foreground">{k}</p>
                    </div>
                  ))}
                </div>
                <Assignments productId={p._id} />
                {p.partial && (
                  <p className="mt-3 text-xs">
                    Partial stock summary; narrow your location filter.
                  </p>
                )}
              </Link>
            ))}
          </div>
          {!result.page.length && (
            <Panel title="No matching inventory">
              <p className="text-sm text-muted-foreground">
                Add your first product or adjust the filters. Inventory is
                reserved from a project room.
              </p>
            </Panel>
          )}
          <div className="my-5 flex gap-3">
            <Button
              variant="outline"
              disabled={!cursor}
              onClick={() => setCursor(null)}
            >
              First page
            </Button>
            <Button
              variant="outline"
              disabled={result.isDone}
              onClick={() => setCursor(result.continueCursor)}
            >
              Next page
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Filters apply to bounded catalog pages. Continue through sparse
            pages to see further matches. Available counts reflect confirmed
            stock today; select dates before reserving.
          </p>
        </>
      )}
    </div>
  );
}
type Product = FunctionReturnType<typeof api.inventory.product>;
export function ProductEditor({ product }: { product?: Product }) {
  const options = useQuery(api.inventory.options, {}),
    save = useMutation(api.inventory.saveProduct),
    router = useRouter();
  if (!options) return <Loading />;
  if (!options.manage)
    return <p>Product management is restricted to Owner and Admin.</p>;
  return (
    <Form
      version={product?.version}
      submit={product ? "Save product" : "Create product"}
      onSave={async (d, version) => {
        const { category, ...fields } = d;
        const id = await save({
          id: product?._id,
          version,
          category_id: category as Id<"inventory_categories">,
          input: JSON.stringify({
            ...fields,
            active: fields.active === "yes",
            staging_eligible: fields.staging_eligible === "yes",
            retail_eligible: fields.retail_eligible === "yes",
          }),
        });
        if (!product) router.push(`/inventory/products/${id}`);
      }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Product name"
          name="name"
          value={product?.name}
          required
        />
        <Field label="SKU" name="sku" value={product?.sku} required />
        <Select
          label="Category"
          name="category"
          value={product?.category_id}
          options={options.categories.map((c) => ({ id: c._id, name: c.name }))}
          required
        />
        <Field
          label="Tracking mode"
          name="track_mode"
          options={["serialized", "quantity"]}
          value={product?.track_mode ?? "serialized"}
        />
        {[
          "brand",
          "collection",
          "color",
          "material",
          "dimensions",
          "weight",
        ].map((k) => (
          <Field
            key={k}
            label={label(k)}
            name={k}
            value={product?.[k as "brand"]}
          />
        ))}
        <Field
          label="Staging eligible"
          name="staging_eligible"
          options={["yes", "no"]}
          value={product?.staging_eligible === false ? "no" : "yes"}
        />
        <Field
          label="Retail eligible"
          name="retail_eligible"
          options={["no", "yes"]}
          value={product?.retail_eligible ? "yes" : "no"}
        />
        <Field
          label="Active"
          name="active"
          options={["yes", "no"]}
          value={product?.active === false ? "no" : "yes"}
        />
      </div>
      <Field
        label="Description"
        name="description"
        type="textarea"
        value={product?.description}
      />
      <p className="text-xs text-muted-foreground">
        Each color or size with its own SKU is a separate product. Tracking mode
        is fixed after the first movement.
      </p>
    </Form>
  );
}
export function NewProduct() {
  return (
    <div className="space-y-6">
      <PageTitle
        title="New product"
        description="Start with its catalog identity, then receive physical inventory."
      />
      <Panel title="Product details">
        <ProductEditor />
      </Panel>
    </div>
  );
}
export function InventorySettings() {
  const data = useQuery(api.inventory.settings, {}),
    category = useMutation(api.inventory.saveCategory),
    location = useMutation(api.inventory.saveLocation);
  if (!data) return <Loading />;
  const locationFields = (
    row?: FunctionReturnType<
      typeof api.inventory.settings
    >["locations"][number],
  ) => (
    <>
      <Field label="Location name" name="name" value={row?.name} required />
      <Field
        label="Location type"
        name="type"
        options={locationTypes}
        value={row?.type}
      />
      <Field label="Address" name="address" value={row?.address} />
      <Field
        label="Staging source"
        name="staging_source"
        options={["yes", "no"]}
        value={row?.staging_source === false ? "no" : "yes"}
      />
      <Field
        label="Retail source"
        name="retail_source"
        options={["no", "yes"]}
        value={row?.retail_source ? "yes" : "no"}
      />
      <Field
        label="Active location"
        name="active"
        options={["yes", "no"]}
        value={row?.active === false ? "no" : "yes"}
      />
    </>
  );
  return (
    <div className="space-y-6">
      <PageTitle
        title="Inventory settings"
        description="Configure the categories and places your team uses."
      />
      <Link href="/inventory" className="text-sm text-primary">
        ← Inventory
      </Link>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Panel title="Categories">
          {data.categories.map((c) => (
            <Disclosure key={c._id}>
              <summary className="my-3 cursor-pointer rounded-lg border p-3 text-sm">
                {c.name} · {c.active ? "Active" : "Inactive"}
              </summary>
              <Form
                version={c.version}
                submit="Save category"
                onSave={(d, version) =>
                  category({
                    id: c._id,
                    version,
                    name: d.name,
                    active: d.active === "yes",
                  })
                }
              >
                <Field
                  label="Category name"
                  name="name"
                  value={c.name}
                  required
                />
                <Field
                  label="Active category"
                  name="active"
                  options={["yes", "no"]}
                  value={c.active ? "yes" : "no"}
                />
              </Form>
            </Disclosure>
          ))}
          <h3 className="my-4 font-medium">New category</h3>
          <Form
            submit="Add category"
            onSave={(d) => category({ version: 0, name: d.name, active: true })}
          >
            <Field label="New category name" name="name" required />
          </Form>
        </Panel>
        <Panel title="Locations">
          {data.locations.map((l) => (
            <Disclosure key={l._id}>
              <summary className="my-3 cursor-pointer rounded-lg border p-3 text-sm">
                {l.name} · {l.active ? "Active" : "Inactive"}
              </summary>
              <Form
                version={l.version}
                submit="Save location"
                onSave={(d, version) =>
                  location({
                    id: l._id,
                    version,
                    input: JSON.stringify({
                      ...d,
                      active: d.active === "yes",
                      staging_source: d.staging_source === "yes",
                      retail_source: d.retail_source === "yes",
                    }),
                  })
                }
              >
                {locationFields(l)}
              </Form>
            </Disclosure>
          ))}
          <h3 className="my-4 font-medium">New location</h3>
          <Form
            submit="Add location"
            onSave={(d) =>
              location({
                version: 0,
                input: JSON.stringify({
                  ...d,
                  active: d.active === "yes",
                  staging_source: d.staging_source === "yes",
                  retail_source: d.retail_source === "yes",
                }),
              })
            }
          >
            {locationFields()}
          </Form>
        </Panel>
      </div>
      {data.partial && (
        <p className="text-sm">Showing first 100 categories and locations.</p>
      )}
    </div>
  );
}
export function ProductDetail({ id }: { id: string }) {
  const p = useQuery(api.inventory.product, { id: id as Id<"products"> }),
    options = useQuery(api.inventory.options, {}),
    archive = useMutation(api.inventory.archiveProduct);
  if (!p || !options) return <Loading />;
  return (
    <div className="space-y-6">
      <Link href="/inventory" className="text-sm text-primary">
        ← Inventory
      </Link>
      <PageTitle
        title={p.name}
        description={`${p.sku} · ${p.category_name} · ${p.color || "Color not set"}`}
      />
      <div className="mb-5 flex flex-wrap gap-3">
        <StatusBadge>{p.track_mode}</StatusBadge>
        <CopilotLink feature="inventory" id={id} />
        <StatusBadge>{p.active ? "Active" : "Inactive"}</StatusBadge>
        {p.deleted_at && <StatusBadge>Archived</StatusBadge>}
        <StatusBadge>
          {p.staging_eligible ? "Staging eligible" : "Retail only"}
        </StatusBadge>
      </div>
      <p className="mb-6 text-sm text-muted-foreground">{p.description}</p>
      <Panel title="Availability by date">
        <AvailabilityPicker
          product={p}
          locations={options.locations.map((l) => ({
            id: l._id,
            name: l.name,
          }))}
        />
      </Panel>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[
          ["Upcoming reserved units", p.upcoming_quantity],
          ["Installed units", p.installed_quantity],
          ["Asset staging uses", p.staging_use_count],
        ].map(([k, n]) => (
          <div key={k} className="rounded-xl border p-5">
            <p className="text-xs text-muted-foreground">{k}</p>
            <p className="mt-2 text-2xl">{n}</p>
          </div>
        ))}
      </div>
      {p.manage && !p.deleted_at && (
        <Panel title="Receive inventory">
          <Receipt
            product={p}
            locations={options.locations.map((l) => ({
              id: l._id,
              name: l.name,
            }))}
          />
        </Panel>
      )}
      {p.track_mode === "serialized" ? (
        <Panel title="Physical assets">
          <div className="grid gap-3 sm:grid-cols-2">
            {p.assets.map((a) => (
              <Link
                className="rounded-xl border p-4"
                key={a.id}
                href={`/inventory/assets/${a.id}`}
              >
                <strong>{a.asset_number}</strong>
                <p className="mt-1 text-sm">
                  {label(a.status)} · {a.condition} · {a.staging_use_count} uses
                </p>
              </Link>
            ))}
          </div>
          {!p.assets.length && (
            <p className="text-sm text-muted-foreground">
              No physical assets received yet.
            </p>
          )}
        </Panel>
      ) : (
        <Panel title="Quantity stock">
          {p.stock.map((s) => (
            <div key={s._id} className="mb-4 rounded-xl border p-4">
              <h3 className="font-semibold">{s.location_name}</h3>
              <div className="my-3 flex flex-wrap gap-3 text-sm">
                {[
                  "available",
                  "inspection",
                  "cleaning",
                  "repair",
                  "damaged",
                  "missing",
                  "sold",
                  "retired",
                ].map((k) => (
                  <span key={k}>
                    {label(k)}: {s[k as "available"]}
                  </span>
                ))}
              </div>
              {p.manage && (
                <>
                  <HoldForm
                    productId={p._id}
                    locationId={s.location_id}
                    version={s.version}
                    locations={options.locations.map((l) => ({
                      id: l._id,
                      name: l.name,
                    }))}
                  />
                  {s.missing > 0 && (
                    <HoldForm
                      productId={p._id}
                      locationId={s.location_id}
                      version={s.version}
                      missing
                      locations={options.locations.map((l) => ({
                        id: l._id,
                        name: l.name,
                      }))}
                    />
                  )}
                  <StockAction
                    product={p}
                    locationId={s.location_id}
                    version={s.version}
                    locations={options.locations.map((l) => ({
                      id: l._id,
                      name: l.name,
                    }))}
                  />
                  {["inspection", "cleaning", "repair", "damaged"]
                    .filter((k) => s[k as "inspection"] > 0)
                    .map((k) => (
                      <Inspection
                        key={k}
                        productId={p._id}
                        locationId={s.location_id}
                        version={s.version}
                        fromState={k as "inspection"}
                      />
                    ))}
                </>
              )}
            </div>
          ))}
        </Panel>
      )}
      {p.partial && (
        <p className="mb-4 text-sm">
          Showing the first 100 assets or stock locations. Use catalog filters
          to narrow your search.
        </p>
      )}
      {p.manage && (
        <>
          <History productId={p._id} />
          <CareHistory productId={p._id} />
          <Panel title="Product administration">
            <Disclosure>
              <summary className="cursor-pointer text-sm font-medium">
                Edit catalog details
              </summary>
              <div className="mt-4">
                <ProductEditor product={p} />
              </div>
            </Disclosure>
            <Disclosure>
              <summary className="mt-6 cursor-pointer text-sm font-medium">
                {p.deleted_at ? "Restore product" : "Archive product"}
              </summary>
              <p className="my-3 text-sm text-muted-foreground">
                Archiving preserves all history. Resolve owned stock and
                reservations first.
              </p>
              <Action
                onClick={() =>
                  archive({
                    id: p._id,
                    version: p.version,
                    archive: !p.deleted_at,
                  })
                }
              >
                {p.deleted_at ? "Confirm restore" : "Confirm archive"}
              </Action>
            </Disclosure>
          </Panel>
        </>
      )}
    </div>
  );
}
export function Receipt({
  product,
  locations,
}: {
  product: Product;
  locations: { id: string; name: string }[];
}) {
  const receive = useMutation(api.inventory.receive);
  return (
    <Form
      submit="Receive inventory"
      onSave={(d) =>
        receive({
          product_id: product._id,
          location_id: d.location as Id<"inventory_locations">,
          quantity:
            product.track_mode === "serialized" ? 1 : Number(d.quantity),
          condition:
            product.track_mode === "serialized"
              ? (d.condition as (typeof conditions)[number])
              : "good",
          acquisition_date: d.date,
          reason: d.reason,
        })
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Select
          label="Receiving location"
          name="location"
          options={locations}
          required
        />
        {product.track_mode === "quantity" ? (
          <Field
            label="Quantity received"
            name="quantity"
            type="number"
            value={1}
            required
          />
        ) : (
          <Field
            label="Received condition"
            name="condition"
            value="good"
            options={conditions}
          />
        )}
        <Field
          label="Acquisition date"
          name="date"
          type="date"
          value={day()}
          required
        />
        <Field label="Receipt reference / reason" name="reason" required />
      </div>
      <p className="text-xs text-muted-foreground">
        Serialized items receive a unique GLA number. Quantity receipts
        represent homogeneous stock in good condition.
      </p>
    </Form>
  );
}
export function AvailabilityPicker({
  product,
  locations,
}: {
  product: Product;
  locations: { id: string; name: string }[];
}) {
  const [window, setWindow] = useState<{
    location: string;
    from: string;
    until: string;
  } | null>(null);
  const result = useQuery(
    api.inventory.availability,
    window && !product.deleted_at && product.active
      ? {
          product_id: product._id,
          location_id: window.location as Id<"inventory_locations">,
          needed_from: window.from,
          needed_until: window.until,
        }
      : "skip",
  );
  return (
    <div className="space-y-6">
      <Form
        submit="Check availability"
        successMessage="Availability updated."
        onSave={async (d) => {
          if (d.from > d.until) throw Error("Invalid date window");
          setWindow({ location: d.location, from: d.from, until: d.until });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Select
            label="Source location"
            name="location"
            options={locations}
            required
          />
          <Field
            label="Needed from"
            name="from"
            type="date"
            value={day()}
            required
          />
          <Field
            label="Needed until (inclusive)"
            name="until"
            type="date"
            value={day()}
            required
          />
        </div>
      </Form>
      {result && (
        <div className="mt-5 rounded-xl bg-secondary p-4">
          <p className="font-semibold">
            {result.available} available for this window
          </p>
          <p className="mt-1 text-sm">
            {result.retail_available} available for retail after future staging
            commitments.
          </p>
          {result.assets.map((a) => (
            <p key={a.id} className="mt-2 text-sm">
              {a.asset_number} · {a.condition} ·{" "}
              {a.available ? "Available" : "Unavailable"}
            </p>
          ))}
          {result.partial && (
            <p className="mt-2 text-sm">Showing first 100 assets.</p>
          )}
        </div>
      )}
    </div>
  );
}
export function StockAction({
  product,
  locationId,
  version,
  assetId,
  locations,
}: {
  product: { _id: Id<"products"> };
  locationId: Id<"inventory_locations">;
  version: number;
  assetId?: Id<"inventory_assets">;
  locations: { id: string; name: string }[];
}) {
  const move = useMutation(api.inventory.transferOrDispose);
  return (
    <Disclosure>
      <summary className="cursor-pointer text-sm font-medium">
        Transfer / disposition
      </summary>
      <div className="mt-4">
        <Form
          version={version}
          submit="Record movement"
          onSave={(d, v) =>
            move({
              product_id: product._id,
              asset_id: assetId,
              location_id: locationId,
              to_location_id: (d.destination || undefined) as
                Id<"inventory_locations"> | undefined,
              version: v,
              quantity: assetId ? 1 : Number(d.quantity),
              action: d.action as "transfer",
              reason: d.reason,
            })
          }
        >
          <Field
            label="Movement"
            name="action"
            options={
              assetId
                ? ["transfer", "sold", "retired"]
                : ["transfer", "sold", "retired", "adjustment"]
            }
          />
          <Select
            label="Destination (transfers only)"
            name="destination"
            options={locations}
          />
          {!assetId && (
            <Field
              label="Quantity"
              name="quantity"
              type="number"
              value={1}
              required
            />
          )}
          <Field label="Movement reason" name="reason" required />
          <p className="text-xs text-muted-foreground">
            Sales and corrections preserve every future reservation. A downward
            adjustment creates a missing-stock balance and ledger entry.
          </p>
        </Form>
      </div>
    </Disclosure>
  );
}
export function Inspection({
  productId,
  locationId,
  version,
  assetId,
  reservationId,
  fromState,
}: {
  productId: Id<"products">;
  locationId: Id<"inventory_locations">;
  version: number;
  assetId?: Id<"inventory_assets">;
  reservationId?: Id<"inventory_reservations">;
  fromState: "inspection" | "cleaning" | "repair" | "damaged";
}) {
  const inspect = useMutation(api.inventory.inspect);
  return (
    <Disclosure>
      <summary className="mt-3 cursor-pointer text-sm font-medium">
        Inspect / release {label(fromState)}
      </summary>
      <div className="mt-4">
        <Form
          version={version}
          submit="Record inspection"
          onSave={(d, v) =>
            inspect({
              product_id: productId,
              location_id: locationId,
              asset_id: assetId,
              reservation_id: reservationId,
              version: v,
              quantity: assetId ? 1 : Number(d.quantity),
              from_state: fromState,
              result: d.result as "available",
              condition: d.condition as (typeof conditions)[number],
              notes: d.notes,
            })
          }
        >
          {!assetId && (
            <Field
              label="Quantity inspected"
              name="quantity"
              type="number"
              value={1}
              required
            />
          )}
          <Field
            label="Inspection result"
            name="result"
            options={["available", "cleaning", "repair", "damaged", "retired"]}
          />
          <Field
            label="Condition after inspection"
            name="condition"
            options={conditions}
            value="good"
          />
          <Field label="Inspection notes" name="notes" type="textarea" />
        </Form>
      </div>
    </Disclosure>
  );
}
export function History({
  productId,
  assetId,
}: {
  productId: Id<"products">;
  assetId?: Id<"inventory_assets">;
}) {
  const [cursor, setCursor] = useState<string | null>(null),
    data = useQuery(api.inventory.history, {
      product_id: productId,
      asset_id: assetId,
      paginationOpts: { cursor, numItems: 20 },
    });
  return (
    <Panel title="Movement history">
      {!data ? (
        <Loading />
      ) : (
        <>
          <ol className="divide-y">
            {data.page.map((m) => (
              <li key={m._id} className="py-3">
                <p className="text-sm font-medium">
                  {label(m.movement_type)} · {m.quantity} unit(s)
                </p>
                <p className="text-xs text-muted-foreground">
                  {dateTime(m.occurred_at)} · {m.reason}
                </p>
                {m.project_id && (
                  <Link
                    href={`/projects/${m.project_id}/inventory`}
                    className="text-xs text-primary"
                  >
                    Project inventory →
                  </Link>
                )}
              </li>
            ))}
          </ol>
          <div className="mt-3 flex gap-3">
            <Button
              variant="outline"
              disabled={!cursor}
              onClick={() => setCursor(null)}
            >
              Latest
            </Button>
            <Button
              variant="outline"
              disabled={data.isDone}
              onClick={() => setCursor(data.continueCursor)}
            >
              Older movements
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}
export function CareHistory({
  productId,
  assetId,
}: {
  productId: Id<"products">;
  assetId?: Id<"inventory_assets">;
}) {
  const data = useQuery(api.inventory.careHistory, {
      product_id: productId,
      asset_id: assetId,
    }),
    resolve = useMutation(api.inventory.resolveDamage);
  return (
    <Panel title="Inspections & damage">
      {data?.inspections.map((i) => (
        <p key={i._id} className="mb-3 text-sm">
          {dateTime(i.inspected_at)} · {i.quantity} × {label(i.result)} ·{" "}
          {i.notes}
        </p>
      ))}
      {data?.damage.map((d) => (
        <Disclosure key={d._id}>
          <summary className="my-2 cursor-pointer rounded-lg border p-3 text-sm">
            {label(d.damage_type)} · {d.quantity} units · {label(d.status)}
          </summary>
          <p className="mb-3 text-sm">{d.description}</p>
          <Form
            version={d.version}
            submit="Update damage record"
            onSave={(f, v) =>
              resolve({
                id: d._id,
                version: v,
                status: f.status as "resolved",
                resolution: f.resolution,
              })
            }
          >
            <Field
              label="Damage status"
              name="status"
              options={["assessed", "repair", "resolved", "written_off"]}
            />
            <Field
              label="Resolution"
              name="resolution"
              type="textarea"
              value={d.resolution}
            />
          </Form>
        </Disclosure>
      ))}
      {data && !data.damage.length && !data.inspections.length && (
        <p className="text-sm text-muted-foreground">
          No inspections or damage recorded yet.
        </p>
      )}
      {data?.partial && (
        <p className="text-xs">Latest 20 records per history shown.</p>
      )}
    </Panel>
  );
}
export function AssetDetail({ id }: { id: string }) {
  const a = useQuery(api.inventory.asset, { id: id as Id<"inventory_assets"> }),
    options = useQuery(api.inventory.options, {});
  if (!a || !options) return <Loading />;
  return (
    <div className="space-y-6">
      <Link
        href={`/inventory/products/${a.product_id}`}
        className="text-sm text-primary"
      >
        ← {a.product_name}
      </Link>
      <PageTitle title={a.asset_number} description={a.product_name} />
      <div className="mb-6 flex flex-wrap gap-3">
        <StatusBadge>{label(a.status)}</StatusBadge>
        <StatusBadge>{a.condition}</StatusBadge>
      </div>
      <Panel title="Current whereabouts">
        <p className="text-xl">{a.location_name}</p>
        {a.project_id && (
          <Link
            className="mt-3 inline-block text-sm text-primary"
            href={`/projects/${a.project_id}/inventory`}
          >
            Assigned project →
          </Link>
        )}
        <p className="mt-4 text-sm text-muted-foreground">
          {a.staging_use_count} staging uses · Last inspection:{" "}
          {dateTime(a.last_inspected_at)}
        </p>
        <p className="mt-3 break-all text-xs text-muted-foreground">
          Label identifier: /inventory/assets/{a._id}
        </p>
      </Panel>
      <Panel title="Reservations">
        {a.reservations.map((r) => (
          <div key={r.id} className="mb-3 rounded-xl border p-4">
            <p className="text-sm">
              {r.needed_from} → {r.needed_until} · {label(r.state)}
            </p>
            {r.project_id && (
              <Link
                className="text-sm text-primary"
                href={`/projects/${r.project_id}/inventory`}
              >
                Open project →
              </Link>
            )}
          </div>
        ))}
        {!a.reservations.length && (
          <p className="text-sm text-muted-foreground">
            No active reservations.
          </p>
        )}
      </Panel>
      {a.manage && (
        <>
          <AssetEditor asset={a} />
          {["available", "missing"].includes(a.status) && (
            <Panel title="Stock condition">
              <HoldForm
                productId={a.product_id}
                assetId={a._id}
                version={a.version}
                locationId={a.location_id ?? undefined}
                missing={a.status === "missing"}
                locations={options.locations.map((l) => ({
                  id: l._id,
                  name: l.name,
                }))}
              />
            </Panel>
          )}
          {a.location_id && (
            <Panel title="Asset operations">
              {a.status === "available" && (
                <StockAction
                  product={{ _id: a.product_id }}
                  assetId={a._id}
                  version={a.version}
                  locationId={a.location_id}
                  locations={options.locations.map((l) => ({
                    id: l._id,
                    name: l.name,
                  }))}
                />
              )}{" "}
              {["inspection", "cleaning", "repair", "damaged"].includes(
                a.status,
              ) && (
                <Inspection
                  productId={a.product_id}
                  assetId={a._id}
                  version={a.version}
                  locationId={a.location_id}
                  fromState={a.status as "inspection"}
                />
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                For project-held items, record care through the project
                reservation.
              </p>
            </Panel>
          )}
          <History productId={a.product_id} assetId={a._id} />
          <CareHistory productId={a.product_id} assetId={a._id} />
        </>
      )}
    </div>
  );
}
export function HoldForm({
  productId,
  assetId,
  version,
  locationId,
  missing = false,
  locations,
}: {
  productId: Id<"products">;
  assetId?: Id<"inventory_assets">;
  version: number;
  locationId?: Id<"inventory_locations">;
  missing?: boolean;
  locations: { id: string; name: string }[];
}) {
  const hold = useMutation(api.inventory.holdStock);
  return (
    <Disclosure>
      <summary className="mt-4 cursor-pointer text-sm font-medium">
        {missing
          ? "Recover / write off missing stock"
          : "Report stock condition"}
      </summary>
      <div className="mt-4">
        <Form
          version={version}
          submit="Record stock condition"
          onSave={(d, v) =>
            hold({
              product_id: productId,
              asset_id: assetId,
              location_id: (locationId ??
                d.location) as Id<"inventory_locations">,
              version: v,
              quantity: assetId ? 1 : Number(d.quantity),
              action: d.action as "missing",
              reason: d.reason,
            })
          }
        >
          <Field
            label="Stock condition action"
            name="action"
            options={
              missing
                ? ["found", "retired"]
                : ["inspection_hold", "damage", "missing"]
            }
          />
          {!locationId && (
            <Select
              label="Confirmed receiving location"
              name="location"
              options={locations}
              required
            />
          )}
          {!assetId && (
            <Field
              label="Affected quantity"
              name="quantity"
              type="number"
              value={1}
              required
            />
          )}
          <Field label="Condition report / reason" name="reason" required />
          <p className="text-xs text-muted-foreground">
            For committed inventory, report through the project line. Found
            stock always requires inspection.
          </p>
        </Form>
      </div>
    </Disclosure>
  );
}
function AssetEditor({
  asset,
}: {
  asset: FunctionReturnType<typeof api.inventory.asset>;
}) {
  const save = useMutation(api.inventory.saveAssetDetails);
  return (
    <Panel title="Asset details">
      <Form
        version={asset.version}
        submit="Save asset details"
        onSave={(d, v) =>
          save({
            id: asset._id,
            version: v,
            staging_eligible: d.eligible === "yes",
            notes: d.notes,
          })
        }
      >
        <Field
          label="Asset staging eligible"
          name="eligible"
          options={["yes", "no"]}
          value={asset.staging_eligible ? "yes" : "no"}
        />
        <Field
          label="Asset notes"
          name="notes"
          type="textarea"
          value={asset.notes}
        />
      </Form>
    </Panel>
  );
}
export function Assignments({ productId }: { productId: Id<"products"> }) {
  const [cursor, setCursor] = useState<string | null>(null),
    data = useQuery(api.inventory.productAssignments, {
      product_id: productId,
      paginationOpts: { cursor, numItems: 20 },
    });
  return (
    <Panel title="Current projects & upcoming reservations">
      {!data ? (
        <Loading />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            {data.page.map((r) => (
              <Link
                className="rounded-xl border p-4 text-sm"
                key={r.id}
                href={`/projects/${r.project_id}/inventory`}
              >
                <strong>
                  {r.project_number} · {r.room_name}
                </strong>
                <p className="mt-2">
                  {r.quantity} units · {label(r.state)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {r.needed_from} → {r.needed_until}
                </p>
              </Link>
            ))}
          </div>
          {!data.page.length && (
            <p className="text-sm text-muted-foreground">
              No active assignments visible on this page.
            </p>
          )}
          <div className="mt-4 flex gap-3">
            <Button
              variant="outline"
              disabled={!cursor}
              onClick={() => setCursor(null)}
            >
              First assignments
            </Button>
            <Button
              variant="outline"
              disabled={data.isDone}
              onClick={() => setCursor(data.continueCursor)}
            >
              More assignments
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}
