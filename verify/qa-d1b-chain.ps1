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
  Write-Output ('== ' + $Label + ' exit=' + $p.ExitCode)
  Write-Output (Read-Temp $outF)
  $er = Read-Temp $errF
  if ($er.Trim().Length -gt 0) { Write-Output ('-- stderr --'); Write-Output $er }
  Remove-Item $outF,$errF -Force -ErrorAction SilentlyContinue
}
Run-Cmd $sshExe ($base + @($Vm1,'rm -rf work/projects/dsh-push/android-app/app/src')) $null 60000 'rm-src'
Run-Cmd $scpExe ($base + @('-r',($Repo + '\android-app\app\src'),($Vm1 + ':work/projects/dsh-push/android-app/app/'))) $null 240000 'scp-src'
Run-Cmd $scpExe ($base + @(($Repo + '\android-app\app\build.gradle.kts'),($Vm1 + ':work/projects/dsh-push/android-app/app/'))) $null 90000 'scp-appgradle'
Run-Cmd $scpExe ($base + @(($Repo + '\android-app\build.gradle.kts'),($Repo + '\android-app\settings.gradle.kts'),($Repo + '\android-app\gradle.properties'),($Vm1 + ':work/projects/dsh-push/android-app/'))) $null 90000 'scp-rootgradle'
$remoteCmd = "tr -d '\r' | bash -s"
Run-Cmd $sshExe ($base + @('-F','NUL',$Vm1,$remoteCmd)) ($Out + '\qa-d1b-build.sh') 900000 'build-vm1'
$localApk = $Out + '\qa-d1b-app-debug.apk'
if (Test-Path $localApk) { Remove-Item $localApk -Force }
Run-Cmd $scpExe ($base + @(($Vm1 + ':work/projects/dsh-push/android-app/app/build/outputs/apk/debug/app-debug.apk'),$localApk)) $null 240000 'fetch-apk'
if (Test-Path $localApk) {
  Write-Output ('LOCAL_APK_SIZE ' + (Get-Item $localApk).Length)
  Write-Output ('LOCAL_APK_SHA ' + (Get-FileHash -Algorithm SHA256 $localApk).Hash.ToLower())
} else { Write-Output 'LOCAL_APK_MISSING' }
Write-Output 'CHAIN_DONE'
