import { NextResponse, type NextRequest } from "next/server";
import { searchRealtors, getBrokerageOptions } from "@/lib/crm/data";
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 100);
  const kind = request.nextUrl.searchParams.get("kind");
  const results =
    kind === "brokerages"
      ? await getBrokerageOptions(q)
      : q.length < 2
        ? []
        : await searchRealtors(q);
  return NextResponse.json(results, {
    headers: { "Cache-Control": "private, no-store" },
  });
}
