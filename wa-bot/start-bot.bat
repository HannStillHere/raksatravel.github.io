@echo off
title RaksaTravel WA Bot 24/7 Supervisor
cd /d "C:\Users\Raihan\OneDrive\Desktop\raksatravel\wa-bot"

:loop
echo [%date% %time%] Menjalankan RaksaTravel Bot 24 Jam Non-Stop...
node watchdog.cjs
if "%ERRORLEVEL%"=="99" (
  echo [%date% %time%] Watchdog lain sudah aktif di latar belakang. Proses ini selesai.
  exit /b 0
)
echo [%date% %time%] Bot berhenti. Memulai ulang otomatis dalam 5 detik...
timeout /t 5 /nobreak >nul
goto loop
