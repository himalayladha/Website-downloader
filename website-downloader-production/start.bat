@echo off
title Website Downloader - Production
setlocal enabledelayedexpansion

:: 1. Validate Node.js is installed on startup
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ===================================================
    echo  [ERROR] Node.js is not installed on this system!
    echo ===================================================
    echo  Please download and install Node.js (LTS recommended):
    echo  https://nodejs.org/
    echo ===================================================
    pause
    exit /b 1
)

:: 2. Check if node_modules exists, auto-install if missing
if not exist "node_modules\" (
    echo ===================================================
    echo  [SETUP] Installing required dependencies...
    echo ===================================================
    call npm install --omit=dev
    if %errorlevel% neq 0 (
        echo ===================================================
        echo  [ERROR] Dependency installation failed!
        echo ===================================================
        pause
        exit /b 1
    )
    echo  [SUCCESS] Dependencies installed successfully.
    timeout /t 2 >nul
)

:: 3. Auto-launch server on first run if not listening
netstat -aon | findstr /C:"LISTENING" | findstr :3000 >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Starting Website Downloader server...
    start "Website Downloader Server" /min cmd /c "npm start"
    start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"
    echo [INFO] Server launched. Opening browser at http://localhost:3000...
    timeout /t 2 >nul
) else (
    start "" "http://localhost:3000"
)

:menu
cls
echo ===================================================
echo             WEBSITE DOWNLOADER PRODUCTION          
echo ===================================================
echo.

:: Check Server Status
netstat -aon | findstr /C:"LISTENING" | findstr :3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo  Server Status : [RUNNING]
    echo  Local Address : http://localhost:3000
) else (
    echo  Server Status : [STOPPED]
)
echo ===================================================
echo.
echo  [1] Open in Browser (http://localhost:3000)
echo  [2] Stop Server
echo  [3] Restart Server
echo  [4] Reinstall Dependencies (Clean)
echo  [5] Exit
echo.
echo ===================================================
set /p choice="Select an option [1-5]: "

if "%choice%"=="1" goto open_browser
if "%choice%"=="2" goto stop_server
if "%choice%"=="3" goto restart_server
if "%choice%"=="4" goto install_deps
if "%choice%"=="5" goto exit_panel
goto menu

:open_browser
echo.
netstat -aon | findstr /C:"LISTENING" | findstr :3000 >nul 2>&1
if %errorlevel% neq 0 (
    echo [INFO] Server is stopped. Starting server...
    start "Website Downloader Server" /min cmd /c "npm start"
    timeout /t 2 /nobreak >nul
)
start "" "http://localhost:3000"
goto menu

:stop_server
echo.
echo [INFO] Stopping server on port 3000...
set "killed=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /C:"LISTENING" ^| findstr :3000') do (
    taskkill /F /PID %%a >nul 2>&1
    set "killed=1"
)
if "!killed!"=="1" (
    echo [SUCCESS] Server stopped.
) else (
    echo [INFO] Server was not running.
)
timeout /t 2 >nul
goto menu

:restart_server
echo.
echo [INFO] Restarting server...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr /C:"LISTENING" ^| findstr :3000') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
start "Website Downloader Server" /min cmd /c "npm start"
start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"
echo [SUCCESS] Server restarted. Opening browser...
timeout /t 2 >nul
goto menu

:install_deps
echo.
echo [INFO] Performing clean dependency install...
if exist "node_modules\" (
    rmdir /s /q node_modules
)
call npm install --omit=dev
echo [SUCCESS] Dependencies reinstalled.
pause
goto menu

:exit_panel
echo.
echo Goodbye!
timeout /t 1 >nul
exit
