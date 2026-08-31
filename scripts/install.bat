@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul 2>&1

:: Resolve project root (one level up from scripts\)
set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
for %%i in ("%SCRIPT_DIR%") do set "SCRIPT_DIR=%%~dpi"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
cd /d "%SCRIPT_DIR%"

set "MODEL=gemma4:e4b"
set "IMAGE_MODEL=x/z-image-turbo"
:: Legacy Ollama model; image generation now uses Diffusers (stabilityai/stable-diffusion-xl-turbo)
:: This pull is kept for backwards compatibility

echo ==========================================
echo   OfflineAI — Installer (Windows)
echo ==========================================
echo.

:: ── 1. Check Python 3.10+ ────────────────────────────────────────
python -c "import sys; raise SystemExit(0 if sys.version_info >= (3, 10) else 1)" >nul 2>&1
if errorlevel 1 (
    echo [!] Python 3.10+ not found.
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

:: ── Pre-download Whisper model (audio transcription) ────────────────
echo.
echo [>>] Pre-downloading Whisper 'tiny' model for audio transcription (~75 MB)...
"%SCRIPT_DIR%\.venv\Scripts\python.exe" -c "from faster_whisper import WhisperModel; WhisperModel('tiny', device='cpu', compute_type='int8'); print('[OK] Whisper model ready')" 2>nul || echo [!] Whisper model skipped -- will download automatically on first audio upload

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

:: -- 5. Pull the image generation model ----------------------------------
echo.
echo [>>] Checking for image generation model: %IMAGE_MODEL%
echo     (~5 GB download -- press Ctrl+C to skip, then run: ollama pull %IMAGE_MODEL%)

ollama list 2>nul | findstr /i "%IMAGE_MODEL%" >nul
if not errorlevel 1 (
    echo [OK] Model '%IMAGE_MODEL%' already downloaded
) else (
    echo     Downloading '%IMAGE_MODEL%' -- this may take several minutes...
    ollama pull "%IMAGE_MODEL%"
    if errorlevel 1 (
        echo [!] Skipped -- run 'ollama pull %IMAGE_MODEL%' later to enable image generation
    ) else (
        echo [OK] Model '%IMAGE_MODEL%' ready
    )
)

if "%OLLAMA_WAS_STARTED%"=="1" (
    taskkill /f /im ollama.exe >nul 2>&1
)

:: ── 6. Vendor front-end assets (offline use) ─────────────────────
set "STATIC_DIR=%SCRIPT_DIR%\static"
if not exist "%STATIC_DIR%" mkdir "%STATIC_DIR%"

echo.
echo [>>] Vendoring front-end assets...

call :download_asset "%STATIC_DIR%\marked.min.js" "https://cdn.jsdelivr.net/npm/marked@12/marked.min.js" "15fabce5b65898b32b03f5ed25e9f891a729ad4c0d6d877110a7744aa847a894" || exit /b 1
call :download_asset "%STATIC_DIR%\dompurify.min.js" "https://cdn.jsdelivr.net/npm/dompurify@3/dist/purify.min.js" "ef9a98b5b21aac33c73e316ef21f5cf06f68eff003a40ac953022129112cff3c" || exit /b 1
call :download_asset "%STATIC_DIR%\highlight.min.js" "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js" "837a6fa5b0c736b52bbde2b2b6190f305da3fc9ed41681db5321507057b5c846" || exit /b 1
call :download_asset "%STATIC_DIR%\github-dark.min.css" "https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css" "9f208d022102b1d0c7aebfecd8e42ca7997d5de636649d2b31ea63093d809019" || exit /b 1
echo [OK] Front-end assets ready

:: ── Build React frontend ─────────────────────────────────────────
echo.
echo [>>] Building React frontend...
where node >nul 2>nul
if %errorlevel% equ 0 (
    pushd "%SCRIPT_DIR%\react-app"
    call npm install --no-audit --no-fund
    call npm run build
    if %errorlevel% equ 0 (
        echo [OK] React frontend built
    ) else (
        echo [!!] React build failed — the start script will retry
    )
    popd
) else (
    echo [!!] Node.js/npm not found — install Node.js 18+ to build the frontend
    echo     The start script will attempt to build on launch if node_modules exists
)

:: ── Done ──────────────────────────────────────────────────────────
echo.
echo ==========================================
echo   [OK] Installation complete!
echo   Run the app with:  scripts\start.bat
echo.
echo   Features enabled:
echo     * Chat with local AI models via Ollama
echo     * Image generation (ask to draw/generate an image)
echo     * Image attachments (vision models)
echo     * Audio transcription (.mp3 .wav .opus .m4a ...)
echo     * Document reading (.docx .odt .ods .odp)
echo     * Code ^& text file attachments
echo.
echo   On first start you will be asked whether to allow
echo   network access (LAN). You can also pre-set it by
echo   running:  set OFFLINEAI_HOST=0.0.0.0 ^&^& scripts\start.bat
echo ==========================================
echo.
pause
exit /b 0

:download_asset
set "ASSET_FILE=%~1"
set "ASSET_URL=%~2"
set "ASSET_EXPECTED=%~3"
if not exist "%ASSET_FILE%" (
    curl -fsSL "%ASSET_URL%" -o "%ASSET_FILE%"
)
set "ASSET_HASH="
for /f "tokens=*" %%h in ('powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 -Path '%ASSET_FILE%').Hash.ToLower()"') do set "ASSET_HASH=%%h"
if /i not "%ASSET_HASH%"=="%ASSET_EXPECTED%" (
    del "%ASSET_FILE%" >nul 2>&1
    echo [!] Checksum mismatch for %~nx1
    echo     Expected: %ASSET_EXPECTED%
    echo     Actual:   %ASSET_HASH%
    exit /b 1
)
exit /b 0
