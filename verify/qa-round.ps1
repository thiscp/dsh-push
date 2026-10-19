# qa-round.ps1 - run one QA round from the orchestrator (this Windows box).
#
# Stages verify/qa-round-driver.mjs on the emulator host, runs the WHOLE round inside ONE ssh
# session (the driver does everything guest-side: real CDP input for in-page taps, `adb
# screencap` + `adb pull` for every screenshot, a DOM re-check bound to each shot), then pulls
# every screenshot and the timestamped report back here.
#
# Discipline this script encodes (see verify/TESTER.md):
#   - the report file is timestamped, so two runs in a day cannot overwrite each other;
#   - the token is re-read from THIS box's web.log on every run (DSH restarts rotate it);
#   - screenshots must be >100KB (the driver checks; a few KB means a failed capture, not "no change");
#   - it never starts the emulator, never switches GPU modes and never restarts the laptop.
#
# usage:
#   powershell -File verify\qa-round.ps1                                   # default case set
#   powershell -File verify\qa-round.ps1 -Cases "QA-C05,QA-P04"            # a focused regression pair
#   powershell -File verify\qa-round.ps1 -Cases "QA-A13" -OutDir F:\work\work_dsh\tmp\shots\qa
param(
    [string]$EmuHost = "user@<tailnet-laptop>",
    [string]$EmuRoot = "G:\Android",
    [string]$Node    = "D:\Program\nodejs\node.exe",
    [string]$OutDir  = "F:\work\work_dsh\tmp\shots\qa",
    [string]$Cases   = "QA-C05,QA-A01,QA-A02,QA-A06,QA-A07,QA-A08,QA-A10,QA-A12,QA-P04,QA-A13",
    [int]$DriverTimeoutSec = 1800
)
$ErrorActionPreference = "Continue"
$ssh = @("-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=15")
$repoVerify = Split-Path -Parent $MyInvocation.MyCommand.Path
$driver = Join-Path $repoVerify "qa-round-driver.mjs"
if (-not (Test-Path $driver)) { throw "driver not found: $driver" }
New-Item -ItemType Directory -Force $OutDir | Out-Null

# fresh token: the last `dsh web: http://...?token=` line in THIS box's web.log
$m = Select-String -Path "$env:USERPROFILE\.dsh\web.log" -Pattern 'dsh web: http://[0-9.]+:[0-9]+/\?token=([^\s]+)' | Select-Object -Last 1
if (-not $m) { throw "no token line in web.log" }
$tok = $m.Matches[0].Groups[1].Value
$DshWebUrl = "http://<tailnet-windows>:3080/?token=$tok"
Write-Host "URL ok (token len $($tok.Length))"
Write-Host "CASES $Cases"

$remoteRoot = $EmuRoot -replace '\\', '/'
scp @ssh $driver "${EmuHost}:$remoteRoot/qa-round-driver.mjs" | Out-Null

$remote = @"
`$ErrorActionPreference='Continue'
& '$EmuRoot\Sdk\platform-tools\adb.exe' start-server | Out-Null
Remove-Item '$EmuRoot\qa' -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force '$EmuRoot\qa' | Out-Null
& '$Node' '$EmuRoot\qa-round-driver.mjs' '$DshWebUrl' '$Cases'
"@
$remotePath = Join-Path $env:TEMP "qa-round-remote.ps1"
[IO.File]::WriteAllText($remotePath, $remote, (New-Object Text.UTF8Encoding $false))
scp @ssh $remotePath "${EmuHost}:$remoteRoot/qa-round-remote.ps1" | Out-Null

# bounded: a wedged guest must end the round as BLOCKED, not hang the operator forever
$job = Start-Job {
    param($sshArgs, $hostName, $root, $remoteScript)
    & ssh @sshArgs $hostName "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe -NoProfile -ExecutionPolicy Bypass -File $root\qa-round-remote.ps1" 2>&1
} -ArgumentList (,$ssh), $EmuHost, $EmuRoot, "G:/Android/qa-round-remote.ps1"
if (Wait-Job $job -Timeout $DriverTimeoutSec) {
    Receive-Job $job | ForEach-Object { Write-Host $_ }
} else {
    Write-Host "ROUND TIMEOUT after ${DriverTimeoutSec}s (treated as BLOCKED; device may be wedged - report it, do not restart the emulator)"
    Stop-Job $job
}
Remove-Job $job -Force

scp @ssh "${EmuHost}:$remoteRoot/qa/*" "$OutDir\" 2>&1 | Out-Null
$shots = Get-ChildItem "$OutDir\qa-*" -ErrorAction SilentlyContinue | Sort-Object Name
$shots | Select-Object Name, Length | Format-Table -AutoSize
$small = $shots | Where-Object { $_.Extension -eq ".png" -and $_.Length -le 100000 }
if ($small) { Write-Host "WARNING: screenshots under 100KB (failed captures): $($small.Name -join ', ')" }
$report = Get-ChildItem "$OutDir\qa-report-*.json" -ErrorAction SilentlyContinue | Sort-Object LastWriteTime | Select-Object -Last 1
if ($report) { Write-Host "REPORT: $($report.FullName)" } else { Write-Host "NO REPORT PULLED" }
Write-Host "SHOTS:  $OutDir"
