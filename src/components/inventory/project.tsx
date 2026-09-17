"use client";
import { useInventoryOptions, useInventoryLocations } from "./options";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PageTitle, StatusBadge } from "@/components/primitives";
import {
  Form,
  Field,
  Select,
  Panel,
  Disclosure,
  label,
} from "@/components/operations/shared";
import { Loading, Inspection } from "./catalog";
import { day } from "@/lib/operations/model";
import { conditions } from "@/lib/inventory/model";
import { Button } from "@/components/ui/button";
type ProjectInventory = FunctionReturnType<
  typeof api.inventory.projectInventory
>;
type Line = ProjectInventory["lines"][number];
export function ProjectInventoryLink({ id }: { id: string }) {
  const user = useQuery(api.profiles.viewer, {});
  if (
    !user?.roles.some((r) =>
      ["owner", "admin", "designer", "staging_crew"].includes(r),
    )
  )
    return null;
  return (
    <Panel title="Inventory">
      <p className="mb-4 text-sm text-muted-foreground">
        Plan room inventory, confirm picks, and reconcile each return.
      </p>
      <Link
        className="inline-block rounded-lg bg-primary px-4 py-3 text-sm text-primary-foreground"
        href={`/projects/${id}/inventory`}
      >
        Open project inventory →
      </Link>
    </Panel>
  );
}
export function ProjectInventory({ id }: { id: string }) {
  const allLocations = useInventoryLocations(id);
  const data = useQuery(api.inventory.projectInventory, {
    project_id: id as Id<"projects">,
  });
  const [view, setView] = useState<"rooms" | "pick" | "return">("rooms");
  if (!data || !allLocations) return <Loading />;
  const filtered = data.lines.filter(
    (r) =>
      view === "rooms" ||
      (view === "pick" &&
        ["planned", "reserved", "picked"].includes(r.state)) ||
      (view === "return" &&
        (r.state === "installed" || !!r.installed_at) &&
        [
          "installed",
          "returning",
          "inspection",
          "cleaning",
          "repair",
          "damaged",
          "missing",
        ].includes(r.state)),
  );
  const sorted = [...filtered].sort(
    (a, b) =>
      (view === "pick" ? a.location_name.localeCompare(b.location_name) : 0) ||
      a.room_name.localeCompare(b.room_name) ||
      a.product_name.localeCompare(b.product_name),
  );
  const groups = Object.groupBy(sorted, (r) =>
    view === "pick" ? `${r.location_name} · ${r.room_name}` : r.room_name,
  );
  return (
    <div className="space-y-6">
      <Link className="text-sm text-primary" href={`/projects/${id}`}>
        ← {data.project_number}
      </Link>
      <PageTitle
        title="Project inventory"
        description={`${data.project_number} · Plan, pick, install, return.`}
      />
      <div className="mb-6 flex flex-wrap gap-3">
        <StatusBadge>{label(data.readiness)}</StatusBadge>
        <StatusBadge>{label(data.project_status)}</StatusBadge>
      </div>
      <div
        className="mb-5 grid grid-cols-3 gap-2"
        role="group"
        aria-label="Inventory view"
      >
        {(["rooms", "pick", "return"] as const).map((v) => (
          <Button
            variant={view === v ? "default" : "outline"}
            aria-pressed={view === v}
            key={v}
            onClick={() => setView(v)}
          >
            {v === "rooms"
              ? "By room"
              : v === "pick"
                ? "Pick list"
                : "Return list"}
          </Button>
        ))}
      </div>
      <Panel title="Reconciliation">
        <div className="flex flex-wrap gap-4 text-sm">
          <span>
            {data.lines
              .filter((r) => r.state === "installed")
              .reduce((n, r) => n + r.quantity, 0)}{" "}
            installed
          </span>
          <span>{data.lines.filter((r) => r.shortage).length} shortages</span>
          <span>
            {data.lines.filter((r) => r.exception && r.active).length}{" "}
            exceptions
          </span>
          <span>
            {data.lines
              .filter((r) => r.state === "picked")
              .reduce((n, r) => n + r.quantity, 0)}{" "}
            picked
          </span>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Staging requires each line installed, released, or an
          Owner/Admin-approved exception. Return receipts enter inspection.
          Completing a project does not release stock.
        </p>
      </Panel>
      {data.design && data.can_edit && (
        <Panel title="Reserve for a room">
          <Disclosure>
            <summary className="cursor-pointer text-sm font-medium">
              Find and reserve inventory
            </summary>
            <div className="mt-5">
              <ReservationBuilder projectId={id as Id<"projects">} />
            </div>
          </Disclosure>
        </Panel>
      )}
      {Object.entries(groups).map(([group, rows]) => (
        <Panel key={group} title={group}>
          <div className="space-y-4">
            {rows?.map((r) => (
              <InventoryLine
                key={r._id}
                row={r}
                data={{
                  ...data,
                  locations: allLocations.map((l) => ({
                    id: l._id,
                    name: l.name,
                  })),
                  partial: false,
                }}
              />
            ))}
          </div>
        </Panel>
      ))}
      {!filtered.length && (
        <Panel
          title={
            view === "rooms"
              ? "No inventory assigned"
              : view === "pick"
                ? "Nothing waiting to be picked"
                : "No expected returns"
          }
        >
          <p className="text-sm text-muted-foreground">
            {view === "rooms"
              ? "Choose a project room and reserve inventory for its staging dates."
              : "This list is derived from the confirmed inventory movements."}
          </p>
        </Panel>
      )}
    </div>
  );
}
function InventoryLine({
  row: r,
  data,
}: {
  row: Line;
  data: ProjectInventory;
}) {
  const move = useMutation(api.inventory.moveReservation);
  const actions: string[] = [];
  if (data.can_edit) {
    if (data.design && r.state === "planned") actions.push("confirm");
    if (data.design && ["planned", "reserved"].includes(r.state))
      actions.push("release");
    if (data.crew && r.state === "reserved")
      actions.push("pick", "wrong_item", "missing", "damage");
    if (data.crew && r.state === "picked")
      actions.push("install", "return", "missing", "damage");
    if (data.crew && r.state === "installed")
      actions.push("destage", "missing", "damage");
    if (data.crew && r.state === "returning")
      actions.push("return", "missing", "damage");
    if (data.manage && r.active) actions.push("exception");
  }
  if (data.manage && r.state === "missing") actions.push("found", "write_off");
  if (data.manage && r.state === "damaged") actions.push("receive_damage");
  return (
    <article className="rounded-xl border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {r.product_name} ×{r.quantity}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {r.asset_number ?? r.sku} · {r.condition}
          </p>
        </div>
        <StatusBadge>{label(r.state)}</StatusBadge>
      </div>
      <p className="mt-3 text-sm">Current: {r.current_location}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {r.needed_from} → {r.needed_until} (inclusive)
      </p>
      {r.shortage && (
        <p
          role="status"
          className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900"
        >
          Shortage — stock is no longer sufficient for this window.
        </p>
      )}
      {r.exception && (
        <p className="mt-3 text-sm text-amber-900">
          {r.exception_approved ? "Approved exception" : "Reported exception"}:{" "}
          {r.exception}
        </p>
      )}
      {!!actions.length && (
        <Disclosure>
          <summary className="mt-4 cursor-pointer rounded-lg border px-3 py-3 text-sm font-medium">
            Record inventory action
          </summary>
          <div className="mt-4">
            <Form
              version={r.version}
              submit="Confirm inventory action"
              onSave={(d, version) =>
                move({
                  id: r._id,
                  version,
                  action: d.action as "pick",
                  return_outcome:
                    d.action === "return"
                      ? (d.return_outcome as
                          "good" | "damaged" | "cleaning" | "repair")
                      : undefined,
                  quantity: r.asset_id ? 1 : Number(d.quantity),
                  asset_confirmation: d.asset_confirmation ?? "",
                  location_id: (d.location || undefined) as
                    Id<"inventory_locations"> | undefined,
                  reason: d.reason,
                })
              }
            >
              <Field label="Action" name="action" options={actions} />
              {r.asset_id ? (
                <Field label="Confirm asset number" name="asset_confirmation" />
              ) : (
                <Field
                  label="Quantity to confirm"
                  name="quantity"
                  type="number"
                  value={r.quantity}
                  required
                />
              )}
              <Select
                label="Receiving location (returns / found items)"
                name="location"
                options={data.locations}
              />
              <Field
                label="Return outcome (returns only)"
                name="return_outcome"
                options={["good", "damaged", "cleaning", "repair"]}
              />
              <Field label="Action notes / reason" name="reason" required />
              <p className="text-xs text-muted-foreground">
                Confirm the physical asset or quantity. Partial quantities
                remain traceable as separate lines.
              </p>
            </Form>
          </div>
        </Disclosure>
      )}
      {data.manage &&
        ["inspection", "cleaning", "repair", "damaged"].includes(r.state) && (
          <Inspection
            productId={r.product_id}
            reservationId={r._id}
            assetId={r.asset_id ?? undefined}
            locationId={r.return_location_id ?? r.location_id}
            version={r.version}
            fromState={r.state as "inspection"}
          />
        )}
    </article>
  );
}
function ReservationBuilder({ projectId }: { projectId: Id<"projects"> }) {
  const project = useQuery(api.operations.get, { id: projectId }),
    options = useInventoryOptions();
  const [filters, setFilters] = useState({
    search: "",
    category: "",
    location: "",
    color: "",
    condition: "",
    from: day(),
    until: day(),
  });
  const [selected, setSelected] = useState<Id<"products"> | null>(null),
    [cursor, setCursor] = useState<string | null>(null);
  const products = useQuery(api.inventory.list, {
    paginationOpts: { cursor, numItems: 8 },
    search: filters.search,
    category_id: (filters.category || undefined) as
      Id<"inventory_categories"> | undefined,
    location_id: (filters.location || undefined) as
      Id<"inventory_locations"> | undefined,
    color: filters.color || undefined,
    condition: (filters.condition || undefined) as
      (typeof conditions)[number] | undefined,
    available_only: false,
    staging_only: true,
    archived: false,
  });
  if (!options || !project) return <Loading />;
  return (
    <div className="space-y-6">
      <Form
        submit="Find products"
        successMessage="Products found."
        onSave={async (d) => {
          if (d.from > d.until) throw Error("Invalid date window");
          setSelected(null);
          setCursor(null);
          setFilters({
            search: d.search,
            category: d.category,
            location: d.location,
            color: d.color,
            condition: d.condition,
            from: d.from,
            until: d.until,
          });
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Product search" name="search" />
          <Select
            label="Category filter"
            name="category"
            options={options.categories.map((c) => ({
              id: c._id,
              name: c.name,
            }))}
          />
          <Select
            label="Staging source"
            name="location"
            options={options.locations
              .filter((l) => l.staging_source)
              .map((l) => ({ id: l._id, name: l.name }))}
            required
          />
          <Field label="Color filter" name="color" />
          <Field
            label="Condition filter"
            name="condition"
            options={["", ...conditions]}
          />
          <Field
            label="Reservation from"
            name="from"
            type="date"
            value={day()}
            required
          />
          <Field
            label="Reservation until (inclusive)"
            name="until"
            type="date"
            value={project.planned_end_date || day()}
            required
          />
        </div>
      </Form>
      <div className="my-4 grid gap-3 sm:grid-cols-2">
        {products?.page.map((p) => (
          <Button
            variant={selected === p._id ? "default" : "outline"}
            className="h-auto min-h-12 justify-start whitespace-normal text-left"
            key={p._id}
            onClick={() => setSelected(p._id)}
          >
            {p.name} · {p.sku}
          </Button>
        ))}
      </div>
      {products && !products.isDone && (
        <Button
          variant="outline"
          onClick={() => setCursor(products.continueCursor)}
        >
          More products
        </Button>
      )}
      {selected && filters.location ? (
        <ReserveSelection
          key={`${selected}-${filters.from}-${filters.until}-${filters.location}`}
          projectId={projectId}
          productId={selected}
          locationId={filters.location as Id<"inventory_locations">}
          from={filters.from}
          until={filters.until}
          rooms={project.rooms.map((r) => ({ id: r._id, name: r.room_name }))}
        />
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">
          Apply a source location and dates, then choose a product.
        </p>
      )}
    </div>
  );
}
function ReserveSelection({
  projectId,
  productId,
  locationId,
  from,
  until,
  rooms,
}: {
  projectId: Id<"projects">;
  productId: Id<"products">;
  locationId: Id<"inventory_locations">;
  from: string;
  until: string;
  rooms: { id: string; name: string }[];
}) {
  const availability = useQuery(api.inventory.availability, {
      product_id: productId,
      location_id: locationId,
      needed_from: from,
      needed_until: until,
    }),
    reserve = useMutation(api.inventory.reserve);
  if (!availability) return <Loading />;
  return (
    <div className="mt-5 rounded-xl border bg-secondary p-5">
      <p className="mb-4 font-semibold">
        {availability.available} available · {from} → {until}
      </p>
      <Form
        submit="Save reservation"
        onSave={(d) =>
          reserve({
            project_id: projectId,
            project_room_id: d.room as Id<"project_rooms">,
            product_id: productId,
            location_id: locationId,
            asset_id:
              availability.track_mode === "serialized"
                ? (d.asset as Id<"inventory_assets">)
                : undefined,
            quantity:
              availability.track_mode === "serialized" ? 1 : Number(d.quantity),
            needed_from: from,
            needed_until: until,
            notes: d.notes,
            planned: d.intent === "planned",
          })
        }
      >
        <Select label="Destination room" name="room" options={rooms} required />
        {availability.track_mode === "serialized" ? (
          <Select
            label="Physical asset"
            name="asset"
            options={availability.assets.map((a) => ({
              id: a.id,
              name: `${a.asset_number} · ${a.condition} · ${a.available ? "available" : "unavailable"}`,
            }))}
            required
          />
        ) : (
          <Field
            label="Quantity to reserve"
            name="quantity"
            type="number"
            value={1}
            required
          />
        )}
        <Field
          label="Reservation intent"
          name="intent"
          options={["reserved", "planned"]}
        />
        <Field label="Reservation notes" name="notes" type="textarea" />
        <p className="text-xs text-muted-foreground">
          Planned demand records a need without allocating stock. Confirm it
          before picking. Reserved dates include both boundary days.
        </p>
      </Form>
    </div>
  );
}
