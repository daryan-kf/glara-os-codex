# Hosted Supabase acceptance — M1 hardening

**PENDING EXTERNAL ACCEPTANCE.** No hosted environment or credentials were configured for this run. PGlite and the HTTP contract double do not satisfy this gate.

Use a dedicated, disposable **hosted development project with fictional records only**. Record project reference, app URL, Git commit, UTC time, operator and each expected/actual result privately. Never record passwords, tokens, headers or raw private rows in Git.

## 1. Provision the hosted environment

1. Select a disposable Supabase project with no customer data.
2. Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local, using the publishable key, never service-role.
3. Apply the ordered migrations:
   ```sh
   supabase login
   supabase link --project-ref YOUR_DISPOSABLE_HOSTED_PROJECT_REF
   supabase db push
   supabase migration list
   ```
   Confirm all three migrations including 202609130002_m1_hardening.sql. Do not reset an existing environment. If needed, execute `NOTIFY pgrst, 'reload schema';` through trusted SQL administration.
4. Disable signups, set the exact Auth Site URL, install invite/recovery templates and configure SMTP following README.
5. Invite six fictional test identities through deliverable aliases in a domain you control: Owner, Sales, Admin, Marketing, Designer and Staging Crew. Add separate unassigned and archived-Sales negative-test identities. Do not use actual customer/employee accounts.
6. Assign each actual Auth UUID exactly one matching role through trusted administration:
   ```sql
   insert into public.user_roles(user_id,role)
   values ('REPLACE_WITH_ACTUAL_AUTH_UUID'::uuid,'owner')
   on conflict(user_id,role) do nothing;
   update public.profiles set display_name='Fictional Owner'
   where id='REPLACE_WITH_ACTUAL_AUTH_UUID'::uuid;
   ```
   Repeat for sales, admin, marketing, designer, staging_crew. Leave the unassigned identity without roles. Archive only the extra Sales profile through its deleted_at field.
7. Verify invitation delivery, password setup and login for each. Test recovery, expired links and reused links.
8. Run `npm run build` then `npm start` using the hosted configuration, or deploy a development preview with these same variables and its exact HTTPS origin.

## 2. Direct REST/PostgREST harness

Use PowerShell 7 with temporary process environment variables or a secret store:

- GLARA_ACCEPTANCE_URL and GLARA_ACCEPTANCE_KEY.
- GLARA_OWNER_EMAIL / GLARA_OWNER_PASSWORD.
- Equivalent SALES, ADMIN, MARKETING, DESIGNER and STAGING_CREW pairs.

Do not enable shell transcripts or print sessions. These helpers keep tokens in memory:

```powershell
$base=$env:GLARA_ACCEPTANCE_URL.TrimEnd('/')
$key=$env:GLARA_ACCEPTANCE_KEY
if ($base -notmatch '^https://[^/]+\.supabase\.co$' -or !$key) { throw 'Configure the disposable hosted project.' }
$sessions=@{}
foreach($role in @('owner','sales','admin','marketing','designer','staging_crew')) {
  $prefix='GLARA_'+$role.ToUpper()
  $email=[Environment]::GetEnvironmentVariable($prefix+'_EMAIL')
  $password=[Environment]::GetEnvironmentVariable($prefix+'_PASSWORD')
  if(!$email -or !$password) { throw "Missing fictional credentials for $role" }
  $requestParams=@{
    Method='Post'; Uri="$base/auth/v1/token?grant_type=password"
    Headers=@{apikey=$key}; ContentType='application/json'
    Body=(@{email=$email;password=$password}|ConvertTo-Json)
  }
  $sessions[$role]=Invoke-RestMethod @requestParams
}
function Call-Crm($role,$rpc,$inputData) {
  $requestParams=@{
    Method='Post'; Uri="$base/rest/v1/rpc/$rpc"
    Headers=@{apikey=$key;Authorization="Bearer $($sessions[$role].access_token)"}
    ContentType='application/json'
    Body=(@{p_input=$inputData}|ConvertTo-Json -Depth 10)
  }
  Invoke-RestMethod @requestParams
}
function Read-Table($role,$query) {
  Invoke-RestMethod -Uri "$base/rest/v1/$query" -Headers @{apikey=$key;Authorization="Bearer $($sessions[$role].access_token)"}
}
function Assert-CrmDenied($role,$rpc,$inputData,$expectedCode) {
  $denied=$false
  try { $null=Call-Crm $role $rpc $inputData }
  catch {
    $failure=$_.ErrorDetails.Message|ConvertFrom-Json
    if($failure.code -ne $expectedCode) { throw "Unexpected failure code for $role" }
    $denied=$true
  }
  if(!$denied) { throw "Unexpected success for $role" }
}
```

For a custom hosted domain, explicitly verify and adjust the URL guard. Do not substitute the local fixture endpoint.

## 3. Create fixtures and verify data permissions

```powershell
$label='Fictional Hardening '+[guid]::NewGuid().ToString('N').Substring(0,8)
$office=Call-Crm owner crm_mutate @{op='brokerage_save';data=@{name=$label}}
$data=@{
  first_name='Fictional';last_name=$label;assigned_to=$sessions.sales.user.id
  relationship_status='prospect';brokerage_id=$office.id
  notes='Fictional internal acceptance note';relationship_score='40'
  next_title='Fictional first call';next_due_at=[DateTimeOffset]::UtcNow.AddDays(1).ToString('o')
}
$realtor=Call-Crm sales crm_mutate @{op='realtor_create';data=$data}
$rid=$realtor.id
```

Run every matrix row; an empty RLS result is distinct from a denied SQL/RPC privilege.

| Identity / request                                                                  | Expected                                                                                |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Owner/Sales/Admin crm_query list, detail id=$rid, activities id=$rid, choices       | Operational records and active operational roster                                       |
| Marketing detail id=$rid                                                            | Safe contacts/status/brokerage/assigned display name, no notes/scores/listing estimates |
| Marketing sources                                                                   | Sources present, owners empty                                                           |
| Marketing choices                                                                   | 42501                                                                                   |
| Marketing direct profiles?select=id,display_name                                    | Own profile only                                                                        |
| Marketing direct user_roles?select=user_id,role                                     | Own assignment only                                                                     |
| Marketing direct realtor_private?select=_, activities?select=_, brokerages?select=* | Empty arrays                                                                            |
| Marketing CRM mutations                                                             | 42501                                                                                   |
| Designer/Crew crm_query list and crm_mutate realtor_create                          | 42501                                                                                   |
| Designer/Crew direct realtors?select=id                                             | Empty arrays                                                                            |
| Any ordinary authenticated identity direct POST/PATCH realtors or brokerages        | Permission denied; no direct table DML                                                  |
| No bearer Authorization, apikey only, table/RPC request                             | Denied; no records                                                                      |
| Unassigned / archived test identity                                                 | Application denied, CRM read/write denied                                               |

Example negative assertions:

```powershell
Assert-CrmDenied marketing crm_query @{op='choices'} '42501'
Assert-CrmDenied marketing crm_mutate @{op='realtor_create';data=$data} '42501'
foreach($role in @('designer','staging_crew')) {
  Assert-CrmDenied $role crm_query @{op='list'} '42501'
  Assert-CrmDenied $role crm_mutate @{op='realtor_create';data=$data} '42501'
  if(@(Read-Table $role 'realtors?select=id').Count -ne 0) { throw 'RLS leak' }
}
if(@(Read-Table marketing 'realtor_private?select=*').Count -ne 0) { throw 'Private-field leak' }
$visible=@(Read-Table marketing 'profiles?select=id')
if($visible.Count -ne 1 -or $visible[0].id -ne $sessions.marketing.user.id) { throw 'Roster leak' }
```

For direct POST/PATCH checks use the same bearer/apikey headers, a JSON body and the table REST URL instead of /rpc. Confirm 42501 and unchanged data.

Repeat create/edit as Owner, Sales and Admin with unique fictional labels. For edit, query detail.version, submit realtor_update with id/version and all intended editable fields. Remove next_title/next_due_at from edit data unless adding an action intentionally. Reuse an older version and confirm rejection. Test name/email/phone search, office/status/owner/source filters, pagination and empty results.

## 4. Follow-up, cancel and reschedule

1. Query activities with id=$rid and status=open; store its first row ID as $aid.
2. Cancel the last action with no replacement. Expect P0001 and unchanged open status.
3. Reschedule without replacement date. Expect 23514; invalid dates must also roll back.
4. Reschedule with a replacement title and new ISO timestamp. Verify original status=cancelled, completed_at=null, original due_at unchanged. New row must be open with new date, original type/assignee/priority/notes and replaces_activity_id=$aid.
5. Repeat reschedule on the cancelled ID: reject and create no extra row.
6. Cancel the replacement with a new title/date; confirm one new open replacement and preserved cancelled history.
7. Create a second task via activity_create with realtor_id, type=task, title, status=open, due_at and assigned_to. Cancel it without replacement; succeeds because another open action remains.
8. Complete an action while another open action remains; completed_at must be populated. Add a completed call and note; contact dates derive only from communication activity.
9. Compare activity and audit rows before/after failed mutations: no partial writes.

```powershell
$open=Call-Crm sales crm_query @{op='activities';id=$rid;status='open'}
$aid=$open.rows[0].id
Assert-CrmDenied sales crm_mutate @{op='activity_cancel';id=$aid;data=@{}} 'P0001'
$null=Call-Crm sales crm_mutate @{
  op='activity_reschedule';id=$aid
  data=@{next_title='Fictional rescheduled call';next_due_at=[DateTimeOffset]::UtcNow.AddDays(2).ToString('o')}
}
```

## 5. Realtor archive and restore

Read current detail.version, archive as Sales through realtor_archive. Confirm absence from active search/list/due queue and Sales/Marketing detail. Owner/Admin can still inspect preserved history. Sales restore must fail with 42501. Restore as Admin using current version; verify active data/history. Repeat recovery as Owner. A conflicting active email/phone must block restore without partial changes.

## 6. Brokerage protection and concurrency

1. Read crm_query brokerage with id=$office.id. Open its edit page in two tabs at the same version.
2. Save tab A; version increments once. Save tab B; stale message, no overwrite.
3. Repeat directly with brokerage_save using the same captured version, distinct names and two independent signed-in sessions. Submit close together: exactly one succeeds, the stale competitor returns 40001. Verify winning name/version. Missing version and nonexistent IDs must not upsert silently.
4. Archive this uniquely labelled office through **trusted SQL administration only**:
   ```sql
   update public.brokerages set deleted_at=now()
   where id='REPLACE_WITH_FICTIONAL_OFFICE_UUID'::uuid
     and name like 'Fictional%';
   ```
5. Sales, Admin and Owner each submit brokerage_save with the archived UUID and current version; also try crafted data.deleted_at=null. All return 42501. Name, notes, deleted_at and version remain unchanged; no extra successful-write audit entries.
6. The active edit route must not show the office. Do not add a restoration bypass.

## 7. Audit actors

As Owner, inspect direct audit_logs REST records filtered by entity/entity_id and select actor_id, action, old_value, new_value, created_at. Keep raw rows private.

- Actor equals the actual caller Auth UUID, not assigned owner or injected created_by.
- Original action UPDATE shows open → cancelled, no completed_at, unchanged due_at.
- Replacement INSERT has the explicit replaces_activity_id link.
- Realtor archive/restore, private-context changes and brokerage version changes are present.
- Failed transactions leave no committed change/audit.
- Sales/Admin/Marketing cannot read owner-only audit records.
- Trusted SQL fixture archival has null actor; distinguish it from authenticated app changes.

## 8. Browser and Auth/session checks

Use separate browser profiles for six identities, or fully sign out between them.

| Role                | Expected workflow                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Owner/Sales/Admin   | Create/edit Realtor, note/call, follow-up, last-action rejection, reschedule, cancel with replacement, archive      |
| Owner/Admin         | Archived-only view, restore, source maintenance                                                                     |
| Sales               | No restore/source maintenance                                                                                       |
| Marketing           | Safe directory/profile and sources; no operational owner picker/roster/private context/writes; /realtors/new denied |
| Designer/Crew       | /realtors and CRM API denied                                                                                        |
| Archived/unassigned | Workspace CRM denied                                                                                                |

Repeat cancel/reschedule on mobile. Check labels, touch targets, viewport fit, cancelled history and original dates.

1. Reload signed-in pages and navigate CRM.
2. Allow an access token to expire under the development project's expiry setting; verify SSR refresh maintains the legitimate session and role scope.
3. Direct refresh: POST /auth/v1/token?grant_type=refresh_token with apikey and JSON refresh_token from the session. Store the response in memory and verify new-session role enforcement; never print tokens.
4. Sign out through Glara. Reload /realtors: redirect to login. Separately revoke REST sessions using POST /auth/v1/logout with their bearer headers.
5. Verify Auth /user no longer recognizes the logged-out session. Supabase PostgREST access JWTs may remain valid until expiry; do not claim immediate database JWT revocation. Test urgent access removal by archiving the separate test profile/removing roles and confirming RLS denies its still-unexpired token.
6. Confirm HttpOnly/SameSite Lax cookies and Secure on HTTPS.

Optional existing live Auth suite (configure .env.local first):

```powershell
$env:E2E_LIVE='1'
$env:E2E_EMAIL=$env:GLARA_OWNER_EMAIL
$env:E2E_PASSWORD=$env:GLARA_OWNER_PASSWORD
$env:PLAYWRIGHT_CHANNEL='chrome'
npm run test:e2e
```

Live mode skips isolated CRM fixture tests. This command alone does not complete six-role/direct REST/lifecycle acceptance; skipped tests are not passes.

## 9. Release decision

Mark hosted PASS only after all required steps were actually run and evidence reviewed. Record failures and rerun affected checks after fixes. Until then retain **PENDING EXTERNAL ACCEPTANCE** and withhold release/M2 readiness approval.

Retain or retire only the disposable fixtures/project as agreed. Do not delete unrelated records. Close sessions and remove temporary credentials. No passwords/tokens/private row dumps belong in Git.
