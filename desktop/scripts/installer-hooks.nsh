; Kill residual app processes before install/uninstall steps to avoid
; "cannot be closed" errors when a hidden/background instance is still alive.

!macro customInit
  nsExec::ExecToLog 'cmd /c taskkill /F /T /IM "Interview AI Hamburger.exe" >nul 2>&1'
  nsExec::ExecToLog 'cmd /c taskkill /F /T /IM "Interview-Hammer.exe" >nul 2>&1'
!macroend

!macro customInstall
  nsExec::ExecToLog 'cmd /c taskkill /F /T /IM "Interview AI Hamburger.exe" >nul 2>&1'
  nsExec::ExecToLog 'cmd /c taskkill /F /T /IM "Interview-Hammer.exe" >nul 2>&1'
!macroend

