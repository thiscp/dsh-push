# bw-iter.ps1 - build, install, open WebActivity, screenshot. ASCII only.
# Infra values come from config.local.ps1 (see config.example.ps1).
#
# Same safety rules as dsh-app-verify.ps1 (details in verify/README.md):
#  * every ssh/scp carries "-o BatchMode=yes -o ConnectTimeout=10": a stale host address must
#    fail in ~10s instead of hanging silently (2026-10-13: a stale LAN IP sat for 34 minutes).
#  * every child process runs under a watchdog (per-step timeout + whole-script budget); on
#    timeout it prints which step / which command / what error and exits non-zero.
#  * the emulator is started (clear stale AVD locks + pin selector to host + run the hardened
#    self-heal task emu-selfheal) AND driven in ONE
#    ssh session - splitting it failed twice on 2026-10-13 (install ok, then "am start" answers
#    "adb.exe: error: no devices/emulators found"); the exact cause is not pinned down, so treat
#    same-session as the reliable recipe, not as a law of nature.
#  * launcher task is emu-selfheal (hardened ladder); dsh-emu-sw -> run-emu-sw.cmd hardcodes
#    "-gpu swiftshader_indirect" = CPU rendering, which the user forbids (fan noise) and which
#    invalidates CSS360 geometry + screencap timing. The old claim that dsh-emu (-gpu host)
#    "crashes in non-interactive sessions" was FALSIFIED 2026-10-14 (console disconnected,
#    -gpu host still up in 6s, renderer = RTX 4060).
#    non-interactive sessions (gfxstream glTexImage2D 0x502).
param(
  [int]$TotalTimeoutSec = 1800,
  [int]$BuildTimeoutSec = 900,
  [int]$EmuBootSec      = 300,
  [int]$SshTimeoutSec   = 60
)
$ErrorActionPreference = "Continue"
# A confirmation prompt is a silent hang when nobody is at the keyboard.
$ConfirmPreference = "None"
$EmuIp = "127.0.0.1"; $EmuUser = "user"; $EmuRoot = "G:\Android"
$Vm1 = "user@build-host"; $DshWebUrl = "http://127.0.0.1:3080/"
if (Test-Path "$PSScriptRoot\config.local.ps1") { . "$PSScriptRoot\config.local.ps1" }
$EmuRootFwd = $EmuRoot.Replace('\','/')
$Repo = "$PSScriptRoot\.."   # was hardcoded F: - stale since the 2026-10-15 move to E:
$OutDir = "$env:TEMP\dsh-verify"
New-Item -ItemType Directory -Force $OutDir | Out-Null

# ---------- watchdog plumbing ----------
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
function Abort([string]$step, [string]$why, [string]$cmd, [string]$err, [string]$out) {
  Log ("FATAL step=" + $step)
  Log ("FATAL why=" + $why)
  Log ("FATAL cmd=" + $cmd)
  Log ("FATAL stderr=" + (Flatten $err))
  Log ("FATAL stdout=" + (Flatten $out))
  Log ("FATAL budget: elapsed=" + (ElapsedSec) + "s of total=" + $TotalTimeoutSec + "s")
  Write-Host ("SUMMARY: ABORTED at step " + $step + " after " + (ElapsedSec) + "s - " + $why)
  exit 3
}
# .NET Process (not Start-Process): Start-Process -PassThru reports a null ExitCode on this box.
function Start-Watched([string]$step, [string]$cmdLine, [int]$timeoutSec, [string]$stdinFile) {
  $script:pn++
  $o = "$OutDir\bw-proc-$($script:pn).out"
  $e = "$OutDir\bw-proc-$($script:pn).err"
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
    $limitedBy = "whole-script budget " + $TotalTimeoutSec + "s (elapsed " + (ElapsedSec) + "s)"
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
    $h.Proc.WaitForExit()
    $h.ExitCode = $h.Proc.ExitCode
  }
  $h.OutText = Get-FileText $h.Out
  $h.ErrText = Get-FileText $h.Err
  Log ("DONE step=" + $h.Step + " rc=" + $h.ExitCode + " out_bytes=" + $h.OutText.Length + " elapsed=" + (ElapsedSec) + "s")
  return $h
}
function Invoke-Watched([string]$step, [string]$cmdLine, [int]$timeoutSec, [string]$stdinFile) {
  $h = Start-Watched $step $cmdLine $timeoutSec $stdinFile
  $h = Wait-Watched $h
  if ($h.TimedOut) { Abort $step $h.Why $h.Cmd $h.ErrText $h.OutText }
  if ($h.ExitCode -ne 0) { Abort $step ("command failed: exit code " + $h.ExitCode + " (stderr above)") $h.Cmd $h.ErrText $h.OutText }
  return $h
}

# 1. build on vm1
Invoke-Watched "build-vm1" ("ssh " + $SSH_OPTS + " " + $Vm1 + " `"rm -rf work/projects/dsh-push/android-app/app/src`"") $SshTimeoutSec $null | Out-Null
Invoke-Watched "build-vm1" ("scp " + $SSH_OPTS + " -r `"$Repo\android-app\app\src`" `"${Vm1}:work/projects/dsh-push/android-app/app/`"") $SshTimeoutSec $null | Out-Null
Invoke-Watched "build-vm1" ("scp " + $SSH_OPTS + " `"$Repo\android-app\app\build.gradle.kts`" `"${Vm1}:work/projects/dsh-push/android-app/app/`"") $SshTimeoutSec $null | Out-Null
$vm1Build = @'
set -e
export JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64
export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH
cd ~/work/projects/dsh-push/android-app
gradle assembleDebug -q < /dev/null
stat -c %s app/build/outputs/apk/debug/app-debug.apk
'@
$f = "$OutDir\bw-build.sh"
[IO.File]::WriteAllText($f, $vm1Build, (New-Object Text.UTF8Encoding $false))
$bd = Invoke-Watched "build-vm1" ("ssh -F NUL " + $SSH_OPTS + " " + $Vm1 + " `"tr -d '\r' | bash -s`"") $BuildTimeoutSec $f
$size = ($bd.OutText -split "`r?`n" | Where-Object { $_ -match '^\d{6,}$' } | Select-Object -Last 1)
if (-not $size) { Abort "build-vm1" "gradle produced no apk size line" $bd.Cmd $bd.ErrText $bd.OutText }
Write-Host "BUILD OK $size"
$localApk = "$OutDir\dsh-push.apk"
Invoke-Watched "fetch-apk" ("scp " + $SSH_OPTS + " `"${Vm1}:work/projects/dsh-push/android-app/app/build/outputs/apk/debug/app-debug.apk`" `"$localApk`"") $SshTimeoutSec $null | Out-Null
Invoke-Watched "push-apk" ("scp " + $SSH_OPTS + " `"$localApk`" `"${EmuUser}@${EmuIp}:$EmuRootFwd/dsh-push.apk`"") $SshTimeoutSec $null | Out-Null

# 2. ONE ssh session: ensure emulator + install + open browser + screenshot
$emuTpl = @'
$ErrorActionPreference="Continue"
$ConfirmPreference="None"
$adb = "G:\Android\Sdk\platform-tools\adb.exe"
$avdCm = "G:\Android\run-emu.cmd"
# BANNED: dsh-emu-sw -> run-emu-sw.cmd hardcodes -gpu swiftshader_indirect = CPU rendering
# (user forbids it: fan noise; also invalidates CSS360 geometry + screencap timing).
# Authoritative launcher = the hardened self-heal; the selector file is pinned to host below.
$task = "emu-selfheal"
$bootSec = __BOOTSEC__
function CurSerial {
  $s = ""
  foreach ($l in ((& $adb devices) 2>&1)) { if ($l -match "^(emulator-\d+)\s+device") { $s = $Matches[1]; break } }
  return $s
}
"STAGE=emu-check"
$serial = CurSerial
"EMU_BEFORE=" + $(if ($serial) { $serial } else { "none" })
if (-not $serial) {
  $avd = "dsh-p16"
  if ((Test-Path $avdCm) -and ((Get-Content $avdCm -Raw) -match "-avd\s+(\S+)")) { $avd = $Matches[1] }
  $avdDir = "$env:USERPROFILE\.android\avd\$avd.avd"
  foreach ($lf in @("hardware-qemu.ini.lock","multiinstance.lock")) {
    $p = Join-Path $avdDir $lf
    "LOCK_TRY=" + $p
    if (Test-Path $p) {
      # HARD FACT: hardware-qemu.ini.lock is a DIRECTORY; PS 5.1 Remove-Item on a non-empty dir
      # without -Recurse raises a confirmation prompt and blocks forever over ssh.
      Remove-Item -LiteralPath $p -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue
      if (Test-Path $p) { "LOCK_FAILED=" + $p } else { "LOCK_CLEARED=" + $p }
    }
    else { "LOCK_ABSENT=" + $p }
  }
  Set-Content "G:\Android\emu-ladder.gpu" "host" -Encoding ASCII -Force
  schtasks /Run /TN $task 2>&1 | Out-Null
  "TASK_RUN=" + $task
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
if (-not $serial) { "EMU_FAIL=no device after " + $bootSec + "s"; "### DRIVE DONE rc=1"; exit 1 }
"STAGE=install"
& $adb root 2>&1 | Out-Null
Start-Sleep 2
& $adb -s $serial install -r G:\Android\dsh-push.apk 2>&1 | Out-Null
& $adb -s $serial shell am force-stop xyz.cpyh.dshpush 2>&1 | Out-Null
Start-Sleep 1
"START=" + ((& $adb -s $serial shell am start -n xyz.cpyh.dshpush/.WebActivity --es url "__DshWebUrl__" 2>&1) -join " | ")
Start-Sleep 18
"STAGE=screenshot"
& $adb -s $serial shell screencap -p /data/local/tmp/bw-shot.png 2>&1 | Out-Null
& $adb -s $serial pull /data/local/tmp/bw-shot.png G:\Android\bw-shot.png 2>&1 | Out-Null
$sl = 0
if (Test-Path "G:\Android\bw-shot.png") { $sl = (Get-Item "G:\Android\bw-shot.png").Length }
"SHOT_BYTES=" + $sl
"### DRIVE DONE rc=0"
'@
$emu = $emuTpl.Replace("__BOOTSEC__", "$EmuBootSec").Replace("__DshWebUrl__", $DshWebUrl)
$f2 = "$OutDir\bw-emu.ps1"
[IO.File]::WriteAllText($f2, $emu, (New-Object Text.UTF8Encoding $false))
Invoke-Watched "bw-drive" ("scp " + $SSH_OPTS + " `"$f2`" `"${EmuUser}@${EmuIp}:$EmuRootFwd/bw-emu.ps1`"") $SshTimeoutSec $null | Out-Null
$dv = Invoke-Watched "bw-drive" ("ssh " + $SSH_OPTS + " " + $EmuUser + "@" + $EmuIp + " `"C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File $EmuRoot\bw-emu.ps1 < NUL`"") ($EmuBootSec + 240) $null
$dv.OutText -split "`r?`n" | Where-Object { $_.Trim() -ne "" } | ForEach-Object { Write-Host $_ }
Invoke-Watched "get-shot" ("scp " + $SSH_OPTS + " `"${EmuUser}@${EmuIp}:$EmuRootFwd/bw-shot.png`" `"F:\work\work_dsh\bw-shot.png`"") $SshTimeoutSec $null | Out-Null
if (Test-Path "F:\work\work_dsh\bw-shot.png") { Write-Host "GOT SHOT" } else { Write-Host "NO SHOT"; exit 1 }
