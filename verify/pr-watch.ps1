# pr-watch.ps1 - daily watcher for the DSH plugin market submission PR.
#
# WHY: 2026-10-27 the host plugin was submitted to the awesome-dsh-plugin list
#      (PR #9779). Merging is done by community maintainers, so there is nothing
#      to speed up locally. The user asked: "check it daily, push to my phone
#      when there is a result".
#
# BEHAVIOUR: quiet by default. It reads the PR anonymously (public repo, no
#      token needed) and pushes an ntfy notification ONLY when something
#      changed that counts as news:
#        - merged            -> priority 5
#        - closed unmerged   -> priority 5
#        - new comment       -> priority 4
#        - CI turned red     -> priority 4
#      An unchanged day produces no notification at all, only a log line.
#
# HARD FACTS (learned the hard way, see HANDOVER 7.25/7.26):
#   * ntfy POST must go to the server ROOT with the topic inside the JSON body.
#     POSTing to /<topic> makes the aliyun edge store the whole blob as text.
#   * "priority" must be an INTEGER in the JSON body, not a string.
#   * GitHub API must be called with a User-Agent header or it answers 403.
#   * An anonymous GET is enough here; a PAT is NOT stored in this script.
#
# USAGE:
#   powershell -NoProfile -ExecutionPolicy Bypass -File verify\pr-watch.ps1 -DryRun
#   powershell -NoProfile -ExecutionPolicy Bypass -File verify\pr-watch.ps1 -Force
#
# -DryRun  : print what would happen, do not push, do not write state.
# -Force   : push even when nothing changed (used once to prove the channel).

param(
  [string]$Repo = "awesome-dsh-plugin/awesome-dsh-plugin",
  [int]$PrNumber = 9779,
  [string]$GitHubToken = "",
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = "Stop"

$StateDir  = Join-Path $env:LOCALAPPDATA "dsh-pr-watch"
$StateFile = Join-Path $StateDir "state.json"
$LogFile   = Join-Path $StateDir "watch.log"

if (-not (Test-Path $StateDir)) { New-Item -ItemType Directory -Path $StateDir -Force | Out-Null }

function Now { (Get-Date).ToString("yyyy-MM-dd HH:mm:ss") }

function Log([string]$msg) {
  $line = (Now) + "  " + $msg
  Write-Host $line
  try {
    Add-Content -LiteralPath $LogFile -Value $line -Encoding UTF8
    $n = (Get-Content -LiteralPath $LogFile).Count
    if ($n -gt 400) {
      $keep = Get-Content -LiteralPath $LogFile -Tail 200
      Set-Content -LiteralPath $LogFile -Value $keep -Encoding UTF8
    }
  } catch { }
}

# ---------- ntfy credentials (never hard-coded here) ----------
$Cfg = Join-Path $PSScriptRoot "config.local.ps1"
if (-not (Test-Path $Cfg)) { Log "FATAL: missing $Cfg"; exit 3 }
. $Cfg
if (-not $Ntfy)       { Log "FATAL: config.local.ps1 has no Ntfy"; exit 3 }
if (-not $WriteToken) { Log "FATAL: config.local.ps1 has no WriteToken"; exit 3 }

function Push([string]$title, [string]$body, [int]$prio, [string]$click) {
  $obj = @{
    topic    = $Topic
    title    = $title
    message  = $body
    priority = $prio
    tags     = @("inbox_tray")
  }
  if ($click) { $obj.click = $click }
  $json = $obj | ConvertTo-Json -Depth 4 -Compress
  $pf = Join-Path $StateDir "push.json"
  [IO.File]::WriteAllText($pf, $json, (New-Object Text.UTF8Encoding($false)))
  if ($DryRun) { Log ("DRYRUN push prio=$prio title=" + $title); return "dryrun" }
  # The scheduled task runs this under cmd, where curl can emit extra lines
  # ahead of the JSON body. Write the response to a file and parse that, so the
  # message id is always recorded instead of falling back to "?".
  $rf = Join-Path $StateDir "push-resp.json"
  if (Test-Path -LiteralPath $rf) { Remove-Item -LiteralPath $rf -Force }
  $null = cmd /c "curl.exe -s -o ""$rf"" -X POST -H ""Authorization: Bearer $WriteToken"" -H ""Content-Type: application/json"" --data-binary ""@$pf"" $Ntfy" 2>&1
  $id = "?"
  if (Test-Path -LiteralPath $rf) {
    # PS 5.1 Get-Content reads UTF-8 as ANSI -> Chinese message text mangles the
    # JSON. Always decode with .NET UTF-8 (global rule: text files via .NET).
    try { $id = ([IO.File]::ReadAllText($rf, [Text.Encoding]::UTF8) | ConvertFrom-Json).id } catch { $id = "?" }
  }
  Log ("pushed id=" + $id + " prio=" + $prio)
  return $id
}

# ---------- read the PR ----------
$H = @{ Accept = "application/vnd.github+json"; "User-Agent" = "dsh-pr-watch" }
# Optional: -GitHubToken (or env DSH_PR_WATCH_TOKEN) lifts the anonymous
# 60-req/hour per-IP limit. Anonymous works for 3 requests a day, but a spent
# IP returns 403 and the run would silently wait for tomorrow. The token is
# NEVER stored in this repo: config.local.ps1 is tracked, so pass it on the
# command line or keep it in the scheduled task, not in a tracked file.
# Token resolution order: -GitHubToken, then env DSH_PR_WATCH_TOKEN, then the
# state directory token file. None of these live in the repository.
if (-not $GitHubToken -and $env:DSH_PR_WATCH_TOKEN) { $GitHubToken = $env:DSH_PR_WATCH_TOKEN }
if (-not $GitHubToken) {
  $tf = Join-Path $StateDir "github-token.txt"
  if (Test-Path -LiteralPath $tf) { $GitHubToken = ([IO.File]::ReadAllText($tf, [Text.Encoding]::UTF8)).Trim() }
}
if ($GitHubToken) { $H["Authorization"] = "Bearer " + $GitHubToken }
$api = "https://api.github.com/repos/$Repo"
try {
  $pr = Invoke-RestMethod -Uri "$api/pulls/$PrNumber" -Headers $H -TimeoutSec 30
} catch {
  # A flaky network must not produce a false alarm.
  Log ("fetch failed (will retry tomorrow): " + $_.Exception.Message)
  exit 0
}

$comments = 0
$latestComment = ""
try {
  $cm = Invoke-RestMethod -Uri "$api/issues/$PrNumber/comments?per_page=100" -Headers $H -TimeoutSec 30
  $comments = @($cm).Count
  if ($comments -gt 0) {
    $last = @($cm)[-1]
    $b = [string]$last.body
    if ($b.Length -gt 200) { $b = $b.Substring(0, 200) + "..." }
    $latestComment = ([string]$last.user.login) + ": " + $b
  }
} catch { }

$ci = "unknown"
try {
  $cr = Invoke-RestMethod -Uri "$api/commits/$($pr.head.sha)/check-runs" -Headers $H -TimeoutSec 30
  $runs = @($cr.check_runs)
  if ($runs.Count -gt 0) {
    $ci = ($runs | ForEach-Object { [string]$_.conclusion }) -join ","
    if (-not $ci.Trim(",")) { $ci = "pending" }
  }
} catch { }

$fp = @(
  [string]$pr.state,
  [string]$pr.merged,
  [string]$pr.mergeable_state,
  [string]$comments,
  [string]$pr.review_comments,
  [string]$pr.updated_at,
  [string]$ci
) -join "|"

Log ("pr=#" + $PrNumber + " state=" + $pr.state + " merged=" + $pr.merged + " mstate=" + $pr.mergeable_state +
     " comments=" + $comments + "/" + $pr.review_comments + " ci=" + $ci)

$prev = $null
if (Test-Path $StateFile) {
  try { $prev = Get-Content -LiteralPath $StateFile -Raw | ConvertFrom-Json } catch { }
}

if ($prev -and ($prev.fp -eq $fp) -and (-not $Force)) {
  Log "no change since last run -> stay quiet"
  exit 0
}

# ---------- decide what (if anything) is news ----------
$link  = [string]$pr.html_url
$title = ""
$body  = ""
$prio  = 4

if ($pr.merged) {
  $title = "dsh-push 上架 DSH 插件市场了"
  $body  = "PR #$PrNumber 已合并。`n市场页: https://awesome-dsh-plugin.com`n安装: dsh plugin --profile web add dsh-push-host`n$link"
  $prio  = 5
} elseif ($pr.state -eq "closed") {
  $title = "dsh-push 市场投稿被关闭了"
  $body  = "PR #$PrNumber 状态 closed（未合并）。`n$link"
  $prio  = 5
} elseif ($prev -and ($comments -gt [int]$prev.comments) -and $latestComment) {
  $title = "市场投稿有新留言"
  $body  = "PR #$PrNumber 有 " + ($comments - [int]$prev.comments) + " 条新评论：`n" + $latestComment + "`n$link"
  $prio  = 4
} elseif ($prev -and ($prev.ci -ne $ci) -and ($ci -match "failure|timed_out|cancelled")) {
  $title = "市场投稿 CI 失败了"
  $body  = "PR #$PrNumber 的检查结果变成 " + $ci + "`n$link"
  $prio  = 4
} elseif ($Force -or (-not $prev)) {
  $title = "PR 守望已就位"
  $body  = "已开始每天检查 PR #$PrNumberNumber（插件市场投稿）。`n当前状态: " + $pr.state + " / mergeable=" + $pr.mergeable_state + "`n有结果（合并或被拒）会再推给你。`n$link"
  $prio  = 3
} else {
  Log "changed but not newsworthy (comment counter unchanged) -> stay quiet"
  $fpOnly = @{ fp = $fp; comments = $comments; ci = $ci; state = [string]$pr.state; at = (Now) }
  [IO.File]::WriteAllText($StateFile, ($fpOnly | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
  exit 0
}

Push $title $body $prio $link | Out-Null

if (-not $DryRun) {
  $st = @{ fp = $fp; comments = $comments; ci = $ci; state = [string]$pr.state; at = (Now) }
  [IO.File]::WriteAllText($StateFile, ($st | ConvertTo-Json -Compress), (New-Object Text.UTF8Encoding($false)))
}

Log "done"
exit 0
