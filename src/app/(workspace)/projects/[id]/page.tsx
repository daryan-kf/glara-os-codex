import { ProjectCalendarStatus } from "@/components/communications/calendar";
import { CommunicationHistory } from "@/components/communications/history";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { requireModule } from "@/lib/auth";
import { notFound } from "next/navigation";
import { recordId } from "@/lib/crm/model";
import { ProjectDetail } from "@/components/operations/detail";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireModule("projects");
  const { id } = await params;
  if (!recordId.safeParse(id).success) notFound();
  return (
    <>
      <ProjectDetail id={id} />
      {user.communications_version === 1 &&
        user.roles.some((r) => r === "owner" || r === "admin") && (
          <ProjectCalendarStatus id={id as Id<"projects">} />
        )}
      {user.communications_version === 1 &&
        user.roles.some((r) => r === "owner" || r === "admin") && (
          <CommunicationHistory
            source={{ type: "project", id: id as Id<"projects"> }}
          />
        )}
    </>
  );
}
