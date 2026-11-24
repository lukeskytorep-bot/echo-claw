param(
  [ValidateSet('local-link','git')][string]$Source = 'local-link',
  [string]$GitRef = '',
  [switch]$ForceConflicts,
  [switch]$AcceptCapabilities
)
$ErrorActionPreference = 'Stop'
if (-not $AcceptCapabilities) { Write-Error 'Review openclaw.plugin.json capabilities, then rerun with -AcceptCapabilities.'; exit 2 }
$Root = Split-Path -Parent $PSScriptRoot
Write-Host 'ECHO-4 preflight...'
node "$PSScriptRoot/echo4-install.mjs" preflight --json
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'ECHO-4 install plan...'
node "$PSScriptRoot/echo4-install.mjs" plan --json
if ($LASTEXITCODE -ne 0 -and -not $ForceConflicts) { exit $LASTEXITCODE }
$argsList = @("$PSScriptRoot/echo4-install.mjs", 'install', '--source', $Source, '--accept-capabilities', '--json')
if ($GitRef) { $argsList += @('--git-ref', $GitRef) }
if ($ForceConflicts) { $argsList += '--force-conflicts' }
node @argsList
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
Write-Host 'Install complete. Start or restart the OpenClaw Gateway if needed, then run:'
Write-Host "  node `"$PSScriptRoot/echo4-host-self-test.mjs`""
