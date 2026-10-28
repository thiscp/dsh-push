# release-fast.ps1 - FIRST-ROUND release: build + publish the APK, NO emulator at all.
#
# Why this exists (user, 2026-10-25): round one = I change code, build, publish; the USER
# downloads and tests on their own phone. Only when they report a problem does round two open
# the emulator to reproduce and verify.
# dsh-app-verify.ps1 -Deploy is the FULL gate: it boots the emulator, installs, pushes a test
# notification, asserts prefs, screenshots and runs the 4-state geometry matrix. That is ~2-4
# minutes of emulator work per round and it verifies the INJECTED LAYER, not the user's real
# device. First round does not need it. This script does exactly:
#   1. idempotent version sync in build.gradle.kts (versionCode + versionName)
#   2. gradle assembleDebug on the BUILD BOX (vm1) and fetch the apk back
#   3. upload to the dl dir and confirm ?v=<versionCode> serves the same SHA256
#   3b. mirror the same apk to the blog download button (skip with -SkipBlog)
#   4. ntfy update notification (skip with -NoNotify)
#   5. export public mirrors (skip with -SkipExport)
# Second round (user reports a problem) still uses verify\release.ps1 / dsh-app-verify.ps1.
#
# ASCII only (PS 5.1). Run it with pwsh, not bash: the ssh -F NUL form below is Windows-only.
param(
  [string]$Version    = "",
  [int]$VersionCode   = 0,
  [string]$DeployNote = "",
  [switch]$NoNotify,
  [switch]$NoPublish,        # build only: no upload, no notification (lets you verify the build)
  [switch]$SkipExport,
  [switch]$SkipBlog,         # do not refresh blog.cpyh.xyz/dl/dsh-push-latest.apk (see step 3b)
  [switch]$SkipOnlineCheck,
  [switch]$DryRun,
  [int]$BuildTimeoutSec = 900
)
$ErrorActionPreference = "Continue"
$ConfirmPreference = "None"
$repo = Split-Path -Parent $PSScriptRoot
if (-not (Test-Path (Join-Path $repo "android-app\app\build.gradle.kts"))) { $repo = "F:\work\work_dsh\dsh-push" }

# infra (hosts/tokens) - same single source as the rest of verify\
$EmuIp = "127.0.0.1"; $EmuUser = "user"; $EmuRoot = "G:\Android"
$Vm1 = "user@build-host"; $Aliyun = "aliyun"; $Ntfy = "https://ntfy.example.tld"; $Topic = "dsh"
$WriteToken = ""
if (Test-Path "$PSScriptRoot\config.local.ps1") { . "$PSScriptRoot\config.local.ps1" }

$SSH_OPTS = "-o BatchMode=yes -o ConnectTimeout=10"
$OutDir = "$env:TEMP\dsh-fast"
New-Item -ItemType Directory -Force $OutDir | Out-Null
$sw = [Diagnostics.Stopwatch]::StartNew()
function El { [int][Math]::Floor($sw.Elapsed.TotalSeconds) }
function Say([string]$s) { Write-Host ("+{0,5}s {1}" -f (El), $s) }
function Fail([string]$s) { Write-Host ("FATAL: " + $s); Write-Host "SUMMARY: ABORTED"; exit 3 }
function Read-Text([string]$p) { return [IO.File]::ReadAllText($p) }
function Write-Text([string]$p, [string]$t) { [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false)) }

# ---------- 0. resolve target version ----------
$gradlePath = Join-Path $repo "android-app\app\build.gradle.kts"
$gradle = Read-Text $gradlePath
$curName = ([regex]::Match($gradle, 'versionName\s*=\s*"([^"]+)"')).Groups[1].Value
$curCode = ([regex]::Match($gradle, 'versionCode\s*=\s*(\d+)')).Groups[1].Value
Say ("current: versionCode=$curCode versionName=$curName")
if (-not $Version) { $Version = $curName }
if ($VersionCode -le 0) { $VersionCode = [int]$curCode }
Say ("target : versionCode=$VersionCode versionName=$Version")

# ---------- 1. idempotent version sync ----------
$g2 = $gradle
if ($curName -ne $Version) { $g2 = $g2 -replace ('versionName\s*=\s*"' + [regex]::Escape($curName) + '"'), ('versionName = "' + $Version + '"') }
if ($curCode -ne $VersionCode.ToString()) { $g2 = $g2 -replace ('versionCode\s*=\s*' + [regex]::Escape($curCode)), ('versionCode = ' + $VersionCode) }
if ($g2 -eq $gradle) {
  Say "version: nothing to write (idempotent skip)"
} elseif ($DryRun) {
  Say "DRYRUN: would write build.gradle.kts"
} else {
  Write-Text $gradlePath $g2
  Say "version: wrote build.gradle.kts"
}

# ---------- 2. build on vm1 ----------
$localApk = "$OutDir\dsh-push.apk"
if ($DryRun) {
  Say "DRYRUN: would rsync src -> vm1 and run gradle assembleDebug"
} else {
  Say "build: sync sources to vm1"
  # NOTE: every ssh/scp here goes through cmd /c. PowerShell 5.1 piping ssh output into
  # Out-String hangs forever (HARD FACT 2026-10-13, 34 min lost) - cmd /c sidesteps it.
  cmd /c "ssh -F NUL $SSH_OPTS $Vm1 ""rm -rf work/projects/dsh-push/android-app/app/src""" 2>&1 | Out-Null
  cmd /c "scp $SSH_OPTS -r ""$repo\android-app\app\src"" ""${Vm1}:work/projects/dsh-push/android-app/app/""" 2>&1 | Out-Null
  cmd /c "scp $SSH_OPTS ""$repo\android-app\app\build.gradle.kts"" ""${Vm1}:work/projects/dsh-push/android-app/app/""" 2>&1 | Out-Null
  cmd /c "scp $SSH_OPTS ""$repo\android-app\build.gradle.kts"" ""$repo\android-app\settings.gradle.kts"" ""$repo\android-app\gradle.properties"" ""${Vm1}:work/projects/dsh-push/android-app/""" 2>&1 | Out-Null

  # gradle --stop + kill the Kotlin daemon first: a stale daemon with the OLD -Xss value is what
  # produced the psi2ir StackOverflowError on 2026-10-25 (see HANDOVER 7.18).
  $sh = @'
set -e
export JAVA_HOME=/usr/lib/jvm/java-1.17.0-openjdk-amd64
export PATH=$HOME/gradle-8.7/bin:$JAVA_HOME/bin:$PATH
cd ~/work/projects/dsh-push/android-app
gradle --stop >/dev/null 2>&1 || true
pkill -f KotlinCompileDaemon >/dev/null 2>&1 || true
gradle assembleDebug -q < /dev/null
stat -c %s app/build/outputs/apk/debug/app-debug.apk
'@
  $f = "$OutDir\vm1-build.sh"
  Write-Text $f $sh
  Say "build: gradle assembleDebug on vm1 (budget ${BuildTimeoutSec}s)"
  $t0 = Get-Date
  $bd = cmd /c "ssh -F NUL $SSH_OPTS $Vm1 ""tr -d '\r' | bash -s"" < ""$f"""
  $bdText = ($bd | Out-String)
  $size = (($bdText -split "`r?`n") | Where-Object { $_ -match '^\d{6,}$' } | Select-Object -Last 1)
  if (-not $size) {
    Write-Host $bdText
    Fail ("gradle produced no apk size line (rc=$LASTEXITCODE). Full output above.")
  }
  Say ("build: apk $size bytes in " + [int]((Get-Date) - $t0).TotalSeconds + "s")
  cmd /c "scp $SSH_OPTS ""${Vm1}:work/projects/dsh-push/android-app/app/build/outputs/apk/debug/app-debug.apk"" ""$localApk""" 2>&1 | Out-Null
  if (-not (Test-Path $localApk)) { Fail "scp of the built apk failed" }
  Say ("build: fetched " + (Get-Item $localApk).Length + " bytes")
}

# ---------- 3. publish ----------
if ($NoPublish) {
  Say ("publish: skipped (-NoPublish); built apk = " + $localApk)
} elseif ($DryRun) {
  Say "DRYRUN: would scp to ${Aliyun}:/var/www/certbot/dl/dsh-push.apk and ${Aliyun}:/srv/blog/dl/dsh-push-latest.apk, then check ?v=$VersionCode"
} else {
  Say "publish: upload to the dl directory"
  cmd /c "scp $SSH_OPTS ""$localApk"" ""${Aliyun}:/var/www/certbot/dl/dsh-push.apk""" 2>&1 | Out-Null
  # 3b. blog download button. blog.cpyh.xyz serves /dsh-push-latest.apk from /srv/blog/dl/,
  # OUTSIDE dist/ (so static site deploys never clobber it) - which also means nothing else
  # ever refreshes it. 2026-10-28: it was stuck on 1.33.52 while dl/ served 1.33.53. Keep the
  # two in step here, or the blog button silently ships an old build.
  if ($SkipBlog) {
    Say "publish: blog copy skipped (-SkipBlog)"
  } else {
    cmd /c "scp $SSH_OPTS ""$localApk"" ""${Aliyun}:/srv/blog/dl/dsh-push-latest.apk""" 2>&1 | Out-Null
    $blog = "https://blog.cpyh.xyz/dsh-push-latest.apk"
    $bchk = cmd /c "curl.exe -s -o ""$OutDir\blog-check.apk"" -w ""%{http_code} %{size_download}"" $blog" 2>&1
    $bsame = (Test-Path "$OutDir\blog-check.apk") -and ((Get-FileHash "$OutDir\blog-check.apk" -Algorithm SHA256).Hash -eq (Get-FileHash $localApk -Algorithm SHA256).Hash)
    if (($bchk -match "^200") -and $bsame) {
      Say ("publish: blog OK $blog (" + $bchk + ", sha256 matches)")
    } else {
      # not fatal: dl/ is the distribution path the app actually uses
      Say ("publish: WARN blog copy mismatch: " + $bchk + " same=" + $bsame)
    }
  }
  $dl = "$Ntfy/dl/dsh-push.apk?v=$VersionCode"
  if ($SkipOnlineCheck) {
    Say "publish: online check skipped"
  } else {
    $chk = cmd /c "curl.exe -s -o ""$OutDir\dl-check.apk"" -w ""%{http_code} %{size_download}"" $dl" 2>&1
    $same = (Get-FileHash "$OutDir\dl-check.apk" -Algorithm SHA256).Hash -eq (Get-FileHash $localApk -Algorithm SHA256).Hash
    if (($chk -match "^200") -and $same) {
      Say ("publish: OK $dl (" + $chk + ", sha256 matches)")
    } else {
      Fail ("online check mismatch: " + $chk + " same=" + $same)
    }
  }
  if (-not $NoNotify) {
    $dl = "$Ntfy/dl/dsh-push.apk?v=$VersionCode"
    $note = if ($DeployNote) { $DeployNote } else { "updated to v$Version" }
    $note = $note.Replace('\', '\\').Replace('"', '\"')
    $pj = '{"topic":"' + $Topic + '","title":"dsh-push update v' + $Version + '","message":"' + $note + '\n#web ' + $dl + '","priority":4,"click":"' + $dl + '"}'
    $pf = "$OutDir\upd-note.json"
    Write-Text $pf $pj
    $r = cmd /c "curl.exe -s -X POST -H ""Authorization: Bearer $WriteToken"" -H ""Content-Type: application/json"" --data-binary ""@$pf"" $Ntfy" 2>&1
    $nid = try { ($r | Out-String | ConvertFrom-Json).id } catch { "?" }
    Say ("publish: update notification id=" + $nid)
  }
}

# ---------- 4. public mirrors ----------
if ($NoPublish -or $SkipExport) {
  Say "export: skipped"
} elseif ($DryRun) {
  Say "DRYRUN: would run export-public.ps1"
} else {
  Say "export: public mirrors"
  $ec = "powershell -NoProfile -ExecutionPolicy Bypass -File ""$PSScriptRoot\export-public.ps1"""
  if ($DeployNote) { $ec += " -Msg ""$DeployNote""" }
  cmd /c $ec 2>&1 | ForEach-Object { Write-Host $_ }
}

Say ""
Say ("DONE. download: " + $Ntfy + "/dl/dsh-push.apk?v=" + $VersionCode + "  (v" + $Version + ")")
Say ("next: user installs and tests. If they report a problem, use verify\release.ps1 or " +
     "verify\dsh-app-verify.ps1 for the emulator round.")
exit 0
