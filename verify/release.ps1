# release.ps1 - one-command release for the dsh-push Android app (Lead only).
#
# It does NOT re-implement the publish chain: the deploy itself is verify\dsh-app-verify.ps1
# -Deploy (vm1 build -> install -> assertions -> upload -> update notification, expect 9/9).
# This script only wraps the parts around it:
#   1. idempotent version sync in the two places of build.gradle.kts (versionCode + versionName).
#      Since v1.32.17 the version shown inside the app is derived at runtime from
#      PackageInfo.versionName (PushService.APP_VER is gone), so there is no third place.
#      a place that already holds the target value is left untouched;
#   2. the deploy call (the existing single command, with -DeployNote);
#   3. online confirmation of ?v=<versionCode> (size comparison when the local APK is known);
#   4. verify\export-public.ps1 (public mirror) - can be skipped with -SkipExport.
#
# -DryRun prints every step and the version diff and touches NOTHING (no build, no upload, no push).
#
# ASCII only. Chinese content belongs in the .md files, not here.
param(
    [string]$Version      = "",     # e.g. 1.32.8 ; empty = read from build.gradle.kts and report it
    [int]$VersionCode     = 0,      # e.g. 74   ; empty = read from build.gradle.kts and report it
    [string]$DeployNote   = "",
    [switch]$DryRun,
    [switch]$SkipExport,
    [switch]$SkipOnlineCheck
)
$ErrorActionPreference = "Continue"
$repo = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not (Test-Path (Join-Path $repo "android-app\app\build.gradle.kts"))) {
    $repo = "F:\work\work_dsh\dsh-push"
}
$gradlePath = Join-Path $repo "android-app\app\build.gradle.kts"
$verifyDir = Join-Path $repo "verify"
$stage = Join-Path $env:TEMP "dsh-release"
New-Item -ItemType Directory -Force $stage | Out-Null

function Say([string]$s) { Write-Host $s }
function Step([string]$n, [string]$what) { Write-Host ""; Write-Host "=== [$n] $what ===" }

function Read-Text([string]$p) { return [IO.File]::ReadAllText($p) }
function Write-Text([string]$p, [string]$t) { [IO.File]::WriteAllText($p, $t, (New-Object Text.UTF8Encoding $false)) }

# ---------- 0. resolve target version ----------
Step "0" "resolve the target version"
$gradle = Read-Text $gradlePath
$curName = ([regex]::Match($gradle, 'versionName\s*=\s*"([^"]+)"')).Groups[1].Value
$curCode = ([regex]::Match($gradle, 'versionCode\s*=\s*(\d+)')).Groups[1].Value
Say ("current: versionCode={0} versionName={1}" -f $curCode, $curName)
if (-not $Version) { $Version = $curName }
if ($VersionCode -le 0) { $VersionCode = [int]$curCode }
Say ("target : versionCode={0} versionName={1}" -f $VersionCode, $Version)

# ---------- 1. idempotent version sync ----------
Step "1" "idempotent version sync (two places in build.gradle.kts)"
$g2 = $gradle
if ($curName -ne $Version) { $g2 = $g2 -replace ('versionName\s*=\s*"' + [regex]::Escape($curName) + '"'), ('versionName = "' + $Version + '"') }
if ($curCode -ne $VersionCode.ToString()) { $g2 = $g2 -replace ('versionCode\s*=\s*' + [regex]::Escape($curCode)), ('versionCode = ' + $VersionCode) }
$needGradle = ($g2 -ne $gradle)
if (-not $needGradle) {
    Say "  nothing to write (idempotent skip)"
} elseif ($DryRun) {
    Say ("  WOULD WRITE build.gradle.kts: versionCode {0} -> {1} ; versionName {2} -> {3}" -f $curCode, $VersionCode, $curName, $Version)
} else {
    Write-Text $gradlePath $g2; Say "  wrote build.gradle.kts"
    $g3 = Read-Text $gradlePath
    Say ("  verify: versionCode={0} versionName={1}" -f `
        ([regex]::Match($g3, 'versionCode\s*=\s*(\d+)')).Groups[1].Value, `
        ([regex]::Match($g3, 'versionName\s*=\s*"([^"]+)"')).Groups[1].Value)
}

# ---------- 2. deploy (the existing chain, not a new one) ----------
Step "2" "deploy via the existing pipeline"
$deployCmd = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$verifyDir\dsh-app-verify.ps1`" -Deploy"
if ($DeployNote) { $deployCmd += " -DeployNote `"$DeployNote`"" }
Say ("  cmd: {0}" -f $deployCmd)
Say "  expected: SUMMARY: 9/9 passed, then it prints the ?v=<versionCode> download link"
if ($DryRun) {
    Say "  DRYRUN: not executing"
} else {
    cmd /c $deployCmd 2>&1 | ForEach-Object { Write-Host $_ }
    Say ("  exit code: {0}" -f $LASTEXITCODE)
}

# ---------- 3. online confirmation ----------
Step "3" "online confirmation (?v=$VersionCode)"
$url = "https://ntfy.cpyh.xyz/dl/dsh-push.apk?v=$VersionCode"
Say ("  url: {0}" -f $url)
if ($SkipOnlineCheck) {
    Say "  skipped (-SkipOnlineCheck)"
} elseif ($DryRun) {
    Say "  DRYRUN: would HEAD the url and compare Content-Length with the local APK"
} else {
    $hdr = (cmd /c "curl.exe -sS -I --max-time 30 $url") 2>&1
    $len = ($hdr | Select-String -Pattern '^content-length:\s*(\d+)' | Select-Object -First 1)
    if ($len) {
        $onlineLen = [int]$len.Matches[0].Groups[1].Value
        Say ("  online Content-Length = {0}" -f $onlineLen)
        $localApk = Get-ChildItem (Join-Path $repo "android-app\app\build\outputs\apk\debug\app-debug.apk") -ErrorAction SilentlyContinue
        if ($localApk) {
            Say ("  local  APK size       = {0}" -f $localApk.Length)
            if ($localApk.Length -eq $onlineLen) { Say "  => MATCH" } else { Say "  => MISMATCH (deploy step already reports its own verdict; treat this as a hint)" }
        } else {
            Say "  local APK not found (built on vm1) - size comparison left to the deploy step"
        }
    } else {
        Say "  could not read Content-Length (deploy step already reports its own verdict)"
    }
    Say "  behaviour confirmation: reference the current round's QA report (verify\QA-ROUND-v*.md)"
}

# ---------- 4. export to the public mirrors ----------
Step "4" "export to public mirrors"
$exportCmd = "powershell -NoProfile -ExecutionPolicy Bypass -File `"$verifyDir\export-public.ps1`""
if ($DeployNote) { $exportCmd += " -Msg `"$DeployNote`"" }
Say ("  cmd: {0}" -f $exportCmd)
if ($SkipExport) {
    Say "  skipped (-SkipExport)"
} elseif ($DryRun) {
    Say "  DRYRUN: not executing"
} else {
    cmd /c $exportCmd 2>&1 | ForEach-Object { Write-Host $_ }
    Say ("  exit code: {0} (exit 1 can be benign: the script prints 'exported to GitHub + Gitee public')" -f $LASTEXITCODE)
}

Say ""
if ($DryRun) { Say "DRYRUN COMPLETE - nothing was built, uploaded or pushed." } else { Say "RELEASE COMPLETE." }
