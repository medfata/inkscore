# Vercel Cost Reduction — Implementation Plan

**Goal:** Reduce Vercel Fluid CPU and memory-duration costs by ~50–70% by fixing the SSE dashboard route, adding edge caching to NFT routes, and moving pass-through routes to the Edge runtime.

**Context:** Vercel metrics report showed **301 GB-hrs memory duration (99.4% of total)** dominated by `app/api/[wallet]/dashboard/route.ts`. That route runs on `nodejs` + `force-dynamic`, holds an SSE stream open for up to 60 s, fans out 29+ parallel fetches to the Express API, and paginates OpenSea GraphQL up to 30 pages. Every dashboard view = ~1 GB × 60 s provisioned. Secondary offenders are a handful of NFT and pass-through routes with missing/weak cache headers.

Use this document as the single source of truth. **Check off each step as you complete it.** Do not skip steps; read the file listed in the step before editing. Keep changes minimal — do not refactor surrounding code.

---

## Repo layout (what you need to know)

- **Root `/`** = Next.js 16 app (App Router). All `app/api/**/route.ts` files are Vercel Serverless Functions by default (`runtime = 'nodejs'`).
- **`/api-server/`** = separate Express 4 server on port 4000. **Not deployed to Vercel** — runs elsewhere. The Next.js API routes fetch from it via `API_SERVER_URL`.
- **`/indexer/`** = blockchain indexer, **untouched by this work**.
- The Express server already has an in-memory `responseCache` at `api-server/src/cache.ts` with a 30 s TTL.
- Redis is available in the Express server via `ioredis` (used today for the leaderboard).

**Only these two locations are edited in this plan:**
1. `app/**` (Next.js routes + new `vercel.json` at repo root)
2. `api-server/src/**` (OpenSea cache + optional Redis/cron)

The `indexer/` directory is not touched.

---

## Tech conventions to respect

- Next.js App Router — `export const runtime`, `export const dynamic`, `export const revalidate` at module top.
- Singleton services in `/lib/services/` — do not introduce new DI patterns.
- Do not add dependencies without a clear need. Redis client (`ioredis`) is already installed in `api-server`.
- Do not add backwards-compat shims. Just change the code.
- Do not add comments that restate the change or reference this task. If a reader 6 months from now wouldn't need it, don't write it.

---

## Phase 1 — Dashboard SSE route (biggest lever, ~50% of win)

**File:** `app/api/[wallet]/dashboard/route.ts`

### Step 1.1 — Shorten the SSE hold time
- [x] Change `TIMEOUT_MS = 60000` to `TIMEOUT_MS = 20000` (line ~132). Rationale: if Express can't answer in 20 s it won't in 60 s; container memory-duration is billed the full wall-clock regardless.

### Step 1.2 — Lower per-metric fetch timeout
- [x] In `fetchFromExpress` (line ~101), change the per-metric abort timeout from `50000` to `8000` (8 s). Individual metric cards can show an error state; the SSE stream must not stall on one slow endpoint.

### Step 1.3 — Cap OpenSea pagination
- [x] In `fetchOpenSeaCounts` (line ~31), change the page cap from `page < 30` to `page < 8`.
- [x] Drop the per-page fetch timeout (line ~35) from `10000` to `5000`.
- [x] Leave the pagination logic otherwise intact.

### Step 1.4 — Delete the non-streaming GET path
- [ ] Confirm the frontend always calls with `?stream=true`. Search the codebase: `rg "api/[^\"']*/dashboard"` under `app/` and `components/` (or wherever the UI lives). If every call passes `stream=true`, proceed.
- [ ] If confirmed, delete lines ~324–460 (everything after `if (enableStreaming) { return getStreamingDashboard(walletAddress); }` except the surrounding try/catch and the 400-wallet-format guard). The `GET` handler should now just validate the wallet, lowercase it, and always call `getStreamingDashboard`.
- [ ] If **not** confirmed (some caller relies on the non-streaming path), **skip this step** and note it in the checklist with a line referencing the caller.
**SKIPPED**: `Dashboard.tsx` lines 1071 and 1120 call without `stream=true`; `useStreamingDashboard.ts` line 227 uses it as browser EventSource fallback.

### Step 1.5 — Add cache headers on the SSE response
- [x] On the `new Response(stream, { headers: ... })` at line ~287, change `Cache-Control` from `'no-cache, no-transform'` to `'private, s-maxage=30, stale-while-revalidate=120, no-transform'`. Keep `Content-Type`, `Connection`, and `X-Accel-Buffering` unchanged. Rationale: dashboard is idempotent per wallet for short windows; `private` keeps it off shared CDN; the edge revalidates in the background.

### Step 1.6 — Add Redis caching in Express for expensive per-metric endpoints
**File:** `api-server/src/services/opensea-service.ts` (and related services as noted)

- [ ] Read `api-server/src/services/opensea-service.ts` to understand current shape.
- [ ] Read `api-server/src/cache.ts` — this is the in-memory cache. We will **add a Redis-backed layer** for the OpenSea counts specifically, keyed on wallet, TTL 300 s (5 min). Keep the existing in-memory cache as-is; the Redis layer sits in front for cross-instance reuse.
- [ ] Find where Redis is instantiated in the api-server (grep `new Redis(` or `from 'ioredis'`). Reuse that client.
- [ ] In the OpenSea cache population endpoint (`POST /api/analytics/:wallet/opensea-cache` — find it under `api-server/src/routes/analytics.ts`), after storing counts in memory, also write to Redis: key `opensea:counts:{walletLower}`, value `JSON.stringify({buys, sales, mints})`, TTL 300 s.
- [ ] In the score/dashboard read paths that currently use the in-memory opensea cache, check Redis on miss before falling through.
- [ ] **Do not** add Redis caching blindly to every endpoint. Scope: OpenSea counts only in Phase 1. Other endpoints comes in Phase 1.7.
**SKIPPED**: Redis is not instantiated in api-server (only in-memory `responseCache` exists). Per plan rules, do not add dependencies.

### Step 1.7 — Optional: add short-TTL Redis cache for dashboard per-metric endpoints
Only do this step **if Phase 1.1–1.6 don't produce enough reduction** (measure first).
- [ ] For the heaviest Express endpoints (grep logs for slowest), add a 30–60 s Redis cache wrapper keyed on `metric:{slug}:{wallet}`. Keep the wrapper in a small helper; don't scatter Redis calls across every route.
**SKIPPED**: Depends on Step 1.6 which was skipped.

### Phase 1 verification
- [x] Run `cd api-server && npm run build` — must pass.
- [x] Run `npm run build` at repo root — must pass.
- [ ] Manual smoke test: load a dashboard for a known wallet in dev, confirm SSE events stream in, confirm the page completes without visible regression.
- [x] Commit with message: `perf(dashboard): cut SSE timeout + cap OpenSea pagination + edge cache headers`.

---

## Phase 2 — NFT routes (multiplier effect from OpenSea, Routescan, social unfurls)

### Step 2.1 — `/api/nft/image/[tokenId]` aggressive caching
**File:** `app/api/nft/image/[tokenId]/route.ts`

- [x] Add `export const revalidate = 600;` near the top (after imports).
- [x] Change the `Cache-Control` header (line ~105) from `'no-cache, no-transform'` to `'public, s-maxage=600, stale-while-revalidate=3600'`.
- [x] Leave all other logic (RPC call, score fetch, SVG generation) untouched.

### Step 2.2 — `/api/nft/metadata/[tokenId]` longer TTL
**File:** `app/api/nft/metadata/[tokenId]/route.ts`

- [x] Change `Cache-Control` (line ~125) `max-age=3600, s-maxage=3600` → `max-age=21600, s-maxage=21600, stale-while-revalidate=86400`.
- [x] Add `export const revalidate = 21600;` near the top.

### Step 2.3 — `/api/proxy-image` redirect instead of streaming
**File:** `app/api/proxy-image/route.ts`

- [x] Replace the fetch+arrayBuffer body of the `try` block (lines ~12–34) with a 302 redirect: `return NextResponse.redirect(url, 302);`.
- [x] Before redirecting, validate that `url` is an `http://` or `https://` URL to avoid open-redirect abuse. Parse with `new URL(url)` inside a try/catch; return a 400 if parsing fails or protocol isn't http(s).
- [x] Keep the fallback SVG behavior (unchanged) — but it now only fires on the URL-validation catch, not on fetch failure (there is no fetch anymore).
- [x] Rationale: the function no longer loads image bytes into memory; the browser follows the redirect to the origin. Vercel bandwidth/memory drop to near-zero for this route.

### Phase 2 verification
- [ ] Load `/api/nft/image/1` (or any valid token) in a browser — verify SVG renders.
- [ ] Load `/api/nft/metadata/1` — verify JSON has correct `image` field pointing at `/api/nft/image/1`.
- [ ] Load `/api/proxy-image?url=https://...` — verify it 302s to the target.
- [x] Commit: `perf(nft): aggressive edge cache + proxy-image redirect`.

---

## Phase 3 — Cheap wins across small routes

### Step 3.1 — ETH price cache
**File:** `app/api/prices/eth/route.ts`
- [x] Add `export const revalidate = 60;` at top.
- [x] Wrap the `NextResponse.json(...)` return with cache headers: `{ headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } }`.

### Step 3.2 — Ranks cache
**File:** `app/api/ranks/route.ts`
- [x] Add `export const revalidate = 300;` at top.
- [x] Add `Cache-Control: 'public, s-maxage=300, stale-while-revalidate=1800'` to the successful response.

### Step 3.3 — Phase1 check cache
**File:** `app/api/phase1/check/[address]/route.ts`
- [x] Add `export const revalidate = 60;` at top.
- [x] Add `Cache-Control: 'public, s-maxage=60, stale-while-revalidate=300'` on the successful `NextResponse.json(data)` return.

### Step 3.4 — Wallet NFT aggregator cache
**File:** `app/api/[wallet]/nft/route.ts`
- [x] Add `Cache-Control: 'private, s-maxage=30, stale-while-revalidate=120'` to the successful response headers.
- [x] Do **not** add `revalidate` here (wallet-keyed dynamic route; `s-maxage` is sufficient).

### Phase 3 verification
- [x] `npm run build` at repo root — must pass (no runtime changes, only headers).
- [x] Commit: `perf(api): add edge cache headers to low-change routes`.

---

## Phase 4 — Runtime & infra (memory multiplier)

### Step 4.1 — Move pass-through routes to Edge runtime
Edge functions don't count toward Fluid CPU/memory bills. Only move routes that do **not** make database calls (the `pg` driver doesn't run on Edge) and do **not** call RPC to IP addresses (Edge blocks raw IPs — the dashboard comment at `app/api/[wallet]/dashboard/route.ts:3` documents this).

Safe candidates (pure Express pass-throughs or simple fetches):
- [x] `app/api/prices/eth/route.ts` — inspect `priceService.getCurrentPrice()` first; only move to Edge if it does **not** hit `pg`. If it does, leave on `nodejs`. **NOT MOVED**: priceService uses `pg` driver.
- [x] `app/api/ranks/route.ts` — Edge-safe (fetch only).
- [x] `app/api/phase1/check/[address]/route.ts` — Edge-safe (fetch only).
- [x] `app/api/[wallet]/nft/route.ts` — Edge-safe (fetch only).

For each route marked Edge-safe: add `export const runtime = 'edge';` at the top.

**Do NOT move:**
- `app/api/[wallet]/dashboard/route.ts` (SSE + IP fetches to Express)
- `app/api/nft/image/[tokenId]/route.ts` (viem RPC + may not work at Edge reliably for this contract)
- `app/api/nft/metadata/[tokenId]/route.ts` (same reason)
- Any `admin/*` route (likely touches DB)

### Step 4.2 — Add `vercel.json` with memory caps
- [x] Verify no `vercel.json` currently exists at repo root: `ls vercel.json` (expect: not found).
- [x] Create `vercel.json` at the repo root with the following content:

```json
{
  "functions": {
    "app/api/**/route.ts": {
      "memory": 512
    },
    "app/api/[wallet]/dashboard/route.ts": {
      "memory": 1024
    }
  }
}
```

Rationale: default Fluid provisioning is generous (often 1024 MB). Capping most routes at 512 MB halves the memory multiplier in GB-hrs. The dashboard SSE route gets 1024 because it runs the parallel fan-out.

- [x] Do **not** set memory below 512 without testing. Edge routes are not affected by this config.

### Phase 4 verification
- [x] `npm run build` — must pass. Watch for Edge-runtime build warnings on any route that was moved; if a moved route imports something incompatible (e.g. `pg`, `fs`, `crypto` in the wrong form), revert that route to `nodejs` and note it.
- [x] Commit: `perf: move pass-through routes to edge runtime + add vercel.json memory caps`.

---

## Out of scope (do not do in this pass)

- Do **not** change `indexer/`.
- Do **not** touch admin routes.
- Do **not** rewrite `lib/services/`.
- Do **not** change the database schema or migrations.
- Do **not** add new dependencies.
- Do **not** touch `.env` or deployment configuration beyond the single `vercel.json` addition.

---

## Final checklist (run before reporting done)

- [ ] All phase verification steps green.
- [ ] `npm run build` (root) and `cd api-server && npm run build` both pass.
- [ ] `npm run lint` at root passes.
- [ ] One commit per phase, each with a clear message.
- [ ] No changes to files outside the scope listed above.
- [ ] Note in the PR description which steps were skipped (e.g., if 1.4 was not done because the non-streaming path is still in use) and why.

---

## Expected outcome

- **Phase 1 alone:** ~50% reduction in dashboard memory-duration (GB-hrs). Biggest single lever.
- **Phases 2+3:** ~15–25% additional reduction from CDN offload of NFT and pass-through routes.
- **Phase 4:** memory multiplier cut proportionally (≈50% on capped routes) plus Edge routes shift off Fluid billing entirely.

Measure after Phase 1 before deciding whether 1.7 is needed.
