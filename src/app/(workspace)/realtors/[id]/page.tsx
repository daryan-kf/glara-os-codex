import { CommunicationHistory } from "@/components/communications/history";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { CopilotLink } from "@/components/ai/copilot";
import { z } from "zod";
import Link from "next/link";
import { notFound } from "next/navigation";
import { recordId } from "@/lib/crm/model";
import { requireModule } from "@/lib/auth";
import { getRealtor, getChoices, getActivities } from "@/lib/crm/data";
import { canWriteCrm, canManageCrm, label, formatDate } from "@/lib/crm/model";
import {
  PageTitle,
  StatusBadge,
  SectionHeading,
  EmptyState,
} from "@/components/primitives";
import { Button } from "@/components/ui/button";
import {
  CrmNav,
  ActivityList,
  FollowupBadge,
  Pager,
} from "@/components/crm/display";
import { ActivityDialog, ArchiveDialog } from "@/components/crm/forms";
function Fact({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted-foreground">
        {title}
      </dt>
      <dd className="mt-2 break-words text-sm">
        {children === 0 ? 0 : children || "Not recorded"}
      </dd>
    </div>
  );
}
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const user = await requireModule("realtors");
  const { id } = await params;
  if (!recordId.safeParse(id).success) notFound();
  const record = await getRealtor(id);
  if (!record) notFound();
  const writable = canWriteCrm(user.roles);
  const page = z.coerce
    .number()
    .int()
    .min(1)
    .max(800)
    .catch(1)
    .parse((await searchParams).page ?? 1);
  const [choices, timeline, open] = await Promise.all([
    getChoices(),
    writable ? getActivities(id, page) : Promise.resolve({ rows: [] }),
    writable ? getActivities(id, 1, "open") : Promise.resolve({ rows: [] }),
  ]);
  return (
    <>
      <Link
        href="/realtors"
        className="mb-5 inline-block py-2 text-sm underline"
      >
        ← All realtors
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageTitle
          title={record.first_name + " " + record.last_name}
          description={record.brokerage_name ?? "Realtor relationship profile"}
        />
        <div className="mb-6 flex flex-wrap gap-2">
          {writable && !record.deleted_at && (
            <CopilotLink feature="realtor" id={id} />
          )}
          {record.deleted_at ? (
            <StatusBadge>Archived</StatusBadge>
          ) : (
            <StatusBadge>{label(record.relationship_status)}</StatusBadge>
          )}
          {writable && !record.deleted_at && (
            <Button variant="outline" asChild>
              <Link href={"/realtors/" + id + "/edit"}>Edit profile</Link>
            </Button>
          )}
        </div>
      </div>
      <CrmNav operational={writable} />
      {writable && (
        <div className="mb-6 flex gap-4 text-sm">
          <Link className="underline" href={"/opportunities?realtor=" + id}>
            Linked sales opportunities
          </Link>
        </div>
      )}
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <aside className="space-y-6">
          <section className="rounded-2xl border bg-card p-6">
            <SectionHeading>Profile & relationship</SectionHeading>
            <dl className="mt-6 grid gap-6 sm:grid-cols-2 xl:grid-cols-1">
              <Fact title="Email">
                {record.email && (
                  <a href={"mailto:" + record.email} className="underline">
                    {record.email}
                  </a>
                )}
              </Fact>
              <Fact title="Phone">
                {record.phone && (
                  <a href={"tel:" + record.phone} className="underline">
                    {record.phone}
                  </a>
                )}
              </Fact>
              <Fact title="Instagram">{record.instagram}</Fact>
              <Fact title="Website">
                {record.website && (
                  <a
                    href={record.website}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {record.website}
                  </a>
                )}
              </Fact>
              <Fact title="Location">
                {[record.primary_city, record.primary_area]
                  .filter(Boolean)
                  .join(" · ")}
              </Fact>
              <Fact title="Secondary areas">
                {record.secondary_areas.join(", ")}
              </Fact>
              <Fact title="Assigned owner">{record.owner_name}</Fact>
              <Fact title="Lead source">{record.lead_source_name}</Fact>
              <Fact title="Relationship status">
                {label(record.relationship_status)}
              </Fact>
              {writable && (
                <>
                  <Fact title="First contact">
                    {formatDate(record.first_contact_date)}
                  </Fact>
                  <Fact title="Last contact">
                    {formatDate(record.last_contact_date)}
                  </Fact>
                  <Fact title="Manual relationship score">
                    {record.relationship_score ?? "Not scored"}
                  </Fact>
                  <Fact title="Manual lead score">
                    {record.lead_score ?? "Not scored"}
                  </Fact>
                  <Fact title="Estimated annual listings">
                    {record.estimated_listings_per_year ?? "Not recorded"}
                  </Fact>
                  <Fact title="Average listing price (CAD)">
                    {record.average_listing_price ?? "Not recorded"}
                  </Fact>
                  {user.communications_version === 1 && (
                    <CommunicationHistory
                      source={{ type: "realtor", id: id as Id<"realtors"> }}
                    />
                  )}
                </>
              )}
              {record.luxury_agent && (
                <Fact title="Market segment">Luxury agent</Fact>
              )}
            </dl>
          </section>
          {writable && (
            <section className="rounded-2xl border bg-card p-6">
              <SectionHeading>Internal notes</SectionHeading>
              <p className="mt-4 whitespace-pre-wrap break-words text-sm leading-7 text-muted-foreground">
                {record.notes ||
                  "No relationship notes yet. Use Edit profile to add context."}
              </p>
            </section>
          )}
          {writable && (!record.deleted_at || canManageCrm(user.roles)) && (
            <ArchiveDialog
              key={record.deleted_at ?? "active"}
              record={record}
            />
          )}
        </aside>
        <div className="order-first min-w-0 space-y-6 xl:order-none">
          {writable ? (
            <>
              <section className="rounded-2xl border bg-card p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionHeading>Next actions</SectionHeading>
                  {!record.deleted_at && (
                    <ActivityDialog
                      realtorId={id}
                      choices={choices}
                      currentUser={user.id}
                      followup
                    />
                  )}
                </div>
                <div className="mt-5">
                  <FollowupBadge
                    due={record.next_followup_date}
                    status={record.relationship_status}
                  />
                </div>
                {open.rows.length ? (
                  <ActivityList
                    rows={open.rows}
                    complete={!record.deleted_at}
                  />
                ) : (
                  <p className="mt-5 text-sm text-muted-foreground">
                    No open follow-up. Keep an active relationship moving with a
                    next action.
                  </p>
                )}
                {open.rows.length === 30 && (
                  <Link
                    href="/realtors/followups"
                    className="text-sm underline"
                  >
                    View more in follow-ups
                  </Link>
                )}
              </section>
              <section className="rounded-2xl border bg-card p-6">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <SectionHeading>Relationship timeline</SectionHeading>
                  {!record.deleted_at && (
                    <ActivityDialog
                      realtorId={id}
                      choices={choices}
                      currentUser={user.id}
                    />
                  )}
                </div>
                {timeline.rows.length ? (
                  <ActivityList rows={timeline.rows} />
                ) : (
                  <p className="mt-6 text-sm text-muted-foreground">
                    Log your first call, message or note to begin the history.
                  </p>
                )}
                <Pager
                  page={page}
                  hasNext={timeline.rows.length === 30}
                  href={(p) => "/realtors/" + id + "?page=" + p}
                />
              </section>
              {user.communications_version === 1 && (
                <CommunicationHistory
                  source={{ type: "realtor", id: id as Id<"realtors"> }}
                />
              )}
            </>
          ) : (
            <EmptyState
              title="Relationship directory access"
              description="Your Marketing role can view contact information, brokerage, location, owner and lead source. Internal notes, scores and activity history are restricted."
            />
          )}
          <section className="rounded-2xl border bg-card p-6">
            <SectionHeading>The relationship, over time</SectionHeading>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              {["Opportunities", "Projects", "Revenue", "Referrals"]
                .filter((name) => writable || name !== "Revenue")
                .map((name) => (
                  <div
                    className="rounded-lg border border-dashed p-4"
                    key={name}
                  >
                    <h3 className="text-sm font-medium">{name}</h3>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Available in a future milestone
                    </p>
                  </div>
                ))}
            </div>
          </section>
        </div>
      </div>
      {user.communications_version === 1 && (
        <CommunicationHistory
          source={{ type: "realtor", id: id as Id<"realtors"> }}
        />
      )}
    </>
  );
}
