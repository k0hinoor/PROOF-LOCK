@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"
title ProofLock console

echo.
echo  ===============================================
echo   ProofLock - local machine console
echo  ===============================================
echo.

REM ---------------------------------------------------------------- Python
if not exist ".venv\Scripts\python.exe" (
  echo [1/4] Creating the Python environment ^(one time only^)...
  py -3 -m venv .venv 2>nul || python -m venv .venv
  if not exist ".venv\Scripts\python.exe" (
    echo.
    echo  ERROR: Python 3.11+ was not found.
    echo  Install it from https://www.python.org/downloads/ and tick
    echo  "Add python.exe to PATH", then run this file again.
    echo.
    pause
    exit /b 1
  )
  echo [2/4] Installing backend packages...
  ".venv\Scripts\python.exe" -m pip install --upgrade pip >nul
  ".venv\Scripts\python.exe" -m pip install -r backend\requirements.txt
  if errorlevel 1 (
    echo.
    echo  ERROR: Could not install the Python packages. Check the internet
    echo  connection and try again.
    pause
    exit /b 1
  )
) else (
  echo [1/4] Python environment found.
  echo [2/4] Backend packages already installed.
)

REM ---------------------------------------------------------------- Node
where npm >nul 2>nul
if errorlevel 1 (
  echo.
  echo  ERROR: Node.js 22 was not found.
  echo  Install the LTS version from https://nodejs.org/ then run this file again.
  pause
  exit /b 1
)

if not exist "frontend\node_modules" (
  echo [3/4] Installing frontend packages ^(one time only, may take a minute^)...
  call npm --prefix frontend ci
  if errorlevel 1 (
    echo.
    echo  ERROR: npm install failed. Check the internet connection.
    pause
    exit /b 1
  )
) else (
  echo [3/4] Frontend packages found.
)

echo [4/4] Building the console...
call npm --prefix frontend run build
if errorlevel 1 (
  echo.
  echo  ERROR: The frontend build failed. Scroll up for the TypeScript error.
  pause
  exit /b 1
)

REM ---------------------------------------------------------------- Operators
if not exist "config\operators.json" (
  copy /y "config\operators.example.json" "config\operators.json" >nul
  echo.
  echo  NOTE: config\operators.json was created from the example file.
  echo        Edit it to match the OP-nn references in your Arduino sketch.
)

echo.
echo  ===============================================
echo   Starting on http://127.0.0.1:8000
echo   Keep this window open. Press Ctrl+C to stop.
echo  ===============================================
echo.
start "" http://127.0.0.1:8000

rem One worker only: the serial port and the session live in this process.
".venv\Scripts\python.exe" -m uvicorn backend.main:app --host 127.0.0.1 --port 8000

echo.
echo  The console has stopped.
pause
