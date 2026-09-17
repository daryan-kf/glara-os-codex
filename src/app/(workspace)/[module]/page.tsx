import Link from "next/link";
import { SecurityCenter } from "@/components/security-center";
import { MarketingCenter } from "@/components/analytics/marketing";
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
  if (moduleKey === "marketing")
    return user.analytics_version === 1 ? (
      <MarketingCenter />
    ) : (
      <EmptyState
        title="Marketing deployment pending"
        description="The M6 reporting backend has not been activated yet."
      />
    );
  if (moduleKey === "settings")
    return (
      <>
        <PageTitle
          title="Settings"
          description="Company configuration, kept next to the modules it governs."
        />
        <div className="grid max-w-4xl gap-3 sm:grid-cols-2">
          {(
            [
              [
                "/inventory/settings",
                "Inventory categories & locations",
                "Catalog structure, warehouses and Excel import/export.",
              ],
              [
                "/projects/settings",
                "Project settings",
                "Checklist template and daily staging capacity.",
              ],
              [
                "/quotes",
                "Quotes & discount authority",
                "Sales and Admin discount limits live under Quotes.",
              ],
              [
                "/security",
                "Security & operations",
                "Emergency controls and operational evidence.",
              ],
              [
                "/automation",
                "Automation rules",
                "Versioned follow-through rules and enrollment.",
              ],
              [
                "/profile",
                "Your profile",
                "Display name and password for your own account.",
              ],
            ] as const
          ).map(([href, title, description]) => (
            <Link key={href} href={href} className="rounded-xl border p-4">
              <strong>{title}</strong>
              <p className="mt-1 text-sm text-muted-foreground">
                {description}
              </p>
            </Link>
          ))}
        </div>
        <p className="mt-6 max-w-4xl text-sm text-muted-foreground">
          User accounts, roles and archiving remain a trusted deployment
          operation performed by the company owner through administration
          tooling, so access can never be broadened from a browser.
        </p>
      </>
    );
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
