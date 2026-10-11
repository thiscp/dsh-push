# qa-test.ps1 - E2E: register a demo question on the relay, open QuickAnswer on
# the emulator, auto-tap the first option, screenshot the success pose animation.
# ASCII only. Run from the orchestrator (this Windows box).
$ErrorActionPreference = "Continue"
$EmuIp = "<lan-laptop>"; $EmuUser = "user"; $EmuRoot = "G:\Android"
$EmuRootFwd = $EmuRoot.Replace('\','/')
$Vm1 = "user@<tailnet-vm1>"
$Repo = "F:\work\work_dsh\dsh-push"
$OutDir = "$env:TEMP\dsh-verify"
New-Item -ItemType Directory -Force $OutDir | Out-Null
function RunRemote([string]$localPath, [string]$remoteName) {
  scp -o BatchMode=yes "$localPath" "${EmuUser}@${EmuIp}:$EmuRootFwd/$remoteName" | Out-Null
  (cmd /c "ssh -o BatchMode=yes $EmuUser@$EmuIp ""C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File $EmuRoot\$remoteName""") 2>$null
}

# 1. build + install
ssh -o BatchMode=yes $Vm1 "rm -rf work/projects/dsh-push/android-app/app/src" | Out-Null
scp -o BatchMode=yes -r "$Repo\android-app\app\src" "${Vm1}:work/projects/dsh-push/android-app/app/" | Out-Null
scp -o BatchMode=yes "$Repo\android-app\app\build.gradle.kts" "${Vm1}:work/projects/dsh-push/android-app/app/" | Out-Null
$vm1Build = @'
set -e
export JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64
export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH
cd ~/work/projects/dsh-push/android-app
gradle assembleDebug -q < /dev/null
stat -c %s app/build/outputs/apk/debug/app-debug.apk
'@
$f = "$OutDir\qa-build.sh"; [IO.File]::WriteAllText($f, $vm1Build, (New-Object Text.UTF8Encoding $false))
$out = (cmd /c "ssh -F NUL $Vm1 ""tr -d '\r' | bash -s"" < ""$f""") 2>&1
$size = ($out | Where-Object { $_ -match '^\d{6,}$' } | Select-Object -Last 1)
if (-not $size) { Write-Host "BUILD FAIL"; $out | Select-Object -Last 30; exit 1 }
Write-Host "BUILD OK $size"
$localApk = "$OutDir\dsh-push.apk"
scp -o BatchMode=yes "${Vm1}:work/projects/dsh-push/android-app/app/build/outputs/apk/debug/app-debug.apk" "$localApk" | Out-Null
scp -o BatchMode=yes "$localApk" "${EmuUser}@${EmuIp}:$EmuRootFwd/dsh-push.apk" | Out-Null

# 2. register demo question via the real hook script (also pushes a notification)
$epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$cid = "demo-$epoch"
$payload = '{"hook_event_name":"PreToolUse","tool_name":"ask_user_question","tool_use_id":"' + $cid + '","session_id":"qa-e2e-session","cwd":"F:\\work\\work_dsh","tool_input":{"questions":[{"id":"q0","question":"E2E test: what should the big fish eat?","options":[{"label":"xiaoyugan A"},{"label":"pudding B"},{"label":"milktea C"}]}]}}'
$py = "C:\Users\<user>\bin\dsh-ntfy-push.py"
$pf = "$OutDir\qa-payload.json"; [IO.File]::WriteAllText($pf, $payload, (New-Object Text.UTF8Encoding $false))
$reg = (cmd /c "python ""$py"" < ""$pf""") 2>&1
Write-Host "register done cid=$cid out=$reg"

# 3. emulator: install, open QuickAnswer, tap first option, shot the success anim
$emu = @'
$ErrorActionPreference="Continue"
$adb = "G:\Android\Sdk\platform-tools\adb.exe"
& $adb install -r G:\Android\dsh-push.apk 2>&1 | Out-Null
& $adb shell am force-stop xyz.cpyh.dshpush 2>&1 | Out-Null
Start-Sleep 1
& $adb shell am start -n xyz.cpyh.dshpush/.QuickAnswerActivity --es callId "__CID__" 2>&1
Start-Sleep 4
& $adb shell uiautomator dump /sdcard/u.json 2>&1 | Out-Null
$ui = ((& $adb shell cat /sdcard/u.json) 2>&1) -join ""
$m = [regex]::Match($ui, 'text="xiaoyugan A"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
if (-not $m.Success) { "TAP_NOT_FOUND"; ($ui -replace '.*text="([^"]{0,40})".*','') ; }
else {
  $x = ([int]$m.Groups[1].Value + [int]$m.Groups[3].Value) / 2
  $y = ([int]$m.Groups[2].Value + [int]$m.Groups[4].Value) / 2
  "TAP $x $y"
  & $adb shell input tap $x $y 2>&1
  Start-Sleep -Milliseconds 800
  & $adb shell screencap -p /data/local/tmp/qa-shot.png 2>&1 | Out-Null
  & $adb pull /data/local/tmp/qa-shot.png G:\Android\qa-shot.png 2>&1 | Out-Null
  "SHOT_DONE"
}
'@
$emuR = $emu.Replace("__CID__", $cid)
$f2 = "$OutDir\qa-emu.ps1"; [IO.File]::WriteAllText($f2, $emuR, (New-Object Text.UTF8Encoding $false))
$r = RunRemote $f2 "qa-emu.ps1"
$r | ForEach-Object { Write-Host $_ }
scp -o BatchMode=yes "${EmuUser}@${EmuIp}:$EmuRootFwd/qa-shot.png" "F:\work\work_dsh\qa-shot.png" | Out-Null
if (Test-Path "F:\work\work_dsh\qa-shot.png") { Write-Host "GOT SHOT" } else { Write-Host "NO SHOT" }
