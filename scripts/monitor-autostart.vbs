' Keeps Monitor running: after logon, a crash or a bluescreen it relaunches Monitor through the
' normal-user start.bat entry point; only the hardware engine requests elevation.
' It only acts when Monitor's own electron.exe is absent, so it never opens a second instance.
' While <project>\autostart.paused exists it does nothing (scripts\monitor-autostart.ps1 -Action pause).
' <project>\autostart.quit is written when the user quits Monitor (electron\main.js before-quit) and
' removed when Monitor starts: a quit since the last boot is respected; a crash leaves no marker.
' Usage: wscript monitor-autostart.vbs <project root>
Option Explicit
Dim shell, fso, wmi, root, electron, pauseFile, quitFile, running, process
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
Set wmi = GetObject("winmgmts:\\.\root\cimv2")
root = WScript.Arguments(0)
electron = LCase(root & "\node_modules\electron\dist\electron.exe")
pauseFile = root & "\autostart.paused"
quitFile = root & "\autostart.quit"

Function BootTime()
  Dim os, stamp
  Set stamp = CreateObject("WbemScripting.SWbemDateTime")
  For Each os In wmi.ExecQuery("SELECT LastBootUpTime FROM Win32_OperatingSystem")
    stamp.Value = os.LastBootUpTime
  Next
  BootTime = stamp.GetVarDate(True)
End Function

' True when the user quit Monitor after the last boot.
Function QuitOnPurpose()
  QuitOnPurpose = False
  If fso.FileExists(quitFile) Then
    If fso.GetFile(quitFile).DateLastModified > BootTime() Then QuitOnPurpose = True
  End If
End Function
WScript.Sleep 20000   ' let the desktop settle after logon
Do
  If Not fso.FileExists(pauseFile) And Not QuitOnPurpose() Then
    running = False
    For Each process In wmi.ExecQuery("SELECT ExecutablePath FROM Win32_Process WHERE Name = 'electron.exe'")
      If Not IsNull(process.ExecutablePath) Then
        If LCase(process.ExecutablePath) = electron Then running = True
      End If
    Next
    If Not running Then
      shell.Run "cmd.exe /d /c """"" & root & "\start.bat"" --autostart""", 0, False
      WScript.Sleep 90000   ' startup grace period
    End If
  End If
  WScript.Sleep 60000
Loop
