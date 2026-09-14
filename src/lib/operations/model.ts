import { z } from "zod";
export const statuses = [
  "planning",
  "designing",
  "ready_to_schedule",
  "scheduled",
  "staging",
  "staged",
  "listing_live",
  "pending_sale",
  "sold",
  "destaging_scheduled",
  "destaging",
  "completed",
  "cancelled",
] as const;
export type ProjectStatus = (typeof statuses)[number];
export const roomTypes = [
  "living_room",
  "dining_room",
  "kitchen",
  "primary_bedroom",
  "bedroom",
  "office",
  "family_room",
  "entry",
  "patio",
  "balcony",
  "basement",
  "bathroom",
  "other",
] as const;
export const roomStatuses = [
  "planned",
  "design_ready",
  "ready",
  "staged",
  "completed",
] as const;
export const scopes = [
  "full",
  "partial",
  "accessories_only",
  "existing_furniture_styling",
  "no_staging",
  "custom",
] as const;
export const categories = [
  "pre_staging",
  "staging",
  "post_staging",
  "destaging",
] as const;
export const checkStatuses = [
  "pending",
  "in_progress",
  "completed",
  "skipped",
] as const;
export const eventTypes = [
  "staging",
  "destaging",
  "photography",
  "walkthrough",
  "delivery",
  "pickup",
  "other",
] as const;
export const eventStatuses = ["scheduled", "completed", "cancelled"] as const;
export const priorities = ["normal", "high", "urgent"] as const;
export const teamRoles = ["designer", "crew"] as const;
export const visibility = ["internal", "operations", "design"] as const;
export const noteTypes = [
  "general",
  "design",
  "operations",
  "property_issue",
  "access",
  "realtor_update",
] as const;
export const mediaCategories = [
  "before",
  "measurement",
  "staging_progress",
  "final",
  "damage",
  "access_reference",
  "other",
] as const;
export const graph: Record<ProjectStatus, readonly ProjectStatus[]> = {
  planning: ["designing", "cancelled"],
  designing: ["ready_to_schedule", "cancelled"],
  ready_to_schedule: ["designing", "scheduled", "cancelled"],
  scheduled: ["staging", "cancelled"],
  staging: ["staged", "cancelled"],
  staged: ["listing_live", "sold", "cancelled"],
  listing_live: ["pending_sale", "sold", "cancelled"],
  pending_sale: ["listing_live", "sold", "cancelled"],
  sold: ["destaging_scheduled", "cancelled"],
  destaging_scheduled: ["destaging", "cancelled"],
  destaging: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
};
export const closed = (s: ProjectStatus) =>
  s === "completed" || s === "cancelled";
export const marketingStatuses: readonly ProjectStatus[] = [
  "staged",
  "listing_live",
  "pending_sale",
  "sold",
  "completed",
];
export const day = (time: string | number = Date.now()) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(time));
export const addDays = (date: string, count: number) =>
  new Date(Date.parse(date + "T12:00:00Z") + count * 86400000)
    .toISOString()
    .slice(0, 10);
export const dateInput = z
  .string()
  .refine(
    (s) =>
      /^\d{4}-\d{2}-\d{2}$/.test(s) &&
      !Number.isNaN(Date.parse(s)) &&
      new Date(s).toISOString().slice(0, 10) === s,
  );
export const optionalDate = z.union([dateInput, z.literal("")]).default("");
export const instant = z
  .string()
  .datetime({ offset: true })
  .transform((s) => new Date(s).toISOString());
const text = (n = 2000) => z.string().trim().max(n).default("");
export const roomInput = z
  .object({
    room_type: z.enum(roomTypes),
    room_name: z.string().trim().min(1).max(100),
    staging_scope: z.enum(scopes),
    style_direction: text(),
    notes: text(),
    status: z.enum(roomStatuses),
    sort_order: z.coerce.number().int().min(0).max(1000),
  })
  .strict();
export const projectInput = z
  .object({
    package_type: z.string().trim().min(1).max(60),
    planned_end_date: optionalDate,
    priority: z.enum(priorities),
    internal_notes: text(),
  })
  .strict();
export const accessInput = z
  .object({
    access_type: text(80),
    instructions: text(),
    parking_notes: text(),
    loading_notes: text(),
    elevator_notes: text(),
    concierge_notes: text(),
    key_pickup_notes: text(),
    sensitive_access_code: text(200),
  })
  .strict();
export const templateItemInput = z
  .object({
    category: z.enum(categories),
    title: z.string().trim().min(1).max(160),
    description: text(),
    required: z.boolean(),
    gate_key: text(80).refine((s) => !s || /^[a-z_]+$/.test(s)),
    default_assignee_role: z.enum([
      "project_manager",
      "designer",
      "staging_lead",
    ]),
    relative_due_rule: z.enum([
      "none",
      "staging_previous_day",
      "staging_day",
      "destaging_day",
    ]),
  })
  .strict();
export type TemplateItem = z.infer<typeof templateItemInput>;
export const defaultItems: TemplateItem[] = [
  [
    "pre_staging",
    "Property consultation complete",
    "consultation_complete",
    false,
  ],
  ["pre_staging", "Measurements complete", "measurements_complete", true],
  ["pre_staging", "Rooms confirmed", "rooms_confirmed", true],
  ["pre_staging", "Design plan complete", "design_complete", true],
  ["pre_staging", "Access instructions received", "access_confirmed", true],
  ["pre_staging", "Parking and loading confirmed", "parking_confirmed", true],
  ["pre_staging", "Elevator booked where applicable", "elevator_booked", false],
  ["pre_staging", "Property ready for staging", "property_ready", true],
  [
    "pre_staging",
    "Client belongings cleared where required",
    "belongings_cleared",
    false,
  ],
  ["staging", "Team assigned", "team_assigned", false],
  ["staging", "Arrival confirmed", "arrival_confirmed", false],
  ["staging", "Rooms staged", "rooms_staged", true],
  ["staging", "Styling complete", "styling_complete", true],
  [
    "staging",
    "Final walkthrough complete",
    "staging_walkthrough_complete",
    true,
  ],
  ["staging", "Final photos recorded", "final_photos", false],
  ["staging", "Property left clean", "property_clean", true],
  ["staging", "Keys and access returned", "keys_returned", false],
  ["post_staging", "Listing live confirmed", "listing_live_confirmed", false],
  ["post_staging", "Realtor notified", "realtor_notified", false],
  ["post_staging", "Package expiry tracked", "expiry_tracked", false],
  ["post_staging", "Sale status monitored", "sale_monitored", false],
  ["destaging", "Destaging scheduled", "destaging_scheduled", false],
  ["destaging", "Realtor or client notified", "destaging_notified", false],
  ["destaging", "Access confirmed", "destaging_access_confirmed", true],
  ["destaging", "Property cleared", "property_cleared", true],
  ["destaging", "Final walkthrough", "project_final_walkthrough", true],
  ["destaging", "Project completion recorded", "completion_recorded", false],
].map(([category, title, gate_key, required]) => ({
  category: category as TemplateItem["category"],
  title: title as string,
  gate_key: gate_key as string,
  required: required as boolean,
  description: "",
  default_assignee_role:
    category === "pre_staging"
      ? "designer"
      : category === "staging" || category === "destaging"
        ? "staging_lead"
        : "project_manager",
  relative_due_rule:
    category === "pre_staging"
      ? "staging_previous_day"
      : category === "staging"
        ? "staging_day"
        : category === "destaging"
          ? "destaging_day"
          : "none",
}));
export const defaultSettings = {
  max_stagings_per_day: 4,
  max_destagings_per_day: 3,
  package_alert_days: [30, 14, 7],
  package_types: ["standard", "premium", "luxury", "custom"],
};
export function attention(
  p: { status: ProjectStatus; planned_end_date: string },
  events: { event_type: string; start_at: string; status: string }[],
  checks: {
    required: boolean;
    status: string;
    category: string;
    gate_key: string;
    due_at: string | null;
  }[],
  tasks: { status: string; due_at: string | null }[],
  alertDays: number[],
  today = day(),
  instantNow = new Date().toISOString(),
) {
  const reasons: string[] = [],
    levels: number[] = [];
  const flag = (level: number, reason: string) => {
    levels.push(level);
    reasons.push(reason);
  };
  const unfinished = checks.filter(
    (c) => c.required && c.status !== "completed",
  );
  const overdue =
    unfinished.filter((c) => c.due_at && c.due_at < instantNow).length +
    tasks.filter(
      (t) => t.status === "open" && t.due_at && t.due_at < instantNow,
    ).length;
  if (!closed(p.status)) {
    if (overdue)
      flag(2, `${overdue} overdue required checklist items or tasks`);
    const staging = events.find(
      (e) => e.event_type === "staging" && e.status === "scheduled",
    );
    if (
      staging &&
      unfinished.some((c) => c.category === "pre_staging") &&
      day(staging.start_at) <= addDays(today, 3)
    )
      flag(
        day(staging.start_at) <= addDays(today, 1) ? 2 : 1,
        "Upcoming staging — preparation incomplete",
      );
    const destaging = events.find(
      (e) => e.event_type === "destaging" && e.status === "scheduled",
    );
    if (
      destaging &&
      day(destaging.start_at) <= today &&
      checks.some(
        (c) =>
          c.gate_key === "destaging_access_confirmed" &&
          c.status !== "completed",
      )
    )
      flag(2, "Destaging access not confirmed");
    if (p.status === "sold" && !destaging)
      flag(1, "Destaging needs to be scheduled");
    if (p.planned_end_date) {
      const days = Math.round(
        (Date.parse(p.planned_end_date) - Date.parse(today)) / 86400000,
      );
      if (days < 0) flag(2, "Package expired");
      else {
        const threshold = [...alertDays]
          .sort((a, b) => a - b)
          .find((n) => days <= n);
        if (threshold !== undefined) flag(1, `Package expires in ${days} days`);
      }
    }
  }
  return {
    attention_level: levels.includes(2)
      ? "red"
      : levels.length
        ? "yellow"
        : "green",
    attention_reasons: reasons,
    required_open_count: unfinished.length,
    overdue_count: overdue,
  };
}
