import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isConfigured } from "@/lib/env";
export async function GET(request: NextRequest) {
  const token_hash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type");
  if (
    isConfigured() &&
    token_hash &&
    (type === "recovery" || type === "invite")
  ) {
    const client = await createClient();
    const { error } = await client.auth.verifyOtp({ token_hash, type });
    if (!error)
      return NextResponse.redirect(new URL("/update-password", request.url));
  }
  return NextResponse.redirect(
    new URL("/login?status=invalid-link", request.url),
  );
}
