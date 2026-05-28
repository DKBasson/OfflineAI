@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

:: Resolve project root (one level up from scripts\)
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
for %%i in ("%SCRIPT_DIR%") do set "SCRIPT_DIR=%%~dpi"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
cd /d "%SCRIPT_DIR%"

:: ── Network access prompt ────────────────────────────────────────
if not defined OFFLINEAI_HOST (
    echo.
    echo   Allow network access?
    echo   Other devices on your LAN will be able to connect to OfflineAI.
    echo   A secure token will be generated automatically when enabled.
    set /p "_NETWORK_REPLY=  [y/N]: "
    if /i "!_NETWORK_REPLY!"=="y" (
        set "OFFLINEAI_HOST=0.0.0.0"
        echo   [OK] Network access enabled
    ) else (
        set "OFFLINEAI_HOST=127.0.0.1"
        echo   [OK] Local-only access (default)
    )
    echo.
)

if not defined OFFLINEAI_PORT set "OFFLINEAI_PORT=8080"
if not defined OFFLINEAI_IMAGE_MAX_HEIGHT set "OFFLINEAI_IMAGE_MAX_HEIGHT=1024"
if not defined OFFLINEAI_IMAGE_MAX_STEPS set "OFFLINEAI_IMAGE_MAX_STEPS=16"
if not defined OFFLINEAI_IMAGE_DEFAULT_WIDTH set "OFFLINEAI_IMAGE_DEFAULT_WIDTH=640"
if not defined OFFLINEAI_IMAGE_DEFAULT_HEIGHT set "OFFLINEAI_IMAGE_DEFAULT_HEIGHT=640"
if not defined OFFLINEAI_IMAGE_DEFAULT_STEPS set "OFFLINEAI_IMAGE_DEFAULT_STEPS=6"

:: ── Ollama ────────────────────────────────────────────────────────
SET "_OLLAMA_STARTED=0"
tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | find /i "ollama.exe" >nul
if errorlevel 1 (
    echo [>>] Starting Ollama...
    start /b "" ollama serve >nul 2>&1
    SET "_OLLAMA_STARTED=1"
    :: Wait up to 5 s for Ollama to be ready
    for /l %%i in (1,1,10) do (
        ping -n 1 -w 500 127.0.0.1 >nul
        curl -s http://localhost:11434/ >nul 2>&1 && goto :ollama_ready
    )
    echo [!] Ollama did not respond. Make sure it is installed correctly.
    pause
    exit /b 1
) else (
    echo [OK] Ollama already running
)
:ollama_ready
echo [OK] Ollama running

:: ── Build React UI ────────────────────────────────────────────────
if exist "%SCRIPT_DIR%\react-app\node_modules" (
    echo [>>] Building UI...
    cd /d "%SCRIPT_DIR%\react-app"
    call npm run build
    cd /d "%SCRIPT_DIR%"
    if errorlevel 1 (
        echo [!] UI build failed — using existing build.
    ) else (
        echo [OK] UI built
    )
) else (
    echo [!] Skipping UI build ^(react-app\node_modules missing — run install.bat first^)
)

:: ── FastAPI app ────────────────────────────────────────────────────
echo [>>] Starting OfflineAI...

if not exist "%SCRIPT_DIR%\.venv\Scripts\python.exe" (
    echo [!] Virtual environment not found. Run scripts\install.bat first.
    pause
    exit /b 1
)

if /i "%OFFLINEAI_HOST%"=="0.0.0.0" (
    if not defined OFFLINEAI_TOKEN (
        for /f "tokens=*" %%i in ('"%SCRIPT_DIR%\.venv\Scripts\python.exe" -c "import secrets; print(secrets.token_urlsafe(18))"') do set "OFFLINEAI_TOKEN=%%i"
    )
)

:: Start app in background, capture PID via a temp file
start /b "" "%SCRIPT_DIR%\.venv\Scripts\python.exe" "%SCRIPT_DIR%\app.py"

:: Wait for server to be ready (up to 5 s)
for /l %%i in (1,1,10) do (
    ping -n 1 -w 500 127.0.0.1 >nul
    curl -s http://127.0.0.1:%OFFLINEAI_PORT%/ >nul 2>&1 && goto :app_ready
)
echo [!] App did not start in time.
pause
exit /b 1

:app_ready
echo [OK] App running
echo    Audio transcription * Word/ODF docs * Code files * Images (vision models)
set "LOCAL_URL=http://127.0.0.1:%OFFLINEAI_PORT%"
if defined OFFLINEAI_TOKEN set "LOCAL_URL=!LOCAL_URL!?token=!OFFLINEAI_TOKEN!"
echo    Local:   !LOCAL_URL!
if /i "%OFFLINEAI_HOST%"=="0.0.0.0" (
    set "LAN_IP="
    for /f "tokens=*" %%i in ('"%SCRIPT_DIR%\.venv\Scripts\python.exe" -c "import socket; s=socket.socket(); s.connect(('8.8.8.8',80)); print(s.getsockname()[0]); s.close()" 2^>nul') do set "LAN_IP=%%i"
    if "!LAN_IP!"=="" set "LAN_IP=127.0.0.1"
    set "NETWORK_URL=http://!LAN_IP!:%OFFLINEAI_PORT%"
    if defined OFFLINEAI_TOKEN set "NETWORK_URL=!NETWORK_URL!?token=!OFFLINEAI_TOKEN!"
    echo    Network: !NETWORK_URL!
    if defined OFFLINEAI_TOKEN echo    Token:   !OFFLINEAI_TOKEN!
) else (
    echo    Network: disabled ^(set OFFLINEAI_HOST=0.0.0.0 to expose^)
)
echo.
echo    Press Ctrl+C to stop.
echo.

:: Open browser
start "" "!LOCAL_URL!"

:: Keep window open — loop until Ctrl+C or the app stops
:loop
timeout /t 2 /nobreak >nul 2>&1
if errorlevel 1 goto :cleanup
curl -s http://127.0.0.1:%OFFLINEAI_PORT%/ >nul 2>&1
if errorlevel 1 (
    echo [!] App stopped unexpectedly.
    goto :cleanup
)
goto :loop

:cleanup
echo.
echo [>>] Stopping OfflineAI...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr ":%OFFLINEAI_PORT% "') do (
    taskkill /f /pid %%p >nul 2>&1
)
if "!_OLLAMA_STARTED!"=="1" (
    ollama stop >nul 2>&1
    taskkill /f /im ollama.exe >nul 2>&1
)
echo [OK] Stopped
pause
exit /b 0
