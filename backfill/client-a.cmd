@echo off
rem Client A watchdog -> lane 1, ranks 1-1015 (heavy top tier), conc 5, tail 4
:loop
cd /d D:\my_projects\inkscore\api-server
set API_BASE_URL_TEST=http://127.0.0.1:4000
node scripts/backfill-leaderboard.mjs all 5 6 200 1 1015 4 >> D:\my_projects\inkscore\backfill\client-a.log 2>&1
echo [client-a exited %date% %time% - restarting in 60s] >> D:\my_projects\inkscore\backfill\client-a.log
timeout /t 60 /nobreak >nul
goto loop
