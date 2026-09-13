begin;
alter table public.activities add column replaces_activity_id uuid references public.activities(id);
-- Append-only hardening: preserve the already-applied M0/M1 migration history.
alter table public.brokerages add column version integer not null default 1 check(version>0);
drop policy crm_team_names on public.profiles;
drop policy crm_team_roles on public.user_roles;
create policy crm_team_names on public.profiles for select to authenticated using(private.crm_role(array['owner','sales','admin']) and deleted_at is null);
create policy crm_team_roles on public.user_roles for select to authenticated using(private.crm_role(array['owner','sales','admin']) and role in ('owner','sales','admin') and exists(select 1 from public.profiles p where p.id=user_id and p.deleted_at is null));
-- Marketing may see the display name attached to a visible Realtor, never the operational roster.
create function private.crm_owner_name(uid uuid) returns text language sql stable security definer set search_path='' as $$
 select p.display_name from public.profiles p where p.id=uid and p.deleted_at is null
 and private.crm_role(array['owner','sales','admin','marketing'])
 and (private.crm_role(array['owner','sales','admin']) or exists(select 1 from public.realtors r where r.assigned_to=uid and r.deleted_at is null));
$$;
revoke all on function private.crm_owner_name(uuid) from public;
grant execute on function private.crm_owner_name(uuid) to authenticated;
create or replace view public.realtor_directory with (security_invoker=true) as
 select r.id,r.first_name,r.last_name,r.email,r.phone,r.instagram,r.website,r.brokerage_id,
 r.primary_city,r.primary_area,r.secondary_areas,r.luxury_agent,r.relationship_status,r.lead_source_id,r.assigned_to,
 r.version,r.created_at,r.updated_at,r.deleted_at,r.search_vector,
 private.crm_brokerage_name(r.brokerage_id) brokerage_name,private.crm_owner_name(r.assigned_to) owner_name,s.name lead_source_name,
 a.first_contact_date,a.last_contact_date,a.next_followup_date,a.next_action
 from public.realtors r left join public.lead_sources s on s.id=r.lead_source_id
 left join lateral (
 select min(completed_at) filter(where type in ('call','email','instagram_dm','sms','meeting','consultation')) first_contact_date,
 max(completed_at) filter(where type in ('call','email','instagram_dm','sms','meeting','consultation')) last_contact_date,
 min(due_at) filter(where status='open') next_followup_date,
 (array_agg(title order by due_at,id) filter(where status='open'))[1] next_action
 from public.activities where realtor_id=r.id and deleted_at is null
 ) a on true;
create or replace function public.crm_mutate(p_input jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare op text:=p_input->>'op'; d jsonb:=coalesce(p_input->'data','{}'); rid uuid; aid uuid; record_id uuid;
 existing public.realtors; office public.brokerages; original public.activities; result jsonb; actor uuid:=auth.uid();
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
 elsif op in ('activity_complete','activity_cancel','activity_reschedule') then
  aid:=(p_input->>'id')::uuid;
  select realtor_id into rid from public.activities where id=aid;
  perform 1 from public.realtors where id=rid and deleted_at is null for update;
  if not found then raise exception 'Realtor is archived or unavailable.'; end if;
  select * into original from public.activities where id=aid;
  if op='activity_reschedule' and (nullif(trim(d->>'next_title'),'') is null or nullif(d->>'next_due_at','') is null) then
   raise exception 'A replacement action needs a title and date.' using errcode='23514';
  end if;
  update public.activities set status=case when op='activity_complete' then 'completed' else 'cancelled' end,
   completed_at=case when op='activity_complete' then now() else null end where id=aid and status='open' and deleted_at is null;
  if not found then raise exception 'This activity is no longer open. Reload the page.'; end if;
  if nullif(d->>'next_title','') is not null then
   insert into public.activities(realtor_id,type,title,description,due_at,assigned_to,priority,created_by,replaces_activity_id)
   values(rid,original.type,d->>'next_title',original.description,(d->>'next_due_at')::timestamptz,original.assigned_to,original.priority,actor,aid);
  end if;
  result:=jsonb_build_object('id',aid,'realtor_id',rid);
 elsif op in ('brokerage_save','source_save') then
  record_id:=coalesce(nullif(p_input->>'id','')::uuid,gen_random_uuid());
  if op='brokerage_save' then
   if nullif(p_input->>'id','') is not null then
    select * into office from public.brokerages where id=record_id for update;
    if not found or office.deleted_at is not null then raise exception 'Brokerage is archived or unavailable.' using errcode='42501'; end if;
    if p_input->>'version' is null or office.version<>(p_input->>'version')::integer then raise exception 'This record changed. Reload before saving.' using errcode='40001'; end if;
    update public.brokerages set name=trim(d->>'name'),office_name=nullif(trim(d->>'office_name'),''),website=nullif(d->>'website',''),
      phone=nullif(d->>'phone',''),address=nullif(d->>'address',''),city=nullif(d->>'city',''),province=coalesce(nullif(d->>'province',''),'BC'),
      postal_code=nullif(d->>'postal_code',''),notes=nullif(d->>'notes',''),version=version+1 where id=record_id;
   else
    insert into public.brokerages(id,name,office_name,website,phone,address,city,province,postal_code,notes)
    values(record_id,trim(d->>'name'),nullif(trim(d->>'office_name'),''),nullif(d->>'website',''),nullif(d->>'phone',''),nullif(d->>'address',''),nullif(d->>'city',''),coalesce(nullif(d->>'province',''),'BC'),nullif(d->>'postal_code',''),nullif(d->>'notes',''));
   end if;
  else
   if not private.crm_role(array['owner','admin']) then raise exception 'Only owner or admin can configure lead sources.' using errcode='42501'; end if;
   insert into public.lead_sources(id,name) values(record_id,trim(d->>'name')) on conflict(id) do update set name=excluded.name;
  end if;
  result:=jsonb_build_object('id',record_id);
 else raise exception 'Unsupported CRM operation.';
 end if;
 return result;
end; $$;
create or replace function public.crm_query(p_input jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
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
 elsif op='sources' then
  result:=jsonb_build_object('owners','[]'::jsonb,'sources',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from (select id,name from public.lead_sources order by name,id limit 500) s));
 elsif op='choices' then
  if not private.crm_role(array['owner','sales','admin']) then raise exception 'Operational roster access denied.' using errcode='42501'; end if;
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

revoke all on function public.crm_mutate(jsonb),public.crm_query(jsonb) from public,anon;
grant execute on function public.crm_mutate(jsonb),public.crm_query(jsonb) to authenticated;
commit;
