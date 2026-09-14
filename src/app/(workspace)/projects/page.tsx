import { requireModule } from "@/lib/auth";
import { Projects } from "@/components/operations/list";
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ property?: string }>;
}) {
  await requireModule("projects");
  const p = await searchParams;
  return <Projects propertyId={p.property} />;
}
