import { EmptyState } from "@/components/primitives";
import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { CampaignCenter } from "@/components/campaigns/center";
import { campaignRoles, managerRoles } from "@/lib/campaigns/model";
export const metadata = { title: "Campaigns & giveaways" };
export default async function Page() {
  const user = await requireUser();
  if (!user.roles.some((r) => campaignRoles.some((x) => x === r)))
    redirect("/unauthorized");
  if (user.campaigns_version !== 1)
    return (
      <EmptyState
        title="Campaign deployment pending"
        description="The campaign backend must be deployed before staff can prepare registrations."
      />
    );
  return (
    <CampaignCenter
      owner={user.id}
      manage={user.roles.some((r) => managerRoles.some((x) => x === r))}
    />
  );
}
