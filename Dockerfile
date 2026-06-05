# Next.js frontend + API for InkScore — self-hosted (Hetzner) build.
# Produces a minimal standalone server image (output: 'standalone').

# ---- Build stage ----
FROM node:20-alpine AS builder
WORKDIR /app

# NEXT_PUBLIC_* are inlined into the client bundle at build time, so they must
# be present as build args (they are public values, not secrets).
ARG NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID
ARG NEXT_PUBLIC_NFT_CONTRACT_ADDRESS
ARG NEXT_PUBLIC_ENABLE_STREAMING=true
ENV NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=$NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID \
    NEXT_PUBLIC_NFT_CONTRACT_ADDRESS=$NEXT_PUBLIC_NFT_CONTRACT_ADDRESS \
    NEXT_PUBLIC_ENABLE_STREAMING=$NEXT_PUBLIC_ENABLE_STREAMING

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- Run stage ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000
CMD ["node", "server.js"]
