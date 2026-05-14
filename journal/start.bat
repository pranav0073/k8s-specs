@echo off
title Trading Journal
echo.
echo  Starting Trading Journal...
echo  Open http://localhost:5000 in your browser
echo  Press Ctrl+C to stop
echo.

set SCRIPT_DIR=%~dp0
set STATIC_DIR=%SCRIPT_DIR%frontend\build
set PORT=5000

echo  [1/3] Installing backend dependencies...
cd /d "%SCRIPT_DIR%backend"
call npm install --silent
if errorlevel 1 (
  echo.
  echo  ERROR: Backend npm install failed. Check your Node.js installation.
  pause
  exit /b 1
)

echo  [2/3] Installing and building frontend...
cd /d "%SCRIPT_DIR%frontend"
call npm install --silent
if errorlevel 1 (
  echo.
  echo  ERROR: Frontend npm install failed.
  pause
  exit /b 1
)
call npm run build
if errorlevel 1 (
  echo.
  echo  ERROR: Frontend build failed. Check above for errors.
  pause
  exit /b 1
)

echo  [3/3] Starting server...
cd /d "%SCRIPT_DIR%backend"
start "" http://localhost:5000
node --experimental-sqlite server.js

echo.
echo  Server stopped.
pause
