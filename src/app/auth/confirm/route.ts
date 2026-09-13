import { NextResponse, type NextRequest } from "next/server";
// Retired Supabase links never create a Convex session.
export function GET(request: NextRequest) {
  return NextResponse.redirect(
    new URL("/login?status=invalid-link", request.url),
  );
}
