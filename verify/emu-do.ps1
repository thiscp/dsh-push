# emu-do.ps1 - laptop-side half of build-install.ps1: install the apk on the emulator and open the app
# at a DSH web url. Runs ON the laptop (adb lives there). ASCII only.
#
#   powershell -File C:/Users/<user>/emu-do.ps1 -Apk C:\Users\<user>\dsh-build.apk -Url "http://<tailnet-windows>:3080/?token=..." -Adb 'G:\Android\Sdk\platform-tools\adb.exe' -Package xyz.cpyh.dshpush -Serial emulator-5554
#
# Launch order: VIEW intent first (normal, no root needed); if that errors, `adb root` + WebActivity
# with `--es url` (WebActivity is not exported, hence the root detour).
param(
  [Parameter(Mandatory = $true)][string]$Apk,
  [Parameter(Mandatory = $true)][string]$Url,
  [string]$Adb = 'G:\Android\Sdk\platform-tools\adb.exe',
  [string]$Package = 'xyz.cpyh.dshpush',
  [string]$Serial = 'emulator-5554',
  [switch]$SkipLaunch
)
$ErrorActionPreference = 'Continue'

Write-Host '--- adb devices ---'
& $Adb start-server | Out-Null
& $Adb devices

Write-Host '--- install ---'
& $Adb -s $Serial install -r $Apk
if ($LASTEXITCODE -ne 0) { Write-Host ('install failed, exit ' + $LASTEXITCODE); exit 2 }

if (-not $SkipLaunch) {
  Write-Host '--- am start (VIEW intent) ---'
  $o = (& $Adb -s $Serial shell am start -a android.intent.action.VIEW -d $Url $Package 2>&1) -join "`n"
  Write-Host $o
  if ($o -match 'Error|Permission Denial|does not exist|Exception') {
    Write-Host '--- VIEW failed -> adb root + WebActivity --es url ---'
    & $Adb root | Out-Null
    Start-Sleep -Seconds 3
    $o2 = (& $Adb -s $Serial shell am start -n ($Package + '/.WebActivity') --es url $Url 2>&1) -join "`n"
    Write-Host $o2
  }
  Write-Host '--- top activity right after launch ---'
  & $Adb -s $Serial shell dumpsys activity activities 2>&1 | Select-String -Pattern 'mResumedActivity|topResumedActivity' | Select-Object -First 2
}
Write-Host '--- done ---'
