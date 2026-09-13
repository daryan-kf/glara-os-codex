import { convexAuthNextjsMiddleware } from "@convex-dev/auth/nextjs/server";
import {
  NextResponse,
  type NextRequest,
  type NextFetchEvent,
} from "next/server";
import { isConfigured } from "@/lib/env";
const authProxy = convexAuthNextjsMiddleware(undefined, {
  cookieConfig: { maxAge: 7 * 24 * 60 * 60 },
  shouldHandleCode: false,
});
export async function proxy(request: NextRequest, event: NextFetchEvent) {
  if (!isConfigured()) return NextResponse.next();
  const response = await authProxy(request, event);
  if (response) response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
