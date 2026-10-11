# bw-iter.ps1 - build, install, open WebActivity, screenshot. ASCII only.
# Infra values come from config.local.ps1 (see config.example.ps1).
$ErrorActionPreference = "Continue"
$EmuIp = "127.0.0.1"; $EmuUser = "user"; $EmuRoot = "G:\Android"
$Vm1 = "user@build-host"; $DshWebUrl = "http://127.0.0.1:3080/"
if (Test-Path "$PSScriptRoot\config.local.ps1") { . "$PSScriptRoot\config.local.ps1" }
$EmuRootFwd = $EmuRoot.Replace('\','/')
$Repo = "F:\work\work_dsh\dsh-push"
$OutDir = "$env:TEMP\dsh-verify"
New-Item -ItemType Directory -Force $OutDir | Out-Null
function RunRemote([string]$localPath, [string]$remoteName) {
  scp -o BatchMode=yes "$localPath" "${EmuUser}@${EmuIp}:$EmuRootFwd/$remoteName" | Out-Null
  (cmd /c "ssh -o BatchMode=yes $EmuUser@$EmuIp ""C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File $EmuRoot\$remoteName""") 2>$null
}

# 1. build on vm1
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
$f = "$OutDir\bw-build.sh"; [IO.File]::WriteAllText($f, $vm1Build, (New-Object Text.UTF8Encoding $false))
$out = (cmd /c "ssh -F NUL $Vm1 ""tr -d '\r' | bash -s"" < ""$f""") 2>&1
$size = ($out | Where-Object { $_ -match '^\d{6,}$' } | Select-Object -Last 1)
if (-not $size) { Write-Host "BUILD FAIL"; $out | Select-Object -Last 30; exit 1 }
Write-Host "BUILD OK $size"
$localApk = "$OutDir\dsh-push.apk"
scp -o BatchMode=yes "${Vm1}:work/projects/dsh-push/android-app/app/build/outputs/apk/debug/app-debug.apk" "$localApk" | Out-Null
scp -o BatchMode=yes "$localApk" "${EmuUser}@${EmuIp}:$EmuRootFwd/dsh-push.apk" | Out-Null

# 2. install + open browser + shot
$emu = @'
$ErrorActionPreference="Continue"
$adb = "G:\Android\Sdk\platform-tools\adb.exe"
$dev = ((& $adb devices) 2>&1) -join " "
if ($dev -notmatch "emulator-\d+\s+device") {
  schtasks /Run /TN dsh-emu | Out-Null
  & $adb wait-for-device 2>&1 | Out-Null
}
for ($i=0; $i -lt 60; $i++) {
  $b = ((& $adb shell getprop sys.boot_completed) 2>&1) -join ""
  if ($b -match "1") { break }
  Start-Sleep 4
}
& $adb root 2>&1 | Out-Null
Start-Sleep 2
& $adb install -r G:\Android\dsh-push.apk 2>&1 | Out-Null
& $adb shell am force-stop xyz.cpyh.dshpush 2>&1 | Out-Null
Start-Sleep 1
& $adb shell am start -n xyz.cpyh.dshpush/.WebActivity --es url "__DshWebUrl__" 2>&1
Start-Sleep 18
& $adb shell screencap -p /data/local/tmp/bw-shot.png 2>&1 | Out-Null
& $adb pull /data/local/tmp/bw-shot.png G:\Android\bw-shot.png 2>&1 | Out-Null
"SHOT_DONE"
'@
$f2 = "$OutDir\bw-emu.ps1"; [IO.File]::WriteAllText($f2, $emu.Replace("__DshWebUrl__", $DshWebUrl), (New-Object Text.UTF8Encoding $false))
$r = RunRemote $f2 "bw-emu.ps1"
$r | ForEach-Object { Write-Host $_ }
scp -o BatchMode=yes "${EmuUser}@${EmuIp}:$EmuRootFwd/bw-shot.png" "F:\work\work_dsh\bw-shot.png" | Out-Null
if (Test-Path "F:\work\work_dsh\bw-shot.png") { Write-Host "GOT SHOT" } else { Write-Host "NO SHOT" }
