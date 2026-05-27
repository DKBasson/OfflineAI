@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
cd /d "%SCRIPT_DIR%"

if not defined OFFLINEAI_HOST set "OFFLINEAI_HOST=127.0.0.1"
if not defined OFFLINEAI_PORT set "OFFLINEAI_PORT=8080"
if not defined OFFLINEAI_IMAGE_MAX_WIDTH set "OFFLINEAI_IMAGE_MAX_WIDTH=1024"
if not defined OFFLINEAI_IMAGE_MAX_HEIGHT set "OFFLINEAI_IMAGE_MAX_HEIGHT=1024"
if not defined OFFLINEAI_IMAGE_MAX_STEPS set "OFFLINEAI_IMAGE_MAX_STEPS=16"
if not defined OFFLINEAI_IMAGE_DEFAULT_WIDTH set "OFFLINEAI_IMAGE_DEFAULT_WIDTH=640"
if not defined OFFLINEAI_IMAGE_DEFAULT_HEIGHT set "OFFLINEAI_IMAGE_DEFAULT_HEIGHT=640"
if not defined OFFLINEAI_IMAGE_DEFAULT_STEPS set "OFFLINEAI_IMAGE_DEFAULT_STEPS=6"

:: ── Ollama ────────────────────────────────────────────────────────
tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | find /i "ollama.exe" >nul
if errorlevel 1 (
    echo [>>] Starting Ollama...
    start /b "" ollama serve >nul 2>&1
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

:: ── FastAPI app ────────────────────────────────────────────────────
echo [>>] Starting OfflineAI...

if not exist "%SCRIPT_DIR%\.venv\Scripts\python.exe" (
    echo [!] Virtual environment not found. Run install.bat first.
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

:: Keep window open so Ctrl+C is visible
:loop
timeout /t 2 >nul
curl -s http://127.0.0.1:%OFFLINEAI_PORT%/ >nul 2>&1
if errorlevel 1 (
    echo [!] App stopped unexpectedly.
    pause
    exit /b 1
)
goto :loop
