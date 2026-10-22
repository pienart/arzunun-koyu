@echo off
chcp 65001 >nul
title Arzu'nun Koyu - Yerel Sunucu
cd /d "%~dp0"
echo Arzu'nun Koyu baslatiliyor...

rem 1) Python
where python >nul 2>nul
if %errorlevel%==0 (
  start "" cmd /c "timeout /t 2 >nul & start http://localhost:8080/"
  python tools\server.py 8080
  goto :eof
)
where py >nul 2>nul
if %errorlevel%==0 (
  start "" cmd /c "timeout /t 2 >nul & start http://localhost:8080/"
  py tools\server.py 8080
  goto :eof
)

rem 2) Node.js
where npx >nul 2>nul
if %errorlevel%==0 (
  start "" cmd /c "timeout /t 4 >nul & start http://localhost:8080/"
  npx --yes serve -l 8080 .
  goto :eof
)

rem 3) Hicbiri yoksa: Windows'ta her zaman bulunan PowerShell ile bagimliliksiz sunucu
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0baslat.ps1"
