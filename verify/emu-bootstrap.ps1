# emu-bootstrap.ps1 - bring up a brand-new Windows emulator host for dsh-app-verify.
# Installs JDK17 + Android SDK (cmdline-tools/platform-tools/emulator/API36 system image)
# under $Root, creates AVD dsh-p16, registers scheduled task dsh-emu (battery limits off),
# starts it. Prereq: Win11 with WHPX (HypervisorPresent=True or Windows Hypervisor Platform
# enabled), ~15 GB free disk, curl.exe + tar (bsdtar) built in. ASCII only (PS 5.1 safe).
# NOTE: use bsdtar ("tar -xf") for the big zips - Expand-Archive chokes on the 1.9 GB sysimg.
param(
  [string]$Root = "G:\Android",
  [string]$AvdName = "dsh-p16",
  [int]$Cores = 4,
  [int]$RamMB = 4096
)
$ErrorActionPreference = "Stop"
New-Item -ItemType Directory -Force "$Root" | Out-Null
$env:ANDROID_HOME = "$Root\Sdk"

# ---------- 1. JDK 17 (Microsoft build via aka.ms, mirror-friendly) ----------
if (-not (Get-ChildItem "$Root\jdk*\bin\java.exe" -ErrorAction SilentlyContinue)) {
  curl.exe -L -o "$Root\jdk.zip" "https://aka.ms/download-jdk/microsoft-jdk-17-windows-x64.zip"
  tar -xf "$Root\jdk.zip" -C "$Root"
  $dir = (Get-ChildItem $Root -Directory | Where-Object { Test-Path "$($_.FullName)\bin\java.exe" } | Select-Object -First 1)
  if ($dir.Name -ne "jdk") { Move-Item $dir.FullName "$Root\jdk" }
  Remove-Item "$Root\jdk.zip" -Force
}
$env:JAVA_HOME = "$Root\jdk"

# ---------- 2. cmdline-tools from Tencent mirror (fast in CN; dl.google also fine behind TUN) ----------
if (-not (Test-Path "$Root\Sdk\cmdline-tools\latest\bin\sdkmanager.bat")) {
  curl.exe -L -o "$Root\clt.zip" "https://mirrors.cloud.tencent.com/AndroidSDK/commandlinetools-win-11076708_latest.zip"
  New-Item -ItemType Directory -Force "$Root\Sdk\cmdline-tools" | Out-Null
  tar -xf "$Root\clt.zip" -C "$Root\Sdk\cmdline-tools"
  if (Test-Path "$Root\Sdk\cmdline-tools\cmdline-tools") { Move-Item "$Root\Sdk\cmdline-tools\cmdline-tools" "$Root\Sdk\cmdline-tools\latest" }
  Remove-Item "$Root\clt.zip" -Force
}
$sdkman = "$Root\Sdk\cmdline-tools\latest\bin\sdkmanager.bat"

# ---------- 3. SDK packages (pipe 'y' x40 to accept licenses - pre-written license dirs do NOT work) ----------
("y`n" * 40) | & $sdkman --sdk_root="$Root\Sdk" --install `
  "platform-tools" "emulator" "platforms;android-36" `
  "system-images;android-36;google_apis;x86_64" | Out-Null

# ---------- 4. AVD (API36 google_apis x86_64, Pixel 7 device profile) ----------
$avdDir = "$env:USERPROFILE\.android\avd\$AvdName.avd"
if (-not (Test-Path $avdDir)) {
  ("n`n" * 5) | & "$Root\Sdk\cmdline-tools\latest\bin\avdmanager.bat" create avd -n $AvdName `
    -k "system-images;android-36;google_apis;x86_64" -d pixel_7 --force | Out-Null
}
$cfg = "$avdDir\config.ini"
(Get-Content $cfg -Raw) -replace "hw.ramSize=.*", "hw.ramSize=$RamMB" | Set-Content $cfg -Encoding ASCII

# ---------- 5. wrapper cmd + scheduled task (ONLY sanctioned launcher: sshd kills session children) ----------
$emuExe = "$Root\Sdk\emulator\emulator.exe"
@"
@echo off
"$emuExe" -avd $AvdName -no-window -no-audio -no-boot-anim -gpu host -cores $Cores -memory $RamMB > $Root\emu-out.txt 2> $Root\emu-err.txt
"@ | Set-Content "$Root\run-emu.cmd" -Encoding ASCII
schtasks /Create /TN dsh-emu /TR "$Root\run-emu.cmd" /SC ONCE /ST 00:00 /F | Out-Null
$t = Get-ScheduledTask -TaskName dsh-emu
$t.Settings.DisallowStartIfOnBatteries = $false
$t.Settings.StopIfGoingOnBatteries = $false
Set-ScheduledTask -TaskName dsh-emu -Settings $t.Settings | Out-Null
schtasks /Run /TN dsh-emu | Out-Null

# ---------- 6. wait for boot ----------
$adb = "$Root\Sdk\platform-tools\adb.exe"
& $adb wait-for-device 2>&1 | Out-Null
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep 4
  if ((((& $adb shell getprop sys.boot_completed) 2>&1) -join "") -match "1") { break }
}
& $adb root 2>&1 | Out-Null
"api=" + (((& $adb shell getprop ro.build.version.sdk) 2>&1) -join "")
"bootstrap done. next: authorize orchestrator ssh key, then run verify\dsh-app-verify.ps1 -Fresh from it."
