# dsh-app-verify.ps1 - one-click APP verification pipeline.
# Flow: ensure emulator up -> (optional) build on vm1 -> install on Android-16 emulator
#       -> publish test push -> assert prefs -> screenshot -> (optional) deploy to aliyun.
# Run from the orchestrator machine (the one holding ssh keys to all hosts).
# ASCII only on purpose: Windows PowerShell 5.1 misreads BOM-less UTF-8 scripts.
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
  [switch]$Deploy                       # on PASS upload to aliyun dl and print ?v= link
)
# Local infra overrides (hosts/tokens), see config.example.ps1 — not published
if (Test-Path "$PSScriptRoot\config.local.ps1") { . "$PSScriptRoot\config.local.ps1" }
$ErrorActionPreference = "Continue"
# PS 5.1 gotcha: ${var.Method('q','q')} interpolation silently yields "" - precompute instead
$EmuRootFwd = $EmuRoot.Replace('\','/')
$script:results = @()
function Report([string]$name, [bool]$ok, [string]$detail) {
  $script:results += [pscustomobject]@{ Name = $name; Ok = $ok; Detail = $detail }
  Write-Host ("[{0}] {1}{2}" -f ($(if ($ok) { "PASS" } else { "FAIL" })), $name, $(if ($detail) { " - " + $detail } else { "" }))
}
function RunRemote([string]$localPath, [string]$remoteName) {
  # scp a generated script to the emulator host and run it; returns stdout lines
  scp -o BatchMode=yes "$localPath" "${EmuUser}@${EmuIp}:$EmuRootFwd/$remoteName" | Out-Null
  (cmd /c "ssh -o BatchMode=yes $EmuUser@$EmuIp ""C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File $EmuRoot\$remoteName""") 2>$null
}
New-Item -ItemType Directory -Force $OutDir | Out-Null
$epoch = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$stamp = Get-Date -Format "HHmmss"

# ---------- 0. token prefs seed (used by -Fresh and bootstrap) ----------
$seed = "$OutDir\dshpush.xml"
[IO.File]::WriteAllText($seed, "<?xml version='1.0' encoding='utf-8' standalone='yes' ?>`n<map>`n    <string name=`"token`">$ReadToken</string>`n</map>`n", (New-Object Text.UTF8Encoding $false))
scp -o BatchMode=yes "$seed" "${EmuUser}@${EmuIp}:$EmuRootFwd/dshpush.xml" | Out-Null

# ---------- 1. ensure emulator is up (scheduled task is the only sanctioned launcher) ----------
$emuCheck = @'
$ErrorActionPreference="Continue"
$adb = "G:\Android\Sdk\platform-tools\adb.exe"
$dev = ((& $adb devices) 2>&1) -join " "
if ($dev -notmatch "emulator-\d+\s+device") {
  schtasks /Run /TN dsh-emu | Out-Null
  & $adb wait-for-device 2>&1 | Out-Null
}
for ($i = 0; $i -lt 60; $i++) {
  $b = ((& $adb shell getprop sys.boot_completed) 2>&1) -join ""
  if ($b -match "1") { break }
  Start-Sleep 4
}
& $adb root 2>&1 | Out-Null
Start-Sleep 2
& $adb wait-for-device 2>&1 | Out-Null
$serial = ""
foreach ($l in ((& $adb devices) 2>&1)) { if ($l -match "^(emulator-\d+)\s+device") { $serial = $Matches[1]; break } }
$api = ((& $adb -s $serial shell getprop ro.build.version.sdk) 2>&1) -join ""
"SERIAL=$serial BOOT=1 API=$api"
'@
$f = "$OutDir\emu-check.ps1"; [IO.File]::WriteAllText($f, $emuCheck, (New-Object Text.UTF8Encoding $false))
$up = RunRemote $f "verify-emu-check.ps1" | Where-Object { $_ -match "SERIAL=" } | Select-Object -First 1
if (-not $up) { Report "emulator-up" $false "no SERIAL line from emulator host"; exit 1 }
$serial = ($up -replace ".*SERIAL=(emulator-\d+).*", '$1')
$api = ($up -replace ".*API=", '')
Report "emulator-up" ($up -match "BOOT=1") "serial=$serial api=$api"

# ---------- 2. build on vm1 (unless -SkipBuild) ----------
$localApk = "$OutDir\dsh-push.apk"
if (-not $SkipBuild) {
  ssh -o BatchMode=yes $Vm1 "rm -rf work/projects/dsh-push/android-app/app/src" | Out-Null
  scp -o BatchMode=yes -r "$Repo\android-app\app\src" "${Vm1}:work/projects/dsh-push/android-app/app/" | Out-Null
  scp -o BatchMode=yes "$Repo\android-app\app\build.gradle.kts" "${Vm1}:work/projects/dsh-push/android-app/app/" | Out-Null
  scp -o BatchMode=yes "$Repo\android-app\build.gradle.kts" "$Repo\android-app\settings.gradle.kts" "$Repo\android-app\gradle.properties" "${Vm1}:work/projects/dsh-push/android-app/" | Out-Null
  $vm1Build = @'
set -e
export JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64
export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH
cd ~/work/projects/dsh-push/android-app
gradle assembleDebug -q < /dev/null
stat -c %s app/build/outputs/apk/debug/app-debug.apk
'@
  $f = "$OutDir\vm1-build.sh"; [IO.File]::WriteAllText($f, $vm1Build, (New-Object Text.UTF8Encoding $false))
  $out = (cmd /c "ssh -F NUL $Vm1 ""tr -d '\r' | bash -s"" < ""$f""") 2>&1
  $size = ($out | Where-Object { $_ -match '^\d{6,}$' } | Select-Object -Last 1)
  if (-not $size) { Report "build-vm1" $false ($out -join " | "); exit 1 }
  scp -o BatchMode=yes "${Vm1}:work/projects/dsh-push/android-app/app/build/outputs/apk/debug/app-debug.apk" "$localApk" | Out-Null
  Report "build-vm1" $true "apk $size bytes"
} else {
  if ($Apk) { Copy-Item $Apk $localApk -Force }
  else { scp -o BatchMode=yes "${EmuUser}@${EmuIp}:$EmuRootFwd/dsh-push.apk" "$localApk" | Out-Null }
  Report "build-vm1" (Test-Path $localApk) "skipped, reused $localApk"
}
scp -o BatchMode=yes "$localApk" "${EmuUser}@${EmuIp}:$EmuRootFwd/dsh-push.apk" | Out-Null

# ---------- 3. install (+ optional fresh seed) ----------
$install = @'
$ErrorActionPreference="Continue"
$adb = "G:\Android\Sdk\platform-tools\adb.exe"
$S = @("-s","__SERIAL__")
function A { param($a) (& $adb @a 2>&1) -join " | " }
"install: " + (A ($S + @("install","-r","-g","G:\Android\dsh-push.apk")))
if ("__FRESH__" -eq "1") {
  A ($S + @("shell","pm","clear","xyz.cpyh.dshpush")) | Out-Null
  Start-Sleep 2
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
A ($S + @("shell","am","start","-n","xyz.cpyh.dshpush/.MainActivity")) | Out-Null
"installed"
'@
$f = "$OutDir\install.ps1"
[IO.File]::WriteAllText($f, ($install.Replace("__SERIAL__", $serial).Replace("__FRESH__", $(if ($Fresh) { "1" } else { "0" }))), (New-Object Text.UTF8Encoding $false))
$inst = RunRemote $f "verify-install.ps1" | Out-String
Report "install" ($inst -match "Success") ($inst -split "`n" | Select-String "install:" | Select-Object -First 1)
Start-Sleep 8   # let WS connect

# ---------- 4. publish unique test push ----------
curl.exe -s -X POST "$Ntfy/$Topic" -H "Authorization: Bearer $WriteToken" -H "Title: auto-verify $stamp" -d "auto-verify $epoch" | Out-Null

# ---------- 5. assert prefs: entry arrived, unread, unique mid (polls up to 40s) ----------
$assert = @'
$ErrorActionPreference="Continue"
$adb = "G:\Android\Sdk\platform-tools\adb.exe"
$hits = 0
for ($i = 0; $i -lt 10; $i++) {
  $p = ( (& $adb -s __SERIAL__ shell cat /data/data/xyz.cpyh.dshpush/shared_prefs/dshpush.xml) 2>&1 ) -join ""
  $m = [regex]::Matches($p, 'auto-verify __EPOCH__.*?mid&quot;:(-?\d+),&quot;read&quot;:(\w+)')
  $hits = $m.Count
  if ($hits -ge 1) {
    "HITS=" + $hits
    foreach ($x in $m) { "MID=" + $x.Groups[1].Value + " READ=" + $x.Groups[2].Value }
    break
  }
  Start-Sleep 4
}
if ($hits -eq 0) { "HITS=0" }
'@
$f = "$OutDir\assert.ps1"
[IO.File]::WriteAllText($f, ($assert.Replace("__SERIAL__", $serial).Replace("__EPOCH__", $epoch)), (New-Object Text.UTF8Encoding $false))
$a = RunRemote $f "verify-assert.ps1" | Out-String
$hitsM = [regex]::Match($a, 'HITS=(\d+)')
$hits = if ($hitsM.Success) { [int]$hitsM.Groups[1].Value } else { 0 }
$mids = ([regex]::Matches($a, 'MID=(-?\d+)') | ForEach-Object { $_.Groups[1].Value } | Select-Object -Unique)
Report "push-received" ($hits -ge 1) "entries with unique body: $hits"
Report "mid-unique" ($mids.Count -eq $hits -and $hits -ge 1) "distinct mids: $($mids -join ',')"
Report "entry-unread" ($a -match 'READ=false') ""

# ---------- 6. screenshot (re-foreground MainActivity first: stale dialogs can cover it) ----------
$shot = "$OutDir\verify-$stamp.png"
$fg = "$OutDir\fg.ps1"
$fgTpl = 'cmd /c "`"G:\Android\Sdk\platform-tools\adb.exe`" -s __SERIAL__ shell input keyevent KEYCODE_BACK" 2>&1 | Out-Null
& "G:\Android\Sdk\platform-tools\adb.exe" -s __SERIAL__ shell am start -n xyz.cpyh.dshpush/.MainActivity 2>&1 | Out-Null
Start-Sleep 3'
[IO.File]::WriteAllText($fg, $fgTpl.Replace("__SERIAL__", $serial) + "`n", (New-Object Text.UTF8Encoding $false))
RunRemote $fg "verify-fg.ps1" | Out-Null
$remoteShot = "$OutDir\shot.ps1"
$shotTpl = 'cmd /c "`"G:\Android\Sdk\platform-tools\adb.exe`" -s __SERIAL__ exec-out screencap -p > G:\Android\verify-shot.png"'
[IO.File]::WriteAllText($remoteShot, $shotTpl.Replace("__SERIAL__", $serial) + "`n", (New-Object Text.UTF8Encoding $false))
RunRemote $remoteShot "verify-shot.ps1" | Out-Null
scp -o BatchMode=yes "${EmuUser}@${EmuIp}:$EmuRootFwd/verify-shot.png" "$shot" | Out-Null
$ok = (Test-Path $shot) -and ((Get-Item $shot).Length -gt 100000)
Report "screenshot" $ok "$shot"

# ---------- 7. optional deploy ----------
if ($Deploy -and ($script:results | Where-Object { -not $_.Ok }).Count -eq 0) {
  $vc = [regex]::Match((Get-Content "$Repo\android-app\app\build.gradle.kts" -Raw), 'versionCode\s*=\s*(\d+)').Groups[1].Value
  scp -o BatchMode=yes $localApk "${Aliyun}:/var/www/certbot/dl/dsh-push.apk" | Out-Null
  $chk = curl.exe -s -o "$OutDir\dl-check.apk" -w "%{http_code} %{size_download}" "$Ntfy/dl/dsh-push.apk?v=$vc"
  $same = (Get-FileHash "$OutDir\dl-check.apk" -Algorithm SHA256).Hash -eq (Get-FileHash $localApk -Algorithm SHA256).Hash
  Report "deploy" ($chk -match "^200" -and $same) "link: $Ntfy/dl/dsh-push.apk?v=$vc"
}

# ---------- summary ----------
$fail = ($script:results | Where-Object { -not $_.Ok }).Count
Write-Host ""
Write-Host ("SUMMARY: {0}/{1} passed" -f ($script:results.Count - $fail), $script:results.Count)
exit $(if ($fail) { 1 } else { 0 })
