import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("foundation migration enforces identity isolation, role safety and audit integrity", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key, raw_user_meta_data jsonb default '{}');
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
    await db.exec(
      await readFile("supabase/migrations/202609120001_foundation.sql", "utf8"),
    );
    const owner = "10000000-0000-0000-0000-000000000001";
    const sales = "10000000-0000-0000-0000-000000000002";
    const outsider = "10000000-0000-0000-0000-000000000003";
    await db.exec(`insert into auth.users(id,raw_user_meta_data) values ('${owner}','{"display_name":"Fictional Owner"}'),('${sales}','{"role":"owner"}'),('${outsider}','{}');
      insert into public.user_roles(user_id,role) values ('${owner}','owner'),('${sales}','sales');`);
    await db.exec(
      `set role authenticated; set request.jwt.claim.sub = '${sales}';`,
    );
    assert.equal(
      (await db.query("select * from public.profiles")).rows.length,
      1,
    );
    assert.deepEqual(
      (await db.query("select role from public.user_roles")).rows,
      [{ role: "sales" }],
    );
    assert.equal(
      (await db.query("select * from public.audit_logs")).rows.length,
      0,
    );
    await assert.rejects(
      db.exec(
        `insert into public.user_roles(user_id,role) values ('${sales}','owner')`,
      ),
      /permission denied/,
    );
    await assert.rejects(
      db.exec(`update public.profiles set deleted_at = null`),
      /permission denied/,
    );
    await assert.rejects(
      db.exec("delete from public.audit_logs"),
      /permission denied/,
    );
    await db.exec(`set request.jwt.claim.sub = '${owner}';`);
    assert.equal(
      (await db.query("select * from public.profiles")).rows.length,
      3,
    );
    assert.equal(
      (await db.query("select * from public.audit_logs")).rows.length,
      5,
    );
    await db.exec(`set request.jwt.claim.sub = '${outsider}';`);
    assert.equal((await db.query("select * from public.roles")).rows.length, 0);
    await db.exec(
      `reset role; update public.profiles set deleted_at=now() where id='${sales}'; set role authenticated; set request.jwt.claim.sub='${sales}';`,
    );
    assert.equal(
      (await db.query("select * from public.user_roles")).rows.length,
      0,
    );
    await db.exec("reset role; set role anon;");
    await assert.rejects(
      db.exec("select * from public.profiles"),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
