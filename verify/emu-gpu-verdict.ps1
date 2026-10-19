# emu-gpu-verdict.ps1 -- ONE command to answer: is the laptop emulator on the REAL GPU or on CPU swiftshader?
#
# WHY THIS EXISTS
#   The user's hard constraint (2026-10-14): the emulator must NOT run on CPU software rendering,
#   because swiftshader spins the laptop's fans up and the noise is unacceptable.
#   Two previously-documented judgement methods were FALSIFIED during the 2026-10-14 infra
#   inspection (see verify/INFRA-HEALTH-2026-10-14.md):
#     * emu-ladder.log's "interactive console session: True/False"  -> NOT usable
#       (regex ignores the state column, and two sibling tasks reported opposite values in the
#        same minute on the same machine)
#     * "no interactive session => -gpu host cannot start"           -> NOT true
#       (measured: console disconnected, -gpu host came up in ~6s, renderer = RTX 4060)
#   The ONLY authoritative judge is the guest-side renderer line from dumpsys SurfaceFlinger.
#   This script implements exactly that, plus the qemu -gpu argument as corroboration, plus a
#   regression warning when the persistent selector file would send the NEXT start to swiftshader.
#
# USAGE
#   powershell.exe -NoProfile -ExecutionPolicy Bypass -File verify\emu-gpu-verdict.ps1
#   powershell.exe ... -File verify\emu-gpu-verdict.ps1 -SelfTest      # classifier unit test, no ssh
#
# EXIT CODES (mirrors the house style used by the other verify gates)
#   0 = PASS      real GPU confirmed (renderer is the host NVIDIA adapter)
#   3 = SOFTWARE  CPU software rendering detected -> violates the user's constraint
#   4 = BLOCKED   could not determine (ssh failed / adb absent / no renderer line / guest down)
#   2 = ENV       bad parameters on this side
#
# ASCII ONLY on purpose (PowerShell 5.1 reads BOM-less UTF-8 as ANSI; see README hard fact 4).
# Read-only against the laptop: it never starts, stops or reconfigures anything.
# The -SelfTest path touches nothing at all (no ssh, no laptop).

[CmdletBinding()]
param(
  [string]$EmuHost = 'user@<tailnet-laptop>',
  [int]$TimeoutSec = 90,
  [switch]$SelfTest
)

$ErrorActionPreference = 'Continue'

# ================================================================================================
# classifier -- extracted so -SelfTest can prove it on synthetic input
# ================================================================================================
function Get-EmuGpuVerdict {
  param(
    [string]$Gles,
    [string]$QemuLine,
    [string]$GpuFileVal,
    [string]$BootVal,
    [string]$QemuCount
  )

  $qemuGpu = ''
  if ($QemuLine -match '-gpu\s+(\S+)') { $qemuGpu = $Matches[1] }

  $result = @{
    code    = 4
    label   = 'BLOCKED'
    reason  = ''
    qemuGpu = $qemuGpu
    warn    = @()
  }

  # no emulator + guest not booted -> nothing to judge
  if (($QemuCount -eq '0' -or $QemuCount -eq '') -and ($BootVal -notmatch '1')) {
    $result.reason = 'no emulator process and guest not booted'
    return $result
  }
  if ([string]::IsNullOrWhiteSpace($Gles) -or $Gles -eq 'NOT_FOUND') {
    $result.reason = 'could not read the renderer line (guest not ready?)'
    return $result
  }

  # software rendering: either signal is enough to fail
  $isSoftware = ($Gles -match 'SwiftShader') -or ($Gles -match 'Google \(Google\)') -or
                ($qemuGpu -eq 'swiftshader_indirect') -or ($qemuGpu -eq 'swiftshader')
  $isHostGpu = ($Gles -match 'NVIDIA')

  if ($isSoftware) {
    $result.code = 3
    $result.label = 'SOFTWARE'
    $result.reason = 'CPU software rendering is ACTIVE (violates the no-CPU-fans constraint)'
    return $result
  }
  if ($isHostGpu) {
    $result.code = 0
    $result.label = 'PASS'
    $result.reason = 'real GPU confirmed (host NVIDIA adapter renders the guest)'
    if ($GpuFileVal -match 'swiftshader') {
      $result.warn += ('selector file still says "' + $GpuFileVal + '" -> the NEXT emulator start will regress to CPU')
      $result.warn += 'write "host" into G:\Android\emu-ladder.gpu to keep it on the real GPU'
    }
    if ($qemuGpu -and $qemuGpu -ne 'host') {
      $result.warn += ('qemu -gpu arg is "' + $qemuGpu + '" but the renderer is the host adapter; renderer wins.')
    }
    return $result
  }

  $result.reason = ('renderer line recognized as neither host NVIDIA nor SwiftShader: ' + $Gles)
  return $result
}

# ================================================================================================
# -SelfTest: prove the classifier on synthetic inputs. Touches nothing.
# ================================================================================================
if ($SelfTest) {
  $nvidia = 'GLES: Google (NVIDIA Corporation), Android Emulator OpenGL ES Translator (NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2), OpenGL ES 3.1 (4.5.0 NVIDIA 616.92)'
  $swiftshader = 'GLES: Google (Google), Android Emulator OpenGL ES Translator (Google SwiftShader), OpenGL ES 3.0'
  $hostLine = 'qemu-system-x86_64-headless.exe -avd dsh-p16 -gpu host -cores 4'
  $swLine = 'qemu-system-x86_64-headless.exe -avd dsh-p16 -gpu swiftshader_indirect -cores 4'

  $cases = @(
    @{ n = 'real GPU, clean selector';              gles = $nvidia;      qemu = $hostLine; file = 'host';                 boot = '1';   cnt = '1'; want = 0; wantWarn = 0 }
    @{ n = 'real GPU, selector would regress';      gles = $nvidia;      qemu = $hostLine; file = 'swiftshader_indirect'; boot = '1';   cnt = '1'; want = 0; wantWarn = 2 }
    @{ n = 'swiftshader renderer';                  gles = $swiftshader; qemu = $hostLine; file = 'host';                 boot = '1';   cnt = '1'; want = 3; wantWarn = 0 }
    @{ n = 'host-looking renderer but -gpu sw (qemu arg wins)'; gles = $nvidia; qemu = $swLine; file = 'host';             boot = '1';   cnt = '1'; want = 3; wantWarn = 0 }
    @{ n = 'no emulator, not booted -> blocked';    gles = $nvidia;      qemu = '';        file = 'host';                 boot = '0';   cnt = '0'; want = 4; wantWarn = 0 }
    @{ n = 'renderer line missing -> blocked';      gles = 'NOT_FOUND';  qemu = $hostLine; file = 'host';                 boot = '1';   cnt = '1'; want = 4; wantWarn = 0 }
  )

  $fail = 0
  Write-Host '=== emu-gpu-verdict self-test (synthetic inputs, no ssh) ==='
  foreach ($c in $cases) {
    $r = Get-EmuGpuVerdict -Gles $c.gles -QemuLine $c.qemu -GpuFileVal $c.file -BootVal $c.boot -QemuCount $c.cnt
    $warnCount = @($r.warn).Count
    $ok = ($r.code -eq $c.want) -and ($warnCount -eq $c.wantWarn)
    if (-not $ok) { $fail++ }
    $mark = if ($ok) { 'ok  ' } else { 'FAIL' }
    Write-Host ('  [' + $mark + '] ' + $c.n)
    Write-Host ('         want code=' + $c.want + ' warn=' + $c.wantWarn + ' | got code=' + $r.code + ' (' + $r.label + ') warn=' + $warnCount)
    if (-not $ok) { Write-Host ('         reason: ' + $r.reason) }
    foreach ($w in @($r.warn)) { Write-Host ('         warn: ' + $w) }
  }
  Write-Host ''
  if ($fail -eq 0) {
    Write-Host ('SELFTEST: PASS (' + $cases.Count + '/' + $cases.Count + ' cases)')
    exit 0
  }
  Write-Host ('SELFTEST: FAIL (' + $fail + ' of ' + $cases.Count + ' cases wrong)')
  exit 2
}

if (-not $EmuHost) { Write-Host 'ENV: -EmuHost is empty'; exit 2 }

# ================================================================================================
# live probe
# ================================================================================================
$remoteScript = @'
$ErrorActionPreference = 'Continue'
$adb = 'G:\Android\Sdk\platform-tools\adb.exe'

function Emit([string]$k, [string]$v) { 'KV|' + $k + '=' + ($v -replace "`r?`n", ' ') }

$q = @(Get-CimInstance Win32_Process -Filter "Name like 'qemu%'" -ErrorAction SilentlyContinue)
if ($q.Count -gt 0) { Emit 'qemu' $q[0].CommandLine } else { Emit 'qemu' 'NONE' }
if ($q.Count -gt 0) { Emit 'qemuStarted' ([string]$q[0].CreationDate) } else { Emit 'qemuStarted' '' }
Emit 'qemuCount' ([string]$q.Count)

$gpuFile = 'G:\Android\emu-ladder.gpu'
if (Test-Path -LiteralPath $gpuFile) {
  Emit 'gpufile' ((Get-Content -LiteralPath $gpuFile -Raw -ErrorAction SilentlyContinue))
} else {
  Emit 'gpufile' 'MISSING'
}

Emit 'boot' ((& $adb shell getprop sys.boot_completed 2>&1 | Out-String))
Emit 'adbdevices' ((& $adb devices 2>&1 | Out-String))

$sf = (& $adb shell dumpsys SurfaceFlinger 2>&1 | Out-String)
$m = [regex]::Match($sf, '(?m)^\s*GLES:.*$')
if ($m.Success) { Emit 'gles' $m.Value.Trim() } else { Emit 'gles' 'NOT_FOUND' }

Emit 'wmsize' ((& $adb shell wm size 2>&1 | Out-String))
Emit 'wmdensity' ((& $adb shell wm density 2>&1 | Out-String))
Emit 'host' ((hostname))
'@

$encoded = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($remoteScript))
$sshArgs = @('-o', 'BatchMode=yes', '-o', ('ConnectTimeout=' + [Math]::Min($TimeoutSec, 60)), $EmuHost,
             ('powershell -NoProfile -EncodedCommand ' + $encoded))

$raw = (& ssh @sshArgs 2>&1 | Out-String)
$sshRc = $LASTEXITCODE

$kv = @{}
foreach ($line in ($raw -split "`r?`n")) {
  if ($line -match '^KV\|([^=]+)=(.*)$') { $kv[$Matches[1]] = $Matches[2].Trim() }
}

Write-Host '=== emulator GPU verdict ==='
if ($sshRc -ne 0 -and $kv.Count -eq 0) {
  Write-Host ('ssh to ' + $EmuHost + ' FAILED (rc=' + $sshRc + ')')
  Write-Host ('raw: ' + ($raw -replace '\s+', ' ').Trim())
  Write-Host 'VERDICT: BLOCKED - laptop unreachable'
  exit 4
}

Write-Host ('laptop           : ' + $(if ($kv['host']) { $kv['host'] } else { '?' }) + '  (' + $EmuHost + ')')
Write-Host ('qemu processes   : ' + $kv['qemuCount'])
Write-Host ('qemu started     : ' + $kv['qemuStarted'])
Write-Host ('qemu argv        : ' + $kv['qemu'])
Write-Host ('selector file    : G:\Android\emu-ladder.gpu = ' + $kv['gpufile'])
Write-Host ('boot_completed   : ' + $kv['boot'])
Write-Host ('adb devices      : ' + $kv['adbdevices'])
Write-Host ('wm size/density  : ' + $kv['wmsize'] + ' / ' + $kv['wmdensity'])
Write-Host ('RENDERER (auth)  : ' + $kv['gles'])

$r = Get-EmuGpuVerdict -Gles ([string]$kv['gles']) -QemuLine ([string]$kv['qemu']) `
                       -GpuFileVal ([string]$kv['gpufile']) -BootVal ([string]$kv['boot']) `
                       -QemuCount ([string]$kv['qemuCount'])

Write-Host ('qemu -gpu arg    : ' + $(if ($r.qemuGpu) { $r.qemuGpu } else { '(none)' }))
Write-Host ''
Write-Host ('VERDICT: ' + $r.label + ' - ' + $r.reason)
foreach ($w in @($r.warn)) { Write-Host ('  WARNING: ' + $w) }
if ($r.code -eq 4) {
  Write-Host '  hint: is the emulator running at all, and is adb responsive?'
}
exit $r.code
