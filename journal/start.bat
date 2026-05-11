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

cd /d "%SCRIPT_DIR%backend"
start "" http://localhost:5000
node --experimental-sqlite server.js
