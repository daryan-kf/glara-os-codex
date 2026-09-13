begin;
-- Business version conflicts must not trigger PostgREST serialization retries.
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
    if p_input->>'version' is null or office.version<>(p_input->>'version')::integer then raise exception 'This record changed. Reload before saving.' using errcode='PT409'; end if;
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
commit;
