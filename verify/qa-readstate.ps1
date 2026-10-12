# qa-readstate.ps1 - v1.28.0 QA: normal text answer -> auto-read; supervisor proxy -> stays unread.
# Pushes two test questions + two #ans echoes, reads emulator prefs, asserts read flags, saves screenshot.
$ErrorActionPreference = "Stop"
. "$PSScriptRoot\config.local.ps1"

function Push([string]$title, [string]$msg, [int]$prio) {
    # Build JSON by hand: \n stays a real JSON escape; written via .NET so cmd/bash never eat backslashes.
    $esc = { param($s) $s.Replace('\','\\').Replace('"','\"').Replace("`n", '\n') }
    $body = '{"topic":"' + $Topic + '","title":"' + (& $esc $title) + '","message":"' + (& $esc $msg) + '","priority":' + $prio + '}'
    $tmp = Join-Path $env:TEMP "dsh-verify\push-qa28.json"
    New-Item -Force -ItemType directory (Split-Path $tmp) | Out-Null
    [IO.File]::WriteAllText($tmp, $body, (New-Object Text.UTF8Encoding $false))
    & curl.exe -s -X POST -H "Authorization: Bearer $WriteToken" `
        -H "Content-Type: application/json" --data-binary "@$tmp" $Ntfy | Out-Null
}

$rnd = Get-Random -Maximum 99999
$cidA = "qa28a$rnd"; $cidB = "qa28b$rnd"

Push "DSH 等你选择 [qa28A]" "测试A：普通文字作答应自动已读`n📱 作答: $Ntfy/answer/$cidA`n#qid q0" 4
Start-Sleep 7
Push "DSH 已答" "#ans $cidA 我自己打的字" 1
Start-Sleep 7
Push "DSH 等你选择 [qa28B]" "测试B：监督者代答应保持未读`n📱 作答: $Ntfy/answer/$cidB`n#qid q0" 4
Start-Sleep 5
Push "DSH 已答" "#ans $cidB 【监督者自动唤醒】用户未在期限内应答" 1
Start-Sleep 7

$raw = (cmd /c "ssh -o BatchMode=yes $EmuUser@$EmuIp ""G:\Android\Sdk\platform-tools\adb.exe -s emulator-5556 shell run-as xyz.cpyh.dshpush cat /data/data/xyz.cpyh.dshpush/shared_prefs/dshpush.xml""") 2>&1 | Out-String
$raw = $raw -replace '&quot;', '"' -replace '&amp;', '&'
foreach ($pair in @(@($cidA, "A normal-answer"), @($cidB, "B supervisor-proxy"))) {
    $cid = $pair[0]; $name = $pair[1]
    $chunk = ($raw -split '\},\{' | Where-Object { $_ -match "`"callId`":`"$cid`"" }) | Select-Object -First 1
    if (-not $chunk) { "FAIL ${name}: card not in prefs (question never arrived?)"; continue }
    $answered = $chunk -match '"answered"'
    $read = $chunk -match '"read":true'
    if ($name -like "A*") {
        if ($answered -and $read) { "PASS ${name}: answered + read=true (dot gone)" }
        else { "FAIL ${name}: answered=$answered read=$read" }
    } else {
        if ($answered -and -not $read) { "PASS ${name}: answered + read=false (dot kept)" }
        else { "FAIL ${name}: answered=$answered read=$read" }
    }
}

(cmd /c "ssh -o BatchMode=yes $EmuUser@$EmuIp ""G:\Android\Sdk\platform-tools\adb.exe -s emulator-5556 shell rm -f /sdcard/qa28.png & G:\Android\Sdk\platform-tools\adb.exe -s emulator-5556 shell screencap -p /sdcard/qa28.png & G:\Android\Sdk\platform-tools\adb.exe -s emulator-5556 pull /sdcard/qa28.png G:\Android\qa28.png""") 2>&1 | Out-Null
Remove-Item -Force F:\work\work_dsh\qa-shot-read.png -ErrorAction SilentlyContinue
scp -o BatchMode=yes "$EmuUser@$EmuIp:G:/qa28.png" "F:\work\work_dsh\qa-shot-read.png" 2>&1 | Out-Null
if (Test-Path F:\work\work_dsh\qa-shot-read.png) { "SHOT: F:\work\work_dsh\qa-shot-read.png" } else { "SHOT MISSING" }
