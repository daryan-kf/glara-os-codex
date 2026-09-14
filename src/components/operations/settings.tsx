"use client";
import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { PageTitle } from "@/components/primitives";
import { Button } from "@/components/ui/button";
import { categories, type TemplateItem } from "@/lib/operations/model";
import { Field, Form, Loading, Panel, inputClass, label } from "./shared";
export function OperationsSettings() {
  const data = useQuery(api.operations.options, {}),
    template = useQuery(api.operations.template, {}),
    save = useMutation(api.operations.saveSettings);
  if (!data || !template) return <Loading />;
  return (
    <>
      <PageTitle
        title="Operations settings"
        description="Capacity and checklist defaults for future planning."
      />
      <div className="space-y-6">
        <Panel title="Daily capacity and packages">
          <Form
            version={data.settings.version}
            submit="Save operations settings"
            onSave={(d, version) =>
              save({
                version,
                input: JSON.stringify({
                  max_stagings_per_day: Number(d.stagings),
                  max_destagings_per_day: Number(d.destagings),
                  package_alert_days: d.alerts.split(",").map(Number),
                  package_types: d.packages
                    .split(",")
                    .map((x) => x.trim())
                    .filter(Boolean),
                }),
              })
            }
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Maximum stagings per day"
                name="stagings"
                type="number"
                value={data.settings.max_stagings_per_day}
              />
              <Field
                label="Maximum destagings per day"
                name="destagings"
                type="number"
                value={data.settings.max_destagings_per_day}
              />
              <Field
                label="Package alert days — comma separated"
                name="alerts"
                value={data.settings.package_alert_days.join(", ")}
              />
              <Field
                label="Package types — comma separated"
                name="packages"
                value={data.settings.package_types.join(", ")}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Lowering capacity does not cancel existing bookings. It blocks
              additional bookings until that day is below capacity.
            </p>
          </Form>
        </Panel>
        <TemplateEditor data={template} />
      </div>
    </>
  );
}
function TemplateEditor({
  data,
}: {
  data: NonNullable<
    ReturnType<typeof useQuery<typeof api.operations.template>>
  >;
}) {
  const [items, setItems] = useState<TemplateItem[]>(
      data.items.map((i) => ({
        category: i.category,
        title: i.title,
        description: i.description,
        required: i.required,
        gate_key: i.gate_key,
        default_assignee_role: i.default_assignee_role,
        relative_due_rule: i.relative_due_rule,
      })),
    ),
    save = useMutation(api.operations.saveTemplate);
  const update = (index: number, patch: Partial<TemplateItem>) =>
    setItems((old) =>
      old.map((v, i) => (i === index ? { ...v, ...patch } : v)),
    );
  return (
    <Panel title="Default checklist template">
      <p className="mb-5 text-sm text-muted-foreground">
        Edits affect newly created projects only. Existing checklists retain
        their own wording, requirements and history.
      </p>
      <Form
        version={data.version}
        submit="Save template for future projects"
        onSave={(d, version) =>
          save({
            id: data.id ?? undefined,
            version,
            name: d.name,
            description: d.description,
            items: JSON.stringify(items),
          })
        }
      >
        <Field name="name" label="Template name" value={data.name} required />
        <Field
          name="description"
          label="Description"
          value={data.description}
        />
        <div className="space-y-3">
          {items.map((item, index) => (
            <details key={index} className="rounded-xl border p-4">
              <summary className="cursor-pointer text-sm font-medium">
                {index + 1}. {item.title} {item.required ? "· Required" : ""}
              </summary>
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="grid gap-2 text-sm">
                  Title
                  <input
                    className={inputClass}
                    value={item.title}
                    onChange={(e) => update(index, { title: e.target.value })}
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Category
                  <select
                    className={inputClass}
                    value={item.category}
                    onChange={(e) =>
                      update(index, {
                        category: e.target.value as TemplateItem["category"],
                      })
                    }
                  >
                    {categories.map((c) => (
                      <option key={c} value={c}>
                        {label(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grid gap-2 text-sm">
                  Stable gate key
                  <input
                    className={inputClass}
                    value={item.gate_key}
                    onChange={(e) =>
                      update(index, { gate_key: e.target.value })
                    }
                  />
                </label>
                <label className="grid gap-2 text-sm">
                  Default assignee role
                  <select
                    className={inputClass}
                    value={item.default_assignee_role}
                    onChange={(e) =>
                      update(index, {
                        default_assignee_role: e.target
                          .value as TemplateItem["default_assignee_role"],
                      })
                    }
                  >
                    {["project_manager", "designer", "staging_lead"].map(
                      (c) => (
                        <option key={c} value={c}>
                          {label(c)}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label className="grid gap-2 text-sm">
                  Due rule
                  <select
                    className={inputClass}
                    value={item.relative_due_rule}
                    onChange={(e) =>
                      update(index, {
                        relative_due_rule: e.target
                          .value as TemplateItem["relative_due_rule"],
                      })
                    }
                  >
                    {[
                      "none",
                      "staging_previous_day",
                      "staging_day",
                      "destaging_day",
                    ].map((c) => (
                      <option key={c} value={c}>
                        {label(c)}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex min-h-11 items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    checked={item.required}
                    onChange={(e) =>
                      update(index, { required: e.target.checked })
                    }
                  />
                  Required
                </label>
                <label className="grid gap-2 text-sm">
                  Description
                  <textarea
                    className={inputClass}
                    value={item.description}
                    onChange={(e) =>
                      update(index, { description: e.target.value })
                    }
                  />
                </label>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setItems((old) => old.filter((_, i) => i !== index))
                  }
                >
                  Remove template item
                </Button>
              </div>
            </details>
          ))}
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={items.length >= 80}
          onClick={() =>
            setItems((old) => [
              ...old,
              {
                category: "pre_staging",
                title: "New checklist item",
                description: "",
                required: false,
                gate_key: "",
                default_assignee_role: "project_manager",
                relative_due_rule: "none",
              },
            ])
          }
        >
          Add template item
        </Button>
      </Form>
    </Panel>
  );
}
