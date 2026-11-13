@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable. Installez Node.js 22, puis relancez ce fichier.
  pause
  exit /b 1
)
if not exist "dist\index.html" (
  echo La webapp compilee est introuvable. Lancez npm ci --ignore-scripts puis npm run build.
  pause
  exit /b 1
)
node "scripts\serve-local.mjs"
if errorlevel 1 pause
