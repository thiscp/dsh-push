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

# ---------- 5. wrapper cmds + scheduled tasks (scheduled task = the only sanctioned launcher:
# sshd reaps the session's children) ----------
# 2026-10-14 CORRECTION - the old rule here was WRONG and has been removed:
#   It said "-gpu host crashes in a NON-interactive session (gfxstream glTexImage2D 0x502), so the
#   DEFAULT task is dsh-emu-sw (swiftshader)". That premise was FALSIFIED by measurement: with the
#   console session DISCONNECTED, `-gpu host` came up in ~6s and the guest renderer was the host
#   NVIDIA adapter. Meanwhile CPU rendering (swiftshader) is explicitly FORBIDDEN by the user
#   (it spins the laptop fans), and it invalidates the CSS360 geometry + screencap timing.
# So: dsh-emu (-gpu host) is the launcher, and run-emu-sw.cmd is kept ONLY as a manual
# last-resort, never as the default. Prefer the hardened self-heal task (emu-selfheal), which
# pins rung 1 to `-gpu host` from the selector file and fails closed if the renderer is not NVIDIA.
$emuExe = "$Root\Sdk\emulator\emulator.exe"
@"
@echo off
"$emuExe" -avd $AvdName -no-window -no-audio -no-boot-anim -gpu host -cores $Cores -memory $RamMB > $Root\emu-out.txt 2> $Root\emu-err.txt
"@ | Set-Content "$Root\run-emu.cmd" -Encoding ASCII
@"
@echo off
rem LAST-RESORT ONLY (CPU rendering = swiftshader). NOT the default: the user forbids CPU rendering.
"$emuExe" -avd $AvdName -no-window -no-audio -no-boot-anim -gpu swiftshader_indirect -cores $Cores -memory $RamMB > $Root\emu-sw-out.txt 2> $Root\emu-sw-err.txt
"@ | Set-Content "$Root\run-emu-sw.cmd" -Encoding ASCII
schtasks /Create /TN dsh-emu /TR "$Root\run-emu.cmd" /SC ONCE /ST 00:00 /F | Out-Null
schtasks /Create /TN dsh-emu-sw /TR "$Root\run-emu-sw.cmd" /SC ONCE /ST 00:00 /F | Out-Null
foreach ($tn in @("dsh-emu","dsh-emu-sw")) {
  $t = Get-ScheduledTask -TaskName $tn
  $t.Settings.DisallowStartIfOnBatteries = $false
  $t.Settings.StopIfGoingOnBatteries = $false
  Set-ScheduledTask -TaskName $tn -Settings $t.Settings | Out-Null
}
# pin the ladder selector to the real GPU before starting anything
Set-Content "$Root\emu-ladder.gpu" "host" -Encoding ASCII -Force
Write-Host "starting the emulator via dsh-emu (-gpu host; CPU/swiftshader is FORBIDDEN - see verify/README.md)"
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
