# build-install.ps1 - one command: local gradle debug build -> install on the laptop emulator ->
# launch the app straight at a DSH web URL (token pulled from web.log, never hand-copied).
# ASCII only (PS 5.1). Emulator/adb live on the laptop DESKTOP-CPYH; build runs here.
[CmdletBinding()]
param(
  [string]$Url,                                   # DSH web URL to open; default = proxy 3080 + fresh token
  [string]$Apk,                                   # prebuilt apk: skip the build step entirely
  [string]$BuildHost  = 'user@<tailnet-vm1>',      # the BUILD BOX (test-machine-1); the desktop has no JDK/SDK
  [string]$RemoteRepo = '/home/user/work/projects/dsh-push',
  [string]$RemoteSdk  = '/home/user/android-sdk',
  [string]$Laptop = 'user@<tailnet-laptop>',
  [string]$Adb    = 'G:\Android\Sdk\platform-tools\adb.exe',
  [string]$Package = 'xyz.cpyh.dshpush',
  [string]$Serial = 'emulator-5554',
  [switch]$SkipBuild,
  [switch]$SkipLaunch
)
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$app  = Join-Path $repo 'android-app'
$remoteApk = $RemoteRepo + '/android-app/app/build/outputs/apk/debug/app-debug.apk'
function Step($m) { Write-Host ("=== " + $m) }
function Get-FreshToken {
  $line = (Get-Content 'C:\Users\<user>\.dsh\web.log' | Where-Object { $_ -match 'dsh web:' } | Select-Object -Last 1)
  if (-not $line) { throw 'no "dsh web:" line in web.log -> DSH not running?' }
  $m = [regex]::Match($line, 'token=([A-Za-z0-9_\-]+)')
  if (-not $m.Success) { throw ('no token in: ' + $line) }
  return $m.Groups[1].Value
}
if (-not $Url) {
  $tk = Get-FreshToken
  $Url = 'http://<tailnet-windows>:3080/?token=' + $tk
  Write-Host ("  token from web.log: " + $tk.Substring(0, [Math]::Min(10, $tk.Length)) + '...')
}
$fetched = Join-Path $env:TEMP 'dsh-build.apk'

if (-not $SkipBuild) {
  Step 'gradle assembleDebug on the build box'
  $t0 = Get-Date
  $bc = 'cd ' + $RemoteRepo + '/android-app && ANDROID_HOME=' + $RemoteSdk + ' ./gradlew assembleDebug --console=plain'
  cmd /c ('ssh -o BatchMode=yes -o ConnectTimeout=15 ' + $BuildHost + ' "' + $bc + '"') 2>&1 | Select-Object -Last 5
  if ($LASTEXITCODE -ne 0) { throw ('remote gradle failed, exit ' + $LASTEXITCODE) }
  Write-Host ('  build wall: ' + [int]((Get-Date) - $t0).TotalSeconds + 's')
  Step 'fetch the apk back from the build box'
  scp -o BatchMode=yes -o ConnectTimeout=15 ($BuildHost + ':' + $remoteApk) $fetched
  if ($LASTEXITCODE -ne 0) { throw 'scp (fetch apk) failed' }
  $Apk = $fetched
} else { Step 'skip build' }
Write-Host ('  apk: ' + $Apk + ' (' + [int]((Get-Item $Apk).Length / 1KB) + ' KB, md5 ' + (Get-FileHash $Apk -Algorithm MD5).Hash + ')')

Step 'install on the laptop emulator'
scp -o BatchMode=yes -o ConnectTimeout=10 $Apk ($Laptop + ':C:/Users/<user>/dsh-build.apk')
if ($LASTEXITCODE -ne 0) { throw 'scp failed' }
$remote = '& ''' + $Adb + ''' devices; & ''' + $Adb + ''' -s ' + $Serial + ' install -r C:\Users\<user>\dsh-build.apk'
cmd /c ('ssh -o BatchMode=yes -o ConnectTimeout=10 ' + $Laptop + ' "powershell -NoProfile -Command ""' + $remote + '"" "')
if ($LASTEXITCODE -ne 0) { throw 'adb install failed' }

if (-not $SkipLaunch) {
  Step 'launch the app at the DSH url (VIEW intent, then root+WebActivity fallback)'
  # native stderr from the expected VIEW failure must NOT terminate the script
  $ErrorActionPreference = 'Continue'
  $r2 = '& ''' + $Adb + ''' -s ' + $Serial + ' shell am start -a android.intent.action.VIEW -d "' + $Url + '" ' + $Package
  $o = (cmd /c ('ssh -o BatchMode=yes -o ConnectTimeout=10 ' + $Laptop + ' "powershell -NoProfile -Command ""' + $r2 + '"" "') 2>&1) -join "`n"
  Write-Host $o
  if ($o -match 'unable to resolve|Error|Permission Denial') {
    Write-Host '  VIEW could not resolve -> adb root + WebActivity --es url'
    $r3 = '& ''' + $Adb + ''' root; Start-Sleep 3; & ''' + $Adb + ''' -s ' + $Serial + ' shell am start -n ' + $Package + '/.WebActivity --es url "' + $Url + '"'
    cmd /c ('ssh -o BatchMode=yes -o ConnectTimeout=10 ' + $Laptop + ' "powershell -NoProfile -Command ""' + $r3 + '"" "')
  }
  Write-Host ('  url: ' + $Url)
}
Step 'done'