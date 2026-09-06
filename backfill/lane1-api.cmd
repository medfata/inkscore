@echo off
rem Lane 1 API watchdog (port 4000): workers ON (sole queue drain), pool 15
:loop
cd /d D:\my_projects\inkscore\api-server
set PORT=4000
set BLOCKSCOUT_RATE_LIMIT=800
set BLOCKSCOUT_MAX_CONCURRENT=30
set PG_POOL_MAX=15
set PG_POOL_MIN=2
npx ts-node src/index.ts >> D:\my_projects\inkscore\backfill\lane1-api.log 2>&1
echo [lane1-api exited %date% %time% - restarting in 30s] >> D:\my_projects\inkscore\backfill\lane1-api.log
timeout /t 30 /nobreak >nul
goto loop
