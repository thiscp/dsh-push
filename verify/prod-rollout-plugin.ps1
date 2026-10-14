# prod-rollout-plugin.ps1 - production rollout for the dsh-push-host companion plugin
# on THIS desktop host (the one whose DSH Web runs the agent).
#
# Why a script: the 0.2.0 rollout was done by hand and shipped a plugin that
# rewrote the production profile on boot (P0, 2026-10-14). Every step below is
# snapshot-first, backed up, and re-verified against the snapshot afterwards.
#
# ASCII only. Run with:
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File prod-rollout-plugin.ps1 -Check
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File prod-rollout-plugin.ps1 -Install -Tarball <path>
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File prod-rollout-plugin.ps1 -DispatchRestart
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File prod-rollout-plugin.ps1 -Verify
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File prod-rollout-plugin.ps1 -Rollback
param(
  [switch]$Check,
  [switch]$Install,
  [switch]$DispatchRestart,
  [switch]$Verify,
  [switch]$Rollback,
  [string]$Tarball = 'F:\work\work_dsh\dsh-push\host-plugin\dsh-push-host-0.2.1.tgz',
  [string]$ExpectedPatchSha = 'D8F12BC0ED0962126D45DA8EC9CDFFA8128DAA5411E07CA683DFDE79E0563731',
  [string]$ExpectedVersion = '0.2.1'
)
$ErrorActionPreference = 'Stop'

$DshCli     = 'D:\programs\dsh\resources\runtime\cli\bin\dsh.cmd'
$ProfileDir = Join-Path $env:USERPROFILE '.dsh\profiles\web'
$Patch      = Join-Path $ProfileDir 'cordis.patch.yml'
$PkgJson    = Join-Path $ProfileDir 'package.json'
$PluginDir  = Join-Path $ProfileDir 'node_modules\dsh-push-host'
$WebLog     = Join-Path $env:USERPROFILE '.dsh\web.log'
$StateFile  = 'F:\work\work_dsh\tmp\prod-rollout-state.json'
$Runbook    = 'F:\work\work_dsh\dsh-push\verify\RUNBOOK-plugin-0.2.1-rollout.md'
$RestartOnce = 'C:\Users\<user>\Documents\cp_learn_win\deepseek-harness\dsh-net-restart-once.ps1'

function Say($m) { Write-Host $m }
function Fail($m) { Write-Host ("ERROR: " + $m); exit 2 }

function Get-Sha($path) {
  if (-not (Test-Path $path)) { return 'missing' }
  return (Get-FileHash $path -Algorithm SHA256).Hash
}

# The running DSH process holds web.log open; File.ReadAllLines (FileShare.Read)
# throws "being used by another process". Open with FileShare.ReadWrite instead,
# and never let a read failure abort the verification.
function Read-SharedLines($path) {
  if (-not (Test-Path $path)) { return @() }
  $fs = $null
  try {
    $fs = [System.IO.File]::Open($path, [System.IO.FileMode]::Open,
                                 [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    $sr = New-Object System.IO.StreamReader($fs)
    $text = $sr.ReadToEnd()
    $sr.Dispose()
    return @($text -split "`r?`n")
  } catch {
    Write-Host ("WARN: cannot read " + $path + " (" + $_.Exception.Message + ")")
    return @()
  } finally {
    if ($fs) { $fs.Dispose() }
  }
}
function Get-LogLines($path) {
  return (Read-SharedLines $path).Count
}
function Get-PatchLineCount($path) {
  return (Read-SharedLines $path).Count
}
function Get-NewLogWindow([int]$offset) {
  $lines = @(Read-SharedLines $WebLog)
  if ($lines.Count -le $offset) { return @() }
  return @($lines[$offset..($lines.Count - 1)])
}
function Get-PortOwner() {
  $c = Get-NetTCPConnection -State Listen -LocalPort 3081 -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($c) { return [int]$c.OwningProcess }
  return 0
}
function Get-PluginVersion() {
  $f = Join-Path $PluginDir 'package.json'
  if (-not (Test-Path $f)) { return 'not installed' }
  return (([System.IO.File]::ReadAllText($f)) | ConvertFrom-Json).version
}
function Get-BackupCount() {
  return @(Get-ChildItem -Path $ProfileDir -Filter 'cordis.patch.yml.bak-*' -ErrorAction SilentlyContinue).Count
}

function Take-Snapshot([string]$reason) {
  $state = [ordered]@{
    takenAt        = (Get-Date).ToString('s')
    reason         = $reason
    patchSha       = Get-Sha $Patch
    patchLines     = Get-PatchLineCount $Patch
    pkgJsonSha     = Get-Sha $PkgJson
    backupCount    = Get-BackupCount
    pluginVersion  = Get-PluginVersion
    portOwner      = Get-PortOwner
    webLogLines    = Get-LogLines $WebLog
  }
  $state | ConvertTo-Json | Set-Content -LiteralPath $StateFile -Encoding UTF8
  return $state
}
function Load-Snapshot() {
  if (-not (Test-Path $StateFile)) { Fail "no snapshot at $StateFile - run -Check or -Install first" }
  return ([System.IO.File]::ReadAllText($StateFile) | ConvertFrom-Json)
}
function Save-PostInstallNote() {
  $pre = Load-Snapshot
  $note = [ordered]@{
    preInstallPatchSha   = $pre.patchSha
    postInstallPatchSha  = Get-Sha $Patch
    patchChangedByInstall = ((Get-Sha $Patch) -ne $pre.patchSha)
    installedVersion     = Get-PluginVersion
    installAt            = (Get-Date).ToString('s')
  }
  $note | ConvertTo-Json | Set-Content -LiteralPath ($StateFile + '.install.json') -Encoding UTF8
}

# ---------------------------------------------------------------- -Check
if ($Check) {
  Say '== production pre-flight (read-only) =='
  Say ("dsh cli    : " + $DshCli + "  exists=" + (Test-Path $DshCli))
  Say ("profile dir: " + $ProfileDir + "  exists=" + (Test-Path $ProfileDir))
  Say ("patch sha  : " + (Get-Sha $Patch))
  Say ("expected   : " + $ExpectedPatchSha)
  $patchOk = ((Get-Sha $Patch) -eq $ExpectedPatchSha)
  Say ("patch match: " + $patchOk)
  Say ("plugin ver : " + (Get-PluginVersion))
  Say ("backups    : " + (Get-BackupCount))
  Say ("port owner : " + (Get-PortOwner))
  Say ("web.log    : " + (Get-LogLines $WebLog) + " lines")
  Say ("tarball    : " + $Tarball + "  exists=" + (Test-Path $Tarball))
  if (Test-Path $Tarball) { Say ("tarball sha: " + (Get-Sha $Tarball)) }
  $modeTimed = (Select-String -LiteralPath $Patch -Pattern 'mode: timed' -SimpleMatch | Measure-Object).Count
  $modeLegacy = (Select-String -LiteralPath $Patch -Pattern 'mode: legacy' -SimpleMatch | Measure-Object).Count
  Say ("patch mode : timed=" + $modeTimed + " legacy=" + $modeLegacy)
  Say ("runbook    : " + $Runbook)
  if (-not $patchOk) {
    Say ''
    Say 'WARNING: the production patch file does NOT match the expected hash.'
    Say '         Do not install until you know why (see runbook section 0).'
  }
  $s = Take-Snapshot 'check'
  Say ("snapshot written: " + $StateFile)
  exit 0
}

# ---------------------------------------------------------------- -Install
if ($Install) {
  if (-not (Test-Path $Tarball)) { Fail "tarball not found: $Tarball" }
  Say '== step 1/3: snapshot + backups =='
  $pre = Take-Snapshot 'pre-install'
  Say ("patch sha  : " + $pre.patchSha)
  if ($pre.patchSha -ne $ExpectedPatchSha) { Fail ("patch sha != expected (" + $ExpectedPatchSha + ") - aborting") }
  $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
  Copy-Item $Patch   "$Patch.prodroll-$stamp"   -Force
  Copy-Item $PkgJson "$PkgJson.prodroll-$stamp" -Force
  Say ("backups    : " + "$Patch.prodroll-$stamp")
  Say ("             " + "$PkgJson.prodroll-$stamp")

  Say '== step 2/3: install the plugin =='
  if (Test-Path $PluginDir) {
    Remove-Item -Recurse -Force $PluginDir
    Say 'removed old node_modules\dsh-push-host (same-version re-add is a no-op otherwise)'
  }
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  & $DshCli plugin --profile web add $Tarball 2>&1 | Select-Object -Last 4 | ForEach-Object { Say ("  " + $_) }
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($code -ne 0) { Fail "dsh plugin add failed (exit $code)" }
  $ver = Get-PluginVersion
  Say ("installed  : version=" + $ver + " client.js=" + (Test-Path (Join-Path $PluginDir 'lib\client.js')))
  if ($ver -ne $ExpectedVersion) { Fail ("installed version " + $ver + " != expected " + $ExpectedVersion) }

  Say '== step 3/3: post-install state (restart NOT yet dispatched) =='
  Say ("patch sha  : " + (Get-Sha $Patch) + "  (pre-install: " + $pre.patchSha + ")")
  Say ("backups    : " + (Get-BackupCount) + "  (pre-install: " + $pre.backupCount + ")")
  Save-PostInstallNote
  Say ''
  Say 'READY. Next: send the user the token note, then dispatch the restart:'
  Say '  powershell.exe -NoProfile -ExecutionPolicy Bypass -File prod-rollout-plugin.ps1 -DispatchRestart'
  Say 'The restart ends the current turn (expected) and changes the web token.'
  exit 0
}

# ---------------------------------------------------------------- -DispatchRestart
if ($DispatchRestart) {
  Say '== dispatching the one-shot restart (this turn will be cut) =='
  if (-not (Test-Path $RestartOnce)) { Fail "restart script not found: $RestartOnce" }
  $argStr = '-NoProfile -ExecutionPolicy Bypass -File "' + $RestartOnce + '"'
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argStr
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERNAME" -LogonType S4U -RunLevel Limited
  Register-ScheduledTask -TaskName 'DshNetRestartOnce' -Action $action -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName 'DshNetRestartOnce'
  Say ("dispatched at " + (Get-Date -Format 'HH:mm:ss'))
  exit 0
}

# ---------------------------------------------------------------- -Verify
if ($Verify) {
  $pre = Load-Snapshot
  Say '== post-restart verification against the pre-install snapshot =='
  Say ("snapshot taken : " + $pre.takenAt + "  (" + $pre.reason + ")")
  $sha = Get-Sha $Patch
  $baks = Get-BackupCount
  $port = Get-PortOwner
  $ver = Get-PluginVersion
  $window = Get-NewLogWindow ([int]$pre.webLogLines)
  $switchLines = @($window | Select-String -Pattern '手机作答模式' -SimpleMatch).Count
  $skipErr = @($window | Select-String -Pattern 'skipping profile bundle' -SimpleMatch | Select-String -Pattern 'dsh-push-host' -SimpleMatch).Count
  $loadMarkers = @($window | Select-String -Pattern 'relay ready|relay disabled|credentials file').Count
  $merged = ($window -join "`n")
  $legacyWritten = $merged -match 'mode: legacy'
  $pkgHasPlugin = ([System.IO.File]::ReadAllText($PkgJson)) -match 'dsh-push-host'

  Say ("patch sha           : " + $sha)
  Say ("expected (pre)      : " + $pre.patchSha)
  Say ("patch unchanged     : " + ($sha -eq $pre.patchSha))
  Say ("backups before/now  : " + $pre.backupCount + " / " + $baks)
  Say ("no new plugin .bak  : " + ($baks -eq [int]$pre.backupCount))
  Say ("port owner before/now: " + $pre.portOwner + " / " + $port + "  (changed = real restart)")
  Say ("plugin version      : " + $ver)
  Say ("positive load marks : " + $loadMarkers + "  (0 = plugin did NOT load)")
  Say ("switch log lines    : " + $switchLines + "  (must be 0)")
  Say ("dangling bundle err : " + $skipErr + "  (must be 0)")
  Say ("plugin wired in pkg : " + $pkgHasPlugin + "  (expected True: installed plugin)")

  $ok = ($sha -eq $pre.patchSha) -and ($baks -eq [int]$pre.backupCount) -and ($switchLines -eq 0) -and
        ($skipErr -eq 0) -and ($loadMarkers -ge 1) -and ($port -ne $pre.portOwner) -and ($ver -eq $ExpectedVersion)
  Say ''
  if ($ok) {
    Say 'VERDICT: PASS - the upgraded plugin wrote nothing on boot; production patch is byte-identical.'
  } else {
    Say 'VERDICT: FAIL - do NOT proceed; investigate with the runbook rollback section.'
  }
  $tokenLine = (Select-String -Path $WebLog -Pattern 'dsh web: http' | Select-Object -Last 1)
  if ($tokenLine) { Say ("web link            : " + $tokenLine.Line) }
  exit $(if ($ok) { 0 } else { 3 })
}

# ---------------------------------------------------------------- -Rollback
if ($Rollback) {
  $cands = @(Get-ChildItem -Path $ProfileDir -Filter 'cordis.patch.yml.prodroll-*' -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending)
  if ($cands.Count -eq 0) { Fail 'no prodroll backup found - nothing to roll back to' }
  $patchBak = $cands[0].FullName
  $pkgBak = $patchBak -replace 'cordis\.patch\.yml\.prodroll-', 'package.json.prodroll-'
  Say '== rollback =='
  Copy-Item $patchBak $Patch -Force
  Say ("patch restored from " + $patchBak + " -> " + (Get-Sha $Patch))
  if (Test-Path $pkgBak) {
    Copy-Item $pkgBak $PkgJson -Force
    Say ("package.json restored from " + $pkgBak)
  } else {
    Say ("WARNING: no matching package.json backup (" + $pkgBak + ")")
  }
  if (Test-Path $PluginDir) { Remove-Item -Recurse -Force $PluginDir; Say 'plugin removed from node_modules' }
  Say ''
  Say 'Rollback staged. Restart to clear the in-memory state:'
  Say '  powershell.exe -NoProfile -ExecutionPolicy Bypass -File prod-rollout-plugin.ps1 -DispatchRestart'
  Say 'Then re-run -Check to confirm the patch hash is back to the expected value.'
  exit 0
}

Say 'usage: -Check | -Install [-Tarball <path>] | -DispatchRestart | -Verify | -Rollback'
Say ('runbook: ' + $Runbook)
exit 2
