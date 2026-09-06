@echo off
rem Lane 4 API watchdog (port 4003): pure gatherer, pool 10
:loop
cd /d D:\my_projects\inkscore\api-server
set PORT=4003
set BLOCKSCOUT_RATE_LIMIT=800
set BLOCKSCOUT_MAX_CONCURRENT=30
set PG_POOL_MAX=10
set PG_POOL_MIN=2
set REFRESH_WORKER=off
set SCORE_SNAPSHOT_WORKER=off
npx ts-node src/index.ts >> D:\my_projects\inkscore\backfill\lane4-api.log 2>&1
echo [lane4-api exited %date% %time% - restarting in 30s] >> D:\my_projects\inkscore\backfill\lane4-api.log
timeout /t 30 /nobreak >nul
goto loop
