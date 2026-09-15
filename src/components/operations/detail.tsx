"use client";
import { CopilotLink } from "@/components/ai/copilot";

import { CommercialProjectLink } from "@/components/commercial/project";
import { ProjectInventoryLink } from "@/components/inventory/project";
import { useState } from "react";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import { PageTitle, StatusBadge } from "@/components/primitives";
import {
  graph,
  day,
  roomTypes,
  roomStatuses,
  scopes,
  categories,
  eventTypes,
} from "@/lib/operations/model";
import {
  Disclosure,
  Form,
  Field,
  Select,
  Panel,
  Loading,
  Action,
  label,
  dateTime,
  localTime,
  toUtc,
  Pager,
} from "./shared";
type Project = FunctionReturnType<typeof api.operations.get>;
type Options = FunctionReturnType<typeof api.operations.projectOptions>;
export function ProjectDetail({ id }: { id: string }) {
  const p = useQuery(api.operations.get, { id: id as Id<"projects"> });
  if (!p) return <Loading />;
  return (
    <>
      <div className="mb-5">
        <Link className="text-sm text-primary" href="/projects">
          ← All projects
        </Link>
      </div>
      <PageTitle
        title={p.project_number}
        description={`${p.property_address} · ${p.city} · ${p.realtor_name}`}
      />
      <div className="mb-6 flex flex-wrap gap-3">
        <StatusBadge>{label(p.status)}</StatusBadge>
        <CopilotLink
          feature={p.access === "marketing" ? "marketing" : "project"}
          id={id}
        />
        <StatusBadge>{p.priority} priority</StatusBadge>
        {p.deleted_at && <StatusBadge>Archived</StatusBadge>}
      </div>
      {p.attention_reasons.length > 0 && (
        <div
          className={`mb-6 rounded-xl border p-5 ${p.attention_level === "red" ? "bg-red-50 text-red-900" : "bg-amber-50 text-amber-900"}`}
        >
          <h2 className="font-semibold">Needs attention</h2>
          <ul className="mt-2 list-inside list-disc text-sm">
            {p.attention_reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mb-6 grid gap-5 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Staging", dateTime(p.staging_date)],
          ["Destaging", dateTime(p.destaging_date)],
          [
            "Package",
            `${p.package_type} · ends ${p.planned_end_date || "not set"}`,
          ],
          ["Project manager", p.project_manager_name || "Not shown"],
        ].map(([title, value]) => (
          <div className="rounded-xl border bg-card p-5" key={title}>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              {title}
            </p>
            <p className="mt-3 text-sm font-medium">{value}</p>
          </div>
        ))}
      </div>
      {p.source && (
        <div className="mb-6 flex flex-wrap gap-4 text-sm text-primary">
          <Link href={`/properties/${p.source.property_id}`}>Property →</Link>
          <Link href={`/opportunities/${p.source.opportunity_id}`}>
            Won opportunity →
          </Link>
          <Link href={`/realtors/${p.source.realtor_id}`}>Realtor →</Link>
          {p.source.source_quote_id && (
            <Link href={`/quotes/${p.source.source_quote_id}`}>
              Source quote →
            </Link>
          )}
        </div>
      )}
      <div className="mb-6 flex flex-wrap gap-3 text-xs text-muted-foreground">
        {p.listing_live_date && (
          <span>Listing live: {p.listing_live_date}</span>
        )}
        {p.pending_sale_date && (
          <span>Pending sale: {p.pending_sale_date}</span>
        )}
        {p.sold_date && <span>Sold: {p.sold_date}</span>}
        {p.actual_end_date && <span>Actual end: {p.actual_end_date}</span>}
      </div>
      {p.access !== "marketing" && p.can_edit && <StatusControls p={p} />}{" "}
      {p.access === "manage" || p.access === "design" || p.access === "crew" ? (
        <OperationalDetail p={p} />
      ) : (
        <Panel title="Project overview">
          <p className="text-sm text-muted-foreground">
            This view contains the project information available to your role.
          </p>
        </Panel>
      )}
      {p.access === "manage" && !p.can_edit && <ArchiveProject p={p} />}
    </>
  );
}
function StatusControls({ p }: { p: Project }) {
  const change = useMutation(api.operations.transition);
  const choices = graph[p.status].filter(
    (s) =>
      s !== "scheduled" &&
      s !== "destaging_scheduled" &&
      (p.access === "manage" ||
        (p.access === "design" &&
          ["designing", "ready_to_schedule"].includes(s)) ||
        (p.access === "crew" &&
          ["staging", "staged", "destaging", "completed"].includes(s)) ||
        (p.access === "sales" &&
          ["listing_live", "pending_sale", "sold"].includes(s))),
  );
  return (
    <div className="mb-6 flex flex-wrap gap-3">
      {choices
        .filter((s) => s !== "cancelled")
        .map((s) =>
          ["listing_live", "pending_sale", "sold"].includes(s) ? (
            <Disclosure key={s} className="rounded-lg border bg-card p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Mark {label(s)}
              </summary>
              <div className="mt-4">
                <Form
                  version={p.version}
                  submit={`Confirm ${label(s)}`}
                  onSave={(d, version) =>
                    change({ id: p.id, version, status: s, date: d.date })
                  }
                >
                  <Field
                    label="Actual date"
                    name="date"
                    type="date"
                    value={day()}
                    required
                  />
                </Form>
              </div>
            </Disclosure>
          ) : (
            <Action
              key={s}
              onClick={() =>
                change({ id: p.id, version: p.version, status: s })
              }
            >
              Mark {label(s)}
            </Action>
          ),
        )}
      {p.access === "manage" && (
        <Disclosure className="rounded-lg border bg-card p-3">
          <summary className="cursor-pointer text-sm">Cancel project</summary>
          <div className="mt-4">
            <Form
              version={p.version}
              submit="Confirm cancellation"
              onSave={(d, version) =>
                change({
                  id: p.id,
                  version,
                  status: "cancelled",
                  reason: d.reason,
                  notes: d.notes,
                })
              }
            >
              <Field label="Cancellation reason" name="reason" required />
              <Field label="Cancellation notes" name="notes" type="textarea" />
            </Form>
          </div>
        </Disclosure>
      )}
    </div>
  );
}
function OperationalDetail({ p }: { p: Project }) {
  const options = useQuery(api.operations.projectOptions, { id: p.id });
  if (!options) return <Loading />;
  return (
    <>
      <nav
        aria-label="Project sections"
        className="sticky top-0 z-10 mb-6 flex gap-1 overflow-x-auto rounded-xl border bg-card p-2 text-sm"
      >
        {["rooms", "checklist", "schedule", "tasks", "team", "notes"].map(
          (s) => (
            <a
              className="min-h-11 shrink-0 rounded-lg px-4 py-3 hover:bg-muted"
              key={s}
              href={`#${s}`}
            >
              {label(s)}
            </a>
          ),
        )}
      </nav>
      <div className="space-y-6">
        {p.access === "manage" && p.can_edit && (
          <Disclosure className="rounded-xl border bg-card p-5">
            <summary className="cursor-pointer font-medium">
              Edit project overview
            </summary>
            <OverviewForm p={p} options={options} />
          </Disclosure>
        )}
        <div id="rooms">
          <Rooms p={p} />
        </div>
        <div id="checklist">
          <Checklist p={p} options={options} />
        </div>
        <div id="schedule">
          <Schedule p={p} options={options} />
        </div>
        <div id="tasks">
          <Tasks p={p} options={options} />
        </div>
        <div id="team">
          <Team p={p} />
        </div>
        {["manage", "crew"].includes(p.access) && <AccessDetails p={p} />}
        <div id="notes">
          <Notes p={p} />
        </div>
        {p.access === "manage" && <Notes p={p} audit />}
        <CommercialProjectLink id={p.id} />
        <ProjectInventoryLink id={p.id} />
      </div>
    </>
  );
}
function OverviewForm({ p, options }: { p: Project; options: Options }) {
  const save = useMutation(api.operations.update);
  return (
    <div className="mt-5">
      <Form
        version={p.version}
        submit="Save project"
        onSave={(d, version) =>
          save({ id: p.id, version, input: JSON.stringify(d) })
        }
      >
        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            name="package_type"
            label="Package"
            value={p.package_type}
            options={[...new Set([p.package_type, ...options.package_types])]}
          />
          <Field
            name="planned_end_date"
            label="Package end date"
            type="date"
            value={p.planned_end_date}
          />
          <Field
            name="priority"
            label="Priority"
            options={["normal", "high", "urgent"]}
            value={p.priority}
          />
        </div>
        <Field
          name="internal_notes"
          label="Manager notes"
          type="textarea"
          value={p.internal_notes}
        />
      </Form>
    </div>
  );
}
function Rooms({ p }: { p: Project }) {
  return (
    <Panel title="Room plan">
      <div className="grid gap-4 sm:grid-cols-2">
        {p.rooms.map((r) => (
          <article className="rounded-xl border p-4" key={r._id}>
            <div className="flex flex-wrap justify-between gap-2">
              <h3 className="font-semibold">{r.room_name}</h3>
              <StatusBadge>{label(r.status)}</StatusBadge>
            </div>
            <p className="mt-2 text-sm text-muted-foreground">
              {label(r.staging_scope)} ·{" "}
              {r.style_direction || "Style direction not set"}
            </p>
            {r.notes && (
              <p className="mt-2 whitespace-pre-wrap text-sm">{r.notes}</p>
            )}
            {p.can_edit && ["manage", "design"].includes(p.access) && (
              <Disclosure className="mt-4">
                <summary className="cursor-pointer text-sm text-primary">
                  Edit or reorder room
                </summary>
                <RoomForm p={p} room={r} />
              </Disclosure>
            )}
          </article>
        ))}
      </div>
      {p.can_edit && ["manage", "design"].includes(p.access) && (
        <Disclosure className="mt-5">
          <summary className="cursor-pointer font-medium text-primary">
            Add room
          </summary>
          <RoomForm p={p} />
        </Disclosure>
      )}
    </Panel>
  );
}
function RoomForm({ p, room }: { p: Project; room?: Doc<"project_rooms"> }) {
  const save = useMutation(api.operations.saveRoom);
  return (
    <div className="mt-5">
      <Form
        version={room?.version}
        submit={room ? "Save room" : "Add room"}
        onSave={(d, version) =>
          save({
            project_id: p.id,
            id: room?._id,
            version,
            input: JSON.stringify(d),
          })
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="room_type"
            label="Room type"
            options={roomTypes}
            value={room?.room_type ?? "living_room"}
          />
          <Field
            name="room_name"
            label="Room name"
            value={room?.room_name}
            required
          />
          <Field
            name="staging_scope"
            label="Staging scope"
            options={scopes}
            value={room?.staging_scope ?? "full"}
          />
          <Field
            name="status"
            label="Room status"
            options={roomStatuses}
            value={room?.status ?? "planned"}
          />
          <Field
            name="sort_order"
            label="Display order"
            type="number"
            value={room?.sort_order ?? p.rooms.length}
          />
          <Field
            name="style_direction"
            label="Style direction"
            value={room?.style_direction}
          />
        </div>
        <Field
          name="notes"
          label="Room notes"
          type="textarea"
          value={room?.notes}
        />
      </Form>
      {room && (
        <div className="mt-4">
          <Action
            onClick={() =>
              save({
                project_id: p.id,
                id: room._id,
                version: room.version,
                archive: true,
                input: JSON.stringify({
                  room_type: room.room_type,
                  room_name: room.room_name,
                  staging_scope: room.staging_scope,
                  status: room.status,
                  sort_order: room.sort_order,
                  notes: room.notes,
                  style_direction: room.style_direction,
                }),
              })
            }
          >
            Archive room
          </Action>
        </div>
      )}
    </div>
  );
}
function Checklist({ p, options }: { p: Project; options: Options }) {
  const save = useMutation(api.operations.checklist);
  return (
    <Panel title="Operational checklist">
      <p className="mb-5 text-sm text-muted-foreground">
        {p.checklist.filter((c) => c.status === "completed").length} /{" "}
        {p.checklist.length} complete · Required items protect critical stage
        transitions.
      </p>
      {categories.map((category) => (
        <Disclosure key={category} open className="mb-4 rounded-xl border p-4">
          <summary className="cursor-pointer font-semibold">
            {label(category)}
          </summary>
          <div className="mt-4 divide-y">
            {p.checklist
              .filter((c) => c.category === category)
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((c) => (
                <article className="py-4" key={c._id}>
                  <div className="flex flex-col justify-between gap-3 sm:flex-row">
                    <div>
                      <h3 className="text-sm font-medium">
                        {c.title}{" "}
                        {c.required && (
                          <span className="text-xs text-primary">
                            · Required
                          </span>
                        )}
                      </h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {label(c.status)} ·{" "}
                        {options.staff.find((s) => s.id === c.assigned_to)
                          ?.name ?? "Unassigned"}
                        {c.due_at ? ` · Due ${dateTime(c.due_at)}` : ""}
                      </p>
                    </div>
                    {p.can_edit &&
                      (p.access === "manage" ||
                        c.assigned_to === p.viewer_id) &&
                      c.status !== "completed" && (
                        <Action
                          onClick={() =>
                            save({
                              id: c._id,
                              version: c.version,
                              status: "completed",
                            })
                          }
                        >
                          Complete
                        </Action>
                      )}
                  </div>
                  {p.can_edit &&
                    (p.access === "manage" ||
                      c.assigned_to === p.viewer_id) && (
                      <Disclosure className="mt-3">
                        <summary className="cursor-pointer text-xs text-primary">
                          Update checklist item
                        </summary>
                        <div className="mt-4">
                          <Form
                            version={c.version}
                            submit="Save checklist item"
                            onSave={(d, version) =>
                              save({
                                id: c._id,
                                version,
                                status:
                                  d.status as Doc<"project_checklist_items">["status"],
                                skip_reason: d.skip_reason,
                                assigned_to:
                                  p.access === "manage" && d.assigned_to
                                    ? (d.assigned_to as Id<"users">)
                                    : undefined,
                                required:
                                  p.access === "manage"
                                    ? d.required === "yes"
                                    : undefined,
                                due_at:
                                  p.access === "manage"
                                    ? d.due_at
                                      ? toUtc(d.due_at)
                                      : null
                                    : undefined,
                                reason: d.reason,
                              })
                            }
                          >
                            <div className="grid gap-4 sm:grid-cols-2">
                              <Field
                                label="Checklist status"
                                name="status"
                                options={[
                                  "pending",
                                  "in_progress",
                                  "completed",
                                  "skipped",
                                ]}
                                value={c.status}
                              />
                              <Field
                                label="Skip reason"
                                name="skip_reason"
                                value={c.skip_reason}
                              />
                              {p.access === "manage" && (
                                <>
                                  <Select
                                    name="assigned_to"
                                    label="Assigned to"
                                    value={c.assigned_to}
                                    options={options.staff}
                                  />
                                  <Field
                                    label="Due — Vancouver time"
                                    name="due_at"
                                    type="datetime-local"
                                    value={c.due_at ? localTime(c.due_at) : ""}
                                  />
                                  <Field
                                    label="Required"
                                    name="required"
                                    value={c.required ? "yes" : "no"}
                                    options={["yes", "no"]}
                                  />
                                  <Field
                                    label="Reason for requirement change"
                                    name="reason"
                                  />
                                </>
                              )}
                            </div>
                          </Form>
                        </div>
                      </Disclosure>
                    )}
                </article>
              ))}
          </div>
        </Disclosure>
      ))}
    </Panel>
  );
}
function Schedule({ p, options }: { p: Project; options: Options }) {
  const change = useMutation(api.operations.eventState);
  return (
    <Panel title="Schedule">
      <p className="mb-4 text-sm text-muted-foreground">
        All times are America/Vancouver. Staging and destaging dates come from
        these events.
      </p>
      <div className="space-y-4">
        {p.events.map((e) => (
          <article key={e._id} className="rounded-xl border p-4">
            <h3 className="font-medium">
              {label(e.event_type)} · {e.title}
            </h3>
            <p className="mt-1 text-sm">
              {dateTime(e.start_at)} — {dateTime(e.end_at)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {e.status} ·{" "}
              {options.staff.find((s) => s.id === e.assigned_lead_id)?.name ??
                "Former team member"}
            </p>
            {e.description && <p className="mt-2 text-sm">{e.description}</p>}
            {e.location_note && (
              <p className="mt-2 text-sm">{e.location_note}</p>
            )}
            {p.can_edit &&
              p.access === "manage" &&
              e.status === "scheduled" && (
                <>
                  <Disclosure className="mt-3">
                    <summary className="cursor-pointer text-sm text-primary">
                      Reschedule event
                    </summary>
                    <ScheduleForm p={p} options={options} event={e} />
                  </Disclosure>
                  <Disclosure className="mt-3">
                    <summary className="cursor-pointer text-sm">
                      Cancel or finish event
                    </summary>
                    <div className="mt-3">
                      <Form
                        version={e.version}
                        submit="Confirm event status"
                        onSave={(d, version) =>
                          change({
                            id: e._id,
                            version,
                            status: d.status as "completed" | "cancelled",
                            reason: d.reason,
                          })
                        }
                      >
                        <Field
                          label="Event status"
                          name="status"
                          options={[
                            "cancelled",
                            ...(["staging", "destaging"].includes(e.event_type)
                              ? []
                              : ["completed"]),
                          ]}
                        />
                        <Field label="Reason" name="reason" required />
                      </Form>
                    </div>
                  </Disclosure>
                </>
              )}
          </article>
        ))}
      </div>
      {p.can_edit && p.access === "manage" && (
        <Disclosure
          className="mt-5"
          open={p.status === "sold" || p.status === "ready_to_schedule"}
        >
          <summary className="cursor-pointer font-medium text-primary">
            Schedule an operation
          </summary>
          <ScheduleForm p={p} options={options} />
        </Disclosure>
      )}
    </Panel>
  );
}
function ScheduleForm({
  p,
  options,
  event,
}: {
  p: Project;
  options: Options;
  event?: Doc<"operations_events">;
}) {
  const save = useMutation(api.operations.schedule),
    [projectVersion, setProjectVersion] = useState(p.version);
  return (
    <div className="mt-5">
      <Form
        version={event?.version}
        submit={event ? "Save schedule" : "Schedule operation"}
        onSave={async (d, version) => {
          const result = await save({
            project_id: p.id,
            project_version: projectVersion,
            id: event?._id,
            version,
            event_type: d.event_type as Doc<"operations_events">["event_type"],
            title: d.title,
            description: d.description,
            start_at: toUtc(d.start_at),
            end_at: toUtc(d.end_at),
            assigned_lead_id: d.assigned_lead_id as Id<"users">,
            location_note: d.location_note,
          });
          setProjectVersion((current) => current + 1);
          return result;
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            name="event_type"
            label="Operation type"
            options={event ? [event.event_type] : eventTypes}
            value={
              event?.event_type ??
              (p.status === "sold" ? "destaging" : "staging")
            }
          />
          <Field
            name="title"
            label="Event title"
            required
            value={
              event?.title ??
              (p.status === "sold" ? "Destaging" : "Staging installation")
            }
          />
          <Field
            name="start_at"
            label="Start — Vancouver time"
            type="datetime-local"
            required
            value={event ? localTime(event.start_at) : ""}
          />
          <Field
            name="end_at"
            label="End — Vancouver time"
            type="datetime-local"
            required
            value={event ? localTime(event.end_at) : ""}
          />
          <Select
            name="assigned_lead_id"
            label="Assigned lead"
            required
            value={event?.assigned_lead_id ?? p.team?.staging_lead_id}
            options={options.staff}
          />
          <Field
            name="location_note"
            label="Location note (no access codes)"
            value={event?.location_note}
          />
        </div>
        <Field
          name="description"
          label="Event description"
          type="textarea"
          value={event?.description}
        />
      </Form>
    </div>
  );
}
function Tasks({ p, options }: { p: Project; options: Options }) {
  const save = useMutation(api.operations.saveTask),
    archive = useMutation(api.operations.archiveTask);
  return (
    <Panel title="Project tasks">
      <p className="mb-5 text-sm text-muted-foreground">
        Ad hoc work uses Activities. Checklist requirements keep their own
        process history.
      </p>
      <div className="space-y-4">
        {p.tasks.map((t) => (
          <article key={t._id} className="rounded-xl border p-4">
            <h3 className="font-medium">{t.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {t.status} ·{" "}
              {options.staff.find((s) => s.id === t.assigned_to)?.name ??
                "Former team member"}{" "}
              · {dateTime(t.due_at)}
            </p>
            {t.description && <p className="mt-2 text-sm">{t.description}</p>}
            {p.can_edit &&
              t.status === "open" &&
              (p.access === "manage" || t.assigned_to === p.viewer_id) && (
                <div className="mt-4">
                  <Action
                    onClick={() =>
                      save({
                        project_id: p.id,
                        id: t._id,
                        version: t.version ?? 1,
                        room_id: t.project_room_id,
                        title: t.title,
                        description: t.description ?? "",
                        due_at: t.due_at!,
                        assigned_to: t.assigned_to,
                        status: "completed",
                      })
                    }
                  >
                    Complete task
                  </Action>
                </div>
              )}
            {p.can_edit &&
              ["manage", "design"].includes(p.access) &&
              (p.access === "manage" || t.assigned_to === p.viewer_id) && (
                <Disclosure className="mt-3">
                  <summary className="cursor-pointer text-sm text-primary">
                    Edit task
                  </summary>
                  <TaskForm p={p} options={options} task={t} />
                </Disclosure>
              )}
            {p.can_edit && p.access === "manage" && t.status !== "open" && (
              <div className="mt-3">
                <Action
                  onClick={() =>
                    archive({ id: t._id, version: t.version ?? 1 })
                  }
                >
                  Archive task
                </Action>
              </div>
            )}
          </article>
        ))}
      </div>
      {p.can_edit && ["manage", "design"].includes(p.access) && (
        <Disclosure className="mt-5">
          <summary className="cursor-pointer font-medium text-primary">
            Add task
          </summary>
          <TaskForm p={p} options={options} />
        </Disclosure>
      )}
    </Panel>
  );
}
function TaskForm({
  p,
  options,
  task,
}: {
  p: Project;
  options: Options;
  task?: Doc<"activities">;
}) {
  const save = useMutation(api.operations.saveTask);
  return (
    <div className="mt-4">
      <Form
        version={task?.version}
        submit="Save task"
        onSave={(d, version) =>
          save({
            project_id: p.id,
            id: task?._id,
            version,
            room_id: d.room_id ? (d.room_id as Id<"project_rooms">) : undefined,
            title: d.title,
            description: d.description,
            due_at: toUtc(d.due_at),
            assigned_to: d.assigned_to as Id<"users">,
            status: d.status as "open" | "completed" | "cancelled",
          })
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Task title" name="title" value={task?.title} required />
          <Select
            label="Task assignee"
            name="assigned_to"
            required
            value={task?.assigned_to ?? p.viewer_id}
            options={
              p.access === "design"
                ? options.staff.filter((s) => s.id === p.viewer_id)
                : options.staff
            }
          />
          <Field
            label="Task due — Vancouver time"
            name="due_at"
            type="datetime-local"
            value={task?.due_at ? localTime(task.due_at) : ""}
            required
          />
          <Select
            label="Room context"
            name="room_id"
            value={task?.project_room_id}
            options={p.rooms.map((r) => ({ id: r._id, name: r.room_name }))}
          />
          <Field
            label="Task status"
            name="status"
            options={["open", "completed", "cancelled"]}
            value={task?.status ?? "open"}
          />
        </div>
        <Field
          label="Task details"
          name="description"
          type="textarea"
          value={task?.description}
        />
      </Form>
    </div>
  );
}
function Team({ p }: { p: Project }) {
  const viewer = useQuery(api.profiles.viewer, {}),
    admin = viewer?.roles.some((r) => ["owner", "admin"].includes(r)),
    options = useQuery(
      api.operations.options,
      admin && p.can_edit ? {} : "skip",
    ),
    save = useMutation(api.operations.setTeam);
  return (
    <Panel title="Project team">
      <dl className="grid gap-4 sm:grid-cols-3">
        {[
          ["Manager", p.project_manager_name],
          ["Designer", p.designer_name],
          ["Staging lead", p.staging_lead_name],
        ].map(([key, value]) => (
          <div key={key}>
            <dt className="text-sm text-muted-foreground">{key}</dt>
            <dd className="mt-1 font-medium">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-sm">
        {p.team?.additional
          .map((t) => `${t.name} (${label(t.role)})`)
          .join(" · ") || "No additional participants"}
      </p>
      {options && (
        <Disclosure className="mt-5">
          <summary className="cursor-pointer text-primary">
            Manage assignments
          </summary>
          <div className="mt-5">
            <Form
              version={p.version}
              submit="Save team"
              onSave={(d, version) =>
                save({
                  id: p.id,
                  version,
                  project_manager_id: d.project_manager_id as Id<"users">,
                  designer_id: d.designer_id
                    ? (d.designer_id as Id<"users">)
                    : null,
                  staging_lead_id: d.staging_lead_id
                    ? (d.staging_lead_id as Id<"users">)
                    : null,
                  additional: Object.entries(d)
                    .filter(([k]) => k.startsWith("member:"))
                    .map(([k, v]) => ({
                      user_id: k.slice(7) as Id<"users">,
                      role: v as "designer" | "crew",
                    })),
                })
              }
            >
              <div className="grid gap-4 sm:grid-cols-3">
                <Select
                  label="Project manager"
                  name="project_manager_id"
                  required
                  value={p.team?.project_manager_id}
                  options={options.staff.filter((s) =>
                    s.roles.some((r) =>
                      ["owner", "admin", "sales"].includes(r),
                    ),
                  )}
                />
                <Select
                  label="Designer"
                  name="designer_id"
                  value={p.team?.designer_id}
                  options={options.staff.filter((s) =>
                    s.roles.some((r) =>
                      ["owner", "admin", "designer"].includes(r),
                    ),
                  )}
                />
                <Select
                  label="Staging lead"
                  name="staging_lead_id"
                  value={p.team?.staging_lead_id}
                  options={options.staff.filter((s) =>
                    s.roles.some((r) =>
                      ["owner", "admin", "staging_crew"].includes(r),
                    ),
                  )}
                />
              </div>
              <fieldset className="rounded-xl border p-4">
                <legend className="text-sm">
                  Additional crew and designers
                </legend>
                {options.staff
                  .filter((s) =>
                    s.roles.some((r) =>
                      ["designer", "staging_crew"].includes(r),
                    ),
                  )
                  .map((s) => (
                    <label
                      className="flex min-h-11 items-center gap-3 text-sm"
                      key={s.id}
                    >
                      <input
                        type="checkbox"
                        name={`member:${s.id}`}
                        value={
                          s.roles.includes("designer") ? "designer" : "crew"
                        }
                        defaultChecked={p.team?.additional.some(
                          (t) => t.user_id === s.id,
                        )}
                      />
                      {s.name} ·{" "}
                      {s.roles.includes("designer") ? "designer" : "crew"}
                    </label>
                  ))}
              </fieldset>
              <p className="text-xs text-muted-foreground">
                Reassign open work and scheduled leads before removing a
                participant.
              </p>
            </Form>
          </div>
        </Disclosure>
      )}
    </Panel>
  );
}
function AccessDetails({ p }: { p: Project }) {
  const details = useQuery(
      api.operations.accessDetails,
      p.access === "crew" && !p.can_edit ? "skip" : { id: p.id },
    ),
    save = useMutation(api.operations.saveAccess);
  if (p.access === "crew" && !p.can_edit) return null;
  return (
    <Panel title="Restricted property access">
      <p className="mb-4 text-sm text-muted-foreground">
        Visible only to project management and assigned crew. Keep access codes
        in the dedicated field.
      </p>
      {details === undefined ? (
        <Loading />
      ) : details ? (
        <dl className="grid gap-4 sm:grid-cols-2">
          {Object.entries(details)
            .filter(
              ([k, v]) =>
                ![
                  "project_id",
                  "version",
                  "created_at",
                  "updated_at",
                  "deleted_at",
                ].includes(k) &&
                !k.startsWith("_") &&
                v,
            )
            .map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-muted-foreground">{label(k)}</dt>
                <dd className="mt-1 whitespace-pre-wrap break-words text-sm">
                  {String(v)}
                </dd>
              </div>
            ))}
        </dl>
      ) : (
        <p className="text-sm">Access instructions have not been added.</p>
      )}
      {p.can_edit && p.access === "manage" && details !== undefined && (
        <Disclosure className="mt-5">
          <summary className="cursor-pointer text-primary">
            Edit access instructions
          </summary>
          <div className="mt-5">
            <Form
              version={details?.version ?? 0}
              submit="Save restricted access"
              onSave={(d, version) =>
                save({ id: p.id, version, input: JSON.stringify(d) })
              }
            >
              <div className="grid gap-4 sm:grid-cols-2">
                {[
                  "access_type",
                  "instructions",
                  "parking_notes",
                  "loading_notes",
                  "elevator_notes",
                  "concierge_notes",
                  "key_pickup_notes",
                  "sensitive_access_code",
                ].map((key) => (
                  <Field
                    key={key}
                    name={key}
                    label={label(key)}
                    value={
                      details
                        ? String(details[key as keyof typeof details] ?? "")
                        : ""
                    }
                    type={
                      key === "sensitive_access_code"
                        ? "password"
                        : key === "access_type"
                          ? "text"
                          : "textarea"
                    }
                  />
                ))}
              </div>
            </Form>
          </div>
        </Disclosure>
      )}
    </Panel>
  );
}
function Notes({ p, audit = false }: { p: Project; audit?: boolean }) {
  const [cursor, setCursor] = useState<string | null>(null),
    rows = useQuery(api.operations.timeline, {
      id: p.id,
      kind: audit ? "audit" : "notes",
      paginationOpts: { cursor, numItems: 10 },
    }),
    add = useMutation(api.operations.addNote),
    archive = useMutation(api.operations.archiveNote);
  return (
    <Panel title={audit ? "Audit activity" : "Project notes"}>
      {rows?.page.map((n) => (
        <article className="mb-4 rounded-xl border p-4" key={n.id}>
          <p className="whitespace-pre-wrap text-sm">
            {audit ? label(n.body) : n.body}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {dateTime(n.created_at)}
          </p>
          {!audit && n.can_archive && p.can_edit && (
            <div className="mt-3">
              <Action
                onClick={() => archive({ id: n.id as Id<"project_notes"> })}
              >
                Archive note
              </Action>
            </div>
          )}
        </article>
      ))}
      {rows && !rows.isDone && (
        <Pager
          done={false}
          onNext={() => setCursor(rows.continueCursor)}
          onReset={() => setCursor(null)}
        />
      )}{" "}
      {!audit && p.can_edit && (
        <Disclosure className="mt-4">
          <summary className="cursor-pointer text-primary">Add a note</summary>
          <div className="mt-4">
            <Form
              submit="Add note"
              onSave={(d) =>
                add({
                  id: p.id,
                  body: d.body,
                  note_type: d.note_type as Doc<"project_notes">["note_type"],
                  visibility:
                    d.visibility as Doc<"project_notes">["visibility"],
                })
              }
            >
              <Field label="Note" name="body" type="textarea" required />
              <Field
                label="Note type"
                name="note_type"
                options={[
                  "general",
                  "design",
                  "operations",
                  "property_issue",
                  "realtor_update",
                ]}
              />
              <Field
                label="Visibility"
                name="visibility"
                options={
                  p.access === "manage"
                    ? ["internal", "operations", "design"]
                    : p.access === "design"
                      ? ["design"]
                      : ["operations"]
                }
              />
              <p className="text-xs text-muted-foreground">
                Use restricted property access for codes and access
                instructions.
              </p>
            </Form>
          </div>
        </Disclosure>
      )}
    </Panel>
  );
}
function ArchiveProject({ p }: { p: Project }) {
  const archive = useMutation(api.operations.archive),
    viewer = useQuery(api.profiles.viewer, {});
  if (!viewer?.roles.some((r) => ["owner", "admin"].includes(r))) return null;
  return (
    <div className="mt-6">
      <Action
        onClick={() =>
          archive({ id: p.id, version: p.version, restore: !!p.deleted_at })
        }
      >
        {p.deleted_at ? "Restore project" : "Archive project"}
      </Action>
    </div>
  );
}
