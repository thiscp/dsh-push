' hidden-run.vbs - launch a command with NO visible console window.
'
' Why this exists (measured on <win-host-a>, 2026-10-15):
'   Task Scheduler Settings.Hidden=$true does NOT hide the task process's console window.
'   Canary task, Hidden=True, action "powershell.exe -File x.ps1" -> from inside the process
'   IsWindowVisible(GetConsoleWindow()) was still True in session 1: it popped a console on
'   the desktop. A window-level auditor confirmed a bare cmd.exe task with Hidden=True shows
'   up as a visible ConsoleWindowClass window, while the same command launched through this
'   shim does not. Both keep the child in session 1, which the emulator needs so qemu can
'   own the real GPU in the console session.
'
' Usage:  wscript.exe //B "G:\Android\hidden-run.vbs" <exe-or-cmd> [args...]
' Waits for the child (bWaitOnReturn=True) so the scheduled task lifecycle is unchanged.
Option Explicit

Dim sh, args, cmd, i, rc
Set sh = CreateObject("WScript.Shell")
Set args = WScript.Arguments

If args.Count = 0 Then
  WScript.Quit 2
End If

cmd = Q(args(0))
For i = 1 To args.Count - 1
  cmd = cmd & " " & Q(args(i))
Next

' 0 = SW_HIDE, True = wait for exit so the task tracks the child's lifetime.
rc = sh.Run(cmd, 0, True)
WScript.Quit rc

' Quote only when needed; do not double-wrap an argument that is already quoted.
Function Q(s)
  Dim t
  t = Trim(s)
  If Len(t) >= 2 Then
    If Left(t, 1) = """" And Right(t, 1) = """" Then
      Q = t
      Exit Function
    End If
  End If
  If InStr(t, " ") > 0 Then
    Q = """" & t & """"
  Else
    Q = t
  End If
End Function