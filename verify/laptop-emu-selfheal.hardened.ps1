# laptop-emu-selfheal.hardened.ps1
#
# HARDENED drop-in replacement for the laptop's G:\Android\emu-selfheal.ps1.
#
# ------------------------------------------------------------------------------------------------
# WHY THIS EXISTS (2026-10-14 infra inspection -- see verify/INFRA-HEALTH-2026-10-14.md)
# ------------------------------------------------------------------------------------------------
# The user's standing constraint: THE EMULATOR MUST NOT RUN ON CPU SOFTWARE RENDERING.
# swiftshader spins the laptop's fans up and the noise is unacceptable. The legacy script
# violated that constraint in a way that could never self-correct, for three reasons:
#
#   F1  The legacy script skipped the real-GPU rung whenever it thought there was no interactive
#       console session, on the stated premise that "-gpu host needs an interactive session with a
#       GPU context -- without one it dies with glTexImage2D 0x502".
#       THAT PREMISE IS FALSIFIED. Measured 2026-10-14: console state was "disconnected",
#       `-gpu host` came up in ~6s, boot_completed=1, and the guest renderer was the host
#       NVIDIA RTX 4060. So the "safety" gate was actually steering the machine onto the CPU path.
#       FIX: rung 1 (host GPU) is ALWAYS attempted first. The session check is kept for logging only
#       and must never drive a decision again (it is also unreliable: two sibling tasks reported
#       opposite values in the same minute on the same machine).
#
#   F2  The legacy "already healthy" gate only checked boot_completed=1 + `adb shell echo ok`.
#       A swiftshader instance passes that test, so the script woke every 5 minutes, saw "healthy",
#       and slept again -- freezing CPU rendering in place as a steady state.
#       FIX: the renderer line from dumpsys SurfaceFlinger is now part of the health verdict.
#       Healthy-but-not-on-host-GPU is treated as a VIOLATION and is corrected (kill + rung 1).
#       If the renderer cannot be read we FAIL CLOSED (treat as not-host-GPU) rather than assume OK.
#
#   F3  A software-GPU fallback used to persist forever: rung 2 left "swiftshader_indirect" in the
#       persistent selector file G:\Android\emu-ladder.gpu, so every later start defaulted to CPU.
#       FIX: software rendering is allowed only as a transient rescue for the current boot. After a
#       software fallback the selector is rewritten to "host", so the next start retries the real
#       GPU, and a loud REGRESSION marker is logged.
#
# ------------------------------------------------------------------------------------------------
# SAFETY / OPERATIONS
# ------------------------------------------------------------------------------------------------
#   * -DryRun       : decide and log, change NOTHING (no kill, no start, no file write). Logs go to
#                     G:\Android\emu-selfheal-dryrun.log so the real ladder log stays clean and
#                     "zero side effects" is externally checkable.
#   * -TestRendererOverride <string> : test hook. Substitutes the detected renderer line so the
#                     host-GPU / software-GPU branches can be exercised WITHOUT actually degrading
#                     a healthy machine to CPU. Use with -DryRun.
#                     Rationale: a verification gate must not pay for its own test by creating the
#                     very state the user forbade.
#   * -BreakHostRung : (kept from the legacy script) TEST HOOK that makes rung 1 fail on purpose,
#                     so the software fallback path can still be proven reachable.
#
#   The ladder, timeouts, zombie handling, lock clearing, sshd keep-alive and the single
#   "needs a REBOOT" ntfy alert are preserved from the legacy script. Only the three defects above
#   were changed. ASCII only, PowerShell 5.1 compatible, idempotent.

param(
  [switch]$SshdOnly,                    # sibling S4U task mode: keep sshd alive + record session state
  [switch]$DryRun,                      # decide + log only; mutate nothing
  [string]$TestRendererOverride = '',   # TEST HOOK: pretend the guest renderer is this string
  [int]$HostGpuTimeoutSec = 90,         # budget for the real-GPU attempt before falling back
  [int]$SwTimeoutSec = 240,             # budget for the software-GPU attempt
  [int]$AdbTimeoutSec = 20,             # every adb call is wrapped in a timeout (never call adb bare)
  [int]$ZombieProbes = 3,
  [switch]$BreakHostRung,               # TEST HOOK: force rung 1 to use a bogus -avd value
  [switch]$ForceLadder,                 # TEST HOOK (dry-run only): skip the health gate
  [string]$DryRunLadderOutcome = '',    # TEST HOOK (dry-run only): host-ok | sw-ok | both-fail
  [switch]$SelfTest                     # read-only: prove the classifier + the LIVE renderer probe
)

$ErrorActionPreference = 'Continue'

# Test hooks that could steer the ladder must be impossible to misuse in production. If either is
# set without -DryRun we refuse to run at all rather than risk mutating a live machine.
if ((-not $DryRun) -and ($ForceLadder -or $DryRunLadderOutcome)) {
  Write-Host 'ENV: -ForceLadder / -DryRunLadderOutcome are dry-run-only test hooks; add -DryRun (nothing was changed).'
  exit 2
}

$LOG = if ($DryRun) { 'G:\Android\emu-selfheal-dryrun.log' } else { 'G:\Android\emu-ladder.log' }
$ADB = 'G:\Android\Sdk\platform-tools\adb.exe'
$AVD = Join-Path $env:USERPROFILE '.android\avd\dsh-p16.avd'
$DEVICE = 'emulator-5554'
$TOKENFILE = Join-Path $env:USERPROFILE '.config\dsh-ntfy\token'

function Log([string]$m) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $m
  try { Add-Content -LiteralPath $LOG -Value $line -Encoding UTF8 } catch { }
  Write-Host $line
}

# run an external exe with a hard timeout; returns @{ok;code;out}
#
# DEADLOCK FIX (2026-10-14, caught by the step-3 real-machine dry run):
#   The original version called WaitForExit() BEFORE ReadToEnd(). When a child writes more than the
#   OS pipe buffer (~4-64KB) it blocks in write() while the parent blocks in WaitForExit() -> both
#   wait forever, and the call only returns via the timeout. `dumpsys SurfaceFlinger` emits ~46KB,
#   so RendererLine() timed out after 45s and the renderer read as empty -> the hardened script then
#   (correctly, per its fail-closed rule) reported VIOLATION on a perfectly healthy real-GPU guest.
#   Reproduced on the laptop: WaitForExit(20000) returned False after 20.01s.
# FIX: start draining stdout/stderr ASYNCHRONOUSLY immediately after Start(), then wait. The waits
#   are still bounded, and on timeout we kill the tree and still return whatever was drained.
function Run-Timeout([string]$exe, [string[]]$argv, [int]$sec) {
  $psi = New-Object Diagnostics.ProcessStartInfo
  $psi.FileName = $exe
  $psi.Arguments = ($argv | ForEach-Object { if ($_ -match '[\s"]') { '"' + ($_ -replace '"', '\"') + '"' } else { $_ } }) -join ' '
  $psi.UseShellExecute = $false
  $psi.RedirectStandardOutput = $true
  $psi.RedirectStandardError = $true
  $psi.CreateNoWindow = $true
  $p = New-Object Diagnostics.Process
  $p.StartInfo = $psi
  try { [void]$p.Start() } catch { return @{ ok = $false; code = -1; out = ('spawn failed: ' + $_.Exception.Message) } }

  # MUST drain before waiting (see DEADLOCK FIX above)
  $outTask = $p.StandardOutput.ReadToEndAsync()
  $errTask = $p.StandardError.ReadToEndAsync()

  $exited = $p.WaitForExit($sec * 1000)
  if (-not $exited) {
    try { [void](Run-TimeoutKillTree $p) } catch { }
    $partial = ''
    try { $partial = (($outTask.Result + $errTask.Result)).Trim() } catch { }
    return @{ ok = $false; code = -2; out = (('TIMEOUT after ' + $sec + 's; partial=' + $partial.Substring(0, [Math]::Min(200, $partial.Length)))) }
  }
  # allow the async readers to observe EOF
  try { [void]$outTask.Wait(5000) } catch { }
  try { [void]$errTask.Wait(5000) } catch { }
  $so = ''; $se = ''
  try { $so = $outTask.Result } catch { }
  try { $se = $errTask.Result } catch { }
  $out = ($so + $se).Trim()
  return @{ ok = ($p.ExitCode -eq 0); code = $p.ExitCode; out = $out }
}

# kill a process and its children; never throws
function Run-TimeoutKillTree($proc) {
  try { & taskkill.exe /PID $proc.Id /F /T 2>&1 | Out-Null } catch { }
  try { if (-not $proc.HasExited) { $proc.Kill() } } catch { }
}

function Adb([string[]]$argv, [int]$sec = 0) {
  if ($sec -le 0) { $sec = $AdbTimeoutSec }
  return Run-Timeout $ADB (@('-s', $DEVICE) + $argv) $sec
}

function QemuProcs { return @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match 'qemu-system|^emulator$' }) }

function GuestHealthy {
  $e = Adb @('shell', 'echo', 'ok') 8
  if (-not $e.ok -or ($e.out -notmatch 'ok')) { return $false }
  $b = Adb @('shell', 'getprop', 'sys.boot_completed') 10
  return ($b.ok -and ($b.out -match '1'))
}

# ---- F2: renderer awareness -------------------------------------------------------------------
# The ONLY authoritative way to tell host GPU from CPU software rendering. Do NOT use
# ro.hardware.egl (always "emulation") and do NOT use screenshot timing as the primary judge.
function RendererLine {
  if ($TestRendererOverride) { return $TestRendererOverride }

  # Preferred path: let the DEVICE do the filtering so only a couple of lines cross the pipe.
  # No -m1 on purpose: an early grep exit gives dumpsys a SIGPIPE and it then prints
  # "Failed to write while dumping service SurfaceFlinger: Broken pipe" noise (observed).
  # Note the pattern deliberately has no inner quotes so Run-Timeout's quoting stays clean.
  $f = Adb @('shell', 'dumpsys SurfaceFlinger | grep GLES:') 45
  if ($f.ok) {
    $m = [regex]::Match($f.out, '(?m)^\s*GLES:.*$')
    if ($m.Success) { return $m.Value.Trim() }
  }

  # Fallback: pull the whole dump and parse here. Safe now that Run-Timeout drains asynchronously;
  # this path is what used to deadlock (see DEADLOCK FIX above) and is kept as a real regression risk.
  $r = Adb @('shell', 'dumpsys', 'SurfaceFlinger') 60
  if (-not $r.ok) { return '' }
  $m2 = [regex]::Match($r.out, '(?m)^\s*GLES:.*$')
  if ($m2.Success) { return $m2.Value.Trim() }
  return ''
}

# Fail closed: anything we cannot positively identify as the host adapter is treated as NOT host GPU.
function IsHostGpuRenderer([string]$line) {
  if ([string]::IsNullOrWhiteSpace($line)) { return $false }
  if ($line -match 'SwiftShader') { return $false }
  if ($line -match 'Google \(Google\)') { return $false }
  return ($line -match 'NVIDIA')
}

function Clear-Locks {
  foreach ($l in @((Join-Path $AVD 'hardware-qemu.ini.lock'), (Join-Path $AVD 'multiinstance.lock'))) {
    if (Test-Path -LiteralPath $l) {
      if ($DryRun) { Log ('  DRYRUN: would clear AVD lock ' + $l); continue }
      Remove-Item -LiteralPath $l -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue
      Log ('  cleared AVD lock: ' + $l)
    }
  }
}

# kill the emulator tree; returns $true when nothing is left alive.
# NOTE: kills the WHOLE tree (taskkill /T). Killing only qemu can leave the cmd.exe wrapper from
# the rung task behind, which is how the old emu-out.txt lock trouble started.
function Kill-Emulator([int]$waitSec = 12) {
  $q = QemuProcs
  if ($q.Count -eq 0) { return $true }
  if ($DryRun) { Log ('  DRYRUN: would kill emulator tree, pids ' + (($q | ForEach-Object { $_.Id }) -join ',')); return $true }
  Log ('  killing emulator tree, pids ' + (($q | ForEach-Object { $_.Id }) -join ','))
  foreach ($p in $q) { [void](Run-Timeout 'taskkill.exe' @('/PID', "$($p.Id)", '/F', '/T') 20) }
  Start-Sleep -Seconds $waitSec
  $left = QemuProcs
  if ($left.Count -gt 0) { Log ('  STILL ALIVE after taskkill: ' + (($left | ForEach-Object { $_.ProcessName + ':' + $_.Id }) -join ',')); return $false }
  return $true
}

# INFORMATIONAL ONLY (F1). The legacy script used this to decide whether the real GPU could work.
# That premise was falsified and the check is unreliable, so it must never gate a decision again.
function InteractiveSession {
  $q = (& query session 2>&1 | Out-String)
  return ($q -match '(?m)^\s*console\s+\S+')
}

function Ntfy([string]$title, [string]$body) {
  if ($DryRun) { Log ('  DRYRUN: would push ntfy "' + $title + '"'); return }
  if (-not (Test-Path -LiteralPath $TOKENFILE)) { Log '  (no ntfy credential on this host -> alert stays in this log)'; return }
  $url = ''; $tok = ''
  foreach ($l in (Get-Content -LiteralPath $TOKENFILE)) {
    if ($l -match '^NTFY_URL=(.+)$') { $url = $Matches[1].Trim() }
    if ($l -match '^NTFY_TOKEN=(.+)$') { $tok = $Matches[1].Trim() }
  }
  if (-not $url -or -not $tok) { Log '  (ntfy credential incomplete -> alert stays in this log)'; return }
  $topic = ($url -replace '/+$', '') + '/dsh'
  $r = Run-Timeout 'curl.exe' @('-s', '--connect-timeout', '10', '--max-time', '20', '-X', 'POST',
    '-H', ('Authorization: Bearer ' + $tok), '-H', ('Title: ' + $title), '-d', $body, $topic) 30
  Log ('  ntfy push -> HTTP-ish ' + $r.code + ' ' + $r.out.Substring(0, [Math]::Min(80, $r.out.Length)))
}

function Start-EmuTask([string]$name) {
  if ($DryRun) { Log ('  DRYRUN: would schtasks /Run /TN ' + $name); return $true }
  $r = Run-Timeout 'schtasks.exe' @('/Run', '/TN', $name) 30
  Log ('  schtasks /Run /TN ' + $name + ' -> rc=' + $r.code + ' ' + ($r.out -replace '\s+', ' '))
  return $r.ok
}

function Wait-Boot([int]$budgetSec, [string]$label) {
  if ($DryRun) {
    # Dry-run cannot really boot anything, so the ladder outcome is injected instead. This is what
    # lets the fallback branch be tested WITHOUT degrading a healthy machine to CPU rendering.
    if ($DryRunLadderOutcome -eq 'host-ok' -and $label -eq 'host-gpu') { Log ('  DRYRUN: injecting outcome "host-gpu booted"'); return @{ ok = $true; sec = 0 } }
    if ($DryRunLadderOutcome -eq 'sw-ok' -and $label -eq 'sw-gpu') { Log ('  DRYRUN: injecting outcome "sw-gpu booted"'); return @{ ok = $true; sec = 0 } }
    Log ('  DRYRUN: would wait up to ' + $budgetSec + 's for ' + $label); return @{ ok = $false; sec = 0 }
  }
  $t0 = Get-Date
  $deadline = $t0.AddSeconds($budgetSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 6
    $el = [int]((Get-Date) - $t0).TotalSeconds
    $qp = QemuProcs
    if ($qp.Count -eq 0) { Log ('  [' + $label + '] ' + $el + 's: no qemu process -> attempt failed'); return @{ ok = $false; sec = $el } }
    $b = Adb @('shell', 'getprop', 'sys.boot_completed') 10
    if ($b.ok -and ($b.out -match '1')) {
      $h = Adb @('shell', 'echo', 'ok') 8
      if ($h.ok -and ($h.out -match 'ok')) {
        $rl = RendererLine
        Log ('  [' + $label + '] boot_completed=1 and shell responsive after ' + $el + 's')
        Log ('  [' + $label + '] renderer: ' + $(if ($rl) { $rl } else { '(could not read)' }))
        return @{ ok = $true; sec = $el }
      }
    }
  }
  Log ('  [' + $label + '] not ready within ' + $budgetSec + 's')
  return @{ ok = $false; sec = $budgetSec }
}

# ---- ladder rung launcher ---------------------------------------------------------------------
# The rungs deliberately do NOT go through the legacy dsh-emu / dsh-emu-sw tasks + run-emu*.cmd:
# those redirect into G:\Android\emu-out.txt / emu-err.txt, and a ghost process can keep those files
# locked. We own a one-shot task "emu-ladder-rung" -> emu-ladder-rung.cmd, logging to
# emu-ladder-rung.log/.err, selecting the GPU mode through G:\Android\emu-ladder.gpu.
$RUNGTASK = 'emu-ladder-rung'
$RUNGCWD = 'G:\Android\emu-ladder-rung.cmd'
$RUNGMODE = 'G:\Android\emu-ladder.gpu'
$AVDFILE = 'G:\Android\emu-ladder.avd'

function Ensure-RungTask {
  $existing = Get-ScheduledTask -TaskName $RUNGTASK -ErrorAction SilentlyContinue
  if ($existing) { return $true }
  if ($DryRun) { Log ('  DRYRUN: would create one-shot rung task ' + $RUNGTASK); return $true }
  try {
    $action = New-ScheduledTaskAction -Execute $RUNGCWD
    $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Hours 12)
    Register-ScheduledTask -TaskName $RUNGTASK -Action $action -Principal $principal -Settings $settings -Force | Out-Null
    Log ('  created one-shot rung task ' + $RUNGTASK)
    return $true
  } catch { Log ('  could NOT create rung task: ' + $_.Exception.Message); return $false }
}

function Start-Rung([string]$gpuMode, [string]$label) {
  $avdName = 'dsh-p16'
  if ($BreakHostRung -and $gpuMode -eq 'host') { $avdName = 'no-such-avd'; Log '  [test hook] rung 1 deliberately uses a bogus -avd name (guaranteed failure)' }
  if ($DryRun) {
    Log ('  DRYRUN: would write ' + $AVDFILE + '=' + $avdName + ' and ' + $RUNGMODE + '=' + $gpuMode + ', then start ' + $RUNGTASK)
    return $true
  }
  try { Set-Content -LiteralPath $AVDFILE -Value $avdName -Encoding ASCII -Force } catch { }
  Log ('  rung ' + $label + ' -> gpu=' + $gpuMode + ' via task ' + $RUNGTASK)
  try { Set-Content -LiteralPath $RUNGMODE -Value $gpuMode -Encoding ASCII -Force } catch { Log ('  could not write ' + $RUNGMODE) }
  if (-not (Ensure-RungTask)) { return $false }
  $r = Run-Timeout 'schtasks.exe' @('/Run', '/TN', $RUNGTASK) 30
  Log ('    schtasks /Run /TN ' + $RUNGTASK + ' -> rc=' + $r.code)
  return $r.ok
}

# ================================================================================================
# -SelfTest: prove the renderer probe and the health classifier. Read-only: it never kills, starts
# or writes anything. This exists because the FIRST deploy attempt reached step 3 with a broken
# renderer probe and nobody noticed until the real-machine dry run -- so the regression that matters
# (can we actually READ the renderer off a live guest?) is now an explicit, permanent case.
# ================================================================================================
if ($SelfTest) {
  $fail = 0
  Write-Host '=== hardened self-heal: self-test (read-only) ==='

  # --- A. classifier, synthetic input -----------------------------------------------------------
  Write-Host ''
  Write-Host 'A. health classifier (synthetic renderer lines)'
  $nvidia = 'GLES: Google (NVIDIA Corporation), Android Emulator OpenGL ES Translator (NVIDIA GeForce RTX 4060 Laptop GPU/PCIe/SSE2), OpenGL ES 3.1 (4.5.0 NVIDIA 616.92)'
  $swift = 'GLES: Google (Google), Android Emulator OpenGL ES Translator (Google SwiftShader), OpenGL ES 3.0'
  $cases = @(
    @{ n = 'host NVIDIA adapter'; want = $true; line = $nvidia },
    @{ n = 'SwiftShader named'; want = $false; line = $swift },
    @{ n = 'vendored Google (Google)'; want = $false; line = 'GLES: Google (Google), something, OpenGL ES 3.0' },
    @{ n = 'empty string'; want = $false; line = '' },
    @{ n = 'foreign vendor (unknown)'; want = $false; line = 'GLES: Acme Corp, Acme Renderer, OpenGL ES 3.0' }
  )
  foreach ($c in $cases) {
    $got = IsHostGpuRenderer $c.line
    $ok = ($got -eq $c.want)
    if (-not $ok) { $fail++ }
    Write-Host ('  [' + $(if ($ok) { 'ok  ' } else { 'FAIL' }) + '] ' + $c.n + ' -> hostGpu=' + $got + ' (want ' + $c.want + ')')
  }

  # --- B. THE REGRESSION THAT SLIPPED: can we read the renderer off the LIVE guest? -------------
  Write-Host ''
  Write-Host 'B. live renderer probe (no override) -- the path that silently broke before'
  if (-not (GuestHealthy)) {
    Write-Host '  [skip] guest not healthy/booted; live probe not applicable right now'
  } else {
    $t = Get-Date
    $live = RendererLine
    $sec = [math]::Round(((Get-Date) - $t).TotalSeconds, 2)
    Write-Host ('  probe took      : ' + $sec + 's')
    Write-Host ('  renderer line   : ' + $(if ($live) { $live } else { '(EMPTY - THIS IS THE BUG)' }))
    $okLive = -not [string]::IsNullOrWhiteSpace($live)
    if (-not $okLive) { $fail++ }
    Write-Host ('  [' + $(if ($okLive) { 'ok  ' } else { 'FAIL' }) + '] probe returned a non-empty renderer line')
    $okNv = IsHostGpuRenderer $live
    Write-Host ('  [info] probe result classifies as host GPU: ' + $okNv + '  (this machine should be true)')
  }

  Write-Host ''
  if ($fail -eq 0) { Write-Host 'SELFTEST: PASS'; exit 0 }
  Write-Host ('SELFTEST: FAIL (' + $fail + ' problem(s))')
  exit 2
}

# ================================================================ main
Log ('=== emu-selfheal start (SshdOnly=' + [bool]$SshdOnly + ' DryRun=' + [bool]$DryRun + ') ===')
if ($DryRun) { Log ('DRYRUN MODE: nothing will be killed, started or written. dry log = ' + $LOG) }
if ($TestRendererOverride) { Log ('TEST HOOK active: renderer line is FORCED to: ' + $TestRendererOverride) }

# 1) sshd must always be alive: its absence once locked everybody out
$svc = Get-Service sshd -ErrorAction SilentlyContinue
if (-not $svc) { $svc = Get-Service 'OpenSSH SSH Server' -ErrorAction SilentlyContinue }
if (-not $svc) {
  Log 'sshd: SERVICE NOT FOUND (install OpenSSH Server)'
} else {
  if ($svc.StartType -ne 'Automatic') {
    if ($DryRun) { Log ('sshd: DRYRUN would set StartType -> Automatic'); }
    else {
      try { Set-Service -Name $svc.Name -StartupType Automatic; Log ('sshd: StartType ' + $svc.StartType + ' -> Automatic') }
      catch { Log ('sshd: could not set Automatic: ' + $_.Exception.Message) }
    }
  }
  $svc.Refresh()
  if ($svc.Status -ne 'Running') {
    if ($DryRun) { Log 'sshd: DRYRUN would start the service'; }
    else {
      try { Start-Service -Name $svc.Name; Start-Sleep -Seconds 2; $svc.Refresh(); Log ('sshd: ' + $svc.Status + ' -> Started (StartType=' + $svc.StartType + ')') }
      catch { Log ('sshd: start FAILED: ' + $_.Exception.Message) }
    }
  } else {
    Log ('sshd: already Running (StartType=' + $svc.StartType + ')')
  }
}

if ($SshdOnly) {
  $has = InteractiveSession
  Log ('sshd-only pass done; interactive console session: ' + $has + ' (INFORMATIONAL ONLY - never gates GPU decisions)')
  Log '=== emu-selfheal end ==='
  exit 0
}

# 2) session state is recorded for humans only (see F1 note above)
$interactive = InteractiveSession
Log ('interactive console session: ' + $interactive + ' (INFORMATIONAL ONLY - no longer gates the GPU ladder)')

# 3) health check -- now renderer-aware (F2)
$q0 = QemuProcs
if ($ForceLadder) {
  # Dry-run test hook: the health gate would exit early on a healthy real-GPU machine, which makes
  # the ladder itself unreachable and would turn a "fallback still works" test into a false pass.
  Log 'TEST HOOK: -ForceLadder set -> skipping the health gate so the ladder itself is exercised'
} elseif ($q0.Count -gt 0) {
  Log ('emulator process present: ' + (($q0 | ForEach-Object { $_.ProcessName + ':' + $_.Id }) -join ','))
  $healthy = GuestHealthy
  if ($healthy) {
    $rl = RendererLine
    Log ('renderer: ' + $(if ($rl) { $rl } else { '(COULD NOT READ)' }))
    if (IsHostGpuRenderer $rl) {
      $b = Adb @('shell', 'getprop', 'sys.boot_completed') 10
      Log ('already healthy ON THE REAL GPU (boot_completed=' + ($b.out -replace '\s+', '') + ') -> nothing to do')
      Log '=== emu-selfheal end ==='
      exit 0
    }
    # healthy but not on the host GPU => the state the user explicitly forbade
    if ([string]::IsNullOrWhiteSpace($rl)) {
      Log 'WARNING: renderer line unreadable -> failing CLOSED (treated as NOT host GPU)'
    }
    Log 'VIOLATION: guest is healthy but NOT rendering on the host GPU (CPU software rendering active)'
    Log '  -> correcting: kill the instance and relaunch rung 1 (-gpu host)'
    if ($DryRun) {
      Log '  DRYRUN: would taskkill the emulator tree, clear AVD locks, then start rung 1 with -gpu host'
      Log '=== emu-selfheal end (dry run) ==='
      exit 0
    }
    $killed = Kill-Emulator
    if (-not $killed) {
      Log 'RESULT: qemu survived taskkill -> THIS MACHINE NEEDS A REBOOT (nothing else can clear it)'
      Ntfy 'Laptop emulator needs a REBOOT' 'emu-selfheal: could not clear a CPU-rendering emulator (qemu survived taskkill); reboot DESKTOP-CPYH. See G:\Android\emu-ladder.log'
      Log '=== emu-selfheal end ==='
      exit 2
    }
    Clear-Locks
    # fall through to the ladder so rung 1 can bring it up on the real GPU
  } else {
    # zombie path: qemu alive but the guest does not answer
    Log ('guest NOT responsive with qemu alive -> zombie check (' + $ZombieProbes + ' probes)')
    $dead = $true
    for ($i = 1; $i -le $ZombieProbes; $i++) {
      if ($DryRun) { Log ('  DRYRUN: would probe ' + $i + '/' + $ZombieProbes); continue }
      Start-Sleep -Seconds $AdbTimeoutSec
      if (GuestHealthy) { $dead = $false; Log ('  probe ' + $i + ': guest answered after all -> NOT a zombie'); break }
      Log ('  probe ' + $i + '/' + $ZombieProbes + ': no answer from the guest')
    }
    if ($DryRun) { Log '  DRYRUN: would evaluate the zombie verdict after probing'; Log '=== emu-selfheal end (dry run) ==='; exit 0 }
    if (-not $dead) { Log '=== emu-selfheal end ==='; exit 0 }
    Log 'zombie confirmed -> taskkill /F /T'
    $killed = Kill-Emulator
    if (-not $killed) {
      Log 'RESULT: qemu survived taskkill -> THIS MACHINE NEEDS A REBOOT (nothing else can clear it)'
      Ntfy 'Laptop emulator needs a REBOOT' ('emu-selfheal: qemu zombie survived taskkill (' + (($q0 | ForEach-Object { $_.ProcessName + ':' + $_.Id }) -join ',') + '); only a reboot of DESKTOP-CPYH clears this. See G:\Android\emu-ladder.log')
      Log '=== emu-selfheal end ==='
      exit 2
    }
    Log 'zombie cleared by taskkill'
  }
} else {
  Log 'no emulator process running'
}

# 4) ladder: real GPU ALWAYS first (F1), software GPU only as a transient rescue (F3)
Clear-Locks
$hostOk = $false
Log 'rung 1: real GPU (-gpu host) -- attempted unconditionally (the old "no interactive session" skip was based on a falsified premise)'
Start-Rung 'host' '1-host-gpu' | Out-Null
$r = Wait-Boot $HostGpuTimeoutSec 'host-gpu'
if ($r.ok) {
  $rl = RendererLine
  if (IsHostGpuRenderer $rl) {
    $hostOk = $true
    Log ('RESULT: host-GPU ladder OK in ' + $r.sec + 's (real GPU confirmed by renderer)')
  } else {
    Log ('rung 1 booted but the renderer is NOT the host GPU -> treating rung 1 as failed')
    Log ('  renderer: ' + $(if ($rl) { $rl } else { '(COULD NOT READ)' }))
    Kill-Emulator | Out-Null
    Clear-Locks
  }
} else {
  Log ('rung 1 failed after ' + $r.sec + 's -> falling back to software GPU')
  Kill-Emulator | Out-Null
  Clear-Locks
}

if (-not $hostOk) {
  Log 'rung 2: software GPU (-gpu swiftshader_indirect) -- TRANSIENT RESCUE ONLY'
  Start-Rung 'swiftshader_indirect' '2-software-gpu' | Out-Null
  $r2 = Wait-Boot $SwTimeoutSec 'sw-gpu'
  if ($r2.ok) {
    Log ('RESULT: software-GPU fallback OK in ' + $r2.sec + 's (CPU RENDERING ACTIVE)')
    Log 'REGRESSION: the emulator is now on CPU software rendering; the user forbids this steady state.'
    # F3: never let software rendering become the persistent default.
    if ($DryRun) {
      Log ('  DRYRUN: would rewrite ' + $RUNGMODE + ' back to "host" so the next start retries the real GPU')
    } else {
      try {
        Set-Content -LiteralPath $RUNGMODE -Value 'host' -Encoding ASCII -Force
        Log ('  selector ' + $RUNGMODE + ' rewritten to "host": the next start will retry the real GPU')
      } catch { Log ('  could not rewrite ' + $RUNGMODE + ': ' + $_.Exception.Message) }
    }
  } else {
    Log 'RESULT: BOTH RUNGS FAILED (host + sw). A machine reboot is the documented cure for a stuck AVD/lock state.'
    $left = QemuProcs
    if ($left.Count -gt 0) {
      Log ('  note: qemu is present (' + (($left | ForEach-Object { $_.Id }) -join ',') + ') but the guest never answered; tried to clear it')
      $k2 = Kill-Emulator
      if (-not $k2) {
        Log 'RESULT: qemu survived -> THIS MACHINE NEEDS A REBOOT'
        Ntfy 'Laptop emulator needs a REBOOT' 'emu-selfheal: both ladder rungs failed and qemu survived taskkill; reboot DESKTOP-CPYH. See G:\Android\emu-ladder.log'
        Log '=== emu-selfheal end ==='
        exit 2
      }
    }
  }
}

Log '=== emu-selfheal end ==='
exit 0
