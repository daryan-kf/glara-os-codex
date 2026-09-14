import { OperationsToday } from "@/components/operations/list";
import { SalesSummary } from "@/components/sales/opportunities";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowUpRight, ShieldCheck, Compass } from "lucide-react";
import { modules, canAccess, type Module } from "@/lib/permissions";
import { requireModule } from "@/lib/auth";
import {
  PageTitle,
  EmptyState,
  StatusBadge,
  SectionHeading,
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
  const moduleKey = key as Module;
  const user = await requireModule(moduleKey);
  const info = modules[moduleKey];
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
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <PageTitle
          title={
            moduleKey === "dashboard"
              ? `Welcome, ${user.name.split(" ")[0]}.`
              : info.title
          }
          description={info.description}
        />
        <StatusBadge>Connected workspace</StatusBadge>
      </div>
      {moduleKey === "dashboard" && canAccess(user.roles, "projects") && (
        <OperationsToday />
      )}
      {moduleKey === "dashboard" &&
        user.roles.some((r) => ["owner", "sales", "admin"].includes(r)) && (
          <SalesSummary />
        )}
      {moduleKey === "dashboard" ? (
        <>
          <section className="relative mb-8 overflow-hidden rounded-2xl bg-primary px-7 py-10 text-primary-foreground sm:p-10">
            <div className="absolute -right-20 -top-36 size-96 rounded-full border border-white/15" />
            <div className="relative max-w-xl">
              <p className="mb-5 text-xs uppercase tracking-[.2em] text-white/65">
                A connected team
              </p>
              <h2 className="font-display text-3xl leading-tight sm:text-4xl">
                More connected.
                <br />
                More room to grow.
              </h2>
              <p className="mt-5 max-w-md text-sm leading-7 text-white/75">
                Your workspace brings the Glara team together. Manage realtor
                relationships, sales and daily staging operations in one place.
              </p>
            </div>
          </section>
          <div className="mb-5 flex items-center justify-between">
            <SectionHeading>Explore your workspace</SectionHeading>
            <span className="text-xs text-muted-foreground">
              Your workspace modules
            </span>
          </div>
          <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {(["realtors", "projects", "inventory"] as const)
              .filter((item) => canAccess(user.roles, item))
              .map((item) => (
                <Link
                  href={`/${item}`}
                  key={item}
                  className="group rounded-xl border bg-card p-6 transition-colors hover:border-primary/40"
                >
                  <div className="mb-7 flex items-center justify-between">
                    <Compass className="size-6 text-primary" />
                    <ArrowUpRight className="size-4 text-muted-foreground group-hover:text-primary" />
                  </div>
                  <h3 className="text-lg font-semibold">
                    {modules[item].title}
                  </h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {modules[item].description}
                  </p>
                  <p className="mt-5 text-xs text-muted-foreground">
                    {item === "realtors" || item === "projects"
                      ? "Available now · " + modules[item].milestone
                      : "Planned · " + modules[item].milestone}
                  </p>
                </Link>
              ))}
          </div>
        </>
      ) : (
        <EmptyState
          title={
            moduleKey === "settings"
              ? "Your workspace foundation is in place"
              : `${info.title}, coming into focus`
          }
          description={info.detail}
        >
          <StatusBadge>
            {moduleKey === "settings"
              ? "Configuration managed by your administrator"
              : `Planned for ${info.milestone}`}
          </StatusBadge>
        </EmptyState>
      )}
      <div className="mt-7 flex items-center gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="size-4" />
        <span>Private team access · Glara Home Staging</span>
      </div>
    </>
  );
}
