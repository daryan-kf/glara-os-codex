import { logCrmFailure } from "@/lib/logger";
import { classifyCrmError } from "./errors";
import { redirect } from "next/navigation";
import "server-only";
import { z } from "zod";
import { readCrm } from "@/lib/convex";
import { recordId } from "./model";
import { requireModule } from "@/lib/auth";

import {
  realtorRow,
  activityRow,
  brokerageRow,
  choicesSchema,
  optionRow,
  canWriteCrm,
  type CrmFilters,
} from "./model";
async function query<T>(input: unknown, schema: z.ZodType<T>): Promise<T> {
  await requireModule("realtors");
  let data: unknown = null,
    error: unknown = null;
  try {
    data = await readCrm(input);
  } catch (failure) {
    error = failure;
  }
  const parsed = error ? null : schema.safeParse(data);
  const failure = error ?? (parsed?.success ? null : { code: "CONFIGURATION" });
  if (failure) {
    const operation =
      input && typeof input === "object" && !Array.isArray(input)
        ? "op" in input
          ? input.op
          : "unknown"
        : "unknown";
    logCrmFailure(operation, failure);
    redirect(
      "/realtors/unavailable?reason=" + classifyCrmError(failure).category,
    );
  }
  if (!parsed?.success) throw new Error("CRM response unavailable.");
  return parsed.data;
}
export function listRealtors(filters: CrmFilters) {
  return query(
    { op: "list", ...filters },
    z.object({ rows: z.array(realtorRow), total: z.number() }),
  );
}
export function getRealtor(id: string) {
  return query({ op: "detail", id: recordId.parse(id) }, realtorRow.nullable());
}
export async function getChoices() {
  const user = await requireModule("realtors");
  return query(
    { op: canWriteCrm(user.roles) ? "choices" : "sources" },
    choicesSchema,
  );
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
    { op: "brokerage", id: recordId.parse(id) },
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
