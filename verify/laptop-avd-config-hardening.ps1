# laptop-avd-config-hardening.ps1 -- F4 fix for the emulator AVD on the laptop.
#
# Problem (measured 2026-10-14, see verify/INFRA-F4-F5-F6-2026-10-14.md):
#   dsh-p16.avd/config.ini contains BOTH the stock definition and our CSS360
#   override, i.e. the same three keys twice:
#       L83  hw.lcd.density = 420      <- stock
#       L85  hw.lcd.height  = 2400     <- stock
#       L88  hw.lcd.width   = 1080     <- stock
#       L141 hw.lcd.width=1440         <- our CSS360 override
#       L142 hw.lcd.height=3168
#       L143 hw.lcd.density=640
#   The emulator currently resolves this by last-wins, so the CSS360 geometry
#   works today -- but it is order-dependent: any tool that normalises or
#   rewrites config.ini (the emulator itself rewrites it on some boots) can
#   collapse the duplicates and silently drop us back to 1080x2400, which would
#   invalidate the whole CSS360 baseline. Also hw.gpu.enabled = no contradicts
#   the standing "always real GPU" mandate (it is currently masked by the
#   explicit `-gpu host` on the self-heal command line, which is equally
#   fragile).
#
# What this does (minimal, auditable):
#   1. backup config.ini
#   2. for hw.lcd.width / hw.lcd.height / hw.lcd.density: keep ONLY the last
#      occurrence of each key (the CSS360 values), drop the earlier duplicates
#   3. hw.gpu.enabled = no  ->  hw.gpu.enabled = yes
#   4. verify: exactly one of each key, with 1440 / 3168 / 640
#   5. print a before/after summary; NO restart of anything
#
# Takes effect on the next cold start of the AVD (the self-heal ladder applies it
# the next time it recreates the instance). This script never starts or stops the
# emulator, so it cannot disturb a running QA session.
#
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File laptop-avd-config-hardening.ps1 [-DryRun]
param([switch]$DryRun)
$ErrorActionPreference = 'Stop'

$ini = "$env:USERPROFILE\.android\avd\dsh-p16.avd\config.ini"
if (-not (Test-Path $ini)) { Write-Host "ERROR: config.ini not found: $ini"; exit 2 }

$keys = @('hw.lcd.width', 'hw.lcd.height', 'hw.lcd.density')
$want = @{ 'hw.lcd.width' = '1440'; 'hw.lcd.height' = '3168'; 'hw.lcd.density' = '640' }

$raw = [System.IO.File]::ReadAllText($ini)
$eol = if ($raw -match "`r`n") { "`r`n" } else { "`n" }
$lines = [System.Collections.Generic.List[string]]::new()
foreach ($l in ($raw -split "`r?`n")) { $lines.Add($l) }

function Get-Key([string]$line) {
  $m = [regex]::Match($line, '^\s*([A-Za-z0-9._]+)\s*=')
  if ($m.Success) { return $m.Groups[1].Value } else { return $null }
}

Write-Host "== before =="
$before = @{}
foreach ($k in $keys) {
  $idx = @()
  for ($i = 0; $i -lt $lines.Count; $i++) { if ((Get-Key $lines[$i]) -eq $k) { $idx += $i } }
  $before[$k] = $idx
  $vals = $idx | ForEach-Object { ($lines[$_] -split '=', 2)[1].Trim() }
  Write-Host ("   " + $k.PadRight(16) + " occurrences=" + $idx.Count + " values=[" + ($vals -join ', ') + "] lines=[" + (($idx | ForEach-Object { $_ + 1 }) -join ', ') + "]")
}
$gpuLine = -1
for ($i = 0; $i -lt $lines.Count; $i++) { if ((Get-Key $lines[$i]) -eq 'hw.gpu.enabled') { $gpuLine = $i } }
if ($gpuLine -ge 0) { Write-Host ("   hw.gpu.enabled   -> [" + $lines[$gpuLine].Trim() + "]") } else { Write-Host "   hw.gpu.enabled   -> (absent)" }

# work out exactly what changes
$drop = New-Object System.Collections.Generic.List[int]
foreach ($k in $keys) {
  $idx = @($before[$k])
  if ($idx.Count -lt 2) { continue }
  # keep the last, drop the rest
  for ($j = 0; $j -lt ($idx.Count - 1); $j++) { $drop.Add([int]$idx[$j]) }
}
$needGpu = ($gpuLine -ge 0) -and ($lines[$gpuLine] -notmatch '=\s*yes\s*$')

Write-Host ""
Write-Host "== plan =="
if ($drop.Count -eq 0) { Write-Host "   duplicate LCD keys: none to drop" }
else { Write-Host ("   drop " + $drop.Count + " stale LCD line(s): " + (($drop | Sort-Object | ForEach-Object { 'L' + ($_ + 1) }) -join ', ')) }
if ($needGpu) { Write-Host ("   rewrite L" + ($gpuLine + 1) + ": hw.gpu.enabled = no -> yes") } else { Write-Host "   hw.gpu.enabled: already yes or absent" }

if ($drop.Count -eq 0 -and -not $needGpu) { Write-Host ""; Write-Host "NOTHING TO DO - config.ini is already hardened."; exit 0 }
if ($DryRun) { Write-Host ""; Write-Host "DRY RUN - no file was modified."; exit 0 }

# backup
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$bak = "$ini.bak-f4-$stamp"
Copy-Item $ini $bak
Write-Host ""
Write-Host ("backup: " + $bak)

# apply
$out = New-Object System.Collections.Generic.List[string]
for ($i = 0; $i -lt $lines.Count; $i++) {
  if ($drop.Contains($i)) { continue }
  if ($needGpu -and $i -eq $gpuLine) {
    $out.Add('hw.gpu.enabled = yes')
    continue
  }
  $out.Add($lines[$i])
}
[System.IO.File]::WriteAllText($ini, (($out -join $eol) + $eol), (New-Object System.Text.UTF8Encoding($false)))

# verify
Write-Host ""
Write-Host "== after =="
$raw2 = [System.IO.File]::ReadAllText($ini)
$lines2 = @($raw2 -split "`r?`n")
$ok = $true
foreach ($k in $keys) {
  $idx = @()
  for ($i = 0; $i -lt $lines2.Count; $i++) { if ((Get-Key $lines2[$i]) -eq $k) { $idx += $i } }
  $vals = @($idx | ForEach-Object { ($lines2[$_] -split '=', 2)[1].Trim() })
  $good = ($idx.Count -eq 1) -and ($vals.Count -eq 1) -and ($vals[0] -eq $want[$k])
  if (-not $good) { $ok = $false }
  Write-Host ("   " + $k.PadRight(16) + " occurrences=" + $idx.Count + " value=[" + ($vals -join ', ') + "] want=" + $want[$k] + "  " + $(if ($good) { 'OK' } else { 'BAD' }))
}
$g2 = @()
for ($i = 0; $i -lt $lines2.Count; $i++) { if ((Get-Key $lines2[$i]) -eq 'hw.gpu.enabled') { $g2 += $lines2[$i].Trim() } }
Write-Host ("   hw.gpu.enabled   -> [" + ($g2 -join ', ') + "]  " + $(if (($g2.Count -eq 1) -and ($g2[0] -match 'yes')) { 'OK' } else { 'BAD' }))
if (-not (($g2.Count -eq 1) -and ($g2[0] -match 'yes'))) { $ok = $false }
Write-Host ("   line count: " + $lines.Count + " -> " + $lines2.Count)

Write-Host ""
if ($ok) {
  Write-Host "VERDICT: PASS - the AVD config now carries exactly one of each LCD key (CSS360) and hw.gpu.enabled=yes."
  Write-Host "NOTE: takes effect on the next COLD START of the AVD. This script did not touch the running emulator."
  Write-Host ("ROLLBACK: Copy-Item `"" + $bak + "`" `"" + $ini + "`" -Force")
  exit 0
}
Write-Host "VERDICT: FAIL - verification did not pass; restore the backup above."
exit 3
