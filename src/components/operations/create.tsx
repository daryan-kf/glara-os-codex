"use client";
import Link from "next/link";
import { useQuery, useMutation } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { PageTitle, EmptyState } from "@/components/primitives";
import { Form, Field, Select, Panel, Loading } from "./shared";
export function Handoff({ id }: { id: Id<"opportunities"> }) {
  const data = useQuery(api.operations.handoff, { id });
  if (data === undefined) return <Loading />;
  if (data === null) return null;
  return (
    <div className="mb-6 rounded-xl border bg-card p-5">
      <p className="mb-3 text-sm text-muted-foreground">
        Won · ready for operational handoff
      </p>
      <Link
        className="font-semibold text-primary"
        href={
          data.existing_id
            ? `/projects/${data.existing_id}`
            : `/projects/new?opportunity=${id}`
        }
      >
        {data.existing_id ? "Open staging project" : "Create staging project"} →
      </Link>
    </div>
  );
}
export function ProjectCreate({ opportunity }: { opportunity: string }) {
  const id = opportunity as Id<"opportunities">,
    handoff = useQuery(api.operations.handoff, { id }),
    options = useQuery(
      api.operations.options,
      handoff?.can_create ? {} : "skip",
    ),
    create = useMutation(api.operations.create),
    router = useRouter();
  if (handoff === undefined) return <Loading />;
  if (handoff === null)
    return (
      <EmptyState
        title="Handoff unavailable"
        description="This won opportunity is not assigned to your sales relationships."
      />
    );
  if (handoff.existing_id)
    return (
      <EmptyState
        title="This opportunity already has a project"
        description="Continue with the existing project to keep one operational history."
      >
        <Link
          className="font-medium text-primary"
          href={`/projects/${handoff.existing_id}`}
        >
          Open project →
        </Link>
      </EmptyState>
    );
  if (!handoff.can_create)
    return (
      <EmptyState
        title="Ready for operations"
        description="An Owner or Admin can create the staging project from this won opportunity."
      />
    );
  if (!options) return <Loading />;
  return (
    <>
      <PageTitle
        title="Create staging project"
        description={`${handoff.address} · ${handoff.city} · ${handoff.realtor}`}
      />
      <div className="max-w-3xl">
        <Panel title="Commercial handoff">
          <p className="mb-6 text-sm text-muted-foreground">
            Property and Realtor are linked from the won opportunity. Schedule
            staging after preparation is complete.
          </p>
          <Form
            submit="Create project"
            onSave={async (d) => {
              const result = await create({
                opportunity_id: id,
                source_quote_id: d.source_quote_id
                  ? (d.source_quote_id as Id<"quotes">)
                  : null,
                project_manager_id: d.project_manager_id as Id<"users">,
                designer_id: d.designer_id
                  ? (d.designer_id as Id<"users">)
                  : null,
                staging_lead_id: d.staging_lead_id
                  ? (d.staging_lead_id as Id<"users">)
                  : null,
                template_id: d.template_id
                  ? (d.template_id as Id<"project_checklist_templates">)
                  : undefined,
                input: JSON.stringify({
                  package_type: d.package_type,
                  planned_end_date: d.planned_end_date,
                  priority: d.priority,
                  internal_notes: d.internal_notes,
                }),
                rooms: d.rooms
                  .split("\n")
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .map((name, i) =>
                    JSON.stringify({
                      room_type: "other",
                      room_name: name,
                      staging_scope: "full",
                      style_direction: "",
                      notes: "",
                      status: "planned",
                      sort_order: i,
                    }),
                  ),
              });
              router.push(`/projects/${result.id}`);
            }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Select
                label="Source accepted quote"
                name="source_quote_id"
                value={handoff.quotes[0]?.id}
                options={handoff.quotes.map((q) => ({
                  id: q.id,
                  name: q.number,
                }))}
              />
              <Select
                label="Checklist template"
                name="template_id"
                options={options.templates.map((t) => ({
                  id: t._id,
                  name: t.name,
                }))}
              />
              <Select
                label="Project manager"
                name="project_manager_id"
                required
                value={handoff.owner_id}
                options={options.staff.filter((p) =>
                  p.roles.some((r) => ["owner", "admin", "sales"].includes(r)),
                )}
              />
              <Select
                label="Designer"
                name="designer_id"
                options={options.staff.filter((p) =>
                  p.roles.some((r) =>
                    ["owner", "admin", "designer"].includes(r),
                  ),
                )}
              />
              <Select
                label="Staging lead"
                name="staging_lead_id"
                options={options.staff.filter((p) =>
                  p.roles.some((r) =>
                    ["owner", "admin", "staging_crew"].includes(r),
                  ),
                )}
              />
              <Field
                label="Package"
                name="package_type"
                options={options.settings.package_types}
              />
              <Field
                label="Package end date"
                name="planned_end_date"
                type="date"
              />
              <Field
                label="Priority"
                name="priority"
                options={["normal", "high", "urgent"]}
              />
            </div>
            <Field
              label="Rooms — one name per line"
              name="rooms"
              type="textarea"
              value={"Living room\nDining room\nPrimary bedroom"}
            />
            <Field
              label="Manager notes"
              name="internal_notes"
              type="textarea"
            />
          </Form>
        </Panel>
      </div>
    </>
  );
}
