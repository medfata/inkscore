# Hetzner Migration Plan — Next.js Frontend off Vercel

**Goal:** Move the Next.js frontend + API routes from Vercel onto the same Hetzner box that already runs `api-server`, Postgres, and the indexer (via `indexer/docker-compose.yml`). Put Cloudflare (free) in front for CDN/TLS/caching so the site loads fast without Vercel's edge network.

**Current state (verified from repo):**
- Next.js 16 App Router, root `/`. 47 API routes. Builds with `next build --webpack`.
- `api-server` (Express:4000), Postgres 16, and 3 indexer services already containerized in `indexer/docker-compose.yml` on Hetzner.
- Frontend reaches Express server-side only via `API_SERVER_URL`.
- 3 edge-runtime routes (`[wallet]/nft`, `phase1/check/[address]`, `ranks`), several ISR `revalidate` routes, one SSE route (`[wallet]/dashboard`), one `next/image` usage (`Logo.tsx`).
- No Vercel crons (only memory caps in `vercel.json`).
- No `output: 'standalone'` in `next.config.ts` — **must add for Docker**.

---

## Architecture (target)

```
Cloudflare (free CDN + TLS + cache)
        |
        v
  Hetzner box (1 server)
  ┌─────────────────────────────────────────────┐
  │ docker network: internal                     │
  │                                              │
  │  cloudflared ──► web (Next.js :3000)         │
  │                    │  API_SERVER_URL          │
  │                    ▼                          │
  │                 api-server (:4000) ──► postgres│
  │                 indexer x3 ─────────► postgres │
  └─────────────────────────────────────────────┘
```

Web talks to `api-server` over the internal docker network (`http://api-server:4000`) — no public exposure of port 4000. Only Cloudflare reaches the box.

---

## Phase 0 — Decisions (pick before starting)

### D1. Ingress method (how traffic reaches the box)
- **Option A — Cloudflare Tunnel (`cloudflared`) [RECOMMENDED].** Zero open inbound ports; the box dials out to Cloudflare. No firewall holes, no origin cert management. Free, unlimited.
- **Option B — Caddy reverse proxy + open 80/443.** Caddy auto-provisions Let's Encrypt TLS. Simpler mental model, but exposes ports; set Cloudflare to "Full (strict)".

### D2. Deploy workflow (DX)
- **Option A — Plain `docker compose` (matches current setup).** `git pull && docker compose up -d --build`. Lowest moving parts.
- **Option B — Coolify (open-source self-hosted PaaS).** Git-push deploys, auto-TLS, build logs, rollbacks — Vercel-like DX on your own box. One-time install, ~1 GB RAM overhead. Recommended only if you want push-to-deploy.

Plan below assumes **D1=A (Cloudflare Tunnel)** and **D2=A (docker compose)**. Swap-in notes included where relevant.

---

## Phase 1 — Make Next.js self-hostable

### 1.1 Standalone output
`next.config.ts` — add inside `nextConfig`:
```ts
output: 'standalone',
```
Produces `.next/standalone/server.js` with only the deps the server needs (small image, fast boot).

### 1.2 Image handling
One `next/image` usage (`app/components/Logo.tsx`). `sharp` is **not** a current dependency. **Default: don't add it** — set `images: { unoptimized: true }` in `next.config.ts`. Zero new deps, no server-side image processing for a single logo. Only add `sharp` (a new dependency — your explicit call) if you later need on-server optimization.

### 1.3 Edge routes
The 3 `runtime = 'edge'` routes were edge for **Vercel billing reasons that no longer apply**. `next start` runs them in a Node edge sandbox — they work, but the sandbox blocks some Node APIs. Lowest-risk move: change those three to `export const runtime = 'nodejs'` (they only `fetch`). Re-test after. Optional, but removes a class of self-host surprises.

### 1.4 Drop Vercel-only config
- Delete `vercel.json` (memory caps are Vercel Fluid-only; ignored elsewhere).
- Keep all `Cache-Control` / `s-maxage` / `revalidate` headers — Cloudflare honors them at the edge (this is what keeps the site fast).

### 1.5 ISR cache note
Single `web` container → default filesystem ISR cache works. **If you ever scale to >1 web replica**, add a shared cache handler backed by Redis (`cacheHandler` in `next.config.ts`). Not needed for one instance.

---

## Phase 2 — Containerize the frontend

### 2.1 Root `Dockerfile` (new)
```dockerfile
# Build
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build            # next build --webpack, emits standalone

# Run
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
EXPOSE 3000
CMD ["node", "server.js"]
```

### 2.2 `.dockerignore` (new)
```
node_modules
.next
.git
.codex-logs
*.md
```

### 2.3 Add `web` service to `indexer/docker-compose.yml`
```yaml
  web:
    build: ..               # repo root
    restart: always
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgres://ink:${DB_PASSWORD}@postgres:5432/ink_analytics
      API_SERVER_URL: http://api-server:4000
      NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: ${NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID}
      NEXT_PUBLIC_NFT_CONTRACT_ADDRESS: ${NEXT_PUBLIC_NFT_CONTRACT_ADDRESS}
      ADMIN_WALLETS: ${ADMIN_WALLETS}
      NEXT_PUBLIC_ENABLE_STREAMING: ${NEXT_PUBLIC_ENABLE_STREAMING:-true}
    expose:
      - "3000"              # internal only; no host port
```

> **No Redis service.** Verified against the code: `ioredis` is installed but never imported, `REDIS_URL` is never read, and the leaderboard caches in Postgres (`cached_leaderboard` table) + in-process Maps. There is no Redis traffic today. Do **not** add a Redis container during migration — provision it only if a future Arch-B collapse runs web as multiple replicas needing a shared cache.
>
> **No `CRON_SECRET` either.** It's in `.env.example` + CLAUDE.md but read by no code (you confirmed no crons). Omitted from the web env above. Add it only if/when you wire an actual cron route.
Note: `NEXT_PUBLIC_*` vars are inlined at **build** time — also pass them as build args if the build needs them (WalletConnect/NFT address do). Add an `args:` block under `build:` mirroring the `NEXT_PUBLIC_*` values.

### 2.4 Redis — not needed
The app uses **no Redis** (see note above). Skip it. `CLAUDE.md` claims "Redis for leaderboard caching" but the code caches in Postgres; treat that line as stale. Drop `ioredis` from `package.json` as dead weight if you want, or leave it — it's never loaded.

---

## Phase 3 — Ingress + TLS (Cloudflare)

### 3.1 DNS
Move the domain's nameservers to **Cloudflare** (free). Or keep Hetzner DNS (also free) and just point an A record — but Cloudflare NS unlocks the CDN/proxy. Use Cloudflare.

### 3.2 Cloudflare Tunnel (D1=A)
```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: always
    command: tunnel run
    environment:
      TUNNEL_TOKEN: ${CF_TUNNEL_TOKEN}
    depends_on:
      - web
```
In the Cloudflare Zero Trust dashboard: create a tunnel, route `inkscore.<domain>` → `http://web:3000`. Copy the token to `.env` as `CF_TUNNEL_TOKEN`. **No ports opened on the Hetzner firewall.**

SSE note: the dashboard route streams Server-Sent Events. Cloudflare passes SSE through, but ensure the route does **not** get buffered — it already sends `X-Accel-Buffering: no`; keep it. Cloudflare does not buffer `text/event-stream` by default.

### 3.2-alt Caddy (D1=B)
```
inkscore.<domain> {
    reverse_proxy web:3000
    encode zstd gzip
}
```
Run Caddy as a service, open 80/443 on the Hetzner firewall, Cloudflare SSL = Full (strict).

### 3.3 Cloudflare cache rules
- Default: Cloudflare honors `s-maxage` from your routes (already set in the cost-reduction work).
- Add a cache rule: `/_next/static/*` → Cache Everything, Edge TTL respects `immutable` (effectively forever). This is the single biggest perceived-speed win.
- Enable **Brotli**, **HTTP/3**, **Early Hints**, **Tiered Cache** (all free, toggles).

---

## Phase 4 — Cutover

1. Stand up the new stack on Hetzner under a temp hostname (`staging.<domain>` via the tunnel). Smoke test: home, a wallet dashboard (SSE streams), `/api/nft/image/1`, leaderboard, an admin route.
2. Verify env parity: copy every Vercel project env var into the box `.env`. Cross-check against `.env.example` (`DATABASE_URL`, `API_SERVER_URL`, `CRON_SECRET`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `ADMIN_WALLETS`, `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS`, `NEXT_PUBLIC_ENABLE_STREAMING`). Skip `REDIS_URL` — unused by the code.
   **Also required (read by code, not in `.env.example`):** `NFT_SIGNER_PRIVATE_KEY` (NFT mint authorization — `app/api/nft/authorize`), `GOOGLE_CLIENT_EMAIL` / `GOOGLE_PRIVATE_KEY` / `GOOGLE_SHEET_COLAB_REQUEST_ID` (colab requests via Google Sheets; keep `\n` escaped in the key — code unescapes it). The compose `environment:` block whitelists vars — putting a var in `.env` alone does NOT reach the container; it must be listed in the `web` service (done in `indexer/docker-compose.yml`).
3. **Check the Vercel dashboard for Cron Jobs** — none are in `vercel.json`, but confirm none were added in the UI. If any exist, replace with a `cron` container or a host crontab cur(using `CRON_SECRET`).
4. Flip DNS / tunnel route for the apex/`www` to the box. TTL low beforehand.
5. Watch logs (`docker compose logs -f web`) and Cloudflare analytics for errors.
6. Keep Vercel deployment live but un-pointed for ~48h as rollback. Then delete the Vercel project.

---

## Phase 5 — Harden / operate

- **Backups:** enable Hetzner snapshots or a nightly `pg_dump` to Cloudflare R2 (free 10 GB).
- **Resource caps:** add `mem_limit` per service in compose so the indexer can't starve `web`.
- **Updates:** `git pull && docker compose up -d --build web` (or Coolify push if D2=B).
- **Monitoring:** Cloudflare Web Analytics (free) replaces Vercel Analytics. Add Uptime check (Hetzner has none free; use a free external like UptimeRobot).
- **Sizing:** Postgres + indexer x3 + api-server + web on one box → start at **CPX31/CX42 (4 vCPU / 8 GB)**. Watch RAM; bump if the indexer backfill is heavy.

---

## Free services to make it fast (verified quotas, June 2026)

| Service | Use here | Free quota |
|---|---|---|
| **Cloudflare CDN (Free plan)** | Global edge cache for `/_next/static`, ISR/`s-maxage` routes, TLS, HTTP/3, Brotli, DDoS | Unlimited bandwidth for normal web traffic; 512 MB max per cached file |
| **Cloudflare Tunnel (`cloudflared`)** | Secure ingress, zero open ports | Free, unlimited |
| **Cloudflare R2** | Store/serve NFT images + assets, **zero egress fees** | 10 GB storage, 1M Class A ops/mo, 10M Class B ops/mo, $0 egress |
| **Cloudflare Web Analytics** | Replace Vercel Analytics | Free, unlimited |
| **Cloudflare Workers** (optional) | Re-home the 3 edge routes at the real edge if wanted | 100,000 requests/day |
| **Hetzner Cloud included traffic** | Outbound bandwidth from the box | 20 TB/mo base (new June-2026 plans up to 60 TB on larger types); overage ~€1.19/TB |
| **Hetzner DNS Console** | Authoritative DNS (alt to Cloudflare DNS) | Free, unlimited zones + records |

**Why this is fast:** Cloudflare serves cached static assets and `s-maxage` API responses from ~330 edge cities — most requests never touch Hetzner. The box only handles dynamic/uncached work (dashboard SSE, admin, DB reads). You keep Vercel-like edge speed for free; the only paid line is the Hetzner server itself.

Sources:
- https://www.hetzner.com/news/new-cloud-plans/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/workers/platform/pricing/

---

## Migration risks (verified in code)

### R1 — OpenSea fetch from a datacenter IP — RESOLVED (was HIGH)
~~The dashboard route fetched OpenSea GraphQL directly from the Next server (a Vercel-IP workaround).~~ After merging main (`7524527 disabled opensea` + opensea-service rewrite), the dashboard fetches OpenSea counts from `api-server` (`/api/analytics/:wallet/opensea_*_count`), which serves them from the `opensea_wallet_counts` Postgres table (auto-created via `CREATE TABLE IF NOT EXISTS`). No direct OpenSea call from the web container remains — nothing IP-sensitive moves in this migration. Still smoke-test OpenSea counts on staging in Phase 4.

### R2 — `cached_leaderboard` table must exist on the box's Postgres
The leaderboard cache reads/writes the `cached_leaderboard` table (`lib/leaderboard-cache.ts`). The box's Postgres already serves the indexer + api-server, so the schema should be present — **verify the table exists** before cutover (it's not Redis; it's a real table).

## Out of scope
- No changes to `indexer/` logic or DB schema.
- No rewrite of `lib/services/` or `api-server/`.
- Keep all existing cache headers from `VERCEL_COST_REDUCTION_PLAN.md` — they now feed Cloudflare instead of Vercel.
