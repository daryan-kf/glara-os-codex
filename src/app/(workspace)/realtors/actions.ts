"use server";
import { logCrmFailure } from "@/lib/logger";
import { classifyCrmError } from "@/lib/crm/errors";
import { z } from "zod";
import { revalidatePath } from "next/cache";

import { requireCrmWrite } from "@/lib/crm/data";
import { writeCrm } from "@/lib/convex";
import { recordId } from "@/lib/crm/model";
import {
  realtorInput,
  activityInput,
  completionInput,
  rescheduleInput,
  brokerageInput,
  sourceInput,
  canManageCrm,
  type MutationState,
  type MutationKind,
} from "@/lib/crm/model";

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
  if (id && !recordId.safeParse(id).success)
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
  else if (kind === "activity_reschedule") schema = rescheduleInput;
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
  let data: unknown = null,
    error: unknown = null;
  try {
    data = await writeCrm({ op: kind, id, version, data: parsed.data });
  } catch (failure) {
    error = failure;
  }
  if (error) {
    logCrmFailure(kind, error);
    return { error: classifyCrmError(error).message };
  }
  const checked = z
    .object({ id: recordId, realtor_id: recordId.optional() })
    .safeParse(data);
  if (!checked.success) {
    logCrmFailure(kind, { code: "CONFIGURATION" });
    return { error: classifyCrmError({ code: "CONFIGURATION" }).message };
  }
  const result = checked.data;
  revalidatePath("/realtors", "layout");
  revalidatePath("/realtors");
  revalidatePath("/dashboard");
  if (kind === "source_save" || kind === "brokerage_save") {
    revalidatePath("/realtors/brokerages");
    revalidatePath("/realtors/sources");
    return { success: "Saved successfully." };
  }
  if (kind === "realtor_archive") return { destination: "/realtors" };
  const target = result.realtor_id ?? result.id;
  revalidatePath("/realtors/" + target);
  if (
    kind === "realtor_create" ||
    kind === "realtor_update" ||
    kind === "realtor_restore"
  )
    return { destination: "/realtors/" + target };
  return { success: "Saved to the relationship timeline." };
}
