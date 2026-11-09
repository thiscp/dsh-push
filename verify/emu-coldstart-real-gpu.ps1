# emu-coldstart-real-gpu.ps1 -- cold-start the laptop AVD on the REAL GPU (not swiftshader).
#
# WHY this exists (2026-10-14): the documented cold-start recipe used the scheduled
# task `dsh-emu-sw`, whose command file hardcodes
#     -gpu swiftshader_indirect
# i.e. the recipe itself started a CPU-rendered instance -- directly against the
# standing mandate "the emulator always runs on the real GPU" (and against F2 in
# the hardened self-heal, which treats software rendering as a VIOLATION).
#
# Measured launcher matrix on the laptop (2026-10-14 20:4x):
#   dsh-emu        -> run-emu.cmd      -gpu host                  (Interactive logon: needs a console session)
#   dsh-emu-sw     -> run-emu-sw.cmd   -gpu swiftshader_indirect  <-- CPU, avoid
#   emu-selfheal   -> emu-selfheal.cmd  every 5 min, Highest, Boot+Logon+Time triggers  <-- authoritative
#   emu-selfheal-svc -> emu-selfheal.cmd -SshdOnly  (S4U, Highest)
#   emu-ladder-rung -> emu-ladder-rung.cmd  one-shot, reads G:\Android\emu-ladder.gpu
#
# The hardened self-heal deliberately does NOT go through the legacy tasks
# (verify/laptop-emu-selfheal.hardened.ps1 lines 269-277: those redirect into
# emu-out.txt/emu-err.txt and a ghost process can keep those files locked). So the
# RIGHT cold start is: let the self-heal ladder do it, with the selector pinned to
# `host`. This script does exactly that and nothing else.
#
# What it does:
#   1. (optional -Kill) kill emulator/qemu + clear AVD locks
#   2. pin G:\Android\emu-ladder.gpu = host     (so rung 1 is the real GPU)
#   3. run emu-selfheal.cmd once (synchronously) -> ladder starts rung 1
#   4. poll adb until boot_completed=1
#   5. assert the renderer is NVIDIA (fails loudly on SwiftShader)
#   6. print geometry; re-apply 1440x3168@640 only if it was lost
#
# ASCII only. It never writes to the AVD config and never edits the self-heal script.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File emu-coldstart-real-gpu.ps1 -Kill
#   powershell -NoProfile -ExecutionPolicy Bypass -File emu-coldstart-real-gpu.ps1 -Status
param(
  [switch]$Kill,
  [switch]$Status,
  [int]$BootSec = 300
)
$ErrorActionPreference = 'Continue'

$ADB    = 'G:\Android\Sdk\platform-tools\adb.exe'
$SELFH  = 'G:\Android\emu-selfheal.cmd'
$SEL    = 'G:\Android\emu-ladder.gpu'
$AVD    = Join-Path $env:USERPROFILE '.android\avd\dsh-p16.avd'
$WANT_W = '1440'; $WANT_H = '3168'; $WANT_D = '640'

function Line($m) { Write-Host ("[cold] " + $m) }
function Fail($m) { Write-Host ("[cold] FAIL: " + $m); exit 3 }

function Get-Renderer {
  if (-not (Test-Path $ADB)) { return '' }
  $out = (& $ADB shell dumpsys SurfaceFlinger 2>$null | Select-String -Pattern '^GLES:' | Select-Object -First 1)
  if ($out) { return $out.Line.Trim() } else { return '' }
}
function Get-Selector {
  if (Test-Path $SEL) { return (Get-Content $SEL -Raw).Trim() } else { return '(absent)' }
}
function Get-Qemu {
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
    Where-Object { $_.Name -match '^qemu-system' } | Select-Object -First 1
}

if ($Status) {
  Write-Host "== cold-start status (read-only) =="
  Write-Host ("  selector emu-ladder.gpu : " + (Get-Selector))
  $q = Get-Qemu
  if ($q) {
    $gpu = ''; if ($q.CommandLine -match '-gpu\s+(\S+)') { $gpu = $matches[1] }
    Write-Host ("  qemu                    : pid=" + $q.ProcessId + " -gpu " + $gpu)
  } else { Write-Host "  qemu                    : not running" }
  $boot = ''; if (Test-Path $ADB) { $boot = ((& $ADB shell getprop sys.boot_completed 2>$null) -join '').Trim() }
  Write-Host ("  sys.boot_completed      : " + $boot)
  $r = Get-Renderer
  Write-Host ("  renderer                : " + $(if ($r) { $r } else { '(unreadable)' }))
  if (Test-Path $ADB) {
    Write-Host ("  wm size                 : " + (((& $ADB shell wm size 2>$null) -join ' ').Trim()))
    Write-Host ("  wm density              : " + (((& $ADB shell wm density 2>$null) -join ' ').Trim()))
  }
  Write-Host ("  self-heal script sha256 : " + (Get-FileHash 'G:\Android\emu-selfheal.ps1' -Algorithm SHA256).Hash)
  Write-Host "  NOTE: task dsh-emu-sw hardcodes -gpu swiftshader_indirect; do NOT use it for a cold start."
  exit 0
}

Write-Host "== cold start on the REAL GPU =="

if ($Kill) {
  Line "killing emulator/qemu"
  Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'qemu|emulator' } | ForEach-Object {
    Write-Host ("  KILL " + $_.ProcessName + " " + $_.Id)
    taskkill /F /T /PID $_.Id 2>&1 | Out-Null
  }
  Start-Sleep -Seconds 10
  foreach ($lk in @('hardware-qemu.ini.lock', 'multiinstance.lock')) {
    $p = Join-Path $AVD $lk
    if (Test-Path -LiteralPath $p) {
      Remove-Item -LiteralPath $p -Recurse -Force -ErrorAction SilentlyContinue
      Write-Host ("  CLEANED " + $lk)
    }
  }
}

# Pin the ladder selector to the real GPU so rung 1 is -gpu host.
$prevSel = Get-Selector
if ($prevSel -ne 'host') {
  Set-Content -LiteralPath $SEL -Value 'host' -Encoding ASCII -Force
  Line ("selector: '" + $prevSel + "' -> 'host'")
} else {
  Line "selector already 'host'"
}

if (-not (Test-Path $SELFH)) { Fail "self-heal entry not found: $SELFH" }

Line "running the self-heal ladder once (this is the authoritative launcher)"
& $SELFH 2>&1 | ForEach-Object { "  " + $_ }

Line ("waiting up to " + $BootSec + "s for boot_completed=1")
$booted = $false
for ($i = 1; $i -le [int]($BootSec / 4); $i++) {
  Start-Sleep -Seconds 4
  if (Test-Path $ADB) {
    $b = ((& $ADB shell getprop sys.boot_completed 2>$null) -join '')
    if ($b -match '1') { Line ("BOOTED after " + ($i * 4) + "s"); $booted = $true; break }
  }
}
if (-not $booted) { Fail ("boot timeout after " + $BootSec + "s; see G:\Android\emu-ladder.log") }

Start-Sleep -Seconds 8

# Renderer assertion -- the whole point of this script.
$rend = Get-Renderer
Line ("renderer: " + $(if ($rend) { $rend } else { '(unreadable)' }))
$isNvidia = ($rend -match 'NVIDIA')
$isSoftware = ($rend -match 'SwiftShader') -or ($rend -match 'Google \(Google\)')
if ($isSoftware) {
  Write-Host ""
  Write-Host "VERDICT: FAIL - the guest is on a SOFTWARE renderer (SwiftShader)."
  Write-Host "  see verify/emu-gpu-verdict.ps1 and G:\Android\emu-ladder.log"
  exit 3
}
if (-not $isNvidia) {
  Write-Host ""
  Write-Host "VERDICT: BLOCKED - renderer could not be confirmed as NVIDIA (fail-closed)."
  Write-Host "  raw: " + $rend
  exit 4
}

# Geometry: report, re-apply only if lost (config.ini hardening now guarantees it).
$size = ((& $ADB shell wm size 2>$null) -join '')
$dens = ((& $ADB shell wm density 2>$null) -join '')
Line ("wm size    : " + $size.Trim())
Line ("wm density : " + $dens.Trim())
if ($size -notmatch ($WANT_W + 'x' + $WANT_H)) {
  & $ADB shell wm size ($WANT_W + 'x' + $WANT_H) | Out-Null
  Line "RE-APPLIED wm size (transient override; config.ini is the durable source)"
}
if ($dens -notmatch $WANT_D) {
  & $ADB shell wm density $WANT_D | Out-Null
  Line "RE-APPLIED wm density"
}

$qFinal = Get-Qemu
$gpuFinal = ''; if ($qFinal -and ($qFinal.CommandLine -match '-gpu\s+(\S+)')) { $gpuFinal = $matches[1] }
Write-Host ""
Write-Host "VERDICT: PASS - real GPU, booted, geometry asserted"
Write-Host ("  qemu pid=" + $(if ($qFinal) { $qFinal.ProcessId } else { '?' }) + " -gpu " + $gpuFinal)
Write-Host ("  selector = " + (Get-Selector))
Write-Host ("  renderer = " + $rend)
exit 0
