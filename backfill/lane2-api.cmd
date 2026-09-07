@echo off
rem Lane 2 API watchdog (port 4001): pure gatherer, pool 10
:loop
cd /d D:\my_projects\inkscore\api-server
set PORT=4001
set BLOCKSCOUT_PROXY=off
rem (proxy list removed - set BLOCKSCOUT_PROXY=on + PROXY_URL_LIST_FILE to re-enable)
set NODE_OPTIONS=--max-old-space-size=2560
set BLOCKSCOUT_RATE_LIMIT=200
set BLOCKSCOUT_MAX_CONCURRENT=15
set PG_POOL_MAX=10
set PG_POOL_MIN=2
set REFRESH_WORKER=off
set SCORE_SNAPSHOT_WORKER=off
node --max-old-space-size=2560 -r ts-node/register/transpile-only src/index.ts >> D:\my_projects\inkscore\backfill\lane2-api.log 2>&1
echo [lane2-api exited %date% %time% - restarting in 30s] >> D:\my_projects\inkscore\backfill\lane2-api.log
timeout /t 30 /nobreak >nul
goto loop
