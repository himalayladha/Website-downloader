@echo off
title Website Downloader - Setup
setlocal enabledelayedexpansion

echo ===================================================
echo             WEBSITE DOWNLOADER SETUP               
echo ===================================================
echo.
echo [1/4] Checking system prerequisites...

:: 1. Validate Node.js & npm
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

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo  [ERROR] npm was not found. Please reinstall Node.js.
    pause
    exit /b 1
)

echo       - Node.js: OK
echo       - npm: OK
echo.

:: 2. Ensure directories exist
echo [2/4] Initializing folder structure...
if not exist "public\sites" mkdir "public\sites"
if not exist "public\sites\.gitkeep" echo. > "public\sites\.gitkeep"
echo       - Storage directory verified: public\sites
echo.

:: 3. Offline Dependency Installation
echo [3/4] Installing dependencies for offline use...
echo       This may take a moment on first setup...
echo.
call npm install --omit=dev
if %errorlevel% neq 0 (
    echo.
    echo ===================================================
    echo  [ERROR] Dependency installation encountered an issue!
    echo ===================================================
    pause
    exit /b 1
)
echo.
echo       - All packages installed locally into node_modules
echo       - System is now 100%% offline-ready!
echo.

:: 4. Generate start.bat
echo [4/4] Generating production start.bat launcher...
node bin\generate-start-bat.js
if %errorlevel% neq 0 (
    echo       [WARN] Could not generate start.bat automatically.
)

echo.
echo ===================================================
echo             SETUP COMPLETED SUCCESSFULLY!          
echo ===================================================
echo  You can now launch the app anytime using start.bat
echo ===================================================
echo.
set /p launch="Would you like to start Website Downloader now? [Y/N]: "
if /i "%launch%"=="Y" (
    call start.bat
) else (
    echo.
    echo Setup finished. Double-click start.bat whenever you want to run.
    pause
)
