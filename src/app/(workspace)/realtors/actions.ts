"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireCrmWrite } from "@/lib/crm/data";
import { createClient } from "@/lib/supabase/server";
import {
  realtorInput,
  activityInput,
  completionInput,
  brokerageInput,
  sourceInput,
  canManageCrm,
  type MutationState,
  type MutationKind,
} from "@/lib/crm/model";
import type { Json } from "@/lib/supabase/database.types";
function friendlyError(message: string, code?: string) {
  if (code === "23505")
    return "An active record already uses this email, phone, or name. Review the existing record; records are never merged automatically.";
  if (code === "23514" || code === "23502" || code === "22P02")
    return "Some fields are invalid. Review the form and try again.";
  if (code === "42501") return "Your account cannot perform this action.";
  const safe = [
    "A prospect needs a next action.",
    "This record changed.",
    "This activity is no longer open.",
    "Select an active",
    "Realtor is archived",
  ];
  return safe.some((prefix) => message.startsWith(prefix))
    ? message
    : "Unable to save. Please reload and try again.";
}
export async function mutateCrm(
  kind: MutationKind,
  id: string,
  version: number,
  _state: MutationState,
  form: FormData,
): Promise<MutationState> {
  const user = await requireCrmWrite();
  if (
    (kind === "source_save" || kind === "realtor_restore") &&
    !canManageCrm(user.roles)
  )
    return { error: "Only owner or admin can perform this action." };
  if (id && !z.uuid().safeParse(id).success)
    return { error: "Invalid record." };
  const raw: Record<string, unknown> = {};
  for (const [key, value] of form.entries())
    if (typeof value === "string") raw[key] = value;
  let schema: z.ZodType;
  if (kind === "realtor_create" || kind === "realtor_update") {
    raw.luxury_agent = raw.luxury_agent === "on";
    raw.secondary_areas = String(raw.secondary_areas ?? "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);
    schema = realtorInput;
  } else if (kind === "activity_create") schema = activityInput;
  else if (kind === "brokerage_save") schema = brokerageInput;
  else if (kind === "source_save") schema = sourceInput;
  else schema = completionInput;
  const parsed = schema.safeParse(raw);
  if (!parsed.success)
    return {
      error: "Please review the highlighted fields.",
      fields: z.flattenError(parsed.error).fieldErrors as Record<
        string,
        string[]
      >,
    };
  const db = await createClient();
  const { data, error } = await db.rpc("crm_mutate", {
    p_input: { op: kind, id, version, data: parsed.data as Json },
  });
  if (error) return { error: friendlyError(error.message, error.code) };
  const result = z
    .object({ id: z.uuid(), realtor_id: z.uuid().optional() })
    .parse(data);
  revalidatePath("/realtors", "layout");
  revalidatePath("/realtors");
  revalidatePath("/dashboard");
  if (kind === "source_save" || kind === "brokerage_save") {
    revalidatePath("/realtors/brokerages");
    revalidatePath("/realtors/sources");
    return { success: "Saved successfully." };
  }
  if (kind === "realtor_archive") redirect("/realtors");
  const target = result.realtor_id ?? result.id;
  revalidatePath("/realtors/" + target);
  if (
    kind === "realtor_create" ||
    kind === "realtor_update" ||
    kind === "realtor_restore"
  )
    redirect("/realtors/" + target);
  return { success: "Saved to the relationship timeline." };
}
