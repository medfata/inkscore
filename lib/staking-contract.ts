/**
 * InkScore Zenith Staking — shared client configuration & data access.
 *
 * Addresses are intentionally hardcoded constants (precedent: leaderboard /
 * lib/nft-contract.ts). This avoids the compose build-arg / .env restore
 * pitfalls documented in HETZNER_DEPLOY_RUNBOOK.md.
 */

export type HexAddress = `0x${string}`;

/** Ink Chain mainnet */
export const INK_CHAIN_ID = 57073;

/** InkScore Zenith ERC-721 collection (the stakable NFTs) */
export const ZENITH_NFT_ADDRESS =
  '0xd0282f4Cb5c6FE4e3F2fecacFcb9477F42ce8c78' as HexAddress;

/** Blockscout v2 API base */
export const EXPLORER_API_BASE = 'https://explorer.inkonchain.com/api/v2';
export const EXPLORER_BASE_URL = 'https://explorer.inkonchain.com';

/** Public Ink RPC (server-side, keyless reads) */
export const INK_RPC_URL = 'https://rpc-gel.inkonchain.com';

/**
 * IPFS gateways tried in order when resolving artwork. Availability is
 * per-content and transient — 504s from one gateway are normal, another
 * serves the same CID fine — hence the multi-gateway fallback.
 *
 * IMPORTANT: dweb.link and ipfs.io are deliberately EXCLUDED — Protocol
 * Labs deprecated them for browser hotlinking and they 403 image requests
 * sent with browser sec-fetch/Referer headers (server-side fetches get
 * 200s, so a naive probe would return URLs no browser can render).
 * w3s.link / nftstorage.link serve `access-control-allow-origin: *` with
 * no CORP restriction and render fine cross-origin.
 */
export const IPFS_GATEWAYS = [
  'https://w3s.link/ipfs/',
  'https://nftstorage.link/ipfs/',
] as const;

/** Rewrite any ipfs:// or gateway URL onto a specific gateway. */
export function ipfsToGateway(uri: string, gateway: string = IPFS_GATEWAYS[0]): string {
  if (uri.startsWith('ipfs://')) return gateway + uri.slice('ipfs://'.length);
  const m = uri.match(/^https?:\/\/[^/]+\/ipfs\/(.+)$/);
  if (m) return gateway + m[1];
  return uri;
}

/** tokenURI — used server-side to resolve fresh (post-reveal) metadata */
export const ZENITH_TOKENURI_ABI = [
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'tokenURI',
    outputs: [{ internalType: 'string', name: '', type: 'string' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as HexAddress;

/**
 * InkScoreStaking (lock-period contract) — deployed to Ink mainnet 2026-08-30
 * tx: 0x9fef56d8c2fffe3ec868e5449eed2d7115744852d83b4eced965a9fec46f4bd7
 * owner/deployer: 0x87051BC64293B9338351c829414fF29EB6ceA1a6
 * verified on explorer.inkonchain.com (standard-json input, solc 0.8.24)
 * artifacts: contracts/deployed-staking.json
 *
 * Address resolution: NEXT_PUBLIC_STAKING_CONTRACT_ADDRESS (from .env /
 * Vercel dashboard) wins; the constant below is the fallback used when the
 * env var is absent (see HETZNER_DEPLOY_RUNBOOK.md restore pitfalls).
 */
function isHexAddress(value: unknown): value is HexAddress {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
}

const FALLBACK_STAKING_ADDRESS = '0xa6c707fcbeead8f1410b6f83c44d03e65e2e89b6' as HexAddress;

const envStakingAddress = process.env.NEXT_PUBLIC_STAKING_CONTRACT_ADDRESS;

export const STAKING_CONTRACT_ADDRESS: HexAddress = isHexAddress(envStakingAddress)
  ? envStakingAddress
  : FALLBACK_STAKING_ADDRESS;

/** True once STAKING_CONTRACT_ADDRESS has been set post-deployment. */
export const STAKING_CONFIGURED = STAKING_CONTRACT_ADDRESS !== ZERO_ADDRESS;

/** Fixed size of the Zenith collection — the staking progress bar denominator. */
export const ZENITH_TOTAL_SUPPLY = 888;

/* ------------------------------------------------------------------ */
/* Lock periods                                                        */
/* ------------------------------------------------------------------ */

/**
 * Lock periods offered by the staking contract. The index is the
 * `LockPeriod` enum value expected by `stake(tokenId, period)` —
 * 0 = 1 day, 1 = 1 week, 2 = 1 month (30 days).
 */
export interface StakingDuration {
  /** Enum value passed to the contract's stake() */
  index: 0 | 1 | 2;
  /** UI label, e.g. "1 Day" */
  label: string;
  /** Short label for badges, e.g. "1D" */
  short: string;
  /** Duration in seconds (mirrors the contract's _PERIOD_SECONDS) */
  seconds: number;
  /** Off-chain reputation points earned per NFT over the full lock */
  points: 5 | 15 | 50;
}

export const STAKING_DURATIONS: readonly StakingDuration[] = [
  { index: 0, label: '1 Day', short: '1D', seconds: 86_400, points: 5 },
  { index: 1, label: '1 Week', short: '1W', seconds: 604_800, points: 15 },
  { index: 2, label: '1 Month', short: '1M', seconds: 2_592_000, points: 50 },
] as const;

/* ------------------------------------------------------------------ */
/* ABIs                                                                */
/* ------------------------------------------------------------------ */

/**
 * Minimal ABI covering only the functions the frontend consumes.
 * Full JSON ABI form (repo convention, see lib/nft-contract.ts) so wagmi/viem
 * type inference resolves exactly across every tsconfig target.
 * Owner-only admin functions (setFees / withdrawFees / emergencyUnstake*)
 * are deliberately excluded.
 */
export const STAKING_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'enum InkScoreStaking.LockPeriod', name: 'period', type: 'uint8' },
    ],
    name: 'stake',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'unstake',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalStaked',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'stakedCount',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: 'user', type: 'address' }],
    name: 'stakedTokensOf',
    outputs: [{ internalType: 'uint256[]', name: '', type: 'uint256[]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'stakeInfo',
    outputs: [
      { internalType: 'address', name: 'depositor', type: 'address' },
      { internalType: 'uint256', name: 'stakedAt', type: 'uint256' },
      { internalType: 'uint256', name: 'unlockAt', type: 'uint256' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'unlockAt',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'enum InkScoreStaking.LockPeriod', name: 'period', type: 'uint8' }],
    name: 'periodSeconds',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'pure',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'tokenId', type: 'uint256' }],
    name: 'isUnlocked',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'stakeFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'unstakeFee',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/** Custom errors surfaced to the UI through viem's revert decoding. */
export const STAKING_ERRORS_ABI = [
  {
    inputs: [
      { internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { internalType: 'uint256', name: 'unlockAt', type: 'uint256' },
    ],
    name: 'StakeLocked',
    type: 'error',
  },
] as const;

/**
 * Events used by the off-chain points system (server-side verification).
 * `Staked` carries the full position anchor (period, stakedAt, unlockAt) and
 * `Unstaked` the settle timestamp — both with indexed user/tokenId topics so
 * a claim is one cheap filtered eth_getLogs. Emergency unstakes (owner-only)
 * emit only `EmergencyUnstaked`; the settle timestamp comes from the block.
 */
export const STAKING_EVENTS_ABI = [
  {
    type: 'event',
    name: 'Staked',
    inputs: [
      { indexed: true, internalType: 'address', name: 'user', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { indexed: false, internalType: 'enum InkScoreStaking.LockPeriod', name: 'period', type: 'uint8' },
      { indexed: false, internalType: 'uint256', name: 'stakedAt', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'unlockAt', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Unstaked',
    inputs: [
      { indexed: true, internalType: 'address', name: 'user', type: 'address' },
      { indexed: true, internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { indexed: false, internalType: 'uint256', name: 'unstakedAt', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'EmergencyUnstaked',
    inputs: [
      { indexed: true, internalType: 'uint256', name: 'tokenId', type: 'uint256' },
      { indexed: true, internalType: 'address', name: 'returnedTo', type: 'address' },
    ],
  },
] as const;

/** Combined ABI for write flows so viem can decode custom revert errors. */
export const STAKING_WRITE_ABI = [...STAKING_ABI, ...STAKING_ERRORS_ABI] as const;

/** Minimal ERC-721 surface needed for approvals before staking. */
export const ERC721_MIN_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'operator', type: 'address' },
      { internalType: 'bool', name: 'approved', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'owner', type: 'address' },
      { internalType: 'address', name: 'operator', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const;

/* ------------------------------------------------------------------ */
/* Explorer API data access                                            */
/* ------------------------------------------------------------------ */

export interface ZenithNFT {
  /** Token ID (decimal string as returned by Blockscout) */
  id: string;
  /** https gateway URL or null when media unavailable */
  imageUrl: string | null;
  /** Display name, e.g. "InkScore Zenith #615" */
  name: string;
  /** Collection exchange rate (USD) from the explorer — null when unavailable */
  priceUsd: string | null;
}

interface RawInstance {
  id?: unknown;
  image_url?: unknown;
  token?: { exchange_rate?: unknown } | null;
}

async function getJSON<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Ink explorer API responded ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function normalizeInstance(raw: RawInstance): ZenithNFT | null {
  if (!raw || typeof raw.id !== 'string' || !/^\d+$/.test(raw.id)) return null;
  // On-chain metadata still carries the pre-reveal placeholder name, so the
  // display name is always derived from the collection name + token id.
  return {
    id: raw.id,
    imageUrl: typeof raw.image_url === 'string' ? raw.image_url : null,
    name: `InkScore Zenith #${raw.id}`,
    priceUsd:
      typeof raw.token?.exchange_rate === 'string' && raw.token.exchange_rate.length > 0
        ? raw.token.exchange_rate
        : null,
  };
}

/**
 * Fetch the Zenith token ids currently HELD by `wallet`.
 *
 * Served by /api/staking/held-nfts — a Blockscout instances lookup filtered
 * by holder address, cached per wallet server-side (20s) and on the CDN.
 * Pass `{ refresh: true }` after stake/unstake/transfer flows to force a
 * post-tx read instead of the cached one.
 */
export async function fetchHeldZenithIds(
  wallet: HexAddress,
  opts?: { refresh?: boolean }
): Promise<string[]> {
  const suffix = opts?.refresh ? '&refresh=1' : '';
  const res = await fetch(`/api/staking/held-nfts?wallet=${wallet}${suffix}`);
  if (!res.ok) {
    throw new Error(`Held-NFT lookup failed (${res.status})`);
  }
  const data = (await res.json()) as { ids?: unknown };
  if (!Array.isArray(data.ids)) return [];
  return data.ids.filter((id): id is string => typeof id === 'string' && /^\d+$/.test(id));
}

/**
 * Fetch metadata for a single token by ID (tolerant — resolves to null on
 * failure so one missing token never breaks a whole batch render).
 */
export async function fetchZenithById(tokenId: string): Promise<ZenithNFT | null> {
  try {
    const data = await getJSON<RawInstance>(
      `${EXPLORER_API_BASE}/tokens/${ZENITH_NFT_ADDRESS}/instances/${tokenId}`
    );
    return normalizeInstance(data);
  } catch {
    return null;
  }
}

/** Explorer URL for an NFT detail page. */
export function zenithExplorerUrl(tokenId: string): string {
  return `${EXPLORER_BASE_URL}/token/${ZENITH_NFT_ADDRESS}/instance/${tokenId}`;
}

/** Explorer URL for a transaction. */
export function transactionExplorerUrl(txHash: string): string {
  return `${EXPLORER_BASE_URL}/tx/${txHash}`;
}
