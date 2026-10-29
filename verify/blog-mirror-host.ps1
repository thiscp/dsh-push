# blog-mirror-host.ps1 - mirror the published npm tarball to the blog download button.
#
# Why this exists: release-fast.ps1 step 3b mirrors the APK to /srv/blog/dl/, but the
# plugin tarball is published by npm-publish-host.ps1, which never touched the blog.
# 2026-10-29: npm dist-tags.latest was 0.6.1 while
# https://blog.cpyh.xyz/dl/dsh-push-host-latest.tgz still served 0.6.0 (37 min stale)
# and /dl/dsh-push-host-0.6.1.tgz was 404. The blog page now links "latest" and prints
# no version number, so that drift is invisible to everyone - this script is the gate.
#
# What it does:
#   1. read dist-tags.latest (or -Version) from the npm registry
#   2. download that exact tarball from the registry (the bytes npm itself serves)
#   3. verify sha1 against the registry dist.shasum
#   4. scp it to /srv/blog/dl/dsh-push-host-<version>.tgz AND ...-latest.tgz
#   5. curl both public URLs back and compare sha256 with the local file
#
# Standalone any time:  powershell -NoProfile -File ./blog-mirror-host.ps1
# npm-publish-host.ps1 calls it at the end of a publish (skip with -SkipBlog there).
param(
  [string]$Version = "",                                  # default: npm dist-tags.latest
  [string]$Aliyun  = "root@47.109.50.167",                # public IP; the tailnet path is flaky under Clash TUN
  [string]$OutDir  = (Join-Path $env:TEMP "dsh-blog-mirror"),
  [switch]$DryRun
)
$ErrorActionPreference = "Continue"
$SSH_OPTS = "-o BatchMode=yes -o ConnectTimeout=10"
$Reg = "https://registry.npmjs.org/dsh-push-host"
function Say($m) { Write-Output ((Get-Date).ToString("HH:mm:ss") + " " + $m) }

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir -Force | Out-Null }

# 1. registry metadata
$meta = $null
try { $meta = (& curl.exe -s -m 30 -H "Accept: application/vnd.npm.install-v1+json" $Reg | Out-String) | ConvertFrom-Json } catch { Say ("registry read failed: " + $_) }
if (-not $meta -or -not $meta.'dist-tags'.latest) {
  Say "FAIL cannot read $Reg - registry unreachable?"
  exit 3
}
$v = $Version
if (-not $v) { $v = $meta.'dist-tags'.latest }
$info = $meta.versions.$v
if (-not $info -or -not $info.dist -or -not $info.dist.tarball) {
  Say ("FAIL " + $v + " is not in the registry")
  exit 3
}
Say ("registry latest=" + $meta.'dist-tags'.latest + " target=" + $v + " modified=" + $meta.modified)

# 2. download the exact published bytes
$tgz = Join-Path $OutDir ("dsh-push-host-" + $v + ".tgz")
if (Test-Path $tgz) { Remove-Item $tgz -Force }
$dl = (& curl.exe -s -m 180 -o $tgz -w "%{http_code} %{size_download}" $info.dist.tarball)
Say ("download: " + ("$dl").Trim())
if (-not (Test-Path $tgz)) { Say "FAIL download produced no file"; exit 3 }

# 3. integrity - the registry shasum is sha1 of the tarball
$sha1 = (Get-FileHash $tgz -Algorithm SHA1).Hash.ToLower()
if ($info.dist.shasum -and $sha1 -ne $info.dist.shasum) {
  Say ("FAIL sha1 mismatch local=" + $sha1 + " registry=" + $info.dist.shasum)
  exit 3
}
Say ("sha1 matches registry (" + $sha1 + ")")
$sha256 = (Get-FileHash $tgz -Algorithm SHA256).Hash.ToLower()
$bytes = (Get-Item $tgz).Length

if ($DryRun) { Say ("DRYRUN: would scp " + $bytes + " bytes to " + $Aliyun + ":/srv/blog/dl/ (versioned + latest)"); exit 0 }

# 4. mirror: the versioned archive first, then the pointer the page links
$verName = "dsh-push-host-$v.tgz"
$latName = "dsh-push-host-latest.tgz"
cmd /c "scp $SSH_OPTS ""$tgz"" ""${Aliyun}:/srv/blog/dl/$verName""" 2>&1 | Out-Null
Say ("scp " + $verName + " rc=" + $LASTEXITCODE)
cmd /c "scp $SSH_OPTS ""$tgz"" ""${Aliyun}:/srv/blog/dl/$latName""" 2>&1 | Out-Null
Say ("scp " + $latName + " rc=" + $LASTEXITCODE)
cmd /c "ssh $SSH_OPTS $Aliyun ""chmod 644 /srv/blog/dl/$verName /srv/blog/dl/$latName""" 2>&1 | Out-Null

# 5. verify the bytes the public URL actually serves - this is what drifted before
$bad = 0
foreach ($name in @($latName, $verName)) {
  $chk = Join-Path $OutDir ("check-" + $name)
  if (Test-Path $chk) { Remove-Item $chk -Force }
  $r = (& curl.exe -s -m 180 -o $chk -w "%{http_code} %{size_download}" "https://blog.cpyh.xyz/dl/$name")
  $same = (Test-Path $chk) -and ((Get-FileHash $chk -Algorithm SHA256).Hash.ToLower() -eq $sha256)
  if ($same) {
    Say ("BLOG OK https://blog.cpyh.xyz/dl/" + $name + " (" + ("$r").Trim() + ", sha256 matches)")
  } else {
    Say ("BLOG WARN https://blog.cpyh.xyz/dl/" + $name + " (" + ("$r").Trim() + ", served bytes DIFFER)")
    $bad = $bad + 1
  }
}
Say ("MIRROR " + $v + " " + $bytes + " bytes; served sha256 " + $sha256)
if ($bad -gt 0) { Say "SUMMARY: WARN - uploaded but the served bytes did not match"; exit 0 }
Say "SUMMARY: OK"
exit 0
