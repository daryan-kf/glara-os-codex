import { cookieOptions } from "@/lib/supabase/cookie-options";
import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isConfigured, publicEnv } from "@/lib/env";
export async function proxy(request: NextRequest) {
  if (!isConfigured()) return NextResponse.next();
  let response = NextResponse.next({ request });
  const env = publicEnv();
  const supabase = createServerClient(env.url, env.key, {
    cookieOptions,
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => {
        values.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        values.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options),
        );
      },
    },
  });
  await supabase.auth.getClaims();
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
