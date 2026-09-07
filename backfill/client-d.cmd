@echo off
rem Client D watchdog -> lane 4, ranks 3046-4060
:loop
cd /d D:\my_projects\inkscore\api-server
set API_BASE_URL_TEST=http://127.0.0.1:4003
node scripts/backfill-leaderboard.mjs wallets scripts\remaining-4.txt 3 4 9999 4 >> D:\my_projects\inkscore\backfill\client-d.log 2>&1
echo [client-d exited %date% %time% - restarting in 60s] >> D:\my_projects\inkscore\backfill\client-d.log
timeout /t 60 /nobreak >nul
goto loop
