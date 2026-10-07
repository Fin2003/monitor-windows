Option Explicit

If WScript.Arguments.Count < 1 Then WScript.Quit 2

Dim fileSystem, shell, batchPath, command
Set fileSystem = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
batchPath = fileSystem.GetAbsolutePathName(WScript.Arguments(0))
shell.CurrentDirectory = fileSystem.GetParentFolderName(batchPath)
command = "cmd.exe /d /c """"" & batchPath & """ --autostart"""
shell.Run command, 0, True
