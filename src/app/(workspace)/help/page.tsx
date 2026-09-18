import type { Metadata } from "next";
import { UserGuide } from "@/components/help/user-guide";
import { requireModule } from "@/lib/auth";

export const metadata: Metadata = {
  title: "راهنمای کاربران | Glara OS",
};

export default async function HelpPage() {
  const user = await requireModule("help");
  return <UserGuide roles={user.roles} />;
}
