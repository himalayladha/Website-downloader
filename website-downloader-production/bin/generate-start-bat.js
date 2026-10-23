const fs = require('fs');
const path = require('path');

const startBatContent = `@echo off
title Website Downloader
setlocal enabledelayedexpansion

:: Check if server is running on port 3000
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
echo               WEBSITE DOWNLOADER                   
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
echo  [4] Exit
echo.
echo ===================================================
set /p choice="Select an option [1-4]: "

if "%choice%"=="1" goto open_browser
if "%choice%"=="2" goto stop_server
if "%choice%"=="3" goto restart_server
if "%choice%"=="4" goto exit_panel
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

:exit_panel
echo.
echo Goodbye!
timeout /t 1 >nul
exit
`;

const targetPath = path.resolve(process.cwd(), 'start.bat');
fs.writeFileSync(targetPath, startBatContent, 'utf8');
console.log('       - start.bat created successfully.');
