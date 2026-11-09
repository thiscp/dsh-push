# install-user.ps1 - one-shot installer for the dsh-push-host companion plugin.
#
# What it does (all steps idempotent, safe to re-run):
#   [1/4] backup profiles\<p>\cordis.patch.yml (covers the plugin-add rewrite too)
#   [2/4] dsh plugin --profile <p> add <source>        (npm name, tarball, or link:<dir>)
#   [3/4] append the timed-mode top-level insert block for tool-ask-user
#         (phone answering requires mode: timed - see host-plugin README hard constraint 1)
#   [4/4] verify via --dump-config: the "push-host" line and "mode: timed" must be visible
#
# After it finishes: RESTART DSH, then use NEW sessions (the ask_user_question tool
# variant is pinned at session creation; old sessions stay legacy forever).
#
# Usage (on the user's Windows machine):
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-user.ps1 -Profile web
#   powershell -NoProfile -ExecutionPolicy Bypass -File install-user.ps1 -Profile web `
#     -DshCli "C:\path\to\dsh.cmd" -Source ".\dsh-push-host-0.1.0.tgz"
param(
  [Parameter(Mandatory = $true)][string]$Profile,
  [string]$DshCli = 'dsh',
  [string]$Source = 'dsh-push-host',
  [int]$Timeout = 120,
  [switch]$SkipPluginAdd
)
$ErrorActionPreference = 'Stop'
$marker = '# dsh-push-host install: timed mode (added by install-user.ps1)'

# 0. preflight: dsh cli + profile dir
if ($DshCli -eq 'dsh') {
  if (-not (Get-Command dsh -ErrorAction SilentlyContinue)) {
    Write-Host 'ERROR: dsh is not on PATH. Pass -DshCli "<DSH install dir>\resources\runtime\cli\bin\dsh.cmd"'
    exit 2
  }
} elseif (-not (Test-Path $DshCli)) {
  Write-Host "ERROR: dsh cli not found: $DshCli"
  exit 2
}
$profileDir = Join-Path $env:USERPROFILE ".dsh\profiles\$Profile"
if (-not (Test-Path $profileDir)) {
  Write-Host "ERROR: profile dir not found: $profileDir"
  Write-Host "Create it first:  & `$$DshCli --profile $Profile --from-default-profile headless --dump-config"
  exit 2
}
$patchFile = Join-Path $profileDir 'cordis.patch.yml'

# 1. backup before any modification (dsh plugin add rewrites this file too)
if (Test-Path $patchFile) {
  $bak = "$patchFile.bak-installuser-$(Get-Date -Format yyyyMMdd-HHmmss)"
  Copy-Item $patchFile $bak
  Write-Host "[1/4] backup: $bak"
} else {
  Write-Host '[1/4] no cordis.patch.yml yet (a new one will be created)'
}

# 2. plugin add (same version re-add is a no-op by design)
if (-not $SkipPluginAdd) {
  Write-Host "[2/4] dsh plugin --profile $Profile add $Source"
  $prevEap = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'   # pnpm writes progress/warnings to stderr; do not let 2>&1 become terminating
  & $DshCli plugin --profile $Profile add $Source
  $code = $LASTEXITCODE
  $ErrorActionPreference = $prevEap
  if ($code -ne 0) {
    Write-Host "ERROR: plugin add failed (exit $code). Restore the backup if the patch file was rewritten."
    exit 3
  }
} else {
  Write-Host '[2/4] plugin add skipped (-SkipPluginAdd)'
}

# 3. timed-mode insert. The patch file may hold CJK comments, so use .NET IO (UTF-8 no BOM),
#    never PowerShell text cmdlets. Idempotency is pinned by the marker line.
#    A fresh profile's patch file is the flow array "[]" - appending a block sequence after it
#    is invalid YAML, so in that case the block REPLACES the empty array.
$enc = New-Object System.Text.UTF8Encoding($false)
$existing = ''
if (Test-Path $patchFile) { $existing = [System.IO.File]::ReadAllText($patchFile, $enc) }
if ($existing.Contains($marker)) {
  Write-Host '[3/4] timed-mode insert already present (marker found) - skipped'
} elseif ($existing.Contains('mode: timed')) {
  Write-Host '[3/4] "mode: timed" already configured somewhere - not appending.'
  Write-Host '      NOTE: if it only lives inside ONE agent preset, other presets stay legacy.'
  Write-Host '      The canonical block is the top-level "- insert:" shown in host-plugin README.'
} else {
  $lines = @(
    $marker,
    '- insert:',
    '    - id: tool-ask-user',
    "      name: '@deepseek-ai/dsh-tool-ask-user'",
    '      config:',
    '        mode: timed',
    "        timeout: $Timeout"
  )
  $block = ($lines -join "`r`n") + "`r`n"
  # judge emptiness on the NON-comment body: the fresh template is comments + "[]"
  $body = ((($existing -split "`r?`n") | Where-Object { $_ -notmatch '^\s*#' }) -join "`n").Trim()
  if ($body -eq '' -or $body -eq '[]') {
    # empty profile template: keep the leading comment header, drop the "[]" line
    $header = @($existing -split "`r?`n") | Where-Object { $_ -match '^\s*#' }
    $newContent = (@($header) + @($lines)) -join "`r`n"
    [System.IO.File]::WriteAllText($patchFile, $newContent + "`r`n", $enc)
    Write-Host "[3/4] patch file was empty ([]) - wrote timed-mode insert as its content (mode: timed, timeout: $Timeout)"
  } else {
    [System.IO.File]::AppendAllText($patchFile, "`r`n" + $block, $enc)
    Write-Host "[3/4] appended timed-mode insert (mode: timed, timeout: $Timeout)"
  }
}

# 4. verify via dump-config. Exit code 0 alone proves nothing - check the actual lines
#    (see host-plugin README pitfall 4).
Write-Host '[4/4] verifying via --dump-config'
$prevEap = $ErrorActionPreference
$ErrorActionPreference = 'Continue'   # node writes stack traces to stderr; capture, do not throw
$dump = & $DshCli --profile $Profile --dump-config 2>&1 | Out-String
$code = $LASTEXITCODE
$ErrorActionPreference = $prevEap
if ($code -ne 0) {
  Write-Host "ERROR: dump-config failed (exit $code). The patch file may be invalid - restore the backup."
  $tail = ($dump -split "`r?`n") | Select-Object -Last 8
  foreach ($t in $tail) { Write-Host ("  | " + $t) }
  exit 4
}
$hitPlugin = ($dump -split "`r?`n") | Select-String -Pattern 'id: push-host' -SimpleMatch
$hitTimed = ($dump -split "`r?`n") | Select-String -Pattern 'mode: timed' -SimpleMatch
foreach ($h in $hitPlugin) { Write-Host ("  plugin: " + $h.Line.Trim()) }
foreach ($h in $hitTimed) { Write-Host ("  timed : " + $h.Line.Trim()) }
if (-not $hitPlugin) {
  Write-Host 'ERROR: no "id: push-host" line in dump-config - the plugin is NOT mounted.'
  exit 5
}
if (-not $hitTimed) {
  Write-Host 'ERROR: no "mode: timed" line in dump-config - phone answering will not land.'
  exit 5
}

Write-Host ''
Write-Host 'OK. Next steps:'
Write-Host '  1) RESTART DSH (tool registration is cold; the token changes on restart).'
Write-Host '  2) Use NEW sessions only - the ask_user_question variant is pinned at session creation.'
Write-Host '  3) Credentials: save the pairing payload as ~/.config/dsh-push/credentials.json,'
Write-Host '     then run dsh-push-pair (and "dsh-push-pair verify") - see host-plugin README.'
Write-Host '  4) Phone app: pair with the payload relay/topic/readToken.'
exit 0
