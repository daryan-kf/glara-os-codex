param([string]$EvidencePath = '.acceptance/m10/restore-result.json')
$ErrorActionPreference='Stop'
$workspaceRoot=(Resolve-Path '.').Path
$evidence=Get-Content -Raw -LiteralPath $EvidencePath | ConvertFrom-Json
if ($evidence.mode -ne 'isolated_restore' -or $evidence.production_modified -or $evidence.shared_development_modified) {throw 'Only an isolated fictional restore artifact is permitted'}
$backup=Get-ChildItem -LiteralPath '.acceptance/m10' -Filter 'fictional-restore-*.zip' | Where-Object {(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() -eq $evidence.backup_sha256} | Select-Object -First 1
if (-not $backup -or -not $backup.FullName.StartsWith($workspaceRoot+[IO.Path]::DirectorySeparatorChar)) {throw 'Verified workspace backup not found'}
Add-Type -AssemblyName System.Security.Cryptography.ProtectedData
$plain=[IO.File]::ReadAllBytes($backup.FullName)
$protected=[Security.Cryptography.ProtectedData]::Protect($plain,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
$destination=$backup.FullName+'.dpapi'
[IO.File]::WriteAllBytes($destination,$protected)
$identity=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl=[Security.AccessControl.FileSecurity]::new()
$acl.SetOwner($identity)
$acl.SetAccessRuleProtection($true,$false)
foreach($sid in @($identity,[Security.Principal.SecurityIdentifier]::new('S-1-5-18'))) {$acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid,[Security.AccessControl.FileSystemRights]::FullControl,[Security.AccessControl.AccessControlType]::Allow))}
Set-Acl -LiteralPath $destination -AclObject $acl
$roundtrip=[Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($destination),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)
$hash=[Convert]::ToHexString([Security.Cryptography.SHA256]::HashData($roundtrip)).ToLowerInvariant()
if($hash -ne $evidence.backup_sha256){throw 'Protected backup integrity failed'}
$tampered=$protected.Clone();$tampered[$tampered.Length-1]=$tampered[$tampered.Length-1] -bxor 1
$rejected=$false
try{[void][Security.Cryptography.ProtectedData]::Unprotect($tampered,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)}catch{$rejected=$true}
if(-not $rejected){throw 'Tampered backup accepted'}
$actual=Get-Acl -LiteralPath $destination
if(-not $actual.AreAccessRulesProtected -or @($actual.Access).Count -ne 2){throw 'Restricted ACL verification failed'}
[Array]::Clear($plain);[Array]::Clear($roundtrip)
@{executed_at=[DateTime]::UtcNow.ToString('o');environment='isolated_restore';status='PASSED';encryption='Windows DPAPI CurrentUser';backup_sha256=$hash;roundtrip_integrity='passed';tamper_rejection='passed';inherited_acl=$false;authorized_principals=2;production_store_configured=$false;independent_operator_recovery='M10B external prerequisite';raw_source_retained_for_isolated_drill=$true} | ConvertTo-Json | Set-Content -LiteralPath '.acceptance/m10/protected-backup.json'
Write-Output 'Isolated backup encryption, restricted file ACL, round-trip and tamper rejection passed.'
