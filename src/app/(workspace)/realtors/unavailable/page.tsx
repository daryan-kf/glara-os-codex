import Link from "next/link";
import { requireModule } from "@/lib/auth";
import { crmMessages, type CrmErrorCategory } from "@/lib/crm/errors";
import { EmptyState } from "@/components/primitives";
import { Button } from "@/components/ui/button";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ reason?: string }>;
}) {
  await requireModule("realtors");
  const { reason } = await searchParams;
  const category: CrmErrorCategory =
    reason && Object.hasOwn(crmMessages, reason)
      ? (reason as CrmErrorCategory)
      : "retry";
  return (
    <EmptyState title="CRM needs attention" description={crmMessages[category]}>
      <Button asChild>
        <Link href="/realtors">Retry CRM</Link>
      </Button>
    </EmptyState>
  );
}
