# qa-paths.ps1 - verify the success pose on the OTHER two answer paths:
#   -Mode chip  : tap the auto-generated option chip on the MainActivity card
#   -Mode notif : fire the same broadcast the notification action button sends
#                 (shade-collapsed buttons are not hittable in uiautomator)
# Assumes the new APK is already installed. Waits for the next real question
# push, answers it, screenshots the floating success pose. ASCII only.
param([string]$Mode = "chip")
$ErrorActionPreference = "Continue"
# tailscale IP only: LAN IPs drift (.20 -> .1.6 on 2026-10-13) and the laptop firewall drops
# new connections to the LAN address. LAN fallback (dead since 2026-10-13): <lan-laptop>
$EmuIp = "<tailnet-laptop>"; $EmuUser = "user"; $EmuRoot = "G:\Android"
$EmuRootFwd = $EmuRoot.Replace('\','/')
Start-Sleep 12
$emu = @'
$ErrorActionPreference="Continue"
$adb = "G:\Android\Sdk\platform-tools\adb.exe"
Remove-Item G:\Android\qa-shot.png -ErrorAction SilentlyContinue
& $adb root 2>&1 | Out-Null
Start-Sleep 2
& $adb shell cmd statusbar collapse 2>&1 | Out-Null
if ("__MODE__" -ne "notif") {
  & $adb shell am start -n xyz.cpyh.dshpush/.MainActivity 2>&1 | Out-Null
  Start-Sleep 3
}
$x = ""
for ($i=0; $i -lt 12; $i++) {
  $x = ((& $adb shell cat /data/data/xyz.cpyh.dshpush/shared_prefs/dshpush.xml) 2>&1) -join ""
  if ($x -match "opts&quot;") { break }
  Start-Sleep 3
}
if ($x -notmatch "opts&quot;") { "NO_OPTS_ENTRY"; exit 1 }
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
if ("__MODE__" -eq "notif") {
  & $adb shell am broadcast -n xyz.cpyh.dshpush/.AnswerReceiver --es callId $cid --es qid q0 --es label "xiaoyugan A" --ei nid 0 2>&1
} else {
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
}
Start-Sleep -Milliseconds 1600
& $adb shell screencap -p /data/local/tmp/qa-shot.png 2>&1 | Out-Null
& $adb pull /data/local/tmp/qa-shot.png G:\Android\qa-shot.png 2>&1 | Out-Null
"SHOT_DONE"
'@
$f = "$env:TEMP\dsh-verify\qa-paths-emu.ps1"
$emuR = $emu.Replace("__MODE__", $Mode)
[IO.File]::WriteAllText($f, $emuR, (New-Object Text.UTF8Encoding $false))
scp -o BatchMode=yes $f "${EmuUser}@${EmuIp}:$EmuRootFwd/qa-paths-emu.ps1" | Out-Null
(cmd /c "ssh -o BatchMode=yes $EmuUser@$EmuIp ""C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File $EmuRoot\qa-paths-emu.ps1""") 2>$null
scp -o BatchMode=yes "${EmuUser}@${EmuIp}:$EmuRootFwd/qa-shot.png" "F:\work\work_dsh\qa-shot-$Mode.png" | Out-Null
if (Test-Path "F:\work\work_dsh\qa-shot-$Mode.png") { Write-Host "GOT SHOT $Mode" }
