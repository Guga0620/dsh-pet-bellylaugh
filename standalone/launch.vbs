' ============================================================
'  dsh-pet-bellylaugh - standalone launcher (ASCII only on purpose:
'  WScript reads .vbs as ANSI, so non-ASCII here would be mangled)
'
'  Double-click to start a borderless, transparent, always-on-top pet
'  window that keeps working whether or not DSH is running.
' ============================================================
Option Explicit
Dim fso, shell, here, script, cmd

Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
script = here & "\pet.ps1"

If Not fso.FileExists(script) Then
  MsgBox "pet.ps1 not found: " & script, 16, "dsh-pet-bellylaugh"
  WScript.Quit 1
End If

cmd = "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """"
' 0 = hidden console window, False = do not wait for exit
shell.Run cmd, 0, False
