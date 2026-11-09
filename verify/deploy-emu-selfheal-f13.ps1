# remote-step4-5.ps1 -- runs ON THE LAPTOP (<win-host-a>).
# Deployed by the lead via scp + `powershell -File`, because the previous attempt passed this body
# through ssh as a base64 -EncodedCommand and blew past the ~8191-char remote command-line limit,
# so NOTHING ran and every check came back empty (which some vacuous comparisons then mislabelled).
# Lesson: long remote bodies go through a FILE, never through the ssh command line.
# ASCII only. Idempotent: if the live script is already the hardened one, it does not copy again.
$ErrorActionPreference = 'Continue'

$S       = 'C:\Users\<user>\emu-selfheal.hardened.ps1'
$live    = 'G:\Android\emu-selfheal.ps1'
$bak     = 'G:\Android\emu-selfheal.ps1.bak-f13'
$sel     = 'G:\Android\emu-ladder.gpu'
$realLog = 'G:\Android\emu-ladder.log'

function Emit([string]$k, [string]$v) { 'KV|' + $k + '=' + (($v -replace "`r?`n", ' ').Trim()) }

# ---------- state check FIRST (the previous silent failure means the live file state is unknown) ----
Emit 'state.liveHash'    (Get-FileHash -LiteralPath $live -Algorithm SHA256).Hash
Emit 'state.backupExists' ([string](Test-Path -LiteralPath $bak))
if (Test-Path -LiteralPath $bak) { Emit 'state.backupHash' (Get-FileHash -LiteralPath $bak -Algorithm SHA256).Hash }
Emit 'state.stagedHash'  (Get-FileHash -LiteralPath $S -Algorithm SHA256).Hash
Emit 'state.stagedExists' ([string](Test-Path -LiteralPath $S))

# ---------- STEP 4a: fallback branch, dry run ----------
$fb = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $S -DryRun -ForceLadder -BreakHostRung -DryRunLadderOutcome sw-ok 2>&1 | Out-String
Emit 'step4a.exit' ([string]$LASTEXITCODE)
Emit 'step4a.regressionLogged' ([string]($fb -match 'REGRESSION'))
Emit 'step4a.selectorRestorePlanned' ([string]($fb -match 'rewrite G:\\Android\\emu-ladder\.gpu back to "host"'))
Emit 'step4a.rung1Attempted' ([string]($fb -match 'rung 1: real GPU'))
Emit 'step4a.swRescueReached' ([string]($fb -match 'rung 2: software GPU'))

# guard: ladder hooks without -DryRun must be refused
$gd = & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $S -ForceLadder 2>&1 | Out-String
Emit 'step4a.guardExit' ([string]$LASTEXITCODE)
Emit 'step4a.guardMessage' ([string]($gd -match 'dry-run-only test hooks'))

# ---------- STEP 4b: replace the live script (idempotent) ----------
$preLive = (Get-FileHash -LiteralPath $live -Algorithm SHA256).Hash
$staged  = (Get-FileHash -LiteralPath $S -Algorithm SHA256).Hash
Emit 'step4b.preLiveHash' $preLive
Emit 'step4b.stagedHash' $staged
if ($preLive -ne $staged) {
  Copy-Item -LiteralPath $S -Destination $live -Force
  Emit 'step4b.copied' 'yes'
} else {
  Emit 'step4b.copied' 'no (already hardened)'
}
Emit 'step4b.postLiveHash' (Get-FileHash -LiteralPath $live -Algorithm SHA256).Hash

foreach ($tn in @('emu-selfheal','emu-selfheal-svc')) {
  $t = Get-ScheduledTask -TaskName $tn -ErrorAction SilentlyContinue
  if ($t) {
    Emit ('task.' + $tn + '.state') $t.State
    Emit ('task.' + $tn + '.exec') (($t.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }) -join ' | ')
  } else { Emit ('task.' + $tn + '.state') 'MISSING' }
}

# ---------- STEP 5: production run of the real scheduled task ----------
Emit 'step5.selBefore' (Get-FileHash -LiteralPath $sel -Algorithm SHA256).Hash
Emit 'step5.selMtimeBefore' ([string](Get-Item -LiteralPath $sel).LastWriteTime.Ticks)
Emit 'step5.qemuBefore' (((Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'qemu*' } | ForEach-Object { $_.ProcessId }) -join ','))
$lineBefore = (Get-Content -LiteralPath $realLog).Count
Emit 'step5.logLinesBefore' ([string]$lineBefore)

$rc = & schtasks.exe /Run /TN emu-selfheal 2>&1 | Out-String
Emit 'step5.schtasksRun' ($rc -replace '\s+', ' ')

$deadline = (Get-Date).AddSeconds(120)
$grew = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 3
  if ((Get-Content -LiteralPath $realLog).Count -gt $lineBefore) { $grew = $true; break }
}
Emit 'step5.logGrew' ([string]$grew)
Start-Sleep -Seconds 2

$newLines = @(Get-Content -LiteralPath $realLog | Select-Object -Skip $lineBefore)
Emit 'step5.newLineCount' ([string]$newLines.Count)
foreach ($l in $newLines) { 'LOG|' + $l }

Emit 'step5.selAfter' (Get-FileHash -LiteralPath $sel -Algorithm SHA256).Hash
Emit 'step5.selMtimeAfter' ([string](Get-Item -LiteralPath $sel).LastWriteTime.Ticks)
Emit 'step5.qemuAfter' (((Get-CimInstance Win32_Process | Where-Object { $_.Name -like 'qemu*' } | ForEach-Object { $_.ProcessId }) -join ','))
Emit 'step5.taskState' ((Get-ScheduledTask -TaskName 'emu-selfheal').State)
Emit 'step5.taskLastResult' ([string](Get-ScheduledTaskInfo -TaskName 'emu-selfheal').LastTaskResult)
