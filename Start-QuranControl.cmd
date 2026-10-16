@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Run Setup-Windows.cmd first.
  pause
  exit /b 1
)
if not exist "node_modules\express" (
  echo Run Setup-Windows.cmd first.
  pause
  exit /b 1
)
set "NO_STARTUP_PROMPT=1"
set "OPEN_ADMIN_ON_START=1"
set "LISTENER_AUTOSTART=0"
if exist "data\listener-settings.json" set "LISTENER_AUTOSTART=1"
node server\index.js
if errorlevel 1 pause
