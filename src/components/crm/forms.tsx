"use client";
import {
  createContext,
  useContext,
  useActionState,
  useTransition,
  useState,
  useEffect,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { mutateCrm } from "@/app/(workspace)/realtors/actions";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogTrigger,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  relationshipStates,
  activityTypes,
  priorities,
  label,
  type Choices,
  type Realtor,
  type Brokerage,
  type MutationKind,
  type MutationState,
  type Option,
} from "@/lib/crm/model";
const Errors = createContext<Record<string, string[]>>({});
const subscribe = () => () => {};
const inputClass =
  "min-h-11 w-full rounded-lg border bg-card px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring";
export function Field({
  name,
  title,
  children,
  ...props
}: React.ComponentProps<"input"> & {
  name: string;
  title: string;
  children?: React.ReactNode;
}) {
  const errors = useContext(Errors)[name];
  const common = {
    id: name,
    name,
    "aria-invalid": Boolean(errors),
    "aria-describedby": errors ? name + "-error" : undefined,
    className: inputClass,
  };
  return (
    <div className="min-w-0 space-y-2">
      <label htmlFor={name} className="block text-sm font-medium">
        {title}
        {props.required ? (
          <span className="ml-1 text-red-700">*</span>
        ) : (
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            Optional
          </span>
        )}
      </label>
      {children ? (
        <select
          {...common}
          defaultValue={String(props.defaultValue ?? "")}
          required={props.required}
        >
          {children}
        </select>
      ) : (
        <input {...common} {...props} />
      )}
      {errors && (
        <p id={name + "-error"} className="text-sm text-red-800">
          {errors.join(" ")}
        </p>
      )}
    </div>
  );
}
export function Notes({
  name = "notes",
  value = "",
  title = "Internal notes",
}: {
  name?: string;
  value?: string | null;
  title?: string;
}) {
  const error = useContext(Errors)[name];
  return (
    <div className="space-y-2">
      <label htmlFor={name} className="block text-sm font-medium">
        {title}{" "}
        <span className="font-normal text-muted-foreground">(optional)</span>
      </label>
      <textarea
        id={name}
        name={name}
        defaultValue={value ?? ""}
        maxLength={10000}
        rows={4}
        className={inputClass}
        aria-invalid={Boolean(error)}
      />
      {error && <p className="text-sm text-red-800">{error.join(" ")}</p>}
    </div>
  );
}
export function MutationForm({
  kind,
  id = "",
  version = 0,
  submit,
  children,
}: {
  kind: MutationKind;
  id?: string;
  version?: number;
  submit: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [state, dispatch, pending] = useActionState(
    async (previous: MutationState, form: FormData) => {
      const result = await mutateCrm(kind, id, version, previous, form);
      if (result.destination) {
        router.replace(result.destination);
        router.refresh();
      }
      return result;
    },
    {} as MutationState,
  );
  const [transition, startTransition] = useTransition();
  const hydrated = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        for (const name of ["due_at", "completed_at", "next_due_at"]) {
          const value = data.get(name);
          if (typeof value === "string" && value)
            data.set(name, new Date(value).toISOString());
        }
        startTransition(() => dispatch(data));
      }}
      className="space-y-6"
    >
      <Errors.Provider value={state.fields ?? {}}>
        <fieldset
          disabled={!hydrated || pending || transition}
          className="min-w-0 space-y-6 disabled:opacity-60"
        >
          {children}
          <div aria-live="polite">
            {state.error && (
              <p
                role="alert"
                className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800"
              >
                {state.error}
              </p>
            )}
            {state.success && (
              <p
                role="status"
                className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900"
              >
                {state.success}
              </p>
            )}
          </div>
          <Button type="submit">
            {pending || transition ? "Saving…" : submit}
          </Button>
        </fieldset>
      </Errors.Provider>
    </form>
  );
}
export function Lookup({
  name,
  title,
  kind,
  value = "",
  selectedName = "",
}: {
  name: string;
  title: string;
  kind: "realtors" | "brokerages";
  value?: string;
  selectedName?: string;
}) {
  const fieldErrors = useContext(Errors)[name];
  const [selected, setSelected] = useState({ id: value, name: selectedName });
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Option[]>([]);
  const [error, setError] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      if (query.length < 2) {
        setRows([]);
        return;
      }
      try {
        const response = await fetch(
          "/api/crm/search?kind=" + kind + "&q=" + encodeURIComponent(query),
          { signal: abort.signal },
        );
        if (!response.ok) throw new Error();
        const result: Option[] = await response.json();
        setRows(result);
        setError(false);
      } catch {
        if (!abort.signal.aborted) setError(true);
      }
    }, 250);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [query, kind]);
  return (
    <div
      className="space-y-2"
      onBlur={(e) => {
        // Close when focus leaves the lookup entirely (click or tab outside).
        if (!e.currentTarget.contains(e.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <label htmlFor={name + "-search"} className="block text-sm font-medium">
        {title}
      </label>
      <input type="hidden" name={name} value={selected.id} />
      <input
        id={name + "-search"}
        aria-invalid={Boolean(fieldErrors)}
        aria-describedby={fieldErrors ? name + "-lookup-error" : undefined}
        maxLength={100}
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        placeholder="Type at least 2 characters to find…"
        autoComplete="off"
        className={inputClass}
      />
      {fieldErrors && (
        <p id={name + "-lookup-error"} className="text-sm text-red-800">
          {fieldErrors.join(" ")}
        </p>
      )}
      {selected.id && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-muted px-3 text-sm">
          <span>{selected.name}</span>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setSelected({ id: "", name: "" })}
          >
            Clear
          </Button>
        </div>
      )}
      {open && query.length >= 2 && (
        <div className="max-h-52 overflow-auto rounded-lg border bg-card">
          {rows.map((row) => (
            <button
              key={row.id}
              type="button"
              onClick={() => {
                setSelected(row);
                setQuery("");
                setRows([]);
              }}
              className="block min-h-11 w-full px-3 py-2 text-left text-sm hover:bg-muted"
            >
              {row.name}
            </button>
          ))}
          {!rows.length && (
            <p className="p-3 text-sm text-muted-foreground">
              {error
                ? "Search is unavailable. Try again."
                : "No matching records."}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
export function NextActionFields({
  required = false,
  title = "",
}: { required?: boolean; title?: string } = {}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field
        name="next_title"
        required={required}
        defaultValue={title}
        title="Next action"
        maxLength={200}
        placeholder="Call to arrange an introduction"
      />
      <Field
        name="next_due_at"
        title="Next action due"
        type="datetime-local"
        required={required}
      />
      <p className="text-xs text-muted-foreground sm:col-span-2">
        Enter times in your device’s timezone. Dates are displayed in Vancouver
        time.
      </p>
    </div>
  );
}
export function RealtorForm({
  record,
  choices,
  currentUser,
}: {
  record?: Realtor;
  choices: Choices;
  currentUser: string;
}) {
  return (
    <MutationForm
      kind={record ? "realtor_update" : "realtor_create"}
      id={record?.id}
      version={record?.version}
      submit={record ? "Save customer" : "Create customer"}
    >
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="first_name"
          title="First name"
          required
          maxLength={100}
          defaultValue={record?.first_name}
        />
        <Field
          name="last_name"
          title="Last name"
          required
          maxLength={100}
          defaultValue={record?.last_name}
        />
        <Field
          name="contact_type"
          title="Customer type"
          required
          defaultValue={record?.contact_type ?? "realtor"}
        >
          <option value="realtor">Realtor</option>
          <option value="builder">Builder</option>
        </Field>
        <Field
          name="email"
          title="Email"
          type="email"
          maxLength={254}
          defaultValue={record?.email ?? ""}
        />
        <Field
          name="phone"
          title="Phone"
          type="tel"
          maxLength={40}
          defaultValue={record?.phone ?? ""}
        />
        <Field
          name="instagram"
          title="Instagram handle"
          maxLength={100}
          defaultValue={record?.instagram ?? ""}
        />
        <Field
          name="website"
          title="Website"
          type="url"
          defaultValue={record?.website ?? ""}
          placeholder="https://"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Matching active email addresses and phone numbers are blocked to avoid
        duplicates. No records are automatically merged.
      </p>
      <Lookup
        name="brokerage_id"
        title="Brokerage (optional)"
        kind="brokerages"
        value={record?.brokerage_id ?? ""}
        selectedName={record?.brokerage_name ?? ""}
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          name="primary_city"
          title="Primary city"
          maxLength={100}
          defaultValue={record?.primary_city ?? ""}
        />
        <Field
          name="primary_area"
          title="Primary area"
          maxLength={100}
          defaultValue={record?.primary_area ?? ""}
        />
        <Field
          name="secondary_areas"
          title="Secondary areas, separated by commas"
          defaultValue={record?.secondary_areas.join(", ") ?? ""}
        />
        <Field
          name="relationship_status"
          title="Relationship status"
          required
          defaultValue={record?.relationship_status ?? "prospect"}
        >
          {relationshipStates.map((s) => (
            <option key={s} value={s}>
              {label(s)}
            </option>
          ))}
        </Field>
        <Field
          name="assigned_to"
          title="Assigned team member"
          required
          defaultValue={record?.assigned_to ?? currentUser}
        >
          {choices.owners.map((o) => (
            <option value={o.id} key={o.id}>
              {o.name}
            </option>
          ))}
        </Field>
        <Field
          name="lead_source_id"
          title="Lead source"
          defaultValue={record?.lead_source_id ?? ""}
        >
          <option value="">Not recorded</option>
          {choices.sources.map((o) => (
            <option value={o.id} key={o.id}>
              {o.name}
            </option>
          ))}
        </Field>
      </div>
      <label className="flex min-h-11 items-center gap-3 text-sm">
        <input
          type="checkbox"
          name="luxury_agent"
          defaultChecked={record?.luxury_agent}
          className="size-5 accent-primary"
        />
        Luxury agent
      </label>
      <section className="space-y-4 rounded-xl border bg-muted/40 p-5">
        <h2 className="font-semibold">Keep the relationship moving</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {record
            ? "Existing open activities stay in place. Add another next action here when needed."
            : "A new prospect needs a next action and due date. Dormant or historical relationships may be recorded without one."}
        </p>
        <NextActionFields />
      </section>
      <details className="rounded-xl border p-5">
        <summary className="cursor-pointer text-sm font-medium">
          Optional relationship context and manual scores
        </summary>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <Field
            name="estimated_listings_per_year"
            title="Estimated listings per year"
            type="number"
            min={0}
            max={100000}
            defaultValue={record?.estimated_listings_per_year ?? ""}
          />
          <Field
            name="average_listing_price"
            title="Average listing price (CAD)"
            type="number"
            min={0}
            step=".01"
            defaultValue={record?.average_listing_price ?? ""}
          />
          <Field
            name="relationship_score"
            title="Manual relationship score (0–100)"
            type="number"
            min={0}
            max={100}
            defaultValue={record?.relationship_score ?? ""}
          />
          <Field
            name="lead_score"
            title="Manual lead score (0–100)"
            type="number"
            min={0}
            max={100}
            defaultValue={record?.lead_score ?? ""}
          />
        </div>
      </details>
      <Notes value={record?.notes} />
    </MutationForm>
  );
}
export function ActivityForm({
  realtorId,
  choices,
  currentUser,
  followup = false,
}: {
  realtorId?: string;
  choices: Choices;
  currentUser: string;
  followup?: boolean;
}) {
  return (
    <MutationForm
      kind="activity_create"
      submit={followup ? "Create follow-up" : "Save activity"}
    >
      {realtorId ? (
        <input name="realtor_id" type="hidden" value={realtorId} />
      ) : (
        <Lookup name="realtor_id" title="Realtor (required)" kind="realtors" />
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="type"
          title="Activity type"
          required
          defaultValue={followup ? "follow_up" : "note"}
        >
          {activityTypes.map((t) => (
            <option key={t} value={t}>
              {label(t)}
            </option>
          ))}
        </Field>
        <Field
          name="status"
          title="Status"
          required
          defaultValue={followup ? "open" : "completed"}
        >
          <option value="open">Open / planned</option>
          <option value="completed">Completed / logged</option>
        </Field>
      </div>
      <Field name="title" title="Title" required maxLength={200} />
      <Notes name="description" title="Activity notes" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="assigned_to"
          title="Assigned to"
          required
          defaultValue={currentUser}
        >
          {choices.owners.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </Field>
        <Field name="priority" title="Priority" required defaultValue="normal">
          {priorities.map((p) => (
            <option key={p} value={p}>
              {label(p)}
            </option>
          ))}
        </Field>
        <Field
          name="due_at"
          title="Due date (required for open activities)"
          type="datetime-local"
        />
        <Field
          name="completed_at"
          title="Completed on (defaults to now)"
          type="datetime-local"
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Enter dates in your device’s timezone. Contact dates are derived from
        completed calls, messages and meetings.
      </p>
    </MutationForm>
  );
}
export function ActivityDialog({
  realtorId,
  choices,
  currentUser,
  followup = false,
}: {
  realtorId: string;
  choices: Choices;
  currentUser: string;
  followup?: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant={followup ? "default" : "outline"}>
          {followup ? "Add follow-up" : "Log activity"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] max-w-2xl overflow-y-auto">
        <DialogTitle className="pr-10 text-xl font-semibold">
          {followup ? "Plan the next action" : "Log a conversation or note"}
        </DialogTitle>
        <DialogDescription className="mb-6 mt-2 text-sm text-muted-foreground">
          Manual activity logging. No message will be sent.
        </DialogDescription>
        <ActivityForm
          realtorId={realtorId}
          choices={choices}
          currentUser={currentUser}
          followup={followup}
        />
      </DialogContent>
    </Dialog>
  );
}
export function CompleteDialog({ id, title }: { id: string; title: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">Complete</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="pr-10 text-xl font-semibold">
          Complete follow-up
        </DialogTitle>
        <DialogDescription className="my-4 text-sm text-muted-foreground">
          {title}. If this is a prospect’s last open action, schedule the next
          one before completing it.
        </DialogDescription>
        <MutationForm kind="activity_complete" id={id} submit="Mark complete">
          <NextActionFields />
        </MutationForm>
      </DialogContent>
    </Dialog>
  );
}
export function ChangeActionDialog({
  id,
  title,
  reschedule = false,
}: {
  id: string;
  title: string;
  reschedule?: boolean;
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          {reschedule ? "Reschedule" : "Cancel action"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90svh] overflow-y-auto">
        <DialogTitle className="pr-10 text-xl font-semibold">
          {reschedule ? "Reschedule follow-up" : "Cancel follow-up"}
        </DialogTitle>
        <DialogDescription className="my-4 text-sm text-muted-foreground">
          {reschedule
            ? "The original action and due date stay in history as cancelled. A replacement keeps its type, owner, priority and notes."
            : "Cancellation does not mark this action completed. A prospect's last action needs a replacement, or a relationship-status change first."}
        </DialogDescription>
        <MutationForm
          kind={reschedule ? "activity_reschedule" : "activity_cancel"}
          id={id}
          submit={reschedule ? "Confirm reschedule" : "Confirm cancellation"}
        >
          <NextActionFields
            required={reschedule}
            title={reschedule ? title : ""}
          />
        </MutationForm>
      </DialogContent>
    </Dialog>
  );
}
export function ArchiveDialog({ record }: { record: Realtor }) {
  const archived = Boolean(record.deleted_at);
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="outline">
          {archived ? "Restore realtor" : "Archive realtor"}
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle className="text-xl font-semibold">
          {archived ? "Restore realtor?" : "Archive realtor?"}
        </DialogTitle>
        <DialogDescription className="my-4 text-sm text-muted-foreground">
          {archived
            ? "Restore this relationship to active views. Duplicate contact details or a missing prospect next action must be resolved first."
            : "The realtor will leave active views. Activities and relationship history are preserved; open follow-ups will be hidden until restoration."}
        </DialogDescription>
        <MutationForm
          kind={archived ? "realtor_restore" : "realtor_archive"}
          id={record.id}
          version={record.version}
          submit={archived ? "Restore realtor" : "Confirm archive"}
        >
          <input type="hidden" name="next_title" value="" />
        </MutationForm>
      </DialogContent>
    </Dialog>
  );
}
export function BrokerageForm({ record }: { record?: Brokerage }) {
  return (
    <MutationForm
      kind="brokerage_save"
      id={record?.id}
      version={record?.version}
      submit={record ? "Save brokerage" : "Create brokerage"}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          name="name"
          title="Brokerage name"
          required
          maxLength={160}
          defaultValue={record?.name}
        />
        <Field
          name="office_name"
          title="Office name"
          maxLength={160}
          defaultValue={record?.office_name ?? ""}
        />
        <Field
          name="website"
          title="Website"
          type="url"
          defaultValue={record?.website ?? ""}
        />
        <Field
          name="phone"
          title="Phone"
          type="tel"
          defaultValue={record?.phone ?? ""}
        />
        <Field
          name="address"
          title="Address"
          defaultValue={record?.address ?? ""}
        />
        <Field name="city" title="City" defaultValue={record?.city ?? ""} />
        <Field
          name="province"
          title="Province"
          required
          defaultValue={record?.province ?? "BC"}
        />
        <Field
          name="postal_code"
          title="Postal code"
          defaultValue={record?.postal_code ?? ""}
        />
      </div>
      <Notes value={record?.notes} />
    </MutationForm>
  );
}
export function SourceForm({
  id = "",
  name = "",
}: {
  id?: string;
  name?: string;
}) {
  return (
    <MutationForm
      kind="source_save"
      id={id}
      submit={id ? "Rename source" : "Add source"}
    >
      <Field
        name="name"
        title="Lead source name"
        required
        defaultValue={name}
        maxLength={100}
      />
    </MutationForm>
  );
}
export function CrmQuickCreate({ enabled }: { enabled: boolean }) {
  return (
    <div className="mt-5 space-y-2">
      {enabled ? (
        [
          ["New Realtor", "/realtors/new"],
          ["New Brokerage", "/realtors/brokerages/new"],
          ["New Follow-Up / Task", "/realtors/followups/new"],
        ].map(([name, href]) => (
          <DialogClose asChild key={href}>
            <Link
              href={href}
              className="block rounded-lg border p-3 text-sm hover:bg-muted"
            >
              {name}
            </Link>
          </DialogClose>
        ))
      ) : (
        <p className="text-sm text-muted-foreground">
          CRM creation is not available for your role.
        </p>
      )}
    </div>
  );
}
