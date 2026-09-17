import { SecurityCenter } from "@/components/security-center";
import { Copilot } from "@/components/ai/copilot";
import {
  AutomationCenter,
  NotificationCenter,
} from "@/components/automation/center";
import { AnalyticsDashboard } from "@/components/analytics/dashboard";
import { notFound } from "next/navigation";
import { modules, type Module } from "@/lib/permissions";
import { requireModule } from "@/lib/auth";
import { PageTitle, EmptyState, StatusBadge } from "@/components/primitives";
import { ProfileSettings } from "@/components/profile";
export async function generateMetadata({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module } = await params;
  return {
    title: Object.hasOwn(modules, module)
      ? modules[module as Module].title
      : "Not found",
  };
}
export default async function ModulePage({
  params,
}: {
  params: Promise<{ module: string }>;
}) {
  const { module: key } = await params;
  if (!Object.hasOwn(modules, key)) notFound();
  const moduleKey = key as Module,
    user = await requireModule(moduleKey),
    info = modules[moduleKey];
  if (
    (moduleKey === "automation" || moduleKey === "notifications") &&
    user.automation_version !== 1
  )
    return (
      <EmptyState
        title="Automation deployment pending"
        description="The M7 development backend has not been activated yet."
      />
    );
  if (moduleKey === "copilot")
    return user.ai_version === 1 ? (
      <Copilot roles={user.roles} />
    ) : (
      <EmptyState
        title="Copilot deployment pending"
        description="The M8 backend has not been deployed yet."
      />
    );
  if (moduleKey === "security") return <SecurityCenter roles={user.roles} />;
  if (moduleKey === "automation") return <AutomationCenter />;
  if (moduleKey === "notifications") return <NotificationCenter />;
  if (moduleKey === "dashboard" || moduleKey === "reports")
    return (
      <AnalyticsDashboard
        roles={user.roles}
        enabled={user.analytics_version === 1}
        report={moduleKey === "reports"}
      />
    );
  if (moduleKey === "profile")
    return (
      <>
        <PageTitle
          title="Your profile"
          description="Your identity within the Glara team."
        />
        <ProfileSettings
          user={{ name: user.name, email: user.email, roles: user.roles }}
        />
      </>
    );
  return (
    <>
      <PageTitle title={info.title} description={info.description} />
      <EmptyState
        title={info.title + ", coming into focus"}
        description={info.detail}
      >
        <StatusBadge>{"Planned for " + info.milestone}</StatusBadge>
      </EmptyState>
    </>
  );
}
