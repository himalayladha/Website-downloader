@echo off
title Website Downloader Control Panel
setlocal enabledelayedexpansion

:menu
cls
echo ===================================================
echo             WEBSITE DOWNLOADER CONTROL PANEL
echo ===================================================
echo.

:: Check Server Status
netstat -aon | findstr :3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo  Server Status: [RUNNING]
    echo  Local Address: http://localhost:3000
) else (
    echo  Server Status: [STOPPED]
)
echo ===================================================
echo.
echo  [1] Start Server
echo  [2] Stop Server
echo  [3] Restart Server
echo  [4] Run Clean Dependency Install
echo  [5] Exit
echo.
echo ===================================================
set /p choice="Enter option [1-5]: "

if "%choice%"=="1" goto start_server
if "%choice%"=="2" goto stop_server
if "%choice%"=="3" goto restart_server
if "%choice%"=="4" goto install_deps
if "%choice%"=="5" goto exit_panel
goto menu

:start_server
echo.
netstat -aon | findstr :3000 >nul 2>&1
if %errorlevel% equ 0 (
    echo [INFO] Server is already running. Opening browser...
    start "" "http://localhost:3000"
    timeout /t 2 >nul
    goto menu
)

:: Validate Node.js is installed
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/ first.
    pause
    goto menu
)

:: Check if node_modules exists, install if missing
if not exist "node_modules\" (
    echo [INFO] Dependencies not found. Installing...
    call npm install
)

echo [INFO] Starting server in background...
start "Website Downloader Server" /min cmd /c "npm start"
start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"
echo [INFO] Server launched. Opening browser shortly...
timeout /t 2 >nul
goto menu

:stop_server
echo.
echo [INFO] Stopping server...
set "killed=0"
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do (
    taskkill /F /PID %%a >nul 2>&1
    set "killed=1"
)
if "!killed!"=="1" (
    echo [INFO] Server stopped successfully.
) else (
    echo [INFO] No running server found on port 3000.
)
timeout /t 2 >nul
goto menu

:restart_server
echo.
echo [INFO] Restarting server...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :3000') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 1 /nobreak >nul
start "Website Downloader Server" /min cmd /c "npm start"
start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"
echo [INFO] Server restarted. Opening browser shortly...
timeout /t 2 >nul
goto menu

:install_deps
echo.
echo [INFO] Running clean npm install...
if exist "node_modules\" (
    echo [INFO] Removing existing node_modules...
    rmdir /s /q node_modules
)
call npm install
echo [INFO] Dependencies installed successfully.
pause
goto menu

:exit_panel
echo.
echo Thank you for using Website Downloader. Goodbye!
timeout /t 2 >nul
exit
