import { AnalyticsDashboard } from "@/components/analytics/dashboard";
import { notFound } from "next/navigation";
import { modules, type Module } from "@/lib/permissions";
import { requireModule } from "@/lib/auth";
import {
  PageTitle,
  EmptyState,
  StatusBadge,
  Avatar,
} from "@/components/primitives";
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
        <section className="max-w-2xl rounded-2xl border bg-card p-8">
          <div className="mb-8 flex items-center gap-4">
            <Avatar name={user.name} />
            <h2 className="text-xl font-semibold">{user.name}</h2>
          </div>
          <dl className="space-y-6">
            <div>
              <dt className="text-sm text-muted-foreground">Work email</dt>
              <dd className="mt-1 break-all">{user.email}</dd>
            </div>
            <div>
              <dt className="mb-2 text-sm text-muted-foreground">
                Assigned roles
              </dt>
              <dd className="flex flex-wrap gap-2">
                {user.roles.map((role) => (
                  <StatusBadge key={role}>
                    {role.replaceAll("_", " ")}
                  </StatusBadge>
                ))}
              </dd>
            </div>
          </dl>
          <p className="mt-8 border-t pt-6 text-sm text-muted-foreground">
            Contact the company owner to update your profile or access.
          </p>
        </section>
      </>
    );
  return (
    <>
      <PageTitle title={info.title} description={info.description} />
      <EmptyState
        title={
          moduleKey === "settings"
            ? "Your workspace foundation is in place"
            : info.title + ", coming into focus"
        }
        description={info.detail}
      >
        <StatusBadge>
          {moduleKey === "settings"
            ? "Configuration managed by your administrator"
            : "Planned for " + info.milestone}
        </StatusBadge>
      </EmptyState>
    </>
  );
}
