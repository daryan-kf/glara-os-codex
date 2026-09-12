-- M0: identity and authorization only. Business records belong to later milestones.
begin;
create schema if not exists private;
revoke all on schema private from public;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null default 'Team member' check (char_length(display_name) between 1 and 120),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name in ('owner','sales','designer','staging_crew','admin','marketing')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
insert into public.roles(name) values ('owner'),('sales'),('designer'),('staging_crew'),('admin'),('marketing');
create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  role text not null references public.roles(name) on update restrict on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, role)
);
create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  action text not null check (action in ('INSERT','UPDATE','DELETE')),
  entity text not null,
  entity_id uuid not null,
  old_value jsonb,
  new_value jsonb,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs(entity, entity_id, created_at desc);
create index audit_logs_actor_idx on public.audit_logs(actor_id, created_at desc);

create function private.touch_updated_at() returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at = now(); return new; end;
$$;
create trigger profiles_updated before update on public.profiles for each row execute function private.touch_updated_at();
create trigger roles_updated before update on public.roles for each row execute function private.touch_updated_at();
create trigger user_roles_updated before update on public.user_roles for each row execute function private.touch_updated_at();

create function private.handle_new_user() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(id, display_name) values (new.id, coalesce(nullif(left(new.raw_user_meta_data->>'display_name', 120), ''), 'Team member'));
  -- Never grant roles based on metadata. Provision roles through trusted administration.
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function private.handle_new_user();
-- Supports projects where invited users predate this migration.
insert into public.profiles(id, display_name)
select id, coalesce(nullif(left(raw_user_meta_data->>'display_name', 120), ''), 'Team member') from auth.users on conflict (id) do nothing;

create function private.is_owner() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.user_roles r join public.profiles p on p.id = r.user_id where r.user_id = (select auth.uid()) and r.role = 'owner' and p.deleted_at is null);
$$;
create function private.is_active_member() returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p join public.user_roles r on r.user_id = p.id where p.id = (select auth.uid()) and p.deleted_at is null);
$$;
create function private.audit_identity_change() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.audit_logs(actor_id, action, entity, entity_id, old_value, new_value)
  values (auth.uid(), tg_op, tg_table_name, coalesce(new.id, old.id),
    case when tg_op = 'INSERT' then null else to_jsonb(old) end,
    case when tg_op = 'DELETE' then null else to_jsonb(new) end);
  return coalesce(new, old);
end;
$$;
create trigger audit_profiles after insert or update or delete on public.profiles for each row execute function private.audit_identity_change();
create trigger audit_user_roles after insert or update or delete on public.user_roles for each row execute function private.audit_identity_change();
create trigger audit_roles after insert or update or delete on public.roles for each row execute function private.audit_identity_change();

alter table public.profiles enable row level security;
alter table public.roles enable row level security;
alter table public.user_roles enable row level security;
alter table public.audit_logs enable row level security;
revoke all on public.profiles, public.roles, public.user_roles, public.audit_logs from anon, authenticated;
grant select on public.profiles, public.roles, public.user_roles, public.audit_logs to authenticated;
grant all on public.profiles, public.roles, public.user_roles, public.audit_logs to service_role;
grant usage on schema private to authenticated;
revoke all on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_owner(), private.is_active_member() to authenticated;
create policy profiles_read on public.profiles for select to authenticated using (id = (select auth.uid()) or (select private.is_owner()));
create policy roles_read on public.roles for select to authenticated using ((select private.is_active_member()));
create policy user_roles_read on public.user_roles for select to authenticated using ((user_id = (select auth.uid()) and (select private.is_active_member())) or (select private.is_owner()));
create policy audit_read on public.audit_logs for select to authenticated using ((select private.is_owner()));
-- No API writes in M0. SQL administration is deliberate; future write paths need
-- explicit authorization, validation, RLS policies and business-level audit coverage.
commit;
