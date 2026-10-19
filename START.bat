@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 24 LTS, then run START.bat again.
 pause
 exit /b 1
)
if not exist node_modules (
 call npm ci
 if errorlevel 1 (
  echo Dependency installation failed. Check internet connection and Node.js version.
  pause
  exit /b 1
 )
)
echo Open the Local URL displayed below. Keep this window open.
call npm run dev
pause
