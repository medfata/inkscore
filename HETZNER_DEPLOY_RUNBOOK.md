# Hetzner Deploy Runbook — Vercel → Hetzner + Cloudflare

Step-by-step execution guide for the migration designed in `HETZNER_MIGRATION_PLAN.md`.

- **Box:** `root@77.42.41.78` (ubuntu-4gb-hel1-3, 4 GB RAM, root disk 38 GB, Postgres data on the 100 GB volume)
- **Branch:** `feat/hetzner-migration` (pushed to `medfata/inkscore`). It already contains **all of `main`** (verified: zero commits in `upstream/main` missing from the branch). Merge the branch into `main` at cutover (Part 8) — until then, deploy staging from the branch.
- **No git on the VPS.** All code transfer uses `git archive` + `scp` from the local Windows machine (ships only tracked files — no `node_modules`, no `.env`, no junk).
- Local commands are PowerShell (run from `D:\my_projects\inkscore`). Box commands are bash over SSH.

---

## Part 0 — How code gets to the box (read first)

The `web` image builds with the **repo root as Docker build context**, so the box needs the full repo tree at `/root/inkscore` (not just `indexer/`). The transfer pattern, used in Part 4 and for every later deploy:

```powershell
# Local (PowerShell) — package exactly what git tracks on the branch
git archive -o inkscore.tar feat/hetzner-migration
scp inkscore.tar root@77.42.41.78:/root/
Remove-Item inkscore.tar
```

```bash
# Box — wipe-and-extract, then restore the env file
rm -rf /root/inkscore && mkdir -p /root/inkscore
tar -xf /root/inkscore.tar -C /root/inkscore && rm /root/inkscore.tar
cp /root/inkscore.env /root/inkscore/indexer/.env   # canonical env lives OUTSIDE the tree (Part 4.4)
```

Wipe-and-extract (instead of overwrite) means deleted files never linger. It is safe **because the env file's canonical copy lives at `/root/inkscore.env`**, outside the wiped directory. Docker volumes (Postgres data) are never touched by this.

> Compose project name comes from the directory name: `/root/inkscore/indexer` still ends in `indexer`, so it is the **same compose project** as the old `~/indexer` setup — the existing `indexer_postgres_data` volume and network are reused automatically. **Postgres data is untouched.**

---

## Part 1 — Gather secrets (Vercel dashboard, ~10 min)

1. **Vercel → project → Settings → Environment Variables** — copy values for:
   - `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`
   - `NEXT_PUBLIC_NFT_CONTRACT_ADDRESS`
   - `NEXT_PUBLIC_ENABLE_STREAMING`
   - `ADMIN_WALLETS`
   - `NFT_SIGNER_PRIVATE_KEY`
   - `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, `GOOGLE_SHEET_COLAB_REQUEST_ID`
2. **Settings → Cron Jobs** — confirm none exist (the plan assumes none).
3. Keep values in a local scratch file for Part 4.4. Delete the scratch file afterwards.

## Part 2 — Cloudflare account + DNS (~20 min + NS propagation)

1. Free account at dash.cloudflare.com.
2. **Add a domain** → enter the domain → **Free** plan.
3. Cloudflare imports existing DNS records. **Verify the records pointing to Vercel imported intact** (apex / `www`). Leave them — the site stays on Vercel until cutover.
4. At the registrar, switch nameservers to the two Cloudflare assigns. Wait for zone status **Active** (minutes–hours).
5. Once active, set the free toggles:
   - **SSL/TLS → Overview** → mode **Full (strict)**
   - **Speed → Optimization** → **Brotli**, **Early Hints**
   - **Network** → **HTTP/3**
   - **Caching → Tiered Cache** → **Smart Tiered Caching**

## Part 3 — Cloudflare Tunnel (~10 min)

1. **Zero Trust dashboard** (one.dash.cloudflare.com) → **Networks → Tunnels → Create a tunnel**.
2. Connector type **Cloudflared**, name `inkscore`.
3. On the connector page **install nothing** — copy the token (the long string after `--token`). That is `CF_TUNNEL_TOKEN` for Part 4.4. The `cloudflared` compose service runs the connector.
4. **Public Hostname** (staging first):
   - Subdomain `staging`, your domain
   - Service **HTTP** → `web:3000` (`web` resolves inside the compose network)
5. Save. Tunnel shows "Down" until Part 5 starts the container.

## Part 4 — Prepare the box (~30 min)

`ssh root@77.42.41.78`

### 4.1 Disk + RAM preflight (box has known disk pressure)

```bash
df -h / /mnt/HC_Volume_104291715   # need ~5 GB free on / for image layers
free -h
docker image prune -f              # safe cleanup
```

> **DANGER:** never run `docker buildx history ...` on this box — known dockerd nil-pointer panic (docker 29.1.3) that resurrects zombie containers and breaks bridge networking. Cleanup playbook is in `vps` memory / ops notes.

### 4.2 Add swap — REQUIRED

4 GB RAM with postgres + 3 indexers + api-server running will OOM the Next.js build:

```bash
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

### 4.3 Ship the code (local PowerShell, then box)

```powershell
# Local — from D:\my_projects\inkscore
git archive -o inkscore.tar feat/hetzner-migration
scp inkscore.tar root@77.42.41.78:/root/
Remove-Item inkscore.tar
```

```bash
# Box
mkdir -p /root/inkscore
tar -xf /root/inkscore.tar -C /root/inkscore && rm /root/inkscore.tar
```

### 4.4 Create the canonical env file

Start from the existing stack env, then extend:

```bash
cp /root/indexer/.env /root/inkscore.env
chmod 600 /root/inkscore.env
nano /root/inkscore.env
```

Append (values from Part 1 and Part 3):

```bash
NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=...
NEXT_PUBLIC_NFT_CONTRACT_ADDRESS=0x...
NEXT_PUBLIC_ENABLE_STREAMING=true
ADMIN_WALLETS=0x...,0x...
NFT_SIGNER_PRIVATE_KEY=0x...
GOOGLE_CLIENT_EMAIL=...@....iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
GOOGLE_SHEET_COLAB_REQUEST_ID=...
CF_TUNNEL_TOKEN=eyJ...
RPC_URL=https://rpc-gel.inkonchain.com
```

Rules:
- `GOOGLE_PRIVATE_KEY` stays on **one line with literal `\n`** — the code unescapes it.
- `/root/inkscore.env` is the **canonical** copy (survives wipe-and-extract). Copy it into place:

```bash
cp /root/inkscore.env /root/inkscore/indexer/.env
```

## Part 5 — Build and start (~15 min)

```bash
cd /root/inkscore/indexer

# Free RAM for the build (recommended on 4 GB):
docker compose stop indexer-backfill indexer-enrichment

# The long step — npm ci + next build:
docker compose build web

# Bring the whole stack up from the new tree:
docker compose up -d
docker compose ps                          # all Up; web + api-server healthy
docker compose logs -f web cloudflared     # cloudflared: 'Registered tunnel connection'
```

Compose recreates the existing containers under the new project path — same volumes, seconds of downtime per service. Keep the old `/root/indexer` directory as rollback backup, but **never run compose from both directories.**

## Part 6 — Staging smoke test

Tunnel shows **Healthy** in Zero Trust, then on `https://staging.<domain>`:

1. Home page loads; wallet-connect modal opens (proves `NEXT_PUBLIC_*` build args baked in).
2. A wallet dashboard — metrics stream progressively (SSE through the tunnel); OpenSea buy/sale counts populate.
3. Leaderboard loads and shows `lastUpdated`.
4. `/api/nft/image/1` returns an image.
5. An admin route works with an admin wallet.
6. NFT mint authorize flow (exercises `NFT_SIGNER_PRIVATE_KEY`).
7. `docker compose logs web --since 10m | grep -i error` — nothing alarming.

SSE note: Cloudflare drops idle HTTP responses after ~100 s. The dashboard streams events continuously, so this only bites if a single metric stalls >100 s — sporadic 524s on the dashboard would be that.

## Part 7 — Cache rule (the speed win)

**Cloudflare → Caching → Cache Rules → Create rule:**

- Name: `next-static-immutable`
- When: URI Path **starts with** `/_next/static/`
- Then: **Eligible for cache**, Edge TTL **Use cache-control header** (assets are `immutable` → cached effectively forever)

API routes need no rule — Cloudflare honors the `s-maxage` headers already set on the routes.

## Part 8 — Cutover (~15 min + 48 h watch)

1. Merge the branch into main (fast-forward — branch already contains all of main):

   ```powershell
   # Local
   git checkout main && git merge feat/hetzner-migration && git push upstream main
   ```

2. Redeploy the box from `main` (full cycle from Part 0):

   ```powershell
   # Local
   git archive -o inkscore.tar main
   scp inkscore.tar root@77.42.41.78:/root/
   Remove-Item inkscore.tar
   ```

   ```bash
   # Box
   cd /root && rm -rf inkscore && mkdir inkscore && tar -xf inkscore.tar -C inkscore && rm inkscore.tar
   cp /root/inkscore.env /root/inkscore/indexer/.env
   cd /root/inkscore/indexer && docker compose up -d --build web
   ```

3. **Zero Trust → Tunnels → inkscore → Public Hostname** — add the production hostname(s): apex and/or `www` → `HTTP://web:3000`. Cloudflare warns the existing (Vercel) DNS record will be replaced — **that click is the cutover.**
4. Watch 30 min: `docker compose logs -f web` + Cloudflare Analytics for error spikes.
5. Keep the Vercel deployment alive but un-pointed for **48 h** as rollback. Rollback = delete the tunnel public hostname, restore the Vercel DNS record.
6. After 48 h clean: delete the Vercel project. Optionally enable **Cloudflare Web Analytics** to replace Vercel Analytics.

## Part 9 — Hardening (after cutover, ~30 min)

1. **Close exposed ports** — compose publishes `5432:5432` and `4000:4000` to the internet; nothing external needs them anymore (web reaches api-server internally; the tunnel needs zero inbound). Hetzner Console → Firewalls → allow only `22/tcp` inbound, apply to the server. *Keep 5432 reachable only if you connect to Postgres remotely — better over an SSH tunnel.*
2. **Backups** — Hetzner Console → enable Backups (~20% of server cost), or a nightly `pg_dump` cron to Cloudflare R2 (free 10 GB).
3. **Uptime monitoring** — free UptimeRobot monitor on `https://<domain>/`.
4. **Memory caps** — add `mem_limit: 1g` to the indexer services in compose so a heavy backfill can't starve `web` on the 4 GB box.

## Part 10 — Every future deploy (the loop)

```powershell
# Local — after merging changes to main
git archive -o inkscore.tar main
scp inkscore.tar root@77.42.41.78:/root/
Remove-Item inkscore.tar
```

```bash
# Box
cd /root && rm -rf inkscore && mkdir inkscore && tar -xf inkscore.tar -C inkscore && rm inkscore.tar
cp /root/inkscore.env /root/inkscore/indexer/.env
cd /root/inkscore/indexer

docker compose up -d --build web                  # frontend changes
# docker compose up -d --build api-server         # api-server changes
# docker compose up -d --build indexer-backfill indexer-realtime indexer-enrichment
#   ^ indexer changes: all three MUST be rebuilt — compose tags a separate
#     image per service even though the build context is identical
```

---

## Gotchas recap

| # | Gotcha | Where |
|---|--------|-------|
| 1 | Never run `docker buildx history` on the box — dockerd panic | Part 4.1 |
| 2 | Swap required before first `web` build (4 GB RAM) | Part 4.2 |
| 3 | Canonical env lives at `/root/inkscore.env`, copy after every extract | Part 0 / 4.4 |
| 4 | `GOOGLE_PRIVATE_KEY` one line, literal `\n` | Part 4.4 |
| 5 | Same compose project name (`indexer`) → volumes preserved | Part 0 |
| 6 | Never run compose from `/root/indexer` and `/root/inkscore/indexer` at once | Part 5 |
| 7 | Indexer rebuilds = all three services, not one | Part 10 |
| 8 | Image layers land on the 38 GB ROOT disk (containerd store), not the volume | Part 4.1 |
| 9 | If `web` build still OOMs: stop `indexer-realtime` too, or build locally and `docker save \| ssh ... docker load` | Part 5 |
