import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
export const fixtureUsers = {
  "owner@example.test": {
    id: "10000000-0000-4000-8000-000000000001",
    name: "Demo Owner",
    role: "owner",
  },
  "sales@example.test": {
    id: "10000000-0000-4000-8000-000000000002",
    name: "Demo Sales",
    role: "sales",
  },
  "admin@example.test": {
    id: "10000000-0000-4000-8000-000000000003",
    name: "Demo Admin",
    role: "admin",
  },
  "marketing@example.test": {
    id: "10000000-0000-4000-8000-000000000004",
    name: "Demo Marketing",
    role: "marketing",
  },
  "crew@example.test": {
    id: "10000000-0000-4000-8000-000000000005",
    name: "Demo Crew",
    role: "staging_crew",
  },
  "designer@example.test": {
    id: "10000000-0000-4000-8000-000000000006",
    name: "Demo Designer",
    role: "designer",
  },
  "archived@example.test": {
    id: "10000000-0000-4000-8000-000000000007",
    name: "Demo Archived",
    role: "sales",
  },
};
export async function createTestDatabase() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
 create schema auth; create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}');
 create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
 grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  for (const name of [
    "202609120001_foundation.sql",
    "202609130001_realtor_crm.sql",
    "202609130002_m1_hardening.sql",
  ])
    await db.exec(await readFile("supabase/migrations/" + name, "utf8"));
  for (const user of Object.values(fixtureUsers)) {
    await db.query(
      "insert into auth.users(id,raw_user_meta_data) values($1,$2)",
      [user.id, JSON.stringify({ display_name: user.name })],
    );
    await db.query(
      "insert into public.user_roles(user_id,role) values($1,$2)",
      [user.id, user.role],
    );
  }
  await db.query("update public.profiles set deleted_at=now() where id=$1", [
    fixtureUsers["archived@example.test"].id,
  ]);
  return db;
}
export async function asUser<T>(
  db: PGlite,
  id: string,
  work: (tx: Parameters<Parameters<PGlite["transaction"]>[0]>[0]) => Promise<T>,
) {
  return db.transaction(async (tx) => {
    await tx.exec("set local role authenticated");
    await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [id]);
    return work(tx);
  });
}
export async function rpc(
  db: PGlite,
  id: string,
  name: "crm_query" | "crm_mutate",
  input: unknown,
) {
  return asUser(
    db,
    id,
    async (tx) =>
      (
        await tx.query<{ result: unknown }>(
          `select public.${name}($1::jsonb) result`,
          [JSON.stringify(input)],
        )
      ).rows[0].result,
  );
}
