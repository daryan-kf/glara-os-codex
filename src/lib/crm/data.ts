import { redirect } from "next/navigation";
import "server-only";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireModule } from "@/lib/auth";
import type { Json } from "@/lib/supabase/database.types";
import {
  realtorRow,
  activityRow,
  brokerageRow,
  choicesSchema,
  optionRow,
  canWriteCrm,
  type CrmFilters,
} from "./model";
async function query<T>(input: Json, schema: z.ZodType<T>): Promise<T> {
  await requireModule("realtors");
  const db = await createClient();
  const { data, error } = await db.rpc("crm_query", { p_input: input });
  if (error)
    throw new Error(
      "CRM data could not load. Check that the M1 migration is applied.",
    );
  return schema.parse(data);
}
export function listRealtors(filters: CrmFilters) {
  return query(
    { op: "list", ...filters },
    z.object({ rows: z.array(realtorRow), total: z.number() }),
  );
}
export function getRealtor(id: string) {
  return query({ op: "detail", id: z.uuid().parse(id) }, realtorRow.nullable());
}
export function getChoices() {
  return query({ op: "choices" }, choicesSchema);
}
export function getActivities(id: string, page = 1, status = "") {
  return query(
    { op: "activities", id, page, status },
    z.object({ rows: z.array(activityRow) }),
  );
}
export function getFollowups(page = 1, assigned_to = "") {
  return query(
    { op: "followups", page, assigned_to },
    z.object({ rows: z.array(activityRow) }),
  );
}
export function getBrokerages(q = "", page = 1) {
  return query(
    { op: "brokerages", q, page },
    z.object({ rows: z.array(brokerageRow) }),
  );
}
export function getBrokerage(id: string) {
  return query(
    { op: "brokerage", id: z.uuid().parse(id) },
    brokerageRow.nullable(),
  );
}
export function getBrokerageOptions(q = "") {
  return query({ op: "brokerage_options", q }, z.array(optionRow));
}
export async function searchRealtors(q: string) {
  const results = await query(
    { op: "search", q },
    z.object({ rows: z.array(realtorRow), total: z.number() }),
  );
  return results.rows.map((r) => ({
    id: r.id,
    name: r.first_name + " " + r.last_name,
    brokerage: r.brokerage_name,
  }));
}
export async function requireCrmWrite() {
  const user = await requireModule("realtors");
  if (!canWriteCrm(user.roles)) redirect("/unauthorized");
  return user;
}
