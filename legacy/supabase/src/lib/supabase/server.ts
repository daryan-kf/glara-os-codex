import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { publicEnv } from "@/lib/env";
import { cookieOptions } from "./cookie-options";
import type { Database } from "./database.types";
export async function createClient() {
  const env = publicEnv();
  const jar = await cookies();
  return createServerClient<Database>(env.url, env.key, {
    cookieOptions,
    cookies: {
      getAll: () => jar.getAll(),
      setAll: (values) => {
        try {
          values.forEach(({ name, value, options }) =>
            jar.set(name, value, options),
          );
        } catch {
          /* Server components cannot write cookies; proxy refreshes sessions. */
        }
      },
    },
  });
}
