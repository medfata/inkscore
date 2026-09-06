@echo off
rem Client B watchdog -> lane 2, ranks 1016-2030
:loop
cd /d D:\my_projects\inkscore\api-server
set API_BASE_URL_TEST=http://127.0.0.1:4001
node scripts/backfill-leaderboard.mjs all 5 6 200 1016 2030 4 >> D:\my_projects\inkscore\backfill\client-b.log 2>&1
echo [client-b exited %date% %time% - restarting in 60s] >> D:\my_projects\inkscore\backfill\client-b.log
timeout /t 60 /nobreak >nul
goto loop
