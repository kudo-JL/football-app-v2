@echo off
echo.
echo   Football League Manager
echo   ======================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo   [X] Node.js not found. Install from https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo   [1/2] Installing dependencies...
  call npm install
  if errorlevel 1 (
    echo   [X] npm install failed
    pause
    exit /b 1
  )
)

echo.
echo   [2/2] Starting server...
echo.
echo   Open: http://localhost:3000
echo   First account = ADMIN
echo   Press Ctrl+C to stop
echo.

node server.js
