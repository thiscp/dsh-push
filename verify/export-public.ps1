# export-public.ps1 - sync private dev repo -> public open-source repo (scrubbed).
# Flow: git archive private HEAD -> scrub personal values -> mirror into public
#       workdir -> commit -> push GitHub(origin) + Gitee(gitee).
# Private-first workflow: develop/commit in private, run this after each release.
# ASCII only (PS 5.1). Usage: powershell -File verify\export-public.ps1 -Msg "release v1.26.0: ..."
param(
  [string]$Msg = "sync from private repo $(Get-Date -Format yyyy-MM-dd)",
  [string]$Private = "$PSScriptRoot\..",
  [string]$Public  = "$PSScriptRoot\..\..\dsh-push-public",
  [switch]$DryRun   # scrub + secret gate only: no mirror, no commit, no push (self-proof of the map)
)
$ErrorActionPreference = "Stop"
$stage = "$env:TEMP\dsh-public-export"
if (Test-Path $stage) { Remove-Item -Recurse -Force $stage }
New-Item -ItemType Directory -Force $stage | Out-Null

# 1. export private HEAD (git archive to FILE: PS pipes corrupt binary)
$tmpTar = "$env:TEMP\dsh-public-export.tar"
Push-Location $Private
git archive HEAD --format=tar -o $tmpTar
if ($LASTEXITCODE -ne 0) { throw "git archive failed" }
Pop-Location
tar -xf $tmpTar -C $stage
Remove-Item $tmpTar

# 2. drop private-only files
Remove-Item "$stage\verify\config.local.ps1" -ErrorAction SilentlyContinue

# 3. scrub personal infra values (keep in sync with the master list below)
$map = [ordered]@{
  '<tailnet-windows>'    = '<tailnet-windows>'
  '<tailnet-work>'    = '<tailnet-work>'
  '<tailnet-vm1>'    = '<tailnet-vm1>'
  '<tailnet-laptop>'    = '<tailnet-laptop>'
  '<tailnet-relay>'   = '<tailnet-relay>'
  '<lan-laptop>'     = '<lan-laptop>'
  '<lan-laptop>'      = '<lan-laptop>'
  '<vm-lan>'    = '<vm-lan>'
  '<vm-lan>'  = '<vm-lan>'
  'user@'            = 'user@'
  "'user'"           = "'user'"
  'Users\<user>'       = 'Users\<user>'
  'Users\\<user>'      = 'Users\\<user>'
  'C:/Users/<user>'    = 'C:/Users/<user>'
  '/home/user'       = '/home/user'
  '$EmuUser     = "user"' = '$EmuUser     = "user"'
  '$EmuUser = "user"'     = '$EmuUser = "user"'
  'tk_REPLACE_READ'  = 'tk_REPLACE_READ'
  'tk_REPLACE_WRITE' = 'tk_REPLACE_WRITE'
}
$exts = "*.md","*.ps1","*.py","*.mjs","*.json","*.conf","*.service","*.txt","*.kt","*.xml"
$scrubHits = [ordered]@{}
foreach ($k in $map.Keys) { $scrubHits[$k] = 0 }
Get-ChildItem $stage -Recurse -Include $exts -File | ForEach-Object {
  $t = [IO.File]::ReadAllText($_.FullName); $o = $t
  foreach ($k in $map.Keys) {
    $c = ([regex]::Matches($t, [regex]::Escape($k))).Count
    if ($c -gt 0) { $scrubHits[$k] = $scrubHits[$k] + $c; $t = $t.Replace($k, $map[$k]) }
  }
  if ($t -ne $o) { [IO.File]::WriteAllText($_.FullName, $t, (New-Object Text.UTF8Encoding $false)) }
}

# 3b. -DryRun self-proof, printed BEFORE the gate so the scrub evidence survives a gate failure.
#     IP values are shown (they are the ones a release reviewer must be able to check); every
#     other mapped value (tokens, usernames) is reported as a count only - never echoed.
if ($DryRun) {
  Write-Host ("DRYRUN stage: " + $stage)
  Write-Host "DRYRUN scrub map - personal values found in the export and replaced:"
  foreach ($k in $map.Keys) {
    if ($scrubHits[$k] -gt 0) {
      if ($k -match '^\d+\.\d+\.\d+\.\d+$') {
        Write-Host ("DRYRUN   " + $k + " -> " + $map[$k] + "  x" + $scrubHits[$k])
      } else {
        Write-Host ("DRYRUN   <masked: " + $map[$k] + ">  x" + $scrubHits[$k])
      }
    }
  }
}

# 4. secret gate: fail loudly if anything personal leaked through
$bad = Select-String -Path (Get-ChildItem $stage -Recurse -Include $exts -File).FullName `
      -Pattern 'tk_[a-z0-9]{15,}|G-A-Fb3[n]|100\.(94|101|75|115)\.\d|192\.168\.1\.20|\bcnop\b'
if ($bad) {
  $bad | ForEach-Object { Write-Host "LEAK: $($_.Path):$($_.LineNumber): $($_.Line.Trim().Substring(0,[Math]::Min(80,$_.Line.Trim().Length)))" }
  throw "secret gate failed - add new values to the scrub map and rerun"
}

# 4b. -DryRun stops before the public workdir or any remote is touched.
if ($DryRun) {
  Write-Host "DRYRUN OK: scrub map applied, secret gate passed, public workdir untouched, nothing pushed."
  exit 0
}

# 5. mirror stage -> public workdir (keep .git)
if (-not (Test-Path "$Public\.git")) { throw "public workdir not found: $Public" }
robocopy $stage $Public /MIR /XD .git /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }

# 6. commit + push both remotes
Push-Location $Public
git add -A
$s = git status --porcelain
if (-not $s) { Write-Host "public already up to date"; Pop-Location; exit 0 }
git commit -m $Msg | Out-Null
# --porcelain: machine output on stdout (PS 5.1 treats native stderr as errors)
git push --porcelain origin master | Out-Null
if ($LASTEXITCODE -ne 0) { throw "push github failed" }
git push --porcelain gitee master | Out-Null
if ($LASTEXITCODE -ne 0) { throw "push gitee failed" }
git log --oneline -1
Write-Host "exported to GitHub + Gitee public"
Pop-Location
