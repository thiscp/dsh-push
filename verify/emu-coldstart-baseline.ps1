# emu-coldstart-baseline.ps1 -- ONE cold start that produces BOTH the real-GPU
# cold-start baseline (a standing backlog item) AND the F4 cold-start verification.
#
# NOTE ON ENCODING (measured 2026-10-14): this file is deliberately PURE ASCII.
# A .ps1 containing Chinese, scp'd to the laptop and run as
#   powershell -File <path>
# is parsed by PowerShell 5.1 as ANSI (the file has no BOM), the Chinese turns
# into mojibake, quotes get mangled, and the script dies with a parse error that
# looks like a syntax bug in the script itself. Keep remote-run scripts ASCII.
#
# Why one script for two items: both were waiting on "a cold start", and doing
# them as two separate disruptive operations would waste a QA window.
#   1. "real GPU cold-start baseline not re-taken" -- the only figure on record
#      (6s) came from a quickboot snapshot boot, so it is NOT a cold-start number.
#   2. F4 (AVD config.ini duplicate keys) only takes effect on the next cold
#      start, so it must be confirmed afterwards.
#
# IMPORTANT: a cold start KILLS the running emulator. Do not run with -Force while
# a QA round or any device work is in flight. Without -Force it only prints a plan.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File emu-coldstart-baseline.ps1            # plan only
#   powershell -NoProfile -ExecutionPolicy Bypass -File emu-coldstart-baseline.ps1 -Force     # do it
param(
  [switch]$Force,
  [int]$BootSec = 300,
  [string]$ReportFile = ''
)
$ErrorActionPreference = 'Continue'

$ADB     = 'G:\Android\Sdk\platform-tools\adb.exe'
$COLD    = 'G:\Android\emu-coldstart-real-gpu.ps1'
$SEL     = 'G:\Android\emu-ladder.gpu'
$AVD     = Join-Path $env:USERPROFILE '.android\avd\dsh-p16.avd'
$INI     = Join-Path $AVD 'config.ini'
$JSONOUT = 'G:\Android\emu-coldstart-baseline.json'
# THIS SCRIPT RUNS ON THE LAPTOP. The repo lives on the desktop, so a repo path is
# NOT writable from here unless the desktop drive happens to be mapped. Measured
# 2026-10-14: passing F:\... produced
#   "New-Item : Cannot find drive. A drive with the name 'F' does not exist."
# and the report/json copy steps failed (the measurements themselves were fine).
# So: default to laptop-local outputs and print an explicit PULL step for the lead.
if (-not $ReportFile) { $ReportFile = 'G:\Android\STATUS-emu-coldstart-baseline.md' }
$JSONDIR = 'G:\Android\evidence-coldstart'

function Line($m) { Write-Host ("[baseline] " + $m) }

function Get-Renderer {
  if (-not (Test-Path $ADB)) { return '' }
  $out = (& $ADB shell dumpsys SurfaceFlinger 2>$null | Select-String -Pattern '^GLES:' | Select-Object -First 1)
  if ($out) { return $out.Line.Trim() } else { return '' }
}
function Get-QemuInfo {
  $q = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^qemu-system' } | Select-Object -First 1
  if (-not $q) { return @{ pid = 0; gpu = '' } }
  $gpu = ''
  if ($q.CommandLine -match '-gpu\s+(\S+)') { $gpu = $matches[1] }
  return @{ pid = $q.ProcessId; gpu = $gpu }
}
function Get-IniKeyState($path) {
  $res = [ordered]@{}
  foreach ($k in @('hw.lcd.width', 'hw.lcd.height', 'hw.lcd.density', 'hw.gpu.enabled')) { $res[$k] = @() }
  if (-not (Test-Path $path)) { return $res }
  foreach ($l in (Get-Content $path)) {
    foreach ($k in @('hw.lcd.width', 'hw.lcd.height', 'hw.lcd.density', 'hw.gpu.enabled')) {
      if ($l -match ("^\s*" + [regex]::Escape($k) + "\s*=\s*(.+?)\s*$")) { $res[$k] += $matches[1] }
    }
  }
  return $res
}
function Append-Text($path, $text) {
  # UTF-8 WITHOUT BOM for the markdown report (so the repo file stays clean);
  # PowerShell 5.1 still writes ASCII lines fine.
  $enc = New-Object System.Text.UTF8Encoding($false)
  if (-not (Test-Path $path)) { [System.IO.File]::WriteAllText($path, '', $enc) }
  [System.IO.File]::AppendAllText($path, $text, $enc)
}

# ---------------------------------------------------------------- precondition
Write-Host "== cold-start baseline plan =="
Line ("cold-start entry : " + $COLD + "  (exists=" + (Test-Path $COLD) + ")")
Line ("selector         : " + $(if (Test-Path $SEL) { (Get-Content $SEL -Raw).Trim() } else { '(absent)' }))
$q0 = Get-QemuInfo
Line ("emulator now     : " + $(if ($q0.pid) { "pid=" + $q0.pid + " -gpu " + $q0.gpu } else { "not running" }))
Line ("report file      : " + $ReportFile)
$ini0 = Get-IniKeyState $INI
foreach ($k in @('hw.lcd.width', 'hw.lcd.height', 'hw.lcd.density', 'hw.gpu.enabled')) {
  Line ("  " + $k.PadRight(16) + " x" + @($ini0[$k]).Count + "  [" + (@($ini0[$k]) -join ', ') + "]")
}
Write-Host ""
Write-Host "This will KILL the running emulator, cold start it on the real GPU, and record:"
Write-Host "  * real cold-start duration (fixes the invalid 6s quickboot figure)"
Write-Host "  * renderer string + qemu -gpu + geometry (F4 cold-start verification)"
Write-Host "  * config.ini key multiplicity (F4 durable check)"
if (-not $Force) {
  Write-Host ""
  Write-Host "PLAN ONLY - nothing was touched. Re-run with -Force when no QA/device work is in flight."
  exit 0
}

# ---------------------------------------------------------------- the cold start
Write-Host ""
Line "cold starting (forced)"
$t0 = Get-Date
$out = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $COLD -Kill -BootSec $BootSec 2>&1
$coldExit = $LASTEXITCODE
$out | ForEach-Object { "  " + $_ }
$t1 = Get-Date
$elapsed = [math]::Round(($t1 - $t0).TotalSeconds, 1)

# ---------------------------------------------------------------- measurements
Write-Host ""
Line "measuring"
$rend = Get-Renderer
$size = ''; $dens = ''
if (Test-Path $ADB) {
  $size = ((& $ADB shell wm size 2>$null) -join ' ').Trim()
  $dens = ((& $ADB shell wm density 2>$null) -join ' ').Trim()
}
$q1 = Get-QemuInfo
$ini1 = Get-IniKeyState $INI
$sel1 = if (Test-Path $SEL) { (Get-Content $SEL -Raw).Trim() } else { '(absent)' }
$selfhealSha = if (Test-Path 'G:\Android\emu-selfheal.ps1') { (Get-FileHash 'G:\Android\emu-selfheal.ps1' -Algorithm SHA256).Hash } else { '' }

$rendererOk = ($rend -match 'NVIDIA')
$software = ($rend -match 'SwiftShader') -or ($rend -match 'Google \(Google\)')
$geomOk = ($size -match '1440x3168') -and ($dens -match '640')
$iniOk = (@($ini1['hw.lcd.width']).Count -eq 1) -and (@($ini1['hw.lcd.height']).Count -eq 1) -and
         (@($ini1['hw.lcd.density']).Count -eq 1) -and (@($ini1['hw.lcd.width'])[0] -eq '1440') -and
         (@($ini1['hw.lcd.height'])[0] -eq '3168') -and (@($ini1['hw.lcd.density'])[0] -eq '640')
$verdict = if ($coldExit -eq 0 -and $rendererOk -and $geomOk -and $iniOk) { 'PASS' } elseif ($software) { 'FAIL-SOFTWARE' } else { 'FAIL' }

$rec = [ordered]@{
  at                = (Get-Date).ToString('s')
  coldStartSeconds  = $elapsed
  coldScriptExit    = $coldExit
  selector          = $sel1
  qemuPid           = $q1.pid
  qemuGpu           = $q1.gpu
  renderer          = $rend
  rendererIsNvidia  = $rendererOk
  softwareRenderer  = $software
  wmSize            = $size
  wmDensity         = $dens
  geometryOk        = $geomOk
  iniWidthValues    = @($ini1['hw.lcd.width'])
  iniHeightValues   = @($ini1['hw.lcd.height'])
  iniDensityValues  = @($ini1['hw.lcd.density'])
  iniGpuEnabled     = @($ini1['hw.gpu.enabled'])
  iniExactlyOneEach = $iniOk
  selfhealSha256    = $selfhealSha
  verdict           = $verdict
}
$rec | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $JSONOUT -Encoding UTF8
Line ("json written: " + $JSONOUT)

# ---------------------------------------------------------------- json copy (laptop-local)
$jsonRepo = Join-Path $JSONDIR ((Get-Date -Format 'yyyyMMdd-HHmmss') + '-emu-coldstart-baseline.json')
try {
  if (-not (Test-Path $JSONDIR)) { New-Item -ItemType Directory -Path $JSONDIR -Force | Out-Null }
  Copy-Item $JSONOUT $jsonRepo -Force
  Line ("json also stored at: " + $jsonRepo)
  Line ("PULL IT (from the desktop): scp user@<laptop>:" + ($jsonRepo -replace '\\', '/') + " F:\work\work_dsh\dsh-push\verify\evidence-coldstart\")
} catch { Line ("WARNING: could not copy json: " + $_.Exception.Message) }

# ---------------------------------------------------------------- report append (ASCII)
$md = @()
$md += ""
$md += "## Cold-start record " + (Get-Date -Format 'yyyy-MM-dd HH:mm') + " -- verdict **" + $verdict + "**"
$md += ""
$md += "| item | value |"
$md += "|---|---|"
$md += "| real-GPU cold-start duration | **" + $elapsed + " s** (script exit " + $coldExit + "; includes self-heal ladder launch + boot polling) |"
$md += "| selector emu-ladder.gpu | " + $sel1 + " |"
$md += "| qemu | pid=" + $q1.pid + " -gpu " + $q1.gpu + " |"
$md += "| renderer | " + $(if ($rend) { $rend } else { '(read failed)' }) + " |"
$md += "| wm size | " + $size + " |"
$md += "| wm density | " + $dens + " |"
$md += "| config.ini hw.lcd.width | x" + @($ini1['hw.lcd.width']).Count + " [" + (@($ini1['hw.lcd.width']) -join ', ') + "] |"
$md += "| config.ini hw.lcd.height | x" + @($ini1['hw.lcd.height']).Count + " [" + (@($ini1['hw.lcd.height']) -join ', ') + "] |"
$md += "| config.ini hw.lcd.density | x" + @($ini1['hw.lcd.density']).Count + " [" + (@($ini1['hw.lcd.density']) -join ', ') + "] |"
$md += "| config.ini hw.gpu.enabled | [" + (@($ini1['hw.gpu.enabled']) -join ', ') + "] |"
$md += "| self-heal script sha256 | " + $selfhealSha + " |"
$md += ""
$md += "Criteria: duration is PASS if exit 0; the renderer MUST contain NVIDIA (SwiftShader / Google (Google) = software = FAIL);"
$md += "geometry MUST be 1440x3168 + 640; config.ini must hold EXACTLY ONE of each LCD key with the right value (that is the F4 cold-start check)."
$md += ""
$md += "> Superseded figure: the 6 s in the infra sweep was a QUICKBOOT snapshot boot, not a cold start, and must not be used as a baseline."
$md += ""

try {
  if (-not (Test-Path $ReportFile)) {
    $hdr = @()
    $hdr += "# Emulator real-GPU cold-start baseline (STATUS)"
    $hdr += ""
    $hdr += "> Appended by ``verify/emu-coldstart-baseline.ps1 -Force``; one section per cold start."
    $hdr += "> Same criteria as ``verify/emu-coldstart-real-gpu.ps1``."
    $hdr += "> (Generated by a PURE-ASCII script on purpose: Chinese in a scp'd .ps1 breaks PowerShell 5.1.)"
    $hdr += ""
    Append-Text $ReportFile (($hdr -join "`r`n") + "`r`n")
  }
  Append-Text $ReportFile (($md -join "`r`n") + "`r`n")
  Line ("report appended: " + $ReportFile)
} catch {
  Line ("WARNING: could not write the report (" + $_.Exception.Message + "); json still at " + $JSONOUT)
}

Write-Host ""
Write-Host "================ COLD-START BASELINE ================"
Write-Host ("cold start seconds : " + $elapsed)
Write-Host ("cold script exit   : " + $coldExit)
Write-Host ("renderer (NVIDIA?) : " + $(if ($rendererOk) { 'YES' } else { 'NO' }) + "  " + $rend)
Write-Host ("geometry 1440x3168 : " + $(if ($geomOk) { 'OK' } else { 'MISMATCH (' + $size + ' / ' + $dens + ')' }))
Write-Host ("config.ini 1-each  : " + $(if ($iniOk) { 'OK' } else { 'STILL DUPLICATED' }))
Write-Host ("VERDICT            : " + $verdict)
Write-Host "====================================================="
if ($verdict -eq 'PASS') { exit 0 } else { exit 3 }
