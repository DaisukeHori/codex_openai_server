@echo off
REM ============================================
REM Codex API Server - Windows Build Script
REM ============================================

echo ===============================================
echo   Codex API Server - Windows Build
echo ===============================================
echo.

REM Check Node.js
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Node.js is not installed!
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)

echo [OK] Node.js found: 
node --version

REM Check npm
where npm >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] npm is not found!
    pause
    exit /b 1
)

echo [OK] npm found:
npm --version
echo.

REM Install dependencies
echo [1/4] Installing dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Failed to install dependencies
    pause
    exit /b 1
)
echo [OK] Dependencies installed
echo.

REM Build TypeScript
echo [2/4] Building TypeScript...
call npm run build
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] TypeScript build failed
    pause
    exit /b 1
)
echo [OK] TypeScript built
echo.

REM Rebuild native modules for Electron
echo [3/4] Rebuilding native modules for Electron...
call npm run postinstall
echo [OK] Native modules rebuilt
echo.

REM Build Electron app
echo [4/4] Building Electron app...
call npm run dist:win
if %ERRORLEVEL% NEQ 0 (
    echo [ERROR] Electron build failed
    pause
    exit /b 1
)
echo.

echo ===============================================
echo   Build Complete!
echo ===============================================
echo.
echo Output files are in the 'release' folder:
dir /b release\*.exe 2>nul
echo.
echo Portable version: release\CodexAPIServer-Portable.exe
echo Installer: release\Codex API Server Setup*.exe
echo.
pause
