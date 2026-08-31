@echo off
title Website Downloader Launcher
cls

echo ===================================================
echo             WEBSITE DOWNLOADER LAUNCHER
echo ===================================================
echo.

:: Check Node.js installation
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/ first.
    echo.
    pause
    exit /b 1
)

:: Check if node_modules is installed
if not exist "node_modules\" (
    echo [INFO] Dependencies not found. Running npm install...
    call npm install
    if %errorlevel% neq 0 (
        echo [ERROR] Failed to install dependencies.
        pause
        exit /b 1
    )
)

:: Start a background process that waits 3 seconds for the server to boot, then opens localhost
echo [INFO] Starting application server...
echo [INFO] Opening http://localhost:3000 in your browser shortly...
start /b cmd /c "timeout /t 3 /nobreak >nul && start http://localhost:3000"

:: Run the server (this is blocking)
call npm start
if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server crashed or stopped.
    pause
)
