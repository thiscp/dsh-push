param([int]$Seconds = 20, [int]$IntervalMs = 200)
# console-audit.ps1 - WINDOW-LEVEL acceptance probe. Must run as an Interactive task (session 1)
# because EnumWindows only sees windows on the calling session's desktop; a session-0 DSH agent
# cannot observe the user's desktop directly.
#
# Records every top-level console-class window in this session along with:
#   visible=IsWindowVisible  iconic=IsIconic (minimized)  rect=GetWindowRect  pid + command line
# Why iconic/rect matter: IsWindowVisible is True for a minimized window too, so "VISIBLE-CONSOLE"
# alone does NOT prove the user saw it flash. A window that is minimized, or whose rect is
# off-screen / tiny, is not what the user describes as "a window popped up".
Add-Type -Namespace Audit -Name Win -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr hWnd);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr hWnd, System.Text.StringBuilder lpClassName, int nMaxCount);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT lpRect);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
'@

$out = 'C:\Users\<user>\Desktop\test\console-audit.log'
"# console-audit start $(Get-Date -Format 'HH:mm:ss.fff') pid=$PID session=$((Get-Process -Id $PID).SessionId)" | Set-Content $out

$consoleClasses = @('ConsoleWindowClass','CASCADIA_HOSTING_WINDOW_CLASS','PseudoConsoleWindow')
$deadline = (Get-Date).AddSeconds($Seconds)
$samples = 0; $flashes = 0; $steady = 0
$flashPids = @{}; $steadyPids = @{}

while ((Get-Date) -lt $deadline) {
  $samples++
  $cb = [Audit.Win+EnumWindowsProc]{
    param($hWnd, $lParam)
    try {
      $cls = New-Object System.Text.StringBuilder 256
      [void][Audit.Win]::GetClassName($hWnd, $cls, 256)
      if ($consoleClasses -contains $cls.ToString()) {
        $vis = [Audit.Win]::IsWindowVisible($hWnd)
        if ($vis) {
          $ico = [Audit.Win]::IsIconic($hWnd)
          $r = New-Object Audit.Win+RECT
          [void][Audit.Win]::GetWindowRect($hWnd, [ref]$r)
          $w = $r.Right - $r.Left; $h = $r.Bottom - $r.Top
          $pid_ = 0
          [void][Audit.Win]::GetWindowThreadProcessId($hWnd, [ref]$pid_)
          $proc = Get-CimInstance Win32_Process -Filter "ProcessId=$pid_" -ErrorAction SilentlyContinue
          $cl = if ($proc) { ($proc.CommandLine -replace '\s+',' ') } else { '(gone)' }
          $kind = if ($ico) { 'MINIMIZED' } else { 'ONSREEN' }
          "VISIBLE-CONSOLE $(Get-Date -Format 'HH:mm:ss.fff') kind=$kind iconic=$ico rect=${w}x${h}@$($r.Left),$($r.Top) hwnd=$hWnd pid=$pid_ name=$($proc.Name) cmd=$cl" |
            Add-Content $out
        }
      }
    } catch { }
    return $true
  }
  [void][Audit.Win]::EnumWindows($cb, [IntPtr]::Zero)
  Start-Sleep -Milliseconds $IntervalMs
}
"# console-audit end $(Get-Date -Format 'HH:mm:ss.fff') samples=$samples" | Add-Content $out
