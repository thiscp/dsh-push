param(
  [Parameter(Mandatory=$true)][string]$Token,
  [string]$Registry = "https://registry.npmjs.org/",
  [switch]$DryRun,
  [switch]$SkipBlog
)
$ErrorActionPreference = "Continue"
$pkg = "E:\work\work_dsh\dsh-push\host-plugin"
$npmrc = Join-Path $env:USERPROFILE ".npmrc"

# back up any existing .npmrc once
if ((Test-Path $npmrc) -and -not (Test-Path "$npmrc.bak-publish")) {
  Copy-Item $npmrc "$npmrc.bak-publish" -Force
}

# registry-scoped auth line; always 2FA-free for CLI publishes
$base = ($Registry -replace '^https?:', '') -replace '/+$', ''
$line = "$base/:_authToken=$Token"
$lines = @()
if (Test-Path $npmrc) {
  $lines = @([IO.File]::ReadAllLines($npmrc, [Text.Encoding]::UTF8) | Where-Object { $_ -notmatch ':_authToken=' })
}
$lines += $line
[IO.File]::WriteAllText($npmrc, (($lines -join "`n") + "`n"), (New-Object Text.UTF8Encoding($false)))
"npmrc written (token masked): " + ($line -replace '=.+', '=***')

Push-Location $pkg
try {
  & D:\Program\nodejs\npm.cmd whoami --registry=$Registry 2>&1 | ForEach-Object { "WHOAMI: $_" }
  $pubArgs = @("publish", "--access", "public", "--registry", $Registry)
  if ($DryRun) { $pubArgs += "--dry-run" }
  & D:\Program\nodejs\npm.cmd @pubArgs 2>&1 | ForEach-Object { "PUB: $_" }
  "PUB_RC=$LASTEXITCODE"
} finally {
  Pop-Location
}

if (-not $DryRun) {
  Start-Sleep -Seconds 6
  $code = & curl.exe -s -o NUL -w "%{http_code}" "https://registry.npmjs.org/dsh-push-host"
  "REGISTRY_HTTP=$code"
  $ver = & curl.exe -s "https://registry.npmjs.org/dsh-push-host/latest"
  if ($ver) { "LATEST=" + ($ver | ConvertFrom-Json).version }
}

# The blog download button serves its own copy of the tarball (release-fast.ps1 only mirrors
# the APK), so a publish that stops here leaves https://blog.cpyh.xyz/dl/ behind - and since
# the page no longer prints a version number, nobody can see it. Keep them in lockstep.
if (-not $DryRun -and -not $SkipBlog) {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PSScriptRoot\blog-mirror-host.ps1" 2>&1 | ForEach-Object { "BLOG: $_" }
  "BLOG_RC=$LASTEXITCODE"
  if ($LASTEXITCODE -ne 0) { "WARN npm publish succeeded but the blog mirror did not verify - run blog-mirror-host.ps1 by hand" }
}
