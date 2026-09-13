begin;
create function private.crm_role(allowed text[]) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.profiles p join public.user_roles ur on ur.user_id=p.id where p.id=auth.uid() and p.deleted_at is null and ur.role=any(allowed));
$$;
revoke all on function private.crm_role(text[]) from public;
grant execute on function private.crm_role(text[]) to authenticated;
create table public.brokerages(
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 160),
 office_name text check(length(office_name)<=160), website text check(website ~ '^https?://'), phone text check(length(phone)<=40),
 address text check(length(address)<=300), city text check(length(city)<=100), province text not null default 'BC' check(length(province)<=80),
 postal_code text check(length(postal_code)<=20), notes text check(length(notes)<=10000),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create unique index brokerage_name_office_unique on public.brokerages(lower(trim(name)),lower(coalesce(office_name,''))) where deleted_at is null;
create table public.lead_sources(
 id uuid primary key default gen_random_uuid(), name text not null check(length(trim(name)) between 1 and 100),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create unique index lead_source_name_unique on public.lead_sources(lower(trim(name))) where deleted_at is null;
insert into public.lead_sources(name) values ('Instagram'),('Google'),('Referral'),('Open House'),('Cold Call'),('Cold Email'),('Brokerage'),('Event'),('Website'),('Existing Client'),('PacificWest'),('Other');
create table public.realtors(
 id uuid primary key default gen_random_uuid(), first_name text not null check(length(trim(first_name)) between 1 and 100),
 last_name text not null check(length(trim(last_name)) between 1 and 100),
 email text check(length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 phone text check(length(phone)<=40 and length(regexp_replace(phone,'[^0-9]','','g')) between 7 and 15),
 instagram text check(length(instagram)<=100), website text check(website ~ '^https?://' and length(website)<=500),
 brokerage_id uuid references public.brokerages(id), primary_city text check(length(primary_city)<=100),
 primary_area text check(length(primary_area)<=100), secondary_areas text[] not null default '{}' check(cardinality(secondary_areas)<=20),
 luxury_agent boolean not null default false,
 relationship_status text not null default 'prospect' check(relationship_status in ('prospect','new_partner','active_partner','vip','at_risk','dormant')),
 lead_source_id uuid references public.lead_sources(id), assigned_to uuid not null references public.profiles(id),
 version integer not null default 1,
 search_vector tsvector generated always as (to_tsvector('simple',coalesce(first_name,'')||' '||coalesce(last_name,'')||' '||coalesce(email,'')||' '||coalesce(phone,''))) stored,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz
);
create unique index realtor_email_unique on public.realtors(lower(email)) where email is not null and deleted_at is null;
create unique index realtor_phone_unique on public.realtors(regexp_replace(phone,'[^0-9]','','g')) where phone is not null and deleted_at is null;
create index realtor_search_idx on public.realtors using gin(search_vector) where deleted_at is null;
create index realtor_name_idx on public.realtors(last_name,first_name,id);
create index realtor_brokerage_idx on public.realtors(brokerage_id) where deleted_at is null;
create index realtor_owner_status_idx on public.realtors(assigned_to,relationship_status) where deleted_at is null;
create table public.realtor_private(
 id uuid primary key references public.realtors(id), notes text check(length(notes)<=10000),
 estimated_listings_per_year integer check(estimated_listings_per_year between 0 and 100000),
 average_listing_price numeric(16,2) check(average_listing_price>=0),
 relationship_score integer check(relationship_score between 0 and 100),
 lead_score integer check(lead_score between 0 and 100),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.activities(
 id uuid primary key default gen_random_uuid(), realtor_id uuid not null references public.realtors(id),
 type text not null check(type in ('call','email','instagram_dm','sms','meeting','consultation','follow_up','task','note')),
 title text not null check(length(trim(title)) between 1 and 200), description text check(length(description)<=10000),
 due_at timestamptz, completed_at timestamptz, status text not null default 'open' check(status in ('open','completed','cancelled')),
 priority text not null default 'normal' check(priority in ('low','normal','high')),
 assigned_to uuid not null references public.profiles(id), created_by uuid not null default auth.uid() references public.profiles(id),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(), deleted_at timestamptz,
 check((status='completed')=(completed_at is not null)), check(status<>'open' or due_at is not null)
);
create index activity_realtor_timeline_idx on public.activities(realtor_id,(coalesce(completed_at,created_at)) desc,id desc) where deleted_at is null;
create index activity_open_due_idx on public.activities(due_at,realtor_id) where status='open' and deleted_at is null;
create index activity_assigned_due_idx on public.activities(assigned_to,due_at) where status='open' and deleted_at is null;
create function private.crm_validate_activity() returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.realtors where id=new.realtor_id for update;
 if not exists(select 1 from public.realtors where id=new.realtor_id and deleted_at is null) then raise exception 'Realtor is archived or unavailable.'; end if;
 if not exists(select 1 from public.profiles p join public.user_roles u on u.user_id=p.id where p.id=new.assigned_to and p.deleted_at is null and u.role in ('owner','sales','admin')) then raise exception 'Select an active CRM team member.'; end if;
 if new.completed_at>now()+interval '1 minute' then raise exception 'Contact completion cannot be in the future.'; end if;
 return new;
end; $$;
create trigger activity_validate before insert or update on public.activities for each row execute function private.crm_validate_activity();
create function private.crm_next_action() returns trigger language plpgsql security definer set search_path='' as $$
declare rid uuid;
begin
 if tg_table_name='realtors' then rid=coalesce(new.id,old.id); else rid=coalesce(new.realtor_id,old.realtor_id); end if;
 if exists(select 1 from public.realtors where id=rid and deleted_at is null and relationship_status='prospect')
 and not exists(select 1 from public.activities where realtor_id=rid and deleted_at is null and status='open' and due_at is not null)
 then raise exception 'A prospect needs a next action. Add a follow-up or change the relationship status before closing the last action.'; end if;
 return null;
end; $$;
create constraint trigger realtor_next_action after insert or update on public.realtors deferrable initially deferred for each row execute function private.crm_next_action();
create constraint trigger activity_next_action after insert or update or delete on public.activities deferrable initially deferred for each row execute function private.crm_next_action();
do $$ declare t text; begin
 foreach t in array array['brokerages','lead_sources','realtors','realtor_private','activities'] loop
 execute format('alter table public.%I enable row level security',t);
 execute format('revoke all on public.%I from anon,authenticated',t);
 execute format('grant select on public.%I to authenticated',t);
 execute format('grant all on public.%I to service_role',t);
 execute format('create trigger touch_updated before update on public.%I for each row execute function private.touch_updated_at()',t);
 execute format('create trigger audit_change after insert or update or delete on public.%I for each row execute function private.audit_identity_change()',t);
 end loop;
end $$;
-- Marketing reads only the non-sensitive directory; it never sees internal notes or activities.
create policy crm_realtors_read on public.realtors for select to authenticated using (
 private.crm_role(array['owner','sales','admin','marketing']) and (deleted_at is null or private.crm_role(array['owner','admin'])));
create policy crm_private_read on public.realtor_private for select to authenticated using (
 private.crm_role(array['owner','sales','admin']) and exists(select 1 from public.realtors where id=realtor_private.id));
create policy crm_activities_read on public.activities for select to authenticated using (
 private.crm_role(array['owner','sales','admin']) and exists(select 1 from public.realtors where id=activities.realtor_id));
-- Brokerage notes are operational; Marketing receives only a safe projection through the directory.
create policy crm_brokerage_read on public.brokerages for select to authenticated using(private.crm_role(array['owner','sales','admin']));
create policy crm_sources_read on public.lead_sources for select to authenticated using(private.crm_role(array['owner','sales','admin','marketing']) and deleted_at is null);
create policy crm_team_names on public.profiles for select to authenticated using(private.crm_role(array['owner','sales','admin','marketing']) and deleted_at is null);
create function private.crm_brokerage_name(bid uuid) returns text language sql stable security definer set search_path='' as $$
 select name || case when nullif(office_name,'') is null then '' else ' · '||office_name end from public.brokerages
 where id=bid and private.crm_role(array['owner','sales','admin','marketing']);
$$;
create function private.crm_search(q text) returns tsquery language sql immutable set search_path='' as $$
 select to_tsquery('simple',nullif(string_agg(quote_literal(word)||':*',' & '),''))
 from regexp_split_to_table(lower(left(q,100)),'[^[:alnum:]@.]+') word where word<>'';
$$;
create view public.realtor_directory with (security_invoker=true) as
 select r.id,r.first_name,r.last_name,r.email,r.phone,r.instagram,r.website,r.brokerage_id,
 r.primary_city,r.primary_area,r.secondary_areas,r.luxury_agent,r.relationship_status,r.lead_source_id,r.assigned_to,
 r.version,r.created_at,r.updated_at,r.deleted_at,r.search_vector,
 private.crm_brokerage_name(r.brokerage_id) brokerage_name,p.display_name owner_name,s.name lead_source_name,
 a.first_contact_date,a.last_contact_date,a.next_followup_date,a.next_action
 from public.realtors r left join public.profiles p on p.id=r.assigned_to left join public.lead_sources s on s.id=r.lead_source_id
 left join lateral (
 select min(completed_at) filter(where type in ('call','email','instagram_dm','sms','meeting','consultation')) first_contact_date,
 max(completed_at) filter(where type in ('call','email','instagram_dm','sms','meeting','consultation')) last_contact_date,
 min(due_at) filter(where status='open') next_followup_date,
 (array_agg(title order by due_at,id) filter(where status='open'))[1] next_action
 from public.activities where realtor_id=r.id and deleted_at is null
 ) a on true;
revoke all on public.realtor_directory from anon,authenticated;
grant select on public.realtor_directory to authenticated;
-- All inputs are explicitly mapped. No client-supplied actor or arbitrary table/column names.
create function public.crm_mutate(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op text:=p_input->>'op'; d jsonb:=coalesce(p_input->'data','{}'); rid uuid; aid uuid; record_id uuid;
 existing public.realtors; result jsonb; actor uuid:=auth.uid();
begin
 if not private.crm_role(array['owner','sales','admin']) then raise exception 'CRM write access denied.' using errcode='42501'; end if;
 if octet_length(p_input::text)>60000 then raise exception 'Request is too large.'; end if;
 if op in ('realtor_create','realtor_update') then
  if not exists(select 1 from public.profiles p join public.user_roles u on u.user_id=p.id where p.id=(d->>'assigned_to')::uuid and p.deleted_at is null and u.role in ('owner','sales','admin')) then raise exception 'Select an active CRM team member.'; end if;
  if nullif(d->>'brokerage_id','') is not null and not exists(select 1 from public.brokerages where id=(d->>'brokerage_id')::uuid and deleted_at is null) then raise exception 'Select an active brokerage.'; end if;
  if nullif(d->>'lead_source_id','') is not null and not exists(select 1 from public.lead_sources where id=(d->>'lead_source_id')::uuid and deleted_at is null) then raise exception 'Select an active lead source.'; end if;
  if op='realtor_create' then
   insert into public.realtors(first_name,last_name,assigned_to) values(trim(d->>'first_name'),trim(d->>'last_name'),(d->>'assigned_to')::uuid) returning id into rid;
  else
   rid:=(p_input->>'id')::uuid;
   select * into existing from public.realtors where id=rid for update;
   if not found or existing.deleted_at is not null then raise exception 'Realtor is archived or unavailable.'; end if;
   if existing.version<>(p_input->>'version')::integer or p_input->>'version' is null then raise exception 'This record changed. Reload before saving.'; end if;
  end if;
  update public.realtors set
   first_name=trim(d->>'first_name'),last_name=trim(d->>'last_name'),email=nullif(lower(trim(d->>'email')),''),phone=nullif(trim(d->>'phone'),''),
   instagram=nullif(d->>'instagram',''),website=nullif(d->>'website',''),brokerage_id=nullif(d->>'brokerage_id','')::uuid,
   primary_city=nullif(trim(d->>'primary_city'),''),primary_area=nullif(trim(d->>'primary_area'),''),
   secondary_areas=array(select jsonb_array_elements_text(coalesce(d->'secondary_areas','[]'))),
   luxury_agent=coalesce((d->>'luxury_agent')::boolean,false),relationship_status=coalesce(d->>'relationship_status','prospect'),
   lead_source_id=nullif(d->>'lead_source_id','')::uuid,assigned_to=(d->>'assigned_to')::uuid,
   version=case when op='realtor_update' then version+1 else version end where id=rid;
  insert into public.realtor_private(id,notes,estimated_listings_per_year,average_listing_price,relationship_score,lead_score)
   values(rid,nullif(d->>'notes',''),nullif(d->>'estimated_listings_per_year','')::integer,nullif(d->>'average_listing_price','')::numeric,nullif(d->>'relationship_score','')::integer,nullif(d->>'lead_score','')::integer)
   on conflict(id) do update set notes=excluded.notes,estimated_listings_per_year=excluded.estimated_listings_per_year,average_listing_price=excluded.average_listing_price,relationship_score=excluded.relationship_score,lead_score=excluded.lead_score;
  if nullif(d->>'next_title','') is not null then
   insert into public.activities(realtor_id,type,title,due_at,assigned_to,created_by) values(rid,'follow_up',d->>'next_title',(d->>'next_due_at')::timestamptz,(d->>'assigned_to')::uuid,actor);
  end if;
  result:=jsonb_build_object('id',rid);
 elsif op in ('realtor_archive','realtor_restore') then
  rid:=(p_input->>'id')::uuid;
  select * into existing from public.realtors where id=rid for update;
  if not found then raise exception 'Realtor unavailable.'; end if;
  if op='realtor_restore' and not private.crm_role(array['owner','admin']) then raise exception 'Only owner or admin can restore.' using errcode='42501'; end if;
  if existing.version<>(p_input->>'version')::integer or p_input->>'version' is null then raise exception 'This record changed. Reload before saving.'; end if;
  update public.realtors set deleted_at=case when op='realtor_archive' then now() else null end,version=version+1 where id=rid;
  result:=jsonb_build_object('id',rid);
 elsif op='activity_create' then
  rid:=(d->>'realtor_id')::uuid;
  insert into public.activities(realtor_id,type,title,description,due_at,completed_at,status,priority,assigned_to,created_by)
   values(rid,d->>'type',trim(d->>'title'),nullif(d->>'description',''),nullif(d->>'due_at','')::timestamptz,
   case when d->>'status'='completed' then coalesce(nullif(d->>'completed_at','')::timestamptz,now()) else null end,
   d->>'status',coalesce(d->>'priority','normal'),(d->>'assigned_to')::uuid,actor) returning id into aid;
  result:=jsonb_build_object('id',aid,'realtor_id',rid);
 elsif op in ('activity_complete','activity_cancel') then
  aid:=(p_input->>'id')::uuid;
  select realtor_id into rid from public.activities where id=aid;
  perform 1 from public.realtors where id=rid and deleted_at is null for update;
  if not found then raise exception 'Realtor is archived or unavailable.'; end if;
  update public.activities set status=case when op='activity_complete' then 'completed' else 'cancelled' end,
   completed_at=case when op='activity_complete' then now() else null end where id=aid and status='open' and deleted_at is null;
  if not found then raise exception 'This activity is no longer open. Reload the page.'; end if;
  if nullif(d->>'next_title','') is not null then
   insert into public.activities(realtor_id,type,title,due_at,assigned_to,created_by)
   select rid,'follow_up',d->>'next_title',(d->>'next_due_at')::timestamptz,assigned_to,actor from public.realtors where id=rid;
  end if;
  result:=jsonb_build_object('id',aid,'realtor_id',rid);
 elsif op in ('brokerage_save','source_save') then
  record_id:=coalesce(nullif(p_input->>'id','')::uuid,gen_random_uuid());
  if op='brokerage_save' then
   insert into public.brokerages(id,name,office_name,website,phone,address,city,province,postal_code,notes)
   values(record_id,trim(d->>'name'),nullif(trim(d->>'office_name'),''),nullif(d->>'website',''),nullif(d->>'phone',''),nullif(d->>'address',''),nullif(d->>'city',''),coalesce(nullif(d->>'province',''),'BC'),nullif(d->>'postal_code',''),nullif(d->>'notes',''))
   on conflict(id) do update set name=excluded.name,office_name=excluded.office_name,website=excluded.website,phone=excluded.phone,address=excluded.address,city=excluded.city,province=excluded.province,postal_code=excluded.postal_code,notes=excluded.notes;
  else
   if not private.crm_role(array['owner','admin']) then raise exception 'Only owner or admin can configure lead sources.' using errcode='42501'; end if;
   insert into public.lead_sources(id,name) values(record_id,trim(d->>'name')) on conflict(id) do update set name=excluded.name;
  end if;
  result:=jsonb_build_object('id',record_id);
 else raise exception 'Unsupported CRM operation.';
 end if;
 return result;
end; $$;
create function private.crm_brokerage_options(q text) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',b.id,'name',b.name||case when b.office_name is null then '' else ' · '||b.office_name end)),'[]') from (
 select id,name,office_name from public.brokerages where deleted_at is null and private.crm_role(array['owner','sales','admin','marketing'])
 and (q='' or position(lower(left(q,100)) in lower(name||' '||coalesce(office_name,'')))>0) order by lower(name),id limit 25) b;
$$;
revoke all on function private.crm_brokerage_options(text) from public;
grant execute on function private.crm_brokerage_options(text) to authenticated;
create function public.crm_query(p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare op text:=p_input->>'op'; result jsonb; rid uuid;
 q text:=left(coalesce(p_input->>'q',''),100); page_num integer:=greatest(1,least(800,coalesce((p_input->>'page')::integer,1)));
 is_archived boolean:=coalesce((p_input->>'archived')::boolean,false);
begin
 if not private.crm_role(array['owner','sales','admin','marketing']) then raise exception 'CRM read access denied.' using errcode='42501'; end if;
 if octet_length(p_input::text)>10000 then raise exception 'Request is too large.'; end if;
 if op in ('list','search') then
  with filtered as (
   select r.* from public.realtor_directory r
   where (r.deleted_at is not null)=is_archived
   and (q='' or r.search_vector @@ private.crm_search(q) or (q ~ '^[+0-9 ()-]+$' and length(regexp_replace(q,'[^0-9]','','g'))>=3 and position(regexp_replace(q,'[^0-9]','','g') in regexp_replace(coalesce(r.phone,''),'[^0-9]','','g'))>0))
   and (coalesce(p_input->>'status','')='' or r.relationship_status=p_input->>'status')
   and (coalesce(p_input->>'brokerage_id','')='' or r.brokerage_id=(p_input->>'brokerage_id')::uuid)
   and (coalesce(p_input->>'assigned_to','')='' or r.assigned_to=(p_input->>'assigned_to')::uuid)
   and (coalesce(p_input->>'lead_source_id','')='' or r.lead_source_id=(p_input->>'lead_source_id')::uuid)
   and (coalesce(p_input->>'area','')='' or position(lower(p_input->>'area') in lower(coalesce(r.primary_city,'')||' '||coalesce(r.primary_area,'')))>0)
   and (coalesce(p_input->>'followup','')='' or
     (p_input->>'followup'='missing' and r.next_followup_date is null and r.relationship_status<>'dormant') or
     (p_input->>'followup'='overdue' and (r.next_followup_date at time zone 'America/Vancouver')::date<(now() at time zone 'America/Vancouver')::date) or
     (p_input->>'followup'='today' and (r.next_followup_date at time zone 'America/Vancouver')::date=(now() at time zone 'America/Vancouver')::date))
  ), paged as (
   select * from filtered order by
    case when p_input->>'sort'='newest' then created_at end desc,
    case when p_input->>'sort'='followup' then next_followup_date end asc nulls last,
    lower(last_name),lower(first_name),id
   limit case when op='search' then 8 else 25 end offset case when op='search' then 0 else (page_num-1)*25 end
  )
  select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(paged)-'search_vector') from paged),'[]'),'total',(select count(*) from filtered)) into result;
 elsif op='detail' then
  rid:=(p_input->>'id')::uuid;
  select to_jsonb(r)-'search_vector' into result from public.realtor_directory r where id=rid;
  if result is not null and private.crm_role(array['owner','sales','admin']) then
   result:=result||coalesce((select to_jsonb(p)-'id'-'created_at'-'updated_at' from public.realtor_private p where id=rid),'{}');
  end if;
 elsif op='activities' then
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(a)),'[]')) into result from (
   select a.* from public.activities a where realtor_id=(p_input->>'id')::uuid and deleted_at is null
   and (coalesce(p_input->>'status','')='' or status=p_input->>'status')
   order by case when p_input->>'status'='open' then due_at end asc,coalesce(completed_at,created_at) desc,id desc limit 30 offset (page_num-1)*30
  ) a;
 elsif op='followups' then
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(a)),'[]')) into result from (
   select a.*,r.first_name,r.last_name from public.activities a join public.realtors r on r.id=a.realtor_id
   where a.status='open' and a.deleted_at is null and r.deleted_at is null
   and (coalesce(p_input->>'assigned_to','')='' or a.assigned_to=(p_input->>'assigned_to')::uuid)
   order by a.due_at,a.id limit 30 offset (page_num-1)*30
  ) a;
 elsif op='choices' then
  result:=jsonb_build_object(
   'owners',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.display_name) order by p.display_name),'[]') from (select id,display_name from public.profiles where deleted_at is null order by display_name,id limit 500) p where p.id in (
    select u.user_id from public.user_roles u where u.role in ('owner','sales','admin'))),
   'sources',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from (select id,name from public.lead_sources order by name,id limit 500) sources));
 elsif op='brokerage_options' then
  result:=private.crm_brokerage_options(q);
 elsif op='brokerages' then
  select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(b)),'[]')) into result from (
   select * from public.brokerages where deleted_at is null and (q='' or position(lower(q) in lower(name||' '||coalesce(office_name,'')))>0) order by lower(name),id limit 25 offset (page_num-1)*25
  ) b;
 elsif op='brokerage' then
  select to_jsonb(b) into result from public.brokerages b where id=(p_input->>'id')::uuid and deleted_at is null;
 else raise exception 'Unsupported CRM query.';
 end if;
 return result;
end; $$;
-- Team assignments need the active operational roster, not just the caller's own role.
create policy crm_team_roles on public.user_roles for select to authenticated using(private.crm_role(array['owner','sales','admin','marketing']) and role in ('owner','sales','admin') and exists(select 1 from public.profiles p where p.id=user_id and p.deleted_at is null));
revoke all on function private.crm_validate_activity(),private.crm_next_action(),private.crm_brokerage_name(uuid),private.crm_search(text) from public;
grant execute on function private.crm_brokerage_name(uuid),private.crm_search(text) to authenticated;
revoke all on function public.crm_query(jsonb),public.crm_mutate(jsonb) from public,anon;
grant execute on function public.crm_query(jsonb),public.crm_mutate(jsonb) to authenticated;
commit;
