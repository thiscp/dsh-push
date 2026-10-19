# dsh-app-verify.ps1 - one-click APP verification pipeline.
#
# Flow (order is load-bearing, see HARD FACTS below):
#   preflight ssh (fail fast) -> seed token prefs -> build on vm1 -> push APK to emulator host
#     -> ONE ssh session: ensure emulator (clear AVD locks / pin selector to host / run emu-selfheal / wait for boot)
#        + install + publish test push + assert prefs + screenshot
#     -> pull screenshot -> (optional) deploy to aliyun -> SUMMARY
# Run from the orchestrator machine (the one holding ssh keys to all hosts).
# ASCII only on purpose: Windows PowerShell 5.1 misreads BOM-less UTF-8 scripts.
#
# HARD FACTS baked into this script (all paid for in blood; see verify/README.md):
#  * EVERY ssh/scp carries "-o BatchMode=yes -o ConnectTimeout=10". A stale host address must
#    fail in ~10 seconds. 2026-10-13: a stale LAN IP (<lan-laptop> - the laptop had drifted to
#    <lan-laptop>) made the 3rd ssh sit there for 34 minutes printing nothing.
#  * EVERY child process runs under a watchdog: per-step timeout + a whole-pipeline budget.
#    On timeout the script prints which step / which command / what error and exits non-zero.
#    Run "-WatchdogSelfTest" to prove the watchdog really kills and exits (see the report).
#  * The emulator is started AND driven inside ONE ssh session. Splitting it (start in ssh #1, come
#    back in ssh #2 to install/drive) failed twice on 2026-10-13: the install succeeds and then
#    "am start" answers "adb.exe: error: no devices/emulators found". The cause is NOT pinned down
#    (a later check saw the emulator survive a session end, so it looks like a race at session
#    release rather than a guaranteed reap) - same session is simply the recipe that works.
#    (The test push is therefore published from inside that same session, with curl on the host.)
#  * The launcher task is emu-selfheal (the HARDENED ladder), NOT dsh-emu-sw. dsh-emu-sw -> run-emu-sw.cmd
#    hardcodes "-gpu swiftshader_indirect" = CPU rendering, which the user forbids (fan noise) and which
#    invalidates the CSS360 geometry + screencap timing. The old note here claimed dsh-emu (-gpu host)
#    "crashes in non-interactive sessions (glTexImage2D 0x502)" - THAT PREMISE WAS FALSIFIED 2026-10-14:
#    with the console session DISCONNECTED, -gpu host still came up (6s, renderer = RTX 4060). So the
#    self-heal skips rung-1 no longer, and this pipeline pins the selector to "host" before launching.
#  * Emulator host address is the Tailscale IP (<win-host-a>). The LAN address drifts and its
#    firewall blocks new connections - see config.local.ps1 / config.example.ps1.
param(
  [string]$EmuIp     = "127.0.0.1",      # emulator host (see config.local.ps1 / config.example.ps1)
  [string]$EmuUser   = "user",
  [string]$EmuRoot   = "G:\Android",     # SDK + APK staging root on emulator host
  [string]$Vm1       = "user@build-host", # build host (ssh target)
  [string]$Aliyun    = "aliyun",         # ssh alias for APK distribution host
  [string]$Ntfy      = "https://ntfy.example.tld",
  [string]$Topic     = "dsh",            # CAUTION: production topic mirrors to the real phone too
  [string]$ReadToken  = "tk_REPLACE_READ",
  [string]$WriteToken = "tk_REPLACE_WRITE",
  [string]$OutDir    = "$env:TEMP\dsh-verify",
  [string]$Repo      = "$PSScriptRoot\..",
  [switch]$SkipBuild,                   # reuse -Apk (or last G:\Android\dsh-push.apk) instead of building
  [string]$Apk,                         # local APK path when -SkipBuild
  [switch]$Fresh,                       # pm clear + reseed token prefs before install
  [switch]$Deploy,                      # on PASS upload to aliyun dl and print ?v= link
  [string]$DeployNote,                  # changelog line for the update notification (default: version only)
  [switch]$NoNotify,                    # deploy silently without pushing the update notification
  [int]$TotalTimeoutSec = 1800,         # whole-pipeline watchdog (2026-10-13 hang was 34 min)
  [int]$SshTimeoutSec   = 60,           # default budget for one ssh/scp/curl command
  [int]$BuildTimeoutSec = 900,          # gradle assembleDebug on vm1
  [int]$EmuBootSec      = 300,          # emulator boot poll (cold start, swiftshader is slow)
  [int]$AssertSec       = 120,          # prefs assert poll inside the drive session
  [string]$Node         = "",            # node.exe for the geometry matrix (config.local.ps1; else PATH)
  [int]$GeomTimeoutSec  = 240,          # geometry matrix: 2 hosts x 2 states, cold start
  [switch]$WatchdogSelfTest             # diagnostic: prove a hung command is killed + non-zero exit
)
# Local infra overrides (hosts/tokens), see config.example.ps1 - not published
if (Test-Path "$PSScriptRoot\config.local.ps1") { . "$PSScriptRoot\config.local.ps1" }
$ErrorActionPreference = "Continue"
# A confirmation prompt is a silent hang when nobody is at the keyboard (nightly runs over ssh).
$ConfirmPreference = "None"
New-Item -ItemType Directory -Force $OutDir | Out-Null
$EmuRootFwd = $EmuRoot.Replace('\','/')

# ---------- self logging (the nightly report cites this path) ----------
$runStamp = Get-Date -Format "yyyyMMdd-HHmmss"
$LogFile = "$OutDir\verify-$runStamp.log"
try { Start-Transcript -Path $LogFile -Force | Out-Null } catch { Write-Host "WARN: transcript unavailable" }

# ---------- watchdog plumbing (every child process is watched) ----------
$SSH_OPTS = "-o BatchMode=yes -o ConnectTimeout=10"
$script:sw = [Diagnostics.Stopwatch]::StartNew()
$script:pn = 0
function ElapsedSec { [int][Math]::Floor($script:sw.Elapsed.TotalSeconds) }
function Log([string]$m) { Write-Host ("+{0,5}s {1}" -f (ElapsedSec), $m) }
function Get-FileText([string]$f) { if (Test-Path $f) { [IO.File]::ReadAllText($f) } else { "" } }
function Flatten([string]$t) {
  if (-not $t) { return "(empty)" }
  $ls = @($t -split "`r?`n" | Where-Object { $_.Trim() -ne "" })
  if ($ls.Count -eq 0) { return "(empty)" }
  return ($ls -join " | ")
}
function Finish([int]$code) {
  Write-Host ("LOG: " + $LogFile)
  try { Stop-Transcript | Out-Null } catch { }
  exit $code
}
$script:results = @()
function Report([string]$name, [bool]$ok, [string]$detail) {
  $script:results += [pscustomobject]@{ Name = $name; Ok = $ok; Detail = $detail }
  Write-Host ("[{0}] {1}{2}" -f ($(if ($ok) { "PASS" } else { "FAIL" })), $name, $(if ($detail) { " - " + $detail } else { "" }))
}
# Abort = the only "cannot continue" exit path. Always names step + command + error + budget.
function Abort-Step([string]$step, [string]$why, [string]$cmd, [string]$err, [string]$out) {
  Log ("FATAL step=" + $step)
  Log ("FATAL why=" + $why)
  Log ("FATAL cmd=" + $cmd)
  Log ("FATAL stderr=" + (Flatten $err))
  Log ("FATAL stdout=" + (Flatten $out))
  Log ("FATAL budget: elapsed=" + (ElapsedSec) + "s of total=" + $TotalTimeoutSec + "s")
  Report $step $false $why
  Write-Host ("SUMMARY: ABORTED at step " + $step + " after " + (ElapsedSec) + "s - " + $why)
  Finish 3
}
# Child process under a watchdog: stdout/stderr to files, optional stdin from a file.
# Uses .NET Process (not Start-Process): on this box Start-Process -PassThru reports a null
# ExitCode, which would turn "exit 255" into an unreadable empty reason. Redirection is done by
# cmd itself ("/c <line> > out 2> err [< in]") so the command line reaches cmd verbatim.
function Start-Watched([string]$step, [string]$cmdLine, [int]$timeoutSec, [string]$stdinFile) {
  $script:pn++
  $o = "$OutDir\proc-$($script:pn).out"
  $e = "$OutDir\proc-$($script:pn).err"
  Remove-Item $o,$e -Force -ErrorAction SilentlyContinue
  Log ("RUN  step=" + $step + " timeout=" + $timeoutSec + "s")
  Log ("CMD  " + $cmdLine)
  $full = "/c " + $cmdLine + ' > "' + $o + '" 2> "' + $e + '"'
  if ($stdinFile) { $full = $full + ' < "' + $stdinFile + '"' }
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = "cmd.exe"
  $psi.Arguments = $full
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  return [pscustomobject]@{ Step = $step; Cmd = $cmdLine; Proc = $p; Out = $o; Err = $e
                            Timeout = $timeoutSec; TimedOut = $false; ExitCode = $null
                            OutText = ""; ErrText = ""; Why = "" }
}
function Wait-Watched($h) {
  $left = $TotalTimeoutSec - (ElapsedSec)
  if ($left -lt 1) { $left = 1 }
  $lim = $h.Timeout
  $limitedBy = "step timeout " + $h.Timeout + "s"
  if ($left -lt $lim) {
    $lim = $left
    $limitedBy = "whole-pipeline budget " + $TotalTimeoutSec + "s (elapsed " + (ElapsedSec) + "s)"
  }
  if ($lim -lt 1) { $lim = 1 }
  $done = $h.Proc.WaitForExit($lim * 1000)
  if (-not $done) {
    $h.TimedOut = $true
    $h.Why = "still running with no result after " + $lim + "s - " + $limitedBy + "; watchdog killed it"
    Log ("TIMEOUT step=" + $h.Step + " - killing process tree pid " + $h.Proc.Id + " (" + $limitedBy + ")")
    taskkill /T /F /PID $h.Proc.Id 2>&1 | Out-Null
    Start-Sleep -Milliseconds 700
  } else {
    $h.Proc.WaitForExit()   # documented: flushes redirected output
    $h.ExitCode = $h.Proc.ExitCode
  }
  $h.OutText = Get-FileText $h.Out
  $h.ErrText = Get-FileText $h.Err
  Log ("DONE step=" + $h.Step + " rc=" + $h.ExitCode + " out_bytes=" + $h.OutText.Length + " elapsed=" + (ElapsedSec) + "s")
  return $h
}
# Run one command; any timeout or non-zero exit aborts with the full diagnostic block.
function Invoke-Watched([string]$step, [string]$cmdLine, [int]$timeoutSec, [string]$stdinFile) {
  $h = Start-Watched $step $cmdLine $timeoutSec $stdinFile
  $h = Wait-Watched $h
  if ($h.TimedOut) { Abort-Step $step $h.Why $h.Cmd $h.ErrText $h.OutText }
  if ($h.ExitCode -ne 0) { Abort-Step $step ("command failed: exit code " + $h.ExitCode + " (stderr above)") $h.Cmd $h.ErrText $h.OutText }
  return $h
}
# Which assertion does a dead drive session map to? (last STAGE= line it managed to print)
function Stage-Report([string]$text, [string]$fallback) {
  $st = ""
  $m = [regex]::Matches($text, 'STAGE=(\S+)')
  if ($m.Count -gt 0) { $st = $m[$m.Count - 1].Groups[1].Value }
  $map = @{ "emu-check" = "emulator-up"; "install" = "install"; "publish" = "push-received"
            "assert" = "push-received"; "screenshot" = "screenshot" }
  if ($map.ContainsKey($st)) { return $map[$st] }
  return $fallback
}

# ---------- 0. watchdog self-test (diagnostic: no network, no device) ----------
if ($WatchdogSelfTest) {
  Log "SELFTEST: handing a deliberately hung command (Start-Sleep 120) to the watchdog, timeout 5s"
  $h = Start-Watched "watchdog-selftest" 'powershell -NoProfile -Command "Start-Sleep -Seconds 120"' 5 $null
  $h = Wait-Watched $h
  if (-not $h.TimedOut) { Log "SELFTEST FAILED: hung command was not killed"; Finish 4 }
  Abort-Step "watchdog-selftest" $h.Why $h.Cmd $h.ErrText $h.OutText
}

# ---------- 1. preflight: is the emulator host reachable at all? (fail fast in ~10s) ----------
$pre = Invoke-Watched "emulator-up" ("ssh " + $SSH_OPTS + " " + $EmuUser + "@" + $EmuIp + " hostname") 20 $null
$emuHost = ($pre.OutText -split "`r?`n" | Where-Object { $_.Trim() -ne "" } | Select-Object -First 1)
Log ("emulator host reachable: " + $emuHost + " (" + $EmuIp + ")")

# ---------- 2. token prefs seed (used by -Fresh and bootstrap) ----------
$seed = "$OutDir\dshpush.xml"
[IO.File]::WriteAllText($seed, "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>`n<map>`n    <string name=`"token`">$ReadToken</string>`n</map>`n", (New-Object Text.UTF8Encoding $false))
Invoke-Watched "seed-prefs" ("scp " + $SSH_OPTS + " `"$seed`" `"${EmuUser}@${EmuIp}:$EmuRootFwd/dshpush.xml`"") $SshTimeoutSec $null | Out-Null

# ---------- 3. build on vm1 (unless -SkipBuild) ----------
$localApk = "$OutDir\dsh-push.apk"
if (-not $SkipBuild) {
  Invoke-Watched "build-vm1" ("ssh " + $SSH_OPTS + " " + $Vm1 + " `"rm -rf work/projects/dsh-push/android-app/app/src`"") $SshTimeoutSec $null | Out-Null
  Invoke-Watched "build-vm1" ("scp " + $SSH_OPTS + " -r `"$Repo\android-app\app\src`" `"${Vm1}:work/projects/dsh-push/android-app/app/`"") $SshTimeoutSec $null | Out-Null
  Invoke-Watched "build-vm1" ("scp " + $SSH_OPTS + " `"$Repo\android-app\app\build.gradle.kts`" `"${Vm1}:work/projects/dsh-push/android-app/app/`"") $SshTimeoutSec $null | Out-Null
  Invoke-Watched "build-vm1" ("scp " + $SSH_OPTS + " `"$Repo\android-app\build.gradle.kts`" `"$Repo\android-app\settings.gradle.kts`" `"$Repo\android-app\gradle.properties`" `"${Vm1}:work/projects/dsh-push/android-app/`"") $SshTimeoutSec $null | Out-Null
  $vm1Build = @'
set -e
export JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64
export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH
cd ~/work/projects/dsh-push/android-app
gradle assembleDebug -q < /dev/null
stat -c %s app/build/outputs/apk/debug/app-debug.apk
'@
  $f = "$OutDir\vm1-build.sh"
  [IO.File]::WriteAllText($f, $vm1Build, (New-Object Text.UTF8Encoding $false))
  $bd = Invoke-Watched "build-vm1" ("ssh -F NUL " + $SSH_OPTS + " " + $Vm1 + " `"tr -d '\r' | bash -s`"") $BuildTimeoutSec $f
  $size = ($bd.OutText -split "`r?`n" | Where-Object { $_ -match '^\d{6,}$' } | Select-Object -Last 1)
  if (-not $size) { Abort-Step "build-vm1" "gradle produced no apk size line" $bd.Cmd $bd.ErrText $bd.OutText }
  Invoke-Watched "fetch-apk" ("scp " + $SSH_OPTS + " `"${Vm1}:work/projects/dsh-push/android-app/app/build/outputs/apk/debug/app-debug.apk`" `"$localApk`"") $SshTimeoutSec $null | Out-Null
  Report "build-vm1" $true "apk $size bytes"
} else {
  if ($Apk) { Copy-Item $Apk $localApk -Force }
  else { Invoke-Watched "fetch-apk" ("scp " + $SSH_OPTS + " `"${EmuUser}@${EmuIp}:$EmuRootFwd/dsh-push.apk`" `"$localApk`"") $SshTimeoutSec $null | Out-Null }
  Report "build-vm1" (Test-Path $localApk) "skipped, reused $localApk"
}
Invoke-Watched "push-apk" ("scp " + $SSH_OPTS + " `"$localApk`" `"${EmuUser}@${EmuIp}:$EmuRootFwd/dsh-push.apk`"") $SshTimeoutSec $null | Out-Null

# ---------- 4. the ONE drive session: emulator + install + push + assert + screenshot ----------
# All device-facing work happens inside this single ssh session. Do NOT split it: see HARD FACTS.
$epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$stamp = Get-Date -Format "HHmmss"
$driveTpl = @'
$ErrorActionPreference="Continue"
$ConfirmPreference="None"   # a confirmation prompt over ssh blocks forever: stdin is the channel
$adb   = "G:\Android\Sdk\platform-tools\adb.exe"
$curl  = "C:\Windows\System32\curl.exe"
$avdCm = "G:\Android\run-emu.cmd"
# BANNED: dsh-emu-sw -> run-emu-sw.cmd hardcodes -gpu swiftshader_indirect = CPU rendering.
# User forbids CPU rendering (fan noise) and it invalidates the CSS360 geometry + screencap timing.
# Authoritative launcher = the hardened self-heal (it reads the selector file and pins rung 1 to host).
$task  = "emu-selfheal"
$apk   = "G:\Android\dsh-push.apk"
$bootSec   = __BOOTSEC__
$assertSec = __ASSERTSEC__
$epoch = "__EPOCH__"
$topic = "__TOPIC__"
$token = "__WTOKEN__"
$ntfy  = "__NTFY__"
function A { param($a) (& $adb @a 2>&1) -join " | " }
# Progress marker that also survives a broken ssh channel: printed AND written to the host disk.
# When a run looks wedged, the first thing to read on the emulator host is G:\Android\verify-stage.txt.
function Stage([string]$m) {
  "STAGE=" + $m
  try { Set-Content -LiteralPath "G:\Android\verify-stage.txt" -Value $m -Encoding ASCII -Confirm:$false } catch { }
}
function CurSerial {
  $s = ""
  foreach ($l in ((& $adb devices) 2>&1)) { if ($l -match "^(emulator-\d+)\s+device") { $s = $Matches[1]; break } }
  return $s
}
"### DRIVE START pid=" + $PID + " " + (Get-Date -Format o)

# [1] emulator lifecycle - this session owns the emulator from here on
Stage "emu-check"
$serial = CurSerial
"EMU_BEFORE=" + $(if ($serial) { $serial } else { "none" })
if (-not $serial) {
  $avd = "dsh-p16"
  if ((Test-Path $avdCm) -and ((Get-Content $avdCm -Raw) -match "-avd\s+(\S+)")) { $avd = $Matches[1] }
  "AVD=" + $avd
  $avdDir = "$env:USERPROFILE\.android\avd\$avd.avd"
  foreach ($lf in @("hardware-qemu.ini.lock","multiinstance.lock")) {
    $p = Join-Path $avdDir $lf
    "LOCK_TRY=" + $p
    if (Test-Path $p) {
      # HARD FACT 2026-10-13: hardware-qemu.ini.lock is a DIRECTORY (it holds a "pid" file), and
      # PS 5.1 Remove-Item on a non-empty directory WITHOUT -Recurse raises a CONFIRMATION PROMPT.
      # Over ssh stdin is the channel, so it blocks forever at 0% CPU (this wedged a whole run
      # right after "AVD=dsh-p16"). Always: -LiteralPath -Recurse -Force -Confirm:$false.
      Remove-Item -LiteralPath $p -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue
      if (Test-Path $p) { "LOCK_FAILED=" + $p } else { "LOCK_CLEARED=" + $p }
    }
    else { "LOCK_ABSENT=" + $p }
  }
  # pin the persistent selector to host so the (hardened) ladder's rung 1 is the real GPU
  Set-Content "G:\Android\emu-ladder.gpu" "host" -Encoding ASCII -Force
  schtasks /Run /TN $task 2>&1 | Out-Null
  "TASK_RUN=" + $task + " " + (Get-Date -Format HH:mm:ss)
  $t0 = Get-Date
  while (((Get-Date) - $t0).TotalSeconds -lt $bootSec) {
    $serial = CurSerial
    if ($serial) {
      $b = ((& $adb -s $serial shell getprop sys.boot_completed) 2>&1) -join ""
      if ($b -match "1") { break }
    }
    Start-Sleep 5
  }
}
"EMU_AFTER=" + $(if ($serial) { $serial } else { "none" })
if (-not $serial) {
  "EMU_FAIL=no device after " + $bootSec + "s"
  "emu-ladder-rung.err tail (self-heal rung, formerly emu-sw-err.txt):"
  (Get-Content "G:\Android\emu-ladder-rung.err" -Tail 10 -ErrorAction SilentlyContinue)
  "### DRIVE DONE rc=1"
  exit 1
}
$bt  = ((& $adb -s $serial shell getprop sys.boot_completed) 2>&1) -join ""
$api = ((& $adb -s $serial shell getprop ro.build.version.sdk) 2>&1) -join ""
"EMU_UP=SERIAL=" + $serial + " BOOT=" + $(if ($bt -match "1") { 1 } else { 0 }) + " API=" + $api
# Gap found 2026-10-16 12:1x: the boot poll above only runs when NO device is attached at all. An
# emulator that is ATTACHED but still booting (the self-heal ladder restarted it) skipped that wait,
# so adb install died with "Error: device is still booting" and the 120s assert poll burned the whole
# step (144s) before aborting. Wait for boot_completed here too - cap $bootSec, and print it.
if ($bt -notmatch "1") {
  "BOOT_WAIT=begin"
  $rt = Get-Date
  while (((Get-Date) - $rt).TotalSeconds -lt $bootSec) {
    $b2 = ((& $adb -s $serial shell getprop sys.boot_completed) 2>&1) -join ""
    if ($b2 -match "1") { $bt = $b2; break }
    Start-Sleep -Milliseconds 2000
  }
  "BOOT_WAIT=end " + [int]((Get-Date) - $rt).TotalSeconds + "s BOOT=" + $bt.Trim()
}
& $adb root 2>&1 | Out-Null
# readiness (was blind Start-Sleep 2): poll until adbd answers as uid 0, cap 10s, then carry on
$rt = Get-Date
$u = ""
while (((Get-Date) - $rt).TotalSeconds -lt 10) {
  $u = (((& $adb wait-for-device shell id -u) 2>&1) -join "").Trim()
  if ($u -eq "0") { break }
  Start-Sleep -Milliseconds 400
}
"ROOT_UID=" + $u + " WAIT=" + [int]((Get-Date) - $rt).TotalSeconds
& $adb wait-for-device 2>&1 | Out-Null
$S = @("-s", $serial)

# [2] install (+ optional fresh seed)
Stage "install"
"INSTALL=" + (A ($S + @("install","-r","-g",$apk)))
if ("__FRESH__" -eq "1") {
  A ($S + @("shell","pm","clear","xyz.cpyh.dshpush")) | Out-Null
  # readiness (was blind Start-Sleep 2): wait for the app data dir to come back, cap 10s
  $rt = Get-Date
  while (((Get-Date) - $rt).TotalSeconds -lt 10) {
    if ((A ($S + @("shell","stat","-c","%u","/data/data/xyz.cpyh.dshpush"))).Trim() -match "^[0-9]+$") { break }
    Start-Sleep -Milliseconds 400
  }
  "CLEAR_WAIT=" + [int]((Get-Date) - $rt).TotalSeconds
  A ($S + @("push","G:\Android\dshpush.xml","/data/local/tmp/dshpush.xml")) | Out-Null
  A ($S + @("shell","mkdir","-p","/data/data/xyz.cpyh.dshpush/shared_prefs")) | Out-Null
  A ($S + @("shell","cp","/data/local/tmp/dshpush.xml","/data/data/xyz.cpyh.dshpush/shared_prefs/dshpush.xml")) | Out-Null
  $uid = (A ($S + @("shell","stat","-c","%u","/data/data/xyz.cpyh.dshpush"))).Trim()
  A ($S + @("shell","chown","-R",$uid,"/data/data/xyz.cpyh.dshpush/shared_prefs")) | Out-Null
  A ($S + @("shell","restorecon","-R","/data/data/xyz.cpyh.dshpush/shared_prefs")) | Out-Null
}
A ($S + @("shell","pm","grant","xyz.cpyh.dshpush","android.permission.POST_NOTIFICATIONS")) | Out-Null
A ($S + @("shell","appops","set","xyz.cpyh.dshpush","REQUEST_INSTALL_PACKAGES","allow")) | Out-Null
A ($S + @("shell","am","force-stop","xyz.cpyh.dshpush")) | Out-Null
"START=" + (A ($S + @("shell","am","start","-n","xyz.cpyh.dshpush/.MainActivity")))
# readiness (was blind Start-Sleep 8): the test push only lands if the app already holds its
# WebSocket to the relay. Poll for an ESTABLISHED socket owned by the app uid (adb root gives us
# uid= via ss -e), cap 10s, then publish ANYWAY - a miss is caught by the assert poll below,
# so this wait is an optimisation, never a gate. Worst case = 10s (2s worse than the old blind 8s).
$cn = "pending"
$rt = Get-Date
while (((Get-Date) - $rt).TotalSeconds -lt 10) {
  $ss = A ($S + @("shell","ss","-tpe","state","established"))
  # this Android ss build prints NO uid= even with -e, and truncates the process name to 15 chars
  # (xyz.cpyh.dshpush -> yz.cpyh.dshpush), so match the tail of the name instead. Port 443/https is the
  # relay WebSocket; the DSH Web link shows up as :3080 and must not count as "connected".
  foreach ($ln in ($ss -split "`r?`n")) {
    if ($ln -match "cpyh.dshpush" -and $ln -match ":https|:443") { $cn = "up"; break }
  }
  if ($cn -eq "up") { break }
  Start-Sleep -Milliseconds 500
}
"CONN=" + $cn + " WAIT=" + [int]((Get-Date) - $rt).TotalSeconds

# [3] publish the unique test push (from inside this session: no second ssh while the emulator lives)
Stage "publish"
$body = "auto-verify " + $epoch
$code = & $curl -s -o "$env:TEMP\verify-push.txt" -w "%{http_code}" -X POST ($ntfy + "/" + $topic) -H ("Authorization: Bearer " + $token) -H ("Title: auto-verify " + (Get-Date -Format HHmmss)) -d $body
"PUSH_HTTP=" + $code + " BODY=" + $body

# [4] assert prefs: entry arrived, unread, unique mid
Stage "assert"
$hits = 0
$t0 = Get-Date
while (((Get-Date) - $t0).TotalSeconds -lt $assertSec) {
  $p = A ($S + @("shell","cat","/data/data/xyz.cpyh.dshpush/shared_prefs/dshpush.xml"))
  $m = [regex]::Matches($p, "auto-verify " + $epoch + ".*?mid&quot;:(-?\d+),&quot;read&quot;:(\w+)")
  if ($m.Count -ge 1) {
    foreach ($x in $m) { "MID=" + $x.Groups[1].Value + " READ=" + $x.Groups[2].Value }
    $hits = $m.Count
    break
  }
  Start-Sleep -Milliseconds 1000   # poll interval (was 4s blind): arrival typically lands in 1-2s
}
"HITS=" + $hits

# [5] screenshot (re-foreground MainActivity first: stale dialogs can cover it)
Stage "screenshot"
cmd /c "`"$adb`" -s $serial shell input keyevent KEYCODE_BACK" 2>&1 | Out-Null
& $adb -s $serial shell am start -n xyz.cpyh.dshpush/.MainActivity 2>&1 | Out-Null
# readiness (was blind Start-Sleep 3): wait until MainActivity actually holds focus, cap 8s
$fc = "pending"
$rt = Get-Date
while (((Get-Date) - $rt).TotalSeconds -lt 8) {
  $w = (((& $adb -s $serial shell dumpsys window) 2>&1) -join " ")
  if ($w -match "mCurrentFocus=.*MainActivity") { $fc = "focused"; break }
  Start-Sleep -Milliseconds 400
}
"FOCUS=" + $fc + " WAIT=" + [int]((Get-Date) - $rt).TotalSeconds
cmd /c "`"$adb`" -s $serial exec-out screencap -p > G:\Android\verify-shot.png"
$sl = 0
if (Test-Path "G:\Android\verify-shot.png") { $sl = (Get-Item "G:\Android\verify-shot.png").Length }
"SHOT_BYTES=" + $sl
"### DRIVE DONE rc=0"
'@
$drive = $driveTpl.Replace("__BOOTSEC__", "$EmuBootSec").Replace("__ASSERTSEC__", "$AssertSec").Replace("__EPOCH__", "$epoch").Replace("__TOPIC__", $Topic).Replace("__WTOKEN__", $WriteToken).Replace("__NTFY__", $Ntfy).Replace("__FRESH__", $(if ($Fresh) { "1" } else { "0" }))
$f = "$OutDir\drive.ps1"
[IO.File]::WriteAllText($f, $drive, (New-Object Text.UTF8Encoding $false))
Invoke-Watched "drive" ("scp " + $SSH_OPTS + " `"$f`" `"${EmuUser}@${EmuIp}:$EmuRootFwd/verify-drive.ps1`"") $SshTimeoutSec $null | Out-Null
$driveTimeout = $EmuBootSec + $AssertSec + 240
$dv = Start-Watched "drive" ("ssh " + $SSH_OPTS + " " + $EmuUser + "@" + $EmuIp + " `"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File $EmuRoot\verify-drive.ps1 < NUL`"") $driveTimeout $null
$dv = Wait-Watched $dv
if ($dv.TimedOut -or $dv.ExitCode -ne 0) {
  $rep = Stage-Report $dv.OutText "emulator-up"
  $why = if ($dv.TimedOut) { $dv.Why } else { "drive session exited rc=" + $dv.ExitCode }
  Abort-Step $rep ($why + " (last STAGE= line above says which sub-step)") $dv.Cmd $dv.ErrText $dv.OutText
}
$lines = @($dv.OutText -split "`r?`n")
function Grab([string]$pat) { return (($lines | Where-Object { $_ -match $pat } | Select-Object -First 1)) }
$emuUp = Grab '^EMU_UP='
if (-not $emuUp) {
  $rep = Stage-Report $dv.OutText "emulator-up"
  Abort-Step $rep ("drive session produced no EMU_UP line; rc=" + $dv.ExitCode) $dv.Cmd $dv.ErrText $dv.OutText
}
$serial = ($emuUp -replace '.*SERIAL=(emulator-\d+).*', '$1')
$api    = ($emuUp -replace '.*API=', '')
Report "emulator-up" ($emuUp -match "BOOT=1") "serial=$serial api=$api"
$inst = Grab '^INSTALL='
if (-not $inst) { Abort-Step "install" "drive session produced no INSTALL line" $dv.Cmd $dv.ErrText $dv.OutText }
$instOk = $inst -match "Success"
Report "install" $instOk ($inst -replace '^INSTALL=', '')
if (-not $instOk) {
  Log "FATAL install did not report Success - refusing to assert against a stale app"
  Write-Host ("SUMMARY: ABORTED at step install after " + (ElapsedSec) + "s - adb install failed")
  Finish 3
}
$push = Grab '^PUSH_HTTP='
$a = $dv.OutText
$hitsM = [regex]::Match($a, 'HITS=(\d+)')
$hits = if ($hitsM.Success) { [int]$hitsM.Groups[1].Value } else { 0 }
$mids = (([regex]::Matches($a, 'MID=(-?\d+)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique))
Report "push-received" ($hits -ge 1) ("entries with unique body: " + $hits + "; " + $(if ($push) { $push } else { "no PUSH_HTTP line" }))
Report "mid-unique" ($mids.Count -eq $hits -and $hits -ge 1) ("distinct mids: " + ($mids -join ','))
Report "entry-unread" ($a -match 'READ=false') ""

# ---------- 5. pull the screenshot ----------
$shot = "$OutDir\verify-$stamp.png"
Invoke-Watched "screenshot" ("scp " + $SSH_OPTS + " `"${EmuUser}@${EmuIp}:$EmuRootFwd/verify-shot.png`" `"$shot`"") $SshTimeoutSec $null | Out-Null
$ok = (Test-Path $shot) -and ((Get-Item $shot).Length -gt 100000)
Report "screenshot" $ok "$shot"

# ---------- 5b. geometry matrix (column widths, both hosts, collapsed + expanded) ----------
# Added 2026-10-16 right after the v1.32.17 real-device regression: the 9 checks above never
# measured COLUMN WIDTH (only card backgrounds + the wallpaper red line), so a P1 that pinned the
# chat column to 56px on the laptop host passed 9/9 and reached the user's phone. See GLASS-OVERLAY.md 11.14.
# The harness exits 0=PASS / 1=FAIL / 2=ENV, so it must NOT go through Invoke-Watched (that aborts
# the whole pipeline on any non-zero exit). Start/Wait-Watched keeps it a plain FAIL row.
#
# 2026-10-17 incident: v1.32.36 never reached the user's phone. The matrix timed out (3rd of 4 runs
# that day) and was reported as a plain FAIL, while step 6 (see the `if ($Deploy -and ...)` guard
# below) deploys ONLY when EVERY earlier step is Ok - so BOTH the APK upload AND the update
# notification were silently skipped, yet the run still printed "SUMMARY: 8/8 passed" and the
# release script happily reported an online size that was still the PREVIOUS build.
# Rule now: only a real geometry regression (verdict=FAIL, fails>0) may block the deploy. ENV /
# timeout / missing harness is an environment problem: the row keeps its own wording and now says
# "ENV - not blocking deploy", so the log stays honest and the release still ships.
$gmScript = "$Repo\verify\geom-matrix.mjs"
$gmNode = $Node
if (-not $gmNode) { $gmGc = Get-Command node -ErrorAction SilentlyContinue; if ($gmGc) { $gmNode = $gmGc.Source } }
if (-not $gmNode -or -not (Test-Path $gmScript)) {
  Report "geom-matrix" $true ("ENV - cannot run: node='" + $gmNode + "' harness=" + $(if (Test-Path $gmScript) { "found" } else { "missing $gmScript" }) + " (not blocking deploy)")
} else {
  $gmJson = "$OutDir\geom-matrix.json"
  if (Test-Path $gmJson) { Remove-Item $gmJson -Force }
  # Deliberately NO quotes: cmd /c strips the outermost quote pair when a command line carries several
  # quote pairs, which turned the watchdog's own "> out 2>&1" into node arguments and lost every byte of
  # output (first run of this check reported ENV with out_bytes=0). All paths here are space-free.
  $gmCmd = $gmNode + " " + $gmScript + " --json --json-out " + $gmJson + " --shots " + $OutDir
  $gh = Start-Watched "geom-matrix" $gmCmd $GeomTimeoutSec $null
  $gh = Wait-Watched $gh
  if ($gh.TimedOut) {
    Report "geom-matrix" $true ("ENV - timeout after " + $GeomTimeoutSec + "s - " + $gh.Why + " (not blocking deploy)")
  } else {
    $gmTxt = ""
    if (Test-Path $gmJson) { $gmTxt = [IO.File]::ReadAllText($gmJson, [Text.Encoding]::UTF8) }
    if (-not $gmTxt) { $gmTxt = $gh.OutText }
    $gmV = "ENV"; $gmD = ""
    $gmM = [regex]::Match($gmTxt, '\{"mode":.*?\}\s*$')
    if (-not $gmM.Success) { $gmM = [regex]::Match($gmTxt, '\{"mode":.*\}') }
    if ($gmM.Success) {
      try {
        $gj = $gmM.Value | ConvertFrom-Json
        $gmV = [string]$gj.verdict
        $gmF = @($gj.fails)
        $gmD = "states=" + $gj.states + " fails=" + $gmF.Count + $(if ($gmF.Count) { "; " + ($gmF -join " | ") } else { "" })
      } catch { $gmV = "ENV"; $gmD = "json parse failed: " + $_.Exception.Message }
    } else {
      $gmD = "no json line; tail: " + (Flatten $gmTxt).Substring([Math]::Max(0, (Flatten $gmTxt).Length - 180))
    }
    Report "geom-matrix" ($gmV -ne "FAIL") ("verdict=" + $gmV + "; " + $gmD + $(if ($gmV -eq "ENV") { " (ENV - not blocking deploy)" } else { "" }))
  }
}

# ---------- 6. optional deploy ----------
if ($Deploy -and @($script:results | Where-Object { -not $_.Ok }).Count -eq 0) {
  $vc = [regex]::Match((Get-Content "$Repo\android-app\app\build.gradle.kts" -Raw), 'versionCode\s*=\s*(\d+)').Groups[1].Value
  Invoke-Watched "deploy" ("scp " + $SSH_OPTS + " `"$localApk`" `"${Aliyun}:/var/www/certbot/dl/dsh-push.apk`"") $SshTimeoutSec $null | Out-Null
  $chkH = Invoke-Watched "deploy" ("curl.exe -s -o `"$OutDir\dl-check.apk`" -w `"%{http_code} %{size_download}`" `"$Ntfy/dl/dsh-push.apk?v=$vc`"") $SshTimeoutSec $null
  $chk = $chkH.OutText
  $same = (Get-FileHash "$OutDir\dl-check.apk" -Algorithm SHA256).Hash -eq (Get-FileHash $localApk -Algorithm SHA256).Hash
  Report "deploy" ($chk -match "^200" -and $same) "link: $Ntfy/dl/dsh-push.apk?v=$vc"
  # Push update notification (v1.28.0+). HARD FACT 2026-10-12: this ntfy behind the aliyun edge
  # nginx only parses a JSON body when POSTed to the ROOT with "topic" inside it - posting the
  # same JSON to /<topic> stores the whole blob as plain text. So: POST $Ntfy, never $Ntfy/$Topic.
  if (-not $NoNotify -and ($chk -match "^200") -and $same) {
    $vn = [regex]::Match((Get-Content "$Repo\android-app\app\build.gradle.kts" -Raw), 'versionName\s*=\s*"([^"]+)"').Groups[1].Value
    $dl = "$Ntfy/dl/dsh-push.apk?v=$vc"
    $note = if ($DeployNote) { $DeployNote } else { "updated to v$vn" }
    $note = $note.Replace('\','\\').Replace('"','\"')
    $pj = '{"topic":"' + $Topic + '","title":"dsh-push update v' + $vn + '","message":"' + $note + '\n#web ' + $dl + '","priority":4,"click":"' + $dl + '"}'
    $pf = Join-Path $OutDir "upd-note.json"
    [IO.File]::WriteAllText($pf, $pj, (New-Object Text.UTF8Encoding $false))
    $rH = Invoke-Watched "update-notify" ("curl.exe -s -X POST -H `"Authorization: Bearer $WriteToken`" -H `"Content-Type: application/json`" --data-binary `"@$pf`" $Ntfy") $SshTimeoutSec $null
    $r = $rH.OutText
    $nid = try { ($r | ConvertFrom-Json).id } catch { "?" }
    Report "update-notify" ($r -match '"title":"dsh-push update') "id: $nid"
  }
}

# ---------- summary ----------
# PS 5.1 硬坑（2026-10-17 实测）：管道只命中一个对象时 (... | Where-Object {…}).Count 返回 $null，
# 而 $null 在算术里当 0 → 明明有一项 FAIL 也打出「N/N passed」（v1.33.0 那轮 screenshot 就是这样被
# 报成 8/8 的）。闸门侥幸是对的（$null -eq 0 为假），但总结会骗人，故用 @() 强制成数组。
$fail = @($script:results | Where-Object { -not $_.Ok }).Count
Write-Host ""
Write-Host ("SUMMARY: {0}/{1} passed" -f ($script:results.Count - $fail), $script:results.Count)
Finish $(if ($fail) { 1 } else { 0 })
