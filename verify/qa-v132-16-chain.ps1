param([Parameter(Mandatory=$true)][ValidateSet('sync','build','fetch')][string]$Step)
$ErrorActionPreference = 'Stop'
$base = @('-o','BatchMode=yes','-o','ConnectTimeout=15')
$Vm1 = 'user@<tailnet-vm1>'
$Repo = 'E:\work\work_dsh\dsh-push'
$Out = Join-Path $Repo 'verify'
$sshExe = Join-Path $env:WINDIR 'System32\OpenSSH\ssh.exe'
$scpExe = Join-Path $env:WINDIR 'System32\OpenSSH\scp.exe'
function Read-Temp([string]$f) {
  $fs = [IO.File]::Open($f,'Open','Read','ReadWrite')
  $sr = New-Object IO.StreamReader($fs,[Text.Encoding]::UTF8)
  $t = $sr.ReadToEnd(); $sr.Close(); $fs.Close(); return $t
}
function Run-Cmd {
  param([string]$Exe,[string[]]$ArgList,[string]$InFile,[int]$TimeoutMs,[string]$Label)
  $outF = [IO.Path]::GetTempFileName(); $errF = [IO.Path]::GetTempFileName()
  if ($InFile) {
    $p = Start-Process -FilePath $Exe -ArgumentList $ArgList -NoNewWindow -PassThru -RedirectStandardOutput $outF -RedirectStandardError $errF -RedirectStandardInput $InFile
  } else {
    $p = Start-Process -FilePath $Exe -ArgumentList $ArgList -NoNewWindow -PassThru -RedirectStandardOutput $outF -RedirectStandardError $errF
  }
  if (-not $p.WaitForExit($TimeoutMs)) { try { $p.Kill() } catch {} ; Write-Output ($Label + ' TIMEOUT') }
  Write-Output ('== ' + $Label)
  Write-Output (Read-Temp $outF)
  $er = Read-Temp $errF
  if ($er.Trim().Length -gt 0) { Write-Output ('-- stderr --'); Write-Output $er }
  Remove-Item $outF,$errF -Force -ErrorAction SilentlyContinue
}
$remoteCmd = "tr -d '\r' | bash -s"
$localApk = Join-Path $Out 'qa-v132-16-app-debug.apk'
if ($Step -eq 'sync') {
  Write-Output 'LOCAL_FILES_SENT'
  Get-ChildItem -Path ($Repo + '\android-app\app\src') -Recurse -File | ForEach-Object { Write-Output ('  ' + $_.FullName.Substring($Repo.Length + 1)) }
  Write-Output ('  ' + $Repo + '\android-app\app\build.gradle.kts')
  Write-Output ('  ' + $Repo + '\android-app\build.gradle.kts')
  Write-Output ('  ' + $Repo + '\android-app\settings.gradle.kts')
  Write-Output ('  ' + $Repo + '\android-app\gradle.properties')
  Run-Cmd $sshExe ($base + @($Vm1,'rm -rf work/projects/dsh-push/android-app/app/src')) $null 90000 'rm-src'
  Run-Cmd $scpExe ($base + @('-r',($Repo + '\android-app\app\src'),($Vm1 + ':work/projects/dsh-push/android-app/app/'))) $null 300000 'scp-src'
  Run-Cmd $scpExe ($base + @(($Repo + '\android-app\app\build.gradle.kts'),($Vm1 + ':work/projects/dsh-push/android-app/app/'))) $null 120000 'scp-appgradle'
  Run-Cmd $scpExe ($base + @(($Repo + '\android-app\build.gradle.kts'),($Repo + '\android-app\settings.gradle.kts'),($Repo + '\android-app\gradle.properties'),($Vm1 + ':work/projects/dsh-push/android-app/'))) $null 120000 'scp-rootgradle'
  Run-Cmd $sshExe ($base + @($Vm1,'cd work/projects/dsh-push/android-app && sha256sum app/src/main/java/xyz/cpyh/dshpush/WebActivity.kt app/src/main/java/xyz/cpyh/dshpush/PushService.kt && find app/src -type f | wc -l')) $null 90000 'vm1-hash'
} elseif ($Step -eq 'build') {
  Run-Cmd $sshExe ($base + @('-F','NUL',$Vm1,$remoteCmd)) ($Out + '\qa-v132-16-build.sh') 900000 'build-vm1'
} else {
  if (Test-Path $localApk) { Remove-Item $localApk -Force }
  Run-Cmd $scpExe ($base + @(($Vm1 + ':work/projects/dsh-push/android-app/app/build/outputs/apk/debug/app-debug.apk'),$localApk)) $null 300000 'fetch-apk'
  if (Test-Path $localApk) {
    Write-Output ('LOCAL_APK_PATH ' + $localApk)
    Write-Output ('LOCAL_APK_SIZE ' + (Get-Item $localApk).Length)
    Write-Output ('LOCAL_APK_SHA ' + (Get-FileHash -Algorithm SHA256 $localApk).Hash.ToLower())
  } else { Write-Output 'LOCAL_APK_MISSING' }
}
Write-Output ('STEP_' + $Step + '_DONE')
