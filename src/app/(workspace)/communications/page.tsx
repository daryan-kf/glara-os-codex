import { EmptyState } from "@/components/primitives";
import { requireModule } from "@/lib/auth";
import { CommunicationsCenter } from "@/components/communications/center";
import type { Id } from "../../../../convex/_generated/dataModel";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ activity?: string; message?: string; ai?: string }>;
}) {
  const user = await requireModule("communications");
  if (user.communications_version !== 1)
    return (
      <EmptyState
        title="Communications deployment pending"
        description="The M9 development backend has not been deployed yet."
      />
    );
  const p = await searchParams;
  return (
    <CommunicationsCenter
      messageId={p.message as Id<"communications"> | undefined}
      activityId={p.activity as Id<"activities"> | undefined}
      aiId={p.ai as Id<"ai_requests"> | undefined}
    />
  );
}
