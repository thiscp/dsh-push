# host-plugin-phone-answer-e2e.ps1 -- prove "the phone can answer a DSH question" END TO END,
# with NO human in the loop: a real agent asks a timed question, the emulator's App answers it,
# and the answer has to land back inside the live agent.
#
# Why this exists (2026-10-13): the plugin's own probe/selfTest fabricates an AGENTLESS question,
# so it can only ever prove "push + register". It can never prove the last hop -- the plugin
# applying the phone's answer with ctx.userQuestions.answer() -- because that requires a LIVE ROOT
# AGENT (deliver() bails out with "no live root agent" otherwise). Every attempt to verify the
# last hop by asking the human to tap the phone is a verification the machine should do itself.
#
# What it does:
#   1. composes a throwaway profile overlay (pushtest): a timed tool-ask-user (the headless bundle
#      has none), the plugin under test pointed at the REAL credentials file, and the uq-probe
#   2. validates the overlay with --dump-config (exit 0 + `mode: timed` present)
#   3. starts the emulator-side answerer first (it polls the App's prefs for our unique marker)
#   4. runs a real headless agent that asks one question and then stays alive (Start-Sleep) so the
#      late answer can be steered into it
#   5. asserts on the run log + the agent's own report
#
# ASCII only (PowerShell 5.1 decodes .ps1 by BOM / ANSI code page; a UTF-8 Chinese comment can
# break parsing outright -- see the shell pitfalls in verify\README.md).
param(
    [string]$Marker = '',
    [int]$ToolTimeoutSec = 60,
    [int]$AgentAliveSec = 150,
    [string]$Profile = 'pushtest',
    [string]$Dsh = 'D:\programs\dsh\resources\runtime\cli\bin\dsh.cmd',
    [string]$DshNode = 'D:\programs\dsh\DeepSeek Harness.exe',
    [string]$WebPatch = "$env:USERPROFILE\.dsh\profiles\web\cordis.patch.yml",
    # tailscale IP only: LAN IPs drift (.20 -> .1.6 on 2026-10-13) and the laptop firewall drops
    # new connections to the LAN address. LAN fallback (dead since 2026-10-13): <lan-laptop>
    [string]$EmuIp = '<tailnet-laptop>',
    [string]$EmuUser = 'user',
    [string]$EmuRoot = 'G:\Android',
    [string]$OutDir = "$env:TEMP\dsh-push-e2e"
)

$ErrorActionPreference = 'Continue'
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null
if ($Marker -eq '') { $Marker = 'dq-e2e-' + [int][double]::Parse((Get-Date -UFormat %s)) }
$overlay = Join-Path $OutDir 'pushtest-e2e.yml'
$runLog = Join-Path $OutDir 'e2e-run.log'
$emuLog = Join-Path $OutDir 'emu-answer.log'
$emuErr = Join-Path $OutDir 'emu-answer.err'
$remoteName = 'host-plugin-e2e-answer.ps1'
$results = @()

function Check([string]$name, [bool]$ok, [string]$detail = '') {
    $script:results += [pscustomobject]@{ Name = $name; Ok = $ok; Detail = $detail }
    if ($ok) { Write-Host ('PASS  ' + $name) } else { Write-Host ('FAIL  ' + $name + '  -> ' + $detail) }
}
function Say([string]$m) { Write-Host ('[e2e] ' + $m) }

Say ('marker = ' + $Marker)

# ---- 1. overlay: model routing (copied out of the live web profile) + timed tool + plugin ----
$web = [System.IO.File]::ReadAllText($WebPatch)
$lines = $web -split "`r?`n"
$starts = @()
for ($i = 0; $i -lt $lines.Count; $i++) { if ($lines[$i] -match '^- (id:|insert:)') { $starts += $i } }
if ($starts.Count -lt 3) { Write-Host 'ERROR: could not parse the web profile patch for its model block'; exit 1 }
$modelBlock = ($lines[$starts[0]..($starts[2] - 1)] -join "`r`n")
$extra = @"

# ---- phone-answer prerequisite: a timed wait (the tool-ask-user the headless bundle lacks) ----
- insert:
    - id: tool-ask-user
      name: '@deepseek-ai/dsh-tool-ask-user'
      config:
        mode: timed
        timeout: $ToolTimeoutSec
# ---- the plugin under test: keep the PRODUCTION topic quiet, name the instance ----
- id: push-host
  config:
    webName: e2e-verify
    notifyTurns: false
# ---- independent probe: prints wait.timed straight off the request waterfall ----
- id: uq-probe
  config:
    log: true
    autoAnswer: false
"@
[System.IO.File]::WriteAllText($overlay, $modelBlock + $extra, (New-Object Text.UTF8Encoding $false))

# ---- 2. validate the overlay before anything runs ----
& $Dsh --profile $Profile --patch $overlay --dump-config 2>&1 | Out-File -Encoding utf8 (Join-Path $OutDir 'dump.txt')
$dumpOk = ($LASTEXITCODE -eq 0)
$dumpText = [System.IO.File]::ReadAllText((Join-Path $OutDir 'dump.txt'))
$timedMounted = ($dumpText -match "tool-ask-user" -and $dumpText -match "mode: timed")
Check 'overlay composes (--dump-config exit 0, no entry-not-found)' $dumpOk 'dump exit=' + $LASTEXITCODE
Check 'timed tool-ask-user is mounted in the test profile' $timedMounted ''
if (-not ($dumpOk -and $timedMounted)) { Write-Host 'ERROR: aborting, the test profile would not be timed'; exit 1 }

# ---- 3. the emulator side: wait for our push in the App's prefs, then answer FROM THE APP ----
# The callId contains a '|', so it MUST be single-quoted for the device shell -- an unquoted
# `am broadcast --es callId call_00_x|uuid` is split at the pipe and silently does nothing.
$remote = @'
$ErrorActionPreference = "Continue"
$adb = "G:\Android\Sdk\platform-tools\adb.exe"
$Marker = "__MARKER__"
& $adb root 2>&1 | Out-Null
Start-Sleep 2
$cid = ""; $qid = "q1"; $nid = 0
for ($i = 0; $i -lt 72; $i++) {
  $x = ((& $adb shell cat /data/data/xyz.cpyh.dshpush/shared_prefs/dshpush.xml) 2>&1) -join ""
  $bestMid = [long]::MinValue
  foreach ($ch in ($x -split '\}\,\{')) {
    if ($ch -notmatch [regex]::Escape($Marker)) { continue }
    if ($ch -match 'answered&quot;') { continue }
    $mm = [regex]::Match($ch, 'mid&quot;:(-?\d+)')
    $cc = [regex]::Match($ch, 'callId&quot;:&quot;([^&]+)')
    if ($mm.Success -and $cc.Success) {
      $v = [long]$mm.Groups[1].Value
      if ($v -gt $bestMid) {
        $bestMid = $v
        $cid = $cc.Groups[1].Value
        $nid = [int]$mm.Groups[1].Value
        $qq = [regex]::Match($ch, 'qid&quot;:&quot;([^&]+)')
        if ($qq.Success) { $qid = $qq.Groups[1].Value }
      }
    }
  }
  if ($cid -ne "") { break }
  Start-Sleep 5
}
if ($cid -eq "") { "NO_MARKER_PUSH"; exit 1 }
"MARKER_SEEN"
"CID=$cid"
"QID=$qid"
$cmd = "am broadcast -n xyz.cpyh.dshpush/.AnswerReceiver --es callId '$cid' --es qid '$qid' --es label 'xiaoyugan A' --ei nid $nid"
"BROADCAST_OUT=" + ((& $adb shell $cmd 2>&1) -join " ")
Start-Sleep 6
& $adb shell screencap -p /data/local/tmp/e2e-shot.png 2>&1 | Out-Null
& $adb pull /data/local/tmp/e2e-shot.png G:\Android\e2e-shot.png 2>&1 | Out-Null
Start-Sleep 3
$y = ((& $adb shell cat /data/data/xyz.cpyh.dshpush/shared_prefs/dshpush.xml) 2>&1) -join ""
$idx = $y.IndexOf($cid)
if ($idx -ge 0) {
  $tail = $y.Substring($idx, [Math]::Min(700, $y.Length - $idx))
  $am = [regex]::Match($tail, 'answered&quot;:&quot;([^&]*)')
  if ($am.Success) { "APP_PREFS_ANSWERED=" + $am.Groups[1].Value } else { "APP_PREFS_ANSWERED=<none>" }
} else { "APP_PREFS_ANSWERED=<callid-not-in-prefs>" }
"EMU_DONE"
'@
$remote = $remote.Replace('__MARKER__', $Marker)
$remotePath = Join-Path $OutDir $remoteName
[System.IO.File]::WriteAllText($remotePath, $remote, (New-Object Text.UTF8Encoding $false))
& scp -o BatchMode=yes $remotePath ($EmuUser + '@' + $EmuIp + ':' + ($EmuRoot -replace '\\', '/') + '/' + $remoteName) 2>&1 | Out-Null
Check 'emulator-side answerer shipped over ssh' ($LASTEXITCODE -eq 0) 'scp exit=' + $LASTEXITCODE

$sshCmd = 'ssh -o BatchMode=yes -o ConnectTimeout=10 ' + $EmuUser + '@' + $EmuIp + ' "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File ' + $EmuRoot + '\' + $remoteName + '"'
Remove-Item $emuLog, $emuErr -ErrorAction SilentlyContinue
$emuProc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c', $sshCmd -RedirectStandardOutput $emuLog -RedirectStandardError $emuErr -NoNewWindow -PassThru
Say ('emulator answerer watching for the push (pid ' + $emuProc.Id + ')')

# ---- 4. the real agent asks one timed question, then stays alive for the late answer ----
# Single line on purpose: a multi-line prompt gets mangled by the dsh.cmd launcher.
$q = '{"questions":[{"id":"q1","header":"e2e","question":"phone-answer e2e ' + $Marker + ': pick an option from the phone App","options":[{"label":"xiaoyugan A"},{"label":"xiaoyugan B"},{"label":"xiaoyugan C"}]}]}'
$prompt = 'Step 1: call the ask_user_question tool exactly once with this argument object and no extra fields (do NOT pass a timeout field): ' + $q +
    '. Step 2: print one line starting with RESULT_JSON: followed by the exact JSON of that tool result.' +
    ' Step 3: call the pwsh tool once with command: Start-Sleep -Seconds ' + $AgentAliveSec + '.' +
    ' Step 4: after it returns, print one line starting with RECEIVED: followed by the verbatim text of any additional user message you received after step 2 (print RECEIVED: none if there was none). Then stop.'
Say 'running the headless agent (expect ~3-5 minutes)'
& $Dsh --profile $Profile --patch $overlay $prompt 2>&1 | Out-File -Encoding utf8 $runLog
Say ('agent run finished, exit=' + $LASTEXITCODE)

$null = $emuProc.WaitForExit(120000)
$emuOut = if (Test-Path $emuLog) { [System.IO.File]::ReadAllText($emuLog) } else { '' }
$log = if (Test-Path $runLog) { [System.IO.File]::ReadAllText($runLog) } else { '' }

# ---- 5. assertions ----
$credLine = [regex]::Match($log, '\[dsh-push-host\] credentials file: .*')
Check 'plugin found the credentials file (path anchored to home, not cwd)' $credLine.Success $credLine.Value
$relayLine = [regex]::Match($log, '\[dsh-push-host\] relay ready host=\S+ topic=\S+')
Check 'relay side active (host + topic + poll)' $relayLine.Success $relayLine.Value
$t = [regex]::Match($log, 'callId\s+=\s+\S+\s+timed=(\w+)')
Check 'the probe sees wait.timed=true (fix 2)' ($t.Success -and $t.Groups[1].Value -eq 'true') $t.Value
$reg = [regex]::Match($log, '\[dsh-push-host\] register \S+ -> HTTP (\d+)')
Check 'POST /answer/register -> HTTP 200 (fix 1)' ($reg.Success -and $reg.Groups[1].Value -eq '200') $reg.Value
Check 'the App really received the push' ($emuOut -match 'MARKER_SEEN') (($emuOut -split "`r?`n") -join ' | ')
Check 'the App submitted the answer (its own record says so)' ($emuOut -match 'APP_PREFS_ANSWERED=xiaoyugan A') ([regex]::Match($emuOut, 'APP_PREFS_ANSWERED=\S*').Value)
$ans = [regex]::Match($log, '\[dsh-push-host\] answered \(continued\) \S+')
Check 'the plugin applied the phone answer in-process (ctx.userQuestions.answer() == true)' $ans.Success $ans.Value
$recv = [regex]::Match($log, 'RECEIVED: .*"selected":\["xiaoyugan A"\]')
Check 'the LIVE AGENT received the phone answer as a user message' $recv.Success ([regex]::Match($log, 'RECEIVED: .{0,160}').Value)

$failed = $results | Where-Object { -not $_.Ok }
Write-Host ''
Write-Host ('SUMMARY: ' + ($results.Count - $failed.Count) + '/' + $results.Count + ' checks passed')
Write-Host ('artifacts: ' + $runLog + ' , ' + $emuLog + ' , ' + $overlay)
if ($failed) { Write-Host ('failed: ' + (($failed | ForEach-Object { $_.Name }) -join ' | ')); exit 1 }
exit 0
