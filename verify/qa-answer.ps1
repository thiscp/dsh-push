# qa-answer.ps1 - answer the CURRENT pending DSH question from the emulator:
# wait for the push to land in prefs, grab its callId, open QuickAnswer,
# tap "xiaoyugan A", screenshot the success pose animation.
# Run in background right before issuing the real ask_user_question. ASCII only.
$ErrorActionPreference = "Continue"
# tailscale IP only: LAN IPs drift (.20 -> .1.6 on 2026-10-13) and the laptop firewall drops
# new connections to the LAN address. LAN fallback (dead since 2026-10-13): <lan-laptop>
$EmuIp = "<tailnet-laptop>"; $EmuUser = "user"; $EmuRoot = "G:\Android"
$EmuRootFwd = $EmuRoot.Replace('\','/')
Start-Sleep 15
$emu = @'
$ErrorActionPreference="Continue"
$adb = "G:\Android\Sdk\platform-tools\adb.exe"
Remove-Item G:\Android\qa-shot.png -ErrorAction SilentlyContinue
& $adb root 2>&1 | Out-Null
Start-Sleep 2
$x = ""
for ($i=0; $i -lt 10; $i++) {
  $x = ((& $adb shell cat /data/data/xyz.cpyh.dshpush/shared_prefs/dshpush.xml) 2>&1) -join ""
  if ($x -match "callId") { break }
  Start-Sleep 3
}
$ms = [regex]::Matches($x, 'callId&quot;:&quot;([^&]+)')
if (-not $ms.Count) { "NO_CALLID"; exit 1 }
# pick the NEWEST unanswered entry (largest mid), not the last regex hit
$chunks = $x -split '\},\{'
$cid = ""; $bestMid = [long]::MinValue
foreach ($ch in $chunks) {
  if ($ch -match 'answered&quot;') { continue }
  $mm = [regex]::Match($ch, 'mid&quot;:(-?\d+)')
  $cc = [regex]::Match($ch, 'callId&quot;:&quot;([^&]+)')
  if ($mm.Success -and $cc.Success) {
    $v = [long]$mm.Groups[1].Value
    if ($v -gt $bestMid) { $bestMid = $v; $cid = $cc.Groups[1].Value }
  }
}
if (-not $cid) { "NO_FRESH_CALLID"; exit 1 }
"CID=$cid"
& $adb shell am start -n xyz.cpyh.dshpush/.QuickAnswerActivity --es callId $cid 2>&1
$m = [regex]::Match("", "")
for ($i=0; $i -lt 8; $i++) {
  Start-Sleep 2
  & $adb shell uiautomator dump /sdcard/u.json 2>&1 | Out-Null
  $ui = ((& $adb shell cat /sdcard/u.json) 2>&1) -join ""
  $m = [regex]::Match($ui, 'text="xiaoyugan A"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"')
  if ($m.Success) { break }
}
if (-not $m.Success) { "TAP_NOT_FOUND"; exit 1 }
$tx = ([int]$m.Groups[1].Value + [int]$m.Groups[3].Value) / 2
$ty = ([int]$m.Groups[2].Value + [int]$m.Groups[4].Value) / 2
& $adb shell input tap $tx $ty 2>&1
Start-Sleep -Milliseconds 1200
& $adb shell screencap -p /data/local/tmp/qa-shot.png 2>&1 | Out-Null
& $adb pull /data/local/tmp/qa-shot.png G:\Android\qa-shot.png 2>&1 | Out-Null
"SHOT_DONE"
'@
$f = "$env:TEMP\dsh-verify\qa-answer-emu.ps1"
[IO.File]::WriteAllText($f, $emu, (New-Object Text.UTF8Encoding $false))
scp -o BatchMode=yes $f "${EmuUser}@${EmuIp}:$EmuRootFwd/qa-answer-emu.ps1" | Out-Null
(cmd /c "ssh -o BatchMode=yes $EmuUser@$EmuIp ""C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File $EmuRoot\qa-answer-emu.ps1""") 2>$null
scp -o BatchMode=yes "${EmuUser}@${EmuIp}:$EmuRootFwd/qa-shot.png" "F:\work\work_dsh\qa-shot.png" | Out-Null
if (Test-Path "F:\work\work_dsh\qa-shot.png") { Write-Host "GOT SHOT" }
