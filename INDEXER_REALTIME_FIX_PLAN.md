# Indexer Realtime Fix — Implementation Plan

**For:** implementing agent (will edit code, build, and deploy on the VPS).
**Goal:** Make the realtime + enrichment indexers work reliably again and stop re-accumulating useless storage. **Do NOT backfill** the missing-transaction gap — only get the indexers healthy and ingesting going forward.

---

## 0. Background (what broke, why)

- The realtime indexer (`indexer-indexer-realtime-1`) ingests via the **Routescan REST API** (`https://api.routescan.io/...`), not RPC.
- On 2026-06-10 ~00:29 UTC the VPS IP (`77.42.41.78`) started getting **HTTP 429 Too Many Requests** from Routescan (free anonymous tier = 10k calls/day; the poller exceeds it).
- **Silent-failure bug:** `RealtimeService.fetchLatestTransactions()` JSON-parses the 429 body, finds no `items`, and returns `[]`. No error is logged. The service looks "running" while indexing nothing for ~11 h. All 32 polled contracts stopped at the same minute → proves API outage, not chain idle.
- The fix: a **free registered Routescan API key** (5 rps / 100k per day, ample for ~25–45k/day usage) plus correct non-200 handling. Key rotation / paid proxy are NOT needed.
- Separately: the `transaction_enrichment.input` column grew to ~13 GB but is only read for **8 DeFi functions**. The enrichment writer stores `input` for *every* tx. We gate it so only the read-needed rows persist `input`.

### Environment / access
- VPS: `ssh root@77.42.41.78`
- Stack: `~/indexer/docker-compose.yml` (compose v2: `docker compose ...`). All `indexer-*` services share one image (`build: .`, Dockerfile at `~/indexer/`). The api-server builds from `../api-server`.
- Postgres: container `indexer-postgres-1`, user `ink`, db `ink_analytics`. Query via:
  `docker exec indexer-postgres-1 psql -U ink -d ink_analytics -c "..."`
- `~/indexer/.env` holds `DATABASE_URL`, `DB_PASSWORD`. `RPC_URL` is intentionally unset (falls back to a default in `config.ts`).
- **Repo is the source of truth.** The VPS runs built JS (`dist/`). Edit TypeScript in this repo, then build on the VPS (the Dockerfile compiles `tsc`). Confirm how the VPS gets code (git pull vs. rsync) before editing — see Task 4.

### Scope
- IN: realtime 429/timeout/key handling; write-side `input` gating; build; redeploy; validate services healthy.
- OUT: backfilling missed transactions; touching `logs`/`operations` (both are read by score paths — **never drop**); the zombie `job_queue` rows (leave them).

---

## Task 1 — Fix realtime ingestion (429 + timeout + global backoff)

**File:** `indexer/src/services/RealtimeService.ts`

### 1a. Add config + service-level pause state
At the top of the `RealtimeService` class add a pause timestamp:

```ts
// Global pause until this epoch-ms (set when Routescan returns 429).
// The rate limit is account/IP-wide, so pause ALL polling, not per-contract.
private pausedUntil = 0;
```

### 1b. Rewrite `fetchLatestTransactions` to check status, time out, and pass the key

Replace the current body (the raw `https.get` that only catches JSON errors). Requirements:
- Read `res.statusCode`. Only `200` is success.
- On `429`: read the `Retry-After` header (seconds; default to 60 if absent) and `throw` a typed error carrying `retryAfterMs`.
- On any other non-200: `throw new Error('Routescan HTTP <status>: <body first 200 chars>')`.
- Add a **request timeout** (`req.setTimeout(15000, () => req.destroy(new Error('Routescan request timeout')))`) — the current `https.get` can hang forever.
- Append the API key (see Task 2) only when present.

Add a small typed error near the top of the file:

```ts
class RateLimitError extends Error {
  constructor(public retryAfterMs: number) {
    super(`Routescan rate limited (429), retry after ${retryAfterMs}ms`);
    this.name = 'RateLimitError';
  }
}
```

Reference implementation:

```ts
async fetchLatestTransactions(contractAddress: string): Promise<RouterscanTransaction[]> {
  const key = config.routescanApiKey; // '' when unset/placeholder (see Task 2)
  const keyParam = key ? `&apikey=${encodeURIComponent(key)}` : '';
  const url =
    `https://api.routescan.io/v2/network/mainnet/evm/${config.chainId}` +
    `/address/${contractAddress}/transactions?limit=${this.transactionLimit}&sort=desc${keyParam}`;

  return new Promise((resolve, reject) => {
    const req = https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        const status = res.statusCode ?? 0;
        if (status === 429) {
          const ra = parseInt(res.headers['retry-after'] as string, 10);
          const retryAfterMs = Number.isFinite(ra) ? ra * 1000 : 60_000;
          return reject(new RateLimitError(retryAfterMs));
        }
        if (status !== 200) {
          return reject(new Error(`Routescan HTTP ${status}: ${data.substring(0, 200)}`));
        }
        try {
          const response: ApiResponse = JSON.parse(data);
          resolve(Array.isArray(response.items) ? response.items : []);
        } catch {
          reject(new Error(`Invalid API response: ${data.substring(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15_000, () => req.destroy(new Error('Routescan request timeout')));
  });
}
```

### 1c. Honor the pause in the poll loop
In `runPollLoop()`, before selecting a contract to poll, skip while paused:

```ts
if (Date.now() < this.pausedUntil) {
  await this.sleep(1000);
  continue;
}
```

### 1d. Set the global pause when a 429 happens
In `pollContract()`'s `catch (error)`, detect the rate-limit error and set `pausedUntil` (log it loudly so this is never silent again):

```ts
} catch (error) {
  if (error instanceof RateLimitError) {
    this.pausedUntil = Date.now() + error.retryAfterMs;
    console.error(`⏸️ [REALTIME] Routescan 429 — pausing all polling for ${Math.round(error.retryAfterMs / 1000)}s`);
  } else {
    console.error(`❌ [REALTIME] ${contract.name} poll failed:`, error);
  }
  this.updatePollingState(contract.id, 0, true);
}
```

> Keep the `RateLimitError` class importable/visible to `pollContract` (same file — fine).

**Best-practice notes for the agent:** don't widen scope. Keep the adaptive-interval logic untouched. No new deps. Match existing logging/emoji style.

---

## Task 2 — API key wiring (fake placeholder; user adds the real one)

### 2a. `indexer/src/config.ts`
Add to the exported `config` object:

```ts
// Routescan API key. Leave empty for anonymous (rate-limited) access.
// The literal 'REPLACE_WITH_REAL_KEY' sentinel is treated as "unset".
routescanApiKey:
  process.env.ROUTESCAN_API_KEY && process.env.ROUTESCAN_API_KEY.trim() !== 'REPLACE_WITH_REAL_KEY'
    ? process.env.ROUTESCAN_API_KEY.trim()
    : '',
```

### 2b. `.env.example` (repo) — document it
Add:
```
# Routescan API key (free tier: register at routescan.io → 100k calls/day).
# Leave as the placeholder to run anonymous; replace with the real key to lift the rate limit.
ROUTESCAN_API_KEY=REPLACE_WITH_REAL_KEY
```

### 2c. Live `~/indexer/.env` on the VPS — add the **fake** placeholder
Append (do NOT invent a real key — the user will swap it):
```
ROUTESCAN_API_KEY=REPLACE_WITH_REAL_KEY
```
With the sentinel, `config.routescanApiKey` resolves to `''` → the service runs anonymous and the 429-handling path is what gets validated now. When the user replaces the value with a real key, the code automatically starts sending `&apikey=...`.

### 2d. Pass the env var into the containers (compose)
In `~/indexer/docker-compose.yml`, add `ROUTESCAN_API_KEY: ${ROUTESCAN_API_KEY:-}` to the `environment:` block of **`indexer-realtime`** (and `indexer-enrichment` if Task 3b touches its fetch path — it uses a different host, see note). Keep the existing log-rotation `x-logging` anchor and `shm_size` already present.

> Note: the **enrichment** service fetches from a *different* host (`https://cdn.routescan.io/api/evm/57073/transactions`) and is currently idle only because realtime feeds it nothing — it is not itself 429-banned. Adding the key there is optional/defensive; if you do, mirror the `keyParam` pattern. Primary fix target is **realtime**.

---

## Task 3 — Write only the data the read queries use (`input` gating)

**Why:** `transaction_enrichment.input` = ~13 GB, but the only reader is `analytics-service.ts`, and only for these 8 function names (the keys of `DEFI_FUNCTIONS` + `ETH_PARAM_FUNCTIONS` in both `lib/services/analytics-service.ts` and `api-server/src/services/analytics-service.ts`):

```
borrow, supply, deposit, repay, withdraw, borrowETH, repayETH, withdrawETH
```

The read query filters on `transaction_details.function_name IN (...)`. `function_name` is the text before `(` in the method signature. So we persist `input` only when the enriched tx's function name is in that allowlist; otherwise store `NULL`. `logs`/`operations` are unchanged (score paths parse them — keep).

### 3a. Live enrichment writer — `indexer/src/services/PureEventDrivenEnrichmentService.ts`
Add a module-level allowlist constant:

```ts
// Only these functions have their calldata read back (analytics-service.ts).
// Storing `input` for anything else wasted ~13 GB — gate it.
const INPUT_REQUIRED_FUNCTIONS = new Set([
  'borrow', 'supply', 'deposit', 'repay', 'withdraw',
  'borrowETH', 'repayETH', 'withdrawETH',
]);
```

In `insertEnrichmentData(...)`, replace the `input` bind value (currently `details.input || null`, parameter `$18`) with a gated value:

```ts
const fnName = details.method ? details.method.split('(')[0].trim() : '';
const inputToStore = INPUT_REQUIRED_FUNCTIONS.has(fnName) ? (details.input || null) : null;
```
…and pass `inputToStore` in place of `details.input || null`.

> The `ON CONFLICT DO UPDATE` already only refreshes `logs`/`operations`/`updated_at` — it does not touch `input`, so no change needed there.

### 3b. Gap-fill writer — `indexer/src/services/VolumeEnrichmentService.ts`
This service backs the `concurrent-enrich` gap script (not the live container) and also writes `input` (around line 258, `item.details.input || null`). Apply the **same** allowlist gating so manual gap-fills don't reintroduce bloat. Reuse the same `INPUT_REQUIRED_FUNCTIONS` set (export it from one place or duplicate with a comment).

> This task only stops *future* growth. Reclaiming the existing 13 GB is a separate one-off `UPDATE ... SET input = NULL ...` + `VACUUM` job — **out of scope here**; do not run it as part of this task.

---

## Task 4 — Build & deploy on the VPS

1. **Get the edited code onto the VPS.** First confirm the mechanism:
   ```bash
   ssh root@77.42.41.78 "cd ~/indexer && git remote -v && git status --porcelain | head"
   ```
   - If it's a git checkout: commit on a branch, push, then `git pull` on the VPS.
   - If not a git checkout (no remote): `rsync`/`scp` the changed `indexer/src/...` files and `.env.example` into `~/indexer/`.
   Use whichever matches reality. Do not force one.

2. **Back up before changing compose/.env:**
   ```bash
   ssh root@77.42.41.78 "cp ~/indexer/docker-compose.yml ~/indexer/docker-compose.yml.bak-$(date +%Y%m%d-%H%M) && cp ~/indexer/.env ~/indexer/.env.bak-$(date +%Y%m%d-%H%M)"
   ```

3. **Apply Task 2c (fake key) and 2d (compose env) on the VPS**, then validate compose syntax:
   ```bash
   ssh root@77.42.41.78 "cd ~/indexer && docker compose config --quiet && echo COMPOSE_OK"
   ```

4. **Rebuild the shared indexer image and recreate the workers** (all `indexer-*` share one image; rebuilding once is enough). Postgres/api-server untouched:
   ```bash
   ssh root@77.42.41.78 "cd ~/indexer && docker compose build indexer-realtime && docker compose up -d indexer-realtime indexer-enrichment indexer-backfill"
   ```
   (Build failures here = TypeScript error; fix and rebuild — do not deploy a broken image.)

5. **Confirm disk didn't regress** (root disk holds the image layers — see prior cleanup):
   ```bash
   ssh root@77.42.41.78 "df -h / /mnt/HC_Volume_104291715 | tail -2 && docker image prune -f"
   ```

---

## Validation

### A. Immediate (no real key yet — proves the fix, runs anonymous)
1. **All containers up/healthy:**
   ```bash
   ssh root@77.42.41.78 "docker ps --format '{{.Names}} {{.Status}}'"
   ```
   Expect postgres healthy, api-server healthy, three indexer workers Up.

2. **Realtime starts clean (no crash, key wiring read):**
   ```bash
   ssh root@77.42.41.78 "docker logs --since 2m indexer-indexer-realtime-1 2>&1 | tail -20"
   ```
   Expect the startup banner + adaptive-interval lines, no stack trace.

3. **429 is now explicit, not silent** (this is the core regression test). While the IP is still anonymous-banned you should see the new pause log instead of silence:
   ```bash
   ssh root@77.42.41.78 "docker logs --since 3m indexer-indexer-realtime-1 2>&1 | grep -E 'Routescan 429|pausing all polling|HTTP [0-9]'"
   ```
   Seeing `⏸️ ... pausing all polling for Ns` (or an explicit `HTTP 429`) = the silent-swallow bug is fixed. (If the anonymous ban has since lapsed and it's ingesting, that's fine too — see B2.)

4. **No unhandled crash / restart loop:**
   ```bash
   ssh root@77.42.41.78 "docker inspect -f '{{.RestartCount}} {{.State.Status}}' indexer-indexer-realtime-1"
   ```
   RestartCount should be stable (not climbing on re-check) and status `running`.

5. **Enrichment + backfill healthy:**
   ```bash
   ssh root@77.42.41.78 "docker logs --since 2m indexer-indexer-enrichment-1 2>&1 | tail -8; echo ---; docker logs --since 6m indexer-indexer-backfill-1 2>&1 | tail -6"
   ```
   Enrichment: `Database listener setup complete` / `started`. Backfill: periodic Health Check lines.

### B. Post-real-key (run after the user sets `ROUTESCAN_API_KEY` to the real value and `docker compose up -d indexer-realtime`)
1. **Ingestion resumes** — `max(created_at)` advances:
   ```bash
   ssh root@77.42.41.78 "docker exec indexer-postgres-1 psql -U ink -d ink_analytics -Atc \"SELECT now() AT TIME ZONE 'UTC', max(created_at) FROM transaction_details;\""
   ```
   Run twice ~60 s apart; the max should move toward "now".
2. **Success logs appear:**
   ```bash
   ssh root@77.42.41.78 "docker logs --since 3m indexer-indexer-realtime-1 2>&1 | grep 'new tx'"
   ```
3. **`input` gating works** — new non-DeFi enrichment rows store NULL `input`, DeFi rows keep it:
   ```bash
   ssh root@77.42.41.78 "docker exec indexer-postgres-1 psql -U ink -d ink_analytics -c \"SELECT (td.function_name IN ('borrow','supply','deposit','repay','withdraw','borrowETH','repayETH','withdrawETH')) AS is_defi, count(*) AS rows, count(te.input) AS with_input FROM transaction_enrichment te JOIN transaction_details td ON td.tx_hash=te.tx_hash WHERE te.created_at > now() - interval '15 min' GROUP BY 1;\""
   ```
   Expect: `is_defi=false` rows have `with_input = 0`; `is_defi=true` rows have `with_input = rows`.

### C. Score-safety sanity (must stay intact)
Pick a known active wallet and confirm the dashboard/score endpoint still returns non-zero volume (logs/operations untouched):
```bash
ssh root@77.42.41.78 "curl -s --max-time 20 http://localhost:4000/health && echo ' api-ok'"
```
Spot-check one wallet's analytics via the api-server route used by the app and confirm volume fields are populated (no regression from the `input` change — `input` is not used for swap/bridge volume, only the 8 DeFi functions).

---

## Rollback
- Code/image: `docker compose up -d` against the previous image, or `git revert` + rebuild.
- Compose/.env: restore the `.bak-*` files created in Task 4 step 2, then `docker compose up -d`.
- The `input` gating is forward-only and non-destructive (it only changes what *new* rows store); nothing to roll back in the DB.

## Definition of done
- [ ] Realtime handles 429/non-200 explicitly (no silent empty results); global pause honored; request timeout added.
- [ ] `ROUTESCAN_API_KEY` read from env; fake placeholder in VPS `.env` + `.env.example`; passed via compose.
- [ ] `input` persisted only for the 8 read-needed functions in both enrichment writers.
- [ ] Image rebuilt; all workers Up; Validation A passes.
- [ ] Handoff note to user: "replace `ROUTESCAN_API_KEY=REPLACE_WITH_REAL_KEY` with your real key, then `docker compose up -d indexer-realtime`; then run Validation B."
