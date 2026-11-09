# rollback-plugin.ps1 -- put the machine back on the old push path (hook + external bridge).
# Use when the plugin cutover misbehaves: questions stop reaching the phone, answers do not land,
# the host fails to boot, or you simply want the previous behaviour back.
# It reverses exactly what the cutover did. ASCII only.
$ErrorActionPreference = "Continue"
$dsh = "D:\programs\dsh\resources\runtime\cli\bin\dsh.cmd"
$prof = Join-Path $env:USERPROFILE ".dsh\profiles\web"
$helper = "C:\Users\<user>\Documents\cp_learn_win\deepseek-harness\dsh-net-restart-once.ps1"

Write-Host "[rollback] removing the plugin from profile web"
& $dsh plugin --profile web remove dsh-push-host

foreach ($f in @("cordis.patch.yml", "package.json")) {
    $bak = Join-Path $prof "$f.bak-plugin"
    if (Test-Path $bak) {
        Copy-Item $bak (Join-Path $prof $f) -Force
        Write-Host "[rollback] restored $f from $f.bak-plugin"
    } else {
        Write-Host "[rollback] WARNING: $bak missing - leaving $f as-is"
    }
}

$hooks = Join-Path $env:USERPROFILE ".dsh\hooks.json"
$hbak = "$hooks.bak-cu"
if (Test-Path $hbak) {
    Copy-Item $hbak $hooks -Force
    Write-Host "[rollback] hooks.json restored from hooks.json.bak-cu"
} else {
    Write-Host "[rollback] WARNING: $hbak missing - hooks.json left as-is"
}

if (Test-Path $helper) {
    Write-Host "[rollback] restarting the DSH host via the one-off task"
    & powershell -NoProfile -ExecutionPolicy Bypass -File $helper
} else {
    Write-Host "[rollback] restart the host manually: dsh-net.ps1 restart (from outside this shell)"
}
Write-Host "[rollback] done. Old path = hook push + relay + external bridge (both bridges verified today)."
