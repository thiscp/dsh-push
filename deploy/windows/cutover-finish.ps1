# cutover-finish.ps1 -- finish the dsh-push-host production cutover for profile "web" (ASCII only!).
# Prerequisites already applied by the Lead:
#   * profiles\web\package.json + cordis.patch.yml: plugin installed (from the npm tarball) and
#     tool-ask-user switched to config {mode: timed, timeout: 120}
#   * ~/.config/dsh-push/credentials.json written (relay/host/topic/writeToken/readToken/hostToken)
# This script does the two remaining steps:
#   1) retire the old push hooks (the plugin now owns question push / turn-end push / answer echo,
#      so keeping them would double-push)
#   2) restart the DSH host from OUTSIDE this process tree (a synchronous restart kills the caller)
# Rollback: rollback-plugin.ps1
$ErrorActionPreference = "Continue"
$delay = 0
$cancel = "F:\work\work_dsh\.cutover-cancel"
if ($env:CUTOVER_DELAY_SEC) { $delay = [int]$env:CUTOVER_DELAY_SEC }
$hooks = Join-Path $env:USERPROFILE ".dsh\hooks.json"
$helper = "C:\Users\<user>\Documents\cp_learn_win\deepseek-harness\dsh-net-restart-once.ps1"

if (Test-Path $hooks) {
    Copy-Item $hooks "$hooks.bak-cu" -Force
    [System.IO.File]::WriteAllText($hooks, '{"hooks":{}}', (New-Object System.Text.UTF8Encoding($false)))
    Write-Host "[cutover] hooks.json retired (backup: hooks.json.bak-cu)"
} else {
    Write-Host "[cutover] no hooks.json found - nothing to retire"
}

if (-not (Test-Path $helper)) {
    Write-Host "[cutover] ERROR: restart helper missing: $helper"
    exit 1
}
if ($delay -gt 0) {
    Write-Host "[cutover] delaying the restart by $delay s (cancel by creating $cancel)"
    Start-Sleep -Seconds $delay
    if (Test-Path $cancel) {
        Write-Host "[cutover] CANCELLED by $cancel - hooks stay retired, host NOT restarted."
        Write-Host "[cutover] to finish later: powershell -File `"$PSCommandPath`""
        exit 0
    }
}
Write-Host "[cutover] restarting the DSH host via the one-off task (this session will drop and resume)"
& powershell -NoProfile -ExecutionPolicy Bypass -File $helper
Write-Host "[cutover] restart job submitted; verify with: Get-NetTCPConnection -LocalPort 3081 -State Listen"
