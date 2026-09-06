@echo off
rem Client C watchdog -> lane 3, ranks 2031-3045
:loop
cd /d D:\my_projects\inkscore\api-server
set API_BASE_URL_TEST=http://127.0.0.1:4002
node scripts/backfill-leaderboard.mjs all 5 6 200 2031 3045 4 >> D:\my_projects\inkscore\backfill\client-c.log 2>&1
echo [client-c exited %date% %time% - restarting in 60s] >> D:\my_projects\inkscore\backfill\client-c.log
timeout /t 60 /nobreak >nul
goto loop
