@echo off
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\setup-windows.ps1"
if errorlevel 1 (
  echo Setup failed. Read the message above, then run setup again.
  pause
  exit /b 1
)
echo Setup complete. Double-click Start-QuranControl.cmd.
pause
