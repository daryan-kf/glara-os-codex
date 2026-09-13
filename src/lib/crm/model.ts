import { z } from "zod";
import type { Role } from "@/lib/permissions";
export const relationshipStates = [
  "prospect",
  "new_partner",
  "active_partner",
  "vip",
  "at_risk",
  "dormant",
] as const;
export const activityTypes = [
  "call",
  "email",
  "instagram_dm",
  "sms",
  "meeting",
  "consultation",
  "follow_up",
  "task",
  "note",
] as const;
export const priorities = ["low", "normal", "high"] as const;
export function canWriteCrm(roles: readonly Role[]) {
  return roles.some((role) => ["owner", "sales", "admin"].includes(role));
}
export function canManageCrm(roles: readonly Role[]) {
  return roles.some((role) => ["owner", "admin"].includes(role));
}
export const label = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (char) => char.toUpperCase());
const optionalText = (max: number) => z.string().trim().max(max).default("");
const optionalId = z.union([z.uuid(), z.literal("")]).default("");
const optionalNumber = (max: number, integer = false) =>
  z
    .string()
    .default("")
    .refine(
      (value) =>
        value === "" ||
        (/^\d+(\.\d{1,2})?$/.test(value) &&
          Number(value) <= max &&
          (!integer || Number.isInteger(Number(value)))),
      "Enter a valid non-negative number.",
    );
const timestamp = z
  .union([z.iso.datetime({ offset: true }), z.literal("")])
  .default("");
const nextFields = { next_title: optionalText(200), next_due_at: timestamp };
export const realtorInput = z
  .object({
    first_name: z.string().trim().min(1, "First name is required.").max(100),
    last_name: z.string().trim().min(1, "Last name is required.").max(100),
    email: z.union([z.email().max(254), z.literal("")]).default(""),
    phone: optionalText(40).refine(
      (value) =>
        !value ||
        (value.replace(/\D/g, "").length >= 7 &&
          value.replace(/\D/g, "").length <= 15),
      "Use 7–15 digits.",
    ),
    instagram: optionalText(100),
    website: z
      .union([
        z
          .url()
          .max(500)
          .refine((v) => /^https?:\/\//.test(v), "Use an http or https URL."),
        z.literal(""),
      ])
      .default(""),
    brokerage_id: optionalId,
    primary_city: optionalText(100),
    primary_area: optionalText(100),
    secondary_areas: z
      .array(z.string().trim().min(1).max(100))
      .max(20)
      .default([]),
    luxury_agent: z.boolean().default(false),
    relationship_status: z.enum(relationshipStates),
    lead_source_id: optionalId,
    assigned_to: z.uuid("Select a team member."),
    notes: optionalText(10000),
    estimated_listings_per_year: optionalNumber(100000, true),
    average_listing_price: optionalNumber(99999999999999.99),
    relationship_score: optionalNumber(100, true),
    lead_score: optionalNumber(100, true),
    ...nextFields,
  })
  .refine((d) => Boolean(d.next_title) === Boolean(d.next_due_at), {
    message: "A next action needs both a title and date.",
    path: ["next_due_at"],
  });
export const activityInput = z
  .object({
    realtor_id: z.uuid(),
    type: z.enum(activityTypes),
    title: z.string().trim().min(1).max(200),
    description: optionalText(10000),
    due_at: timestamp,
    completed_at: timestamp,
    status: z.enum(["open", "completed"]),
    priority: z.enum(priorities),
    assigned_to: z.uuid(),
  })
  .refine((d) => d.status !== "open" || Boolean(d.due_at), {
    message: "Open activities need a due date.",
    path: ["due_at"],
  })
  .refine(
    (d) =>
      d.status !== "completed" ||
      !d.completed_at ||
      new Date(d.completed_at).getTime() <= Date.now() + 60000,
    {
      message: "Contact completion cannot be in the future.",
      path: ["completed_at"],
    },
  );
export const completionInput = z
  .object(nextFields)
  .refine((d) => Boolean(d.next_title) === Boolean(d.next_due_at), {
    message: "A next action needs both a title and date.",
    path: ["next_due_at"],
  });
export const brokerageInput = z.object({
  name: z.string().trim().min(1).max(160),
  office_name: optionalText(160),
  website: realtorInput.shape.website,
  phone: optionalText(40),
  address: optionalText(300),
  city: optionalText(100),
  province: z.string().trim().min(1).max(80),
  postal_code: optionalText(20),
  notes: optionalText(10000),
});
export const sourceInput = z.object({
  name: z.string().trim().min(1).max(100),
});
export const queryInput = z.object({
  q: optionalText(100),
  status: z.union([z.enum(relationshipStates), z.literal("")]).default(""),
  brokerage_id: optionalId,
  assigned_to: optionalId,
  lead_source_id: optionalId,
  area: optionalText(100),
  sort: z.enum(["name", "newest", "followup"]).default("name"),
  page: z.coerce.number().int().min(1).max(800).default(1),
  archived: z.enum(["true", "false"]).default("false"),
  followup: z.enum(["", "missing", "today", "overdue"]).default(""),
});
export type CrmFilters = z.infer<typeof queryInput>;
export type RealtorInput = z.infer<typeof realtorInput>;
const nullable = z.string().nullable();
export const realtorRow = z.object({
  id: z.uuid(),
  first_name: z.string(),
  last_name: z.string(),
  email: nullable,
  phone: nullable,
  instagram: nullable,
  website: nullable,
  brokerage_id: nullable,
  brokerage_name: nullable,
  primary_city: nullable,
  primary_area: nullable,
  secondary_areas: z.array(z.string()),
  luxury_agent: z.boolean(),
  relationship_status: z.enum(relationshipStates),
  lead_source_id: nullable,
  lead_source_name: nullable,
  assigned_to: z.uuid(),
  owner_name: nullable,
  version: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: nullable,
  first_contact_date: nullable,
  last_contact_date: nullable,
  next_followup_date: nullable,
  next_action: nullable,
  notes: nullable.optional(),
  estimated_listings_per_year: z.number().nullable().optional(),
  average_listing_price: z
    .union([z.string(), z.number()])
    .nullable()
    .optional(),
  relationship_score: z.number().nullable().optional(),
  lead_score: z.number().nullable().optional(),
});
export type Realtor = z.infer<typeof realtorRow>;
export const activityRow = z.object({
  id: z.uuid(),
  realtor_id: z.uuid(),
  type: z.enum(activityTypes),
  title: z.string(),
  description: nullable,
  due_at: nullable,
  completed_at: nullable,
  status: z.enum(["open", "completed", "cancelled"]),
  priority: z.enum(priorities),
  assigned_to: z.uuid(),
  created_by: z.uuid(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: nullable,
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});
export type Activity = z.infer<typeof activityRow>;
export const brokerageRow = z.object({
  id: z.uuid(),
  name: z.string(),
  office_name: nullable,
  website: nullable,
  phone: nullable,
  address: nullable,
  city: nullable,
  province: z.string(),
  postal_code: nullable,
  notes: nullable,
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: nullable,
});
export type Brokerage = z.infer<typeof brokerageRow>;
export const optionRow = z.object({ id: z.uuid(), name: z.string() });
export type Option = z.infer<typeof optionRow>;
export const choicesSchema = z.object({
  owners: z.array(optionRow),
  sources: z.array(optionRow),
});
export type Choices = z.infer<typeof choicesSchema>;
export type MutationState = {
  error?: string;
  fields?: Record<string, string[]>;
  success?: string;
};
export type MutationKind =
  | "realtor_create"
  | "realtor_update"
  | "realtor_archive"
  | "realtor_restore"
  | "activity_create"
  | "activity_complete"
  | "activity_cancel"
  | "brokerage_save"
  | "source_save";
export function formatDate(value?: string | null, time = true) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Vancouver",
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(time ? ({ hour: "numeric", minute: "2-digit" } as const) : {}),
  }).format(new Date(value));
}
export function followupState(value: string | null, now = new Date()) {
  if (!value) return "No next action";
  const due = new Date(value);
  const day = (date: Date) =>
    date.toLocaleDateString("en-CA", { timeZone: "America/Vancouver" });
  if (day(due) === day(now)) return "Due today";
  return due < now ? "Overdue" : "Upcoming";
}
