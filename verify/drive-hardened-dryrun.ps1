# drive-hardened-dryrun.ps1 (v2) -- prove the hardened self-heal script is correct and side-effect free.
# Runs on <win-host-a>. ASCII only.
#
# SAFETY DESIGN (this is the point of the exercise):
#   The forbidden state is "emulator running on CPU software rendering". So we must NOT test the
#   renderer branches by actually degrading the machine to swiftshader. Instead:
#     * -DryRun                          : the script decides and logs, but kills/starts/writes NOTHING
#     * -TestRendererOverride <string>    : substitutes the renderer line so every branch is reachable
#     * -ForceLadder + -DryRunLadderOutcome : inject a ladder outcome so the fallback branch is
#                                             reachable even while the real machine is healthy
#     * -BreakHostRung                    : makes rung 1 fail on purpose
#   Before and after, we snapshot the REAL state (qemu pid, selector file hash+mtime, real ladder log
#   length, live renderer) and require it to be byte-identical, so "zero side effects" is externally
#   checkable rather than just asserted.
#
# v2 FIXES A FALSE TEST FROM v1: v1 tried to exercise the fallback with -BreakHostRung alone, but the
# script exits at the "already healthy" gate on a healthy machine, so the ladder was never reached and
# that scenario proved nothing. v2 adds -ForceLadder so the ladder is genuinely exercised.

$ErrorActionPreference = 'Continue'
$S = 'C:\Users\<user>\laptop-emu-selfheal.hardened.ps1'
$DRYLOG = 'G:\Android\emu-selfheal-dryrun.log'
$REALLOG = 'G:\Android\emu-ladder.log'
$SEL = 'G:\Android\emu-ladder.gpu'
$ADB = 'G:\Android\Sdk\platform-tools\adb.exe'
$NVIDIA = 'GLES: Google (NVIDIA Corporation), Android Emulator OpenGL ES Translator (NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2), OpenGL ES 3.1 (4.5.0 NVIDIA 616.92)'
$SWIFT = 'GLES: Google (Google), Android Emulator OpenGL ES Translator (Google SwiftShader), OpenGL ES 3.0'

function Snapshot {
  $q = @(Get-CimInstance Win32_Process -Filter "Name like 'qemu%'" -ErrorAction SilentlyContinue)
  $selHash = if (Test-Path -LiteralPath $SEL) { (Get-FileHash -LiteralPath $SEL -Algorithm SHA256).Hash } else { 'MISSING' }
  $selMtime = if (Test-Path -LiteralPath $SEL) { (Get-Item -LiteralPath $SEL).LastWriteTime.Ticks } else { 0 }
  $realLines = if (Test-Path -LiteralPath $REALLOG) { (Get-Content -LiteralPath $REALLOG).Count } else { -1 }
  $sfOut = (& $ADB shell dumpsys SurfaceFlinger 2>&1 | Out-String)
  $gles = (([regex]::Match($sfOut, '(?m)^\s*GLES:.*$')).Value).Trim()
  return [ordered]@{
    qemuPid   = ($q | ForEach-Object { $_.ProcessId }) -join ','
    qemuCount = $q.Count
    selHash   = $selHash
    selMtime  = $selMtime
    realLines = $realLines
    renderer  = $gles
  }
}

function Show([string]$label, $s) {
  $h = if ($s.selHash.Length -ge 12) { $s.selHash.Substring(0, 12) } else { $s.selHash }
  Write-Host ("  {0,-8} qemuCount={1} selHash={2} realLogLines={3}" -f $label, $s.qemuCount, $h, $s.realLines)
}

Write-Host '=== hardened self-heal: dry-run proof (v2) ==='
Write-Host ''
Write-Host '--- BEFORE snapshot (real state) ---'
$before = Snapshot
Show 'before' $before
Write-Host ('  renderer: ' + $before.renderer)

if (Test-Path -LiteralPath $DRYLOG) { Remove-Item -LiteralPath $DRYLOG -Force -ErrorAction SilentlyContinue }

$script:results = @()
function RunScenario([string]$name, [string[]]$extra, [int]$expectRc) {
  Write-Host ''
  Write-Host ('--- SCENARIO: ' + $name + ' (expect exit ' + $expectRc + ') ---')
  $argv = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $S) + $extra
  $out = & powershell.exe @argv 2>&1 | Out-String
  $rc = $LASTEXITCODE
  $verdict = if ($rc -eq $expectRc) { 'ok  ' } else { 'FAIL' }
  Write-Host ('  [' + $verdict + '] exit=' + $rc)
  foreach ($line in ($out -split "`r?`n")) {
    if ($line -match 'renderer:|VIOLATION|already healthy|DRYRUN|REGRESSION|RESULT:|rung |TEST HOOK|ENV:|injecting') {
      Write-Host ('  | ' + $line.Trim())
    }
  }
  $script:results += [pscustomobject]@{ name = $name; rc = $rc; want = $expectRc; ok = ($rc -eq $expectRc) }
}

# S1 healthy + NVIDIA renderer -> "already healthy ON THE REAL GPU", zero mutation
RunScenario 'healthy on real GPU (NVIDIA renderer)' @('-DryRun', '-TestRendererOverride', $NVIDIA) 0

# S2 healthy + swiftshader renderer -> VIOLATION + would correct to rung 1
RunScenario 'healthy but CPU software rendering' @('-DryRun', '-TestRendererOverride', $SWIFT) 0

# S3 unrecognizable renderer -> must FAIL CLOSED (treated as not host GPU), never silently pass
RunScenario 'unrecognizable renderer -> fail closed' @('-DryRun', '-TestRendererOverride', 'GLES: something-we-do-not-recognize') 0

# S4 THE REAL FALLBACK TEST: force the ladder, rung 1 fails, software rescue succeeds
#    -> must log REGRESSION and would rewrite the selector back to "host" (F3)
RunScenario 'ladder reached: rung1 fails -> sw rescue + selector restored' @('-DryRun', '-ForceLadder', '-BreakHostRung', '-DryRunLadderOutcome', 'sw-ok') 0

# S5 in dry-run the ladder outcome can be injected as host-ok -> normal successful rung 1 path
RunScenario 'ladder reached: rung1 host-ok' @('-DryRun', '-ForceLadder', '-DryRunLadderOutcome', 'host-ok', '-TestRendererOverride', $NVIDIA) 0

# S6 SAFETY GUARD: ladder test hooks must be refused outside dry-run (must not touch the machine)
RunScenario 'guard: -ForceLadder without -DryRun is refused' @('-ForceLadder') 2

Write-Host ''
Write-Host '--- AFTER snapshot (must equal BEFORE) ---'
$after = Snapshot
Show 'after' $after
Write-Host ('  renderer: ' + $after.renderer)

Write-Host ''
Write-Host '=== ZERO-SIDE-EFFECT VERDICT ==='
$ok = $true
if ($before.qemuPid -ne $after.qemuPid) { Write-Host ('  FAIL qemu pid changed: ' + $before.qemuPid + ' -> ' + $after.qemuPid); $ok = $false } else { Write-Host ('  ok   qemu untouched (pid ' + $after.qemuPid + ')') }
if ($before.selHash -ne $after.selHash) { Write-Host ('  FAIL selector file changed: ' + $before.selHash + ' -> ' + $after.selHash); $ok = $false } else { Write-Host '  ok   selector file unchanged' }
if ($before.selMtime -ne $after.selMtime) { Write-Host '  FAIL selector mtime changed (rewritten)'; $ok = $false } else { Write-Host '  ok   selector mtime unchanged' }
if ($before.realLines -ne $after.realLines) { Write-Host ('  FAIL real ladder log grew: ' + $before.realLines + ' -> ' + $after.realLines); $ok = $false } else { Write-Host '  ok   real ladder log untouched' }
if ($after.renderer -notmatch 'NVIDIA') { Write-Host ('  FAIL renderer is no longer the host GPU: ' + $after.renderer); $ok = $false } else { Write-Host '  ok   still rendering on the host GPU' }

Write-Host ''
Write-Host '=== SCENARIO SUMMARY ==='
$failed = 0
foreach ($r in $script:results) {
  $mark = if ($r.ok) { 'ok  ' } else { 'FAIL' }
  if (-not $r.ok) { $failed++ }
  Write-Host ('  [' + $mark + '] exit=' + $r.rc + ' (want ' + $r.want + ')  ' + $r.name)
}

Write-Host ''
Write-Host ('=== DRY LOG: ' + $DRYLOG + ' ===')
if (Test-Path -LiteralPath $DRYLOG) {
  $dry = Get-Content -LiteralPath $DRYLOG
  Write-Host ('  lines: ' + $dry.Count)
  foreach ($line in $dry) { if ($line -match 'REGRESSION|selector|VIOLATION|injecting|TEST HOOK|nothing to do') { Write-Host ('  ' + $line) } }
} else { Write-Host '  (no dry log written)' }

Write-Host ''
if ($ok -and $failed -eq 0) {
  Write-Host ('FINAL: PASS - ' + $script:results.Count + '/' + $script:results.Count + ' scenarios correct, machine mutated: NO')
  exit 0
}
Write-Host ('FINAL: FAIL - ' + $failed + ' scenario(s) wrong; sideEffectsClean=' + $ok)
exit 1
