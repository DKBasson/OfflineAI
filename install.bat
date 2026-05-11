@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
cd /d "%SCRIPT_DIR%"

set "MODEL=gemma4:e4b"

echo ==========================================
echo   OfflineAI — Installer (Windows)
echo ==========================================
echo.

:: ── 1. Check Python 3 ────────────────────────────────────────────
python --version >nul 2>&1
if errorlevel 1 (
    echo [!] Python 3 not found.
    echo     Download and install it from: https://www.python.org/downloads/
    echo     Make sure to check "Add Python to PATH" during setup.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('python --version 2^>^&1') do echo [OK] %%v found

:: ── 2. Virtual environment ────────────────────────────────────────
if not exist "%SCRIPT_DIR%\.venv\" (
    echo.
    echo [>>] Creating virtual environment...
    python -m venv "%SCRIPT_DIR%\.venv"
    echo [OK] Virtual environment created
) else (
    echo [OK] Virtual environment already exists
)

echo.
echo [>>] Installing Python dependencies...
call "%SCRIPT_DIR%\.venv\Scripts\activate.bat"
python -m pip install -q --upgrade pip
python -m pip install -q -r "%SCRIPT_DIR%\requirements.txt"
echo [OK] Python dependencies installed

:: ── 3. Ollama ─────────────────────────────────────────────────────
where ollama >nul 2>&1
if errorlevel 1 (
    echo.
    echo [!] Ollama not found.
    echo     Download and install it from: https://ollama.com/download/windows
    echo     After installing, re-run this script.
    echo.
    pause
    exit /b 1
)
for /f "tokens=*" %%v in ('ollama --version 2^>^&1') do echo [OK] Ollama %%v found

:: ── 4. Pull the model ─────────────────────────────────────────────
echo.
echo [>>] Checking for model: %MODEL%

:: Start Ollama temporarily to query models
set "OLLAMA_WAS_STARTED=0"
tasklist /FI "IMAGENAME eq ollama.exe" 2>nul | find /i "ollama.exe" >nul
if errorlevel 1 (
    start /b "" ollama serve >nul 2>&1
    set "OLLAMA_WAS_STARTED=1"
    :: Wait up to 10 s for Ollama to be ready
    for /l %%i in (1,1,20) do (
        ping -n 1 -w 500 127.0.0.1 >nul
        curl -s http://localhost:11434/ >nul 2>&1 && goto :ollama_ready
    )
    echo [!] Ollama did not start in time. Check that it installed correctly.
    pause
    exit /b 1
)
:ollama_ready

ollama list 2>nul | findstr /i "%MODEL%" >nul
if not errorlevel 1 (
    echo [OK] Model '%MODEL%' already downloaded
) else (
    echo     Downloading '%MODEL%' — this may take several minutes...
    ollama pull "%MODEL%"
    echo [OK] Model '%MODEL%' ready
)

if "%OLLAMA_WAS_STARTED%"=="1" (
    taskkill /f /im ollama.exe >nul 2>&1
)

:: ── 5. Vendor front-end assets (offline use) ─────────────────────
set "STATIC_DIR=%SCRIPT_DIR%\static"
if not exist "%STATIC_DIR%" mkdir "%STATIC_DIR%"

echo.
echo [>>] Vendoring front-end assets...

if not exist "%STATIC_DIR%\marked.min.js" (
    curl -fsSL "https://cdn.jsdelivr.net/npm/marked@12/marked.min.js" -o "%STATIC_DIR%\marked.min.js"
)
if not exist "%STATIC_DIR%\dompurify.min.js" (
    curl -fsSL "https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js" -o "%STATIC_DIR%\dompurify.min.js"
)
if not exist "%STATIC_DIR%\highlight.min.js" (
    curl -fsSL "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" -o "%STATIC_DIR%\highlight.min.js"
)
if not exist "%STATIC_DIR%\github-dark.min.css" (
    curl -fsSL "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" -o "%STATIC_DIR%\github-dark.min.css"
)
echo [OK] Front-end assets ready

:: ── Done ──────────────────────────────────────────────────────────
echo.
echo ==========================================
echo   [OK] Installation complete!
echo   Run the app with:  start.bat
echo ==========================================
echo.
pause
