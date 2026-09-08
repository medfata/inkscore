"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useAccount, usePublicClient, useReadContract, useReadContracts, useWriteContract } from 'wagmi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatEther } from 'viem';
import { Logo } from '../components/Logo';
import { ConnectWalletButton } from '../components/ConnectWalletButton';
import { Coins, ExternalLink, Loader2, Lock, Menu, RefreshCw, X, Zap } from '../components/Icons';
import {
  ERC721_MIN_ABI,
  EXPLORER_BASE_URL,
  STAKING_ABI,
  STAKING_CONTRACT_ADDRESS,
  STAKING_CONFIGURED,
  STAKING_DURATIONS,
  STAKING_WRITE_ABI,
  ZENITH_NFT_ADDRESS,
  ZENITH_TOTAL_SUPPLY,
  fetchHeldZenithIds,
  fetchZenithById,
  transactionExplorerUrl,
  type HexAddress,
  type StakingDuration,
  type ZenithNFT,
} from '@/lib/staking-contract';
import { StakingCard, formatRemaining, type StakingMode, type StakingPhase } from '../components/StakingCard';
import { StakeModal } from '../components/StakeModal';
import { useSmoothPoints } from '../hooks/useSmoothPoints';

type OpKind = 'stake' | 'unstake';

interface ActiveOp {
  tokenId: string;
  kind: OpKind;
  phase: StakingPhase;
  /** Optional detail line shown in the status bar */
  detail?: string;
  errorMessage?: string;
}

/** Awaiting polling/refetch to reflect a just-confirmed tx on one card */
interface PendingSettle {
  tokenId: string;
  /** Mode the card must reach before the syncing state clears */
  expect: StakingMode;
}

/** Shorten RPC/wallet error messages for the UI */
function describeError(err: unknown): { message: string; rejected: boolean } {
  const e = err as Error & {
    shortMessage?: string;
    name?: string;
    data?: { errorName?: string; args?: readonly unknown[] };
  };
  if (e?.name === 'UserRejectedRequestError' || /user rejected|rejected the request/i.test(e?.message ?? '')) {
    return { message: 'You rejected the request.', rejected: true };
  }
  // Custom error decoded via STAKING_WRITE_ABI — friendly lock message.
  if (e?.data?.errorName === 'StakeLocked') {
    const unlockAt = Number(e.data.args?.[1] ?? 0);
    const remainingMs = unlockAt > 0 ? unlockAt * 1000 - Date.now() : 0;
    return {
      message: `This NFT is still locked — unlocks in ${formatRemaining(Math.max(0, remainingMs))}.`,
      rejected: false,
    };
  }
  const raw = e?.shortMessage || e?.message || 'Something went wrong.';
  return { message: raw.length > 160 ? `${raw.slice(0, 157)}…` : raw, rejected: false };
}

/** "1500000000000000" -> "0.0015 ETH"; zero/negative-free display helper */
function formatEthLabel(wei: bigint | undefined): string {
  if (!wei || wei <= BigInt(0)) return '';
  const trimmed = formatEther(wei).replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  return `${trimmed} ETH`;
}

const FALLBACK_NFT = (id: string): ZenithNFT => ({
  id,
  imageUrl: null,
  name: `InkScore Zenith #${id}`,
  priceUsd: null,
});

/** Official Zenith collection hero banner (OpenSea CDN). */
const ZENITH_BANNER_URL =
  'https://i2c.seadn.io/collection/inkscore-zenith/image_type_hero_desktop/afb3c710a890df59e10b8a7cbc0f0d/5fafb3c710a890df59e10b8a7cbc0f0d.png?w=2000';

const BUSY_PHASES = new Set<StakingPhase>(['signing', 'broadcasting', 'confirming']);

interface UnifiedNFT {
  token: ZenithNFT;
  mode: StakingMode;
}

export default function StakingPage() {
  const { address, isConnected } = useAccount();
  const publicClient = usePublicClient();

  /* ---------------------------- chain reads --------------------------- */
  const { data: stakeFeeWei } = useReadContract({
    address: STAKING_CONTRACT_ADDRESS,
    abi: STAKING_ABI,
    functionName: 'stakeFee',
    query: { enabled: STAKING_CONFIGURED },
  });

  const { data: unstakeFeeWei } = useReadContract({
    address: STAKING_CONTRACT_ADDRESS,
    abi: STAKING_ABI,
    functionName: 'unstakeFee',
    query: { enabled: STAKING_CONFIGURED },
  });

  const {
    data: totalStaked,
    isLoading: isLoadingTotal,
    refetch: refetchTotalStaked,
  } = useReadContract({
    address: STAKING_CONTRACT_ADDRESS,
    abi: STAKING_ABI,
    functionName: 'totalStaked',
    // Countdowns/points are local-clock math — polls only guard against
    // external changes. 60s (was 10s) keeps the keyless public RPC happy.
    query: { enabled: STAKING_CONFIGURED, staleTime: 30_000, refetchInterval: 60_000 },
  });

  const ready = STAKING_CONFIGURED && isConnected && !!address;

  const { data: stakedIdsRaw, refetch: refetchStakedIds } = useReadContract({
    address: STAKING_CONTRACT_ADDRESS,
    abi: STAKING_ABI,
    functionName: 'stakedTokensOf',
    args: address ? [address as HexAddress] : undefined,
    query: { enabled: ready, staleTime: 30_000, refetchInterval: 60_000 },
  });

  const { data: isApprovedForAll, refetch: refetchApproval } = useReadContract({
    address: ZENITH_NFT_ADDRESS,
    abi: ERC721_MIN_ABI,
    functionName: 'isApprovedForAll',
    args: address && STAKING_CONFIGURED ? [address as HexAddress, STAKING_CONTRACT_ADDRESS] : undefined,
    query: { enabled: ready },
  });

  /* ------------------------- held NFTs (fast) ------------------------- */
  const {
    data: heldIdsRaw,
    isLoading: holdingsLoading,
    isError: holdingsError,
    refetch: refetchHoldings,
  } = useQuery({
    queryKey: ['zenith-holdings', address],
    queryFn: () => fetchHeldZenithIds(address as HexAddress),
    enabled: ready,
    staleTime: 15_000,
    refetchOnWindowFocus: false,
    refetchInterval: 30_000,
  });

  /** Held NFTs — ids from the cached on-chain scan, names derived client-side. */
  const heldNfts = useMemo(
    () =>
      (heldIdsRaw ?? []).map((id) => ({
        id,
        imageUrl: null,
        name: `InkScore Zenith #${id}`,
        priceUsd: null,
      })),
    [heldIdsRaw]
  );

  /* --------------------- explorer: staked metadata -------------------- */
  const stakedIds = useMemo(
    () => (stakedIdsRaw ?? []).map((id: bigint) => id.toString()),
    [stakedIdsRaw]
  );
  const [stakedMeta, setStakedMeta] = useState<Record<string, ZenithNFT>>({});
  const inflightIds = useRef(new Set<string>());

  useEffect(() => {
    let cancelled = false;
    const missing = stakedIds.filter((id) => !stakedMeta[id] && !inflightIds.current.has(id));
    if (!missing.length) return;
    missing.forEach((id) => inflightIds.current.add(id));

    void Promise.all(
      missing.map(async (id) => {
        const nft = (await fetchZenithById(id)) ?? FALLBACK_NFT(id);
        if (!cancelled) {
          setStakedMeta((prev) => ({ ...prev, [id]: nft }));
        }
        inflightIds.current.delete(id);
      })
    );

    return () => {
      cancelled = true;
    };
  }, [stakedIds]); // eslint-disable-line react-hooks/exhaustive-deps -- refresh metadata only when the id list changes

  /* ---------------------- stake flow state ---------------------------- */
  /** NFT awaiting lock-period choice in the stake modal. */
  const [stakeModalToken, setStakeModalToken] = useState<ZenithNFT | null>(null);

  /* ------------------- staked locks (stakeInfo batch) ----------------- */
  const stakeInfoContracts = useMemo(
    () =>
      stakedIds.map((id: string) => ({
        address: STAKING_CONTRACT_ADDRESS,
        abi: STAKING_ABI,
        functionName: 'stakeInfo' as const,
        args: [BigInt(id)] as const,
      })),
    [stakedIds]
  );

  const { data: stakeInfos, refetch: refetchStakeInfos } = useReadContracts({
    contracts: stakeInfoContracts,
    query: { enabled: ready && stakedIds.length > 0, staleTime: 30_000, refetchInterval: 60_000 },
  });

  /** tokenId → { stakedAtSec, unlockAtSec } for countdowns / lock badges */
  const lockInfoById = useMemo(() => {
    const map: Record<string, { stakedAtSec: number; unlockAtSec: number }> = {};
    if (!stakeInfos) return map;
    for (let i = 0; i < stakedIds.length && i < stakeInfos.length; i++) {
      const res = stakeInfos[i];
      if (res?.status === 'success' && res.result) {
        const [, stakedAt, unlockAt] = res.result;
        map[stakedIds[i]] = { stakedAtSec: Number(stakedAt), unlockAtSec: Number(unlockAt) };
      }
    }
    return map;
  }, [stakeInfos, stakedIds]);

  /** Resolve the human label of a lock from its exact duration in seconds. */
  const durationLabelFor = useCallback((stakedAtSec: number, unlockAtSec: number): string => {
    const diff = unlockAtSec - stakedAtSec;
    const match = STAKING_DURATIONS.find((d) => Math.abs(d.seconds - diff) < 60);
    return match?.label ?? formatRemaining(diff * 1000);
  }, []);

  /* ------------------- staking points (flat tiers) -------------------- */
  // Points are now flat tiers on the staked count (1 → 2k, 2-8 → 4k,
  // >8 → 6k), credited to the main inkscore wallet score server-side.
  // The old per-day accrual/anchor/claim flow was removed.
  const stakedCount = stakedIds.length;

  /* --------------------------- write flows ---------------------------- */
  const [activeOp, setActiveOp] = useState<ActiveOp | null>(null);
  const [pendingSettle, setPendingSettle] = useState<PendingSettle | null>(null);
  const opRequestRef = useRef(0);
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const busyTokenId = activeOp && BUSY_PHASES.has(activeOp.phase) ? activeOp.tokenId : null;

  const refreshHeldIds = useCallback(async () => {
    // Force a server-side fresh scan after a tx, then write the result
    // straight into the query cache — the background 30s poll alone would
    // leave the held list trailing the chain for up to the server TTL.
    // On failure keep the previous data; the poll settles it later.
    if (!address) return;
    try {
      const ids = await fetchHeldZenithIds(address as HexAddress, { refresh: true });
      queryClient.setQueryData(['zenith-holdings', address], ids);
    } catch {
      // Previous data stays; a failed refresh must never empty the grid.
    }
  }, [address, queryClient]);

  const refreshAll = useCallback(() => {
    // Held NFTs are refreshed explicitly with refresh=1 (above) so the
    // server scan reflects the just-confirmed tx; staked ids come from
    // direct chain reads here. 'zenith-images' keys off unifiedIdsKey,
    // so it refetches on its own.
    return Promise.all([
      refetchStakedIds(),
      refetchTotalStaked(),
      refetchStakeInfos(),
      refreshHeldIds(),
    ]);
  }, [refetchStakedIds, refetchTotalStaked, refetchStakeInfos, refreshHeldIds]);

  const runTx = useCallback(
    async (kind: OpKind, tokenId: string, duration?: StakingDuration['index']) => {
      if (!ready || !address || !publicClient) return;
      const requestAtStart = ++opRequestRef.current;
      setActiveOp({ tokenId, kind, phase: 'signing' });

      try {
        if (kind === 'stake' && isApprovedForAll !== true) {
          setActiveOp((p) =>
            p?.tokenId === tokenId ? { ...p, detail: 'Granting staking approval…' } : p
          );
          const approveHash = await writeContractAsync({
            address: ZENITH_NFT_ADDRESS,
            abi: ERC721_MIN_ABI,
            functionName: 'setApprovalForAll',
            args: [STAKING_CONTRACT_ADDRESS, true],
          });
          await publicClient.waitForTransactionReceipt({ hash: approveHash });
          void refetchApproval();
        }

        if (requestAtStart !== opRequestRef.current) return;

        setActiveOp((p) =>
          p?.tokenId === tokenId ? { ...p, phase: 'broadcasting', detail: undefined } : p
        );
        const value = kind === 'stake' ? stakeFeeWei : unstakeFeeWei;
        const hash = await writeContractAsync({
          address: STAKING_CONTRACT_ADDRESS,
          abi: STAKING_WRITE_ABI,
          functionName: kind,
          // stake(tokenId, LockPeriod) — duration picked in the stake modal.
          args: kind === 'stake' ? [BigInt(tokenId), duration ?? 0] : [BigInt(tokenId)],
          ...(value !== undefined ? { value } : {}),
        });

        if (requestAtStart !== opRequestRef.current) return;
        setActiveOp((p) =>
          p?.tokenId === tokenId ? { ...p, phase: 'confirming', detail: transactionExplorerUrl(hash) } : p
        );

        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (requestAtStart !== opRequestRef.current) return;

        if (receipt.status !== 'success') {
          throw new Error('The transaction reverted on-chain.');
        }

        // Confirmed — refresh everything immediately so the UI always shows
        // the live on-chain state, keep the success pulse for a beat.
        refreshAll();
        setActiveOp((p) =>
          p?.tokenId === tokenId
            ? { ...p, phase: 'success', detail: transactionExplorerUrl(hash) }
            : p
        );
        // The card may keep its pre-tx mode until a refetch/poll picks up
        // the new chain state — show a per-card syncing state until then.
        setPendingSettle({ tokenId, expect: kind === 'stake' ? 'staked' : 'available' });
        window.setTimeout(() => {
          if (requestAtStart === opRequestRef.current) setActiveOp(null);
        }, 1300);
        // Failsafe: never leave a card syncing forever.
        window.setTimeout(() => {
          setPendingSettle((p) => (p?.tokenId === tokenId ? null : p));
        }, 45_000);
        // RPC reads can briefly lag the receipt (indexing delay) — re-sync
        // once more so card states never wait for a tab focus or poll tick.
        window.setTimeout(() => {
          if (requestAtStart === opRequestRef.current) refreshAll();
        }, 3_500);
      } catch (err) {
        const { message, rejected } = describeError(err);
        setActiveOp((p) => {
          if (!p || p.tokenId !== tokenId) return p;
          return rejected
            ? null // silent back to idle on wallet-cancel
            : { ...p, phase: 'error', errorMessage: message, detail: undefined };
        });
      }
    },
    [ready, address, publicClient, isApprovedForAll, stakeFeeWei, unstakeFeeWei, writeContractAsync, refetchApproval, refreshAll]
  );

  const dismissOp = useCallback(() => setActiveOp(null), []);

  /* ----------------- unified collection (held + staked) ---------------- */
  const unified: UnifiedNFT[] = useMemo(() => {
    const stakedIdSet = new Set(stakedIds);
    const held = heldNfts ?? [];
    const heldIds = new Set(held.map((t) => t.id));

    const list: UnifiedNFT[] = [];
    // Staked first — NFTs currently escrowed by the staking contract.
    for (const id of stakedIds) {
      list.push({ token: stakedMeta[id] ?? FALLBACK_NFT(id), mode: 'staked' });
    }
    // Everything the wallet holds (excluding anything the chain says is staked).
    for (const token of held) {
      if (!stakedIdSet.has(token.id)) list.push({ token, mode: 'available' });
    }
    // Bridge for explorer indexing lag: after an unstake, the token is no
    // longer staked on-chain but the holder API may not list it for a few
    // seconds. Keep it visible using the metadata we already fetched.
    for (const [id, meta] of Object.entries(stakedMeta)) {
      if (!stakedIdSet.has(id) && !heldIds.has(id)) {
        list.push({ token: meta, mode: 'available' });
      }
    }

    return list.sort((a, b) => Number(a.token.id) - Number(b.token.id));
  }, [stakedIds, stakedMeta, heldNfts]);

  /* ------- settle: clear the syncing state once the outcome shows ------ */
  useEffect(() => {
    if (!pendingSettle) return;
    const match = unified.find((u) => u.token.id === pendingSettle.tokenId);
    if (match?.mode === pendingSettle.expect) {
      setPendingSettle(null);
    }
  }, [pendingSettle, unified]);

  /* ------------------- OpenSea CDN image resolution ------------------- */
  const unifiedIdsKey = unified.map((u) => u.token.id).join(',');
  const { data: imageOverrides } = useQuery({
    queryKey: ['zenith-images', unifiedIdsKey],
    queryFn: async (): Promise<Record<string, string | null>> => {
      const res = await fetch(`/api/staking/nft-images?ids=${unifiedIdsKey}`);
      if (!res.ok) return {};
      const data = (await res.json()) as { images?: Record<string, string | null> };
      return data.images ?? {};
    },
    enabled: ready && unified.length > 0,
    staleTime: 24 * 60 * 60 * 1000,
    gcTime: 24 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  /** True while the authoritative (chain/OpenSea) image URLs are still resolving */
  const imagesPending = ready && imageOverrides === undefined;

  useEffect(() => () => {
    // Clear transient UI state if the wallet disconnects mid-flow
    setActiveOp(null);
    setPendingSettle(null);
  }, [isConnected]);

  const stakeFeeLabel = formatEthLabel(stakeFeeWei);
  const unstakeFeeLabel = formatEthLabel(unstakeFeeWei);

  /* ================================ UI =============================== */

  const navItems = (
    <>
      <Link href="/how-it-works" className="text-sm font-medium text-slate-400 hover:text-white transition-colors relative group">
        How it Works
        <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-ink-purple group-hover:w-full transition-all duration-300"></span>
      </Link>
      <Link href="/leaderboard" className="text-sm font-medium text-slate-400 hover:text-white transition-colors relative group">
        Leaderboard
        <span className="absolute -bottom-1 left-0 w-0 h-0.5 bg-ink-purple group-hover:w-full transition-all duration-300"></span>
      </Link>
      <Link href="/staking" className="text-sm font-medium text-white relative">
        Staking
        <span className="absolute -bottom-1 left-0 w-full h-0.5 bg-ink-purple"></span>
      </Link>
    </>
  );

  return (
    <div className="bg-ink-950 min-h-screen text-slate-200 font-sans selection:bg-ink-purple selection:text-white">
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 border-b border-white/5 bg-ink-950/80 backdrop-blur-md">
        <MobileAwareNav items={navItems} />
      </nav>

      <main className="pt-32 pb-20 px-4 md:px-6 relative overflow-hidden">
        {/* Ambient blobs */}
        <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
          <div className="absolute top-24 left-1/4 w-72 h-72 rounded-full bg-purple-600/10 blur-3xl animate-blob" />
          <div className="absolute top-52 right-1/4 w-64 h-64 rounded-full bg-blue-600/10 blur-3xl animate-blob animation-delay-2000" />
        </div>

        {/* Hero */}
        <header className="max-w-7xl mx-auto mb-12 animate-fade-in-up">
          {/* Collection banner */}
          <div className="relative overflow-hidden rounded-3xl border border-white/10 shadow-2xl shadow-purple-950/30">
            <img
              src={ZENITH_BANNER_URL}
              alt="InkScore Zenith collection"
              className="h-52 w-full object-cover md:h-72"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-950 via-ink-950/55 to-transparent" />

            {/* Explorer links — pinned to the banner's top-right */}
            <div className="absolute top-4 right-4 z-10 flex flex-wrap justify-end gap-3 md:top-6 md:right-6">
              <StatChip
                icon={<ExternalLink size={14} />}
                value="InkScore Zenith"
                tone="slate"
                href={`${EXPLORER_BASE_URL}/token/${ZENITH_NFT_ADDRESS}`}
              />
              <StatChip
                icon={<ExternalLink size={14} />}
                value="Staking contract"
                tone="purple"
                href={`${EXPLORER_BASE_URL}/address/${STAKING_CONTRACT_ADDRESS}`}
              />
            </div>
          </div>
        </header>

        {!STAKING_CONFIGURED ? (
          <ComingSoonPanel />
        ) : !isConnected ? (
          <section className="max-w-md mx-auto text-center py-20 animate-fade-in-up">
            <div className="glass-card rounded-3xl border border-white/5 p-10">
              <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
                <Lock size={28} className="text-purple-400" />
              </div>
              <h2 className="text-xl font-bold text-white mb-2">Connect your wallet</h2>
              <p className="text-slate-400 mb-8 text-sm">Your Zenith NFTs and staking positions live on Ink Chain.</p>
              <ConnectWalletButton size="lg" />
            </div>
          </section>
        ) : (
          <div className="max-w-7xl mx-auto space-y-8">
            {/* Status bar */}
            {activeOp && (
              <StatusBar op={activeOp} onDismiss={dismissOp} />
            )}

            {/* Staking points (flat tiers on the staked count) */}
            <div className="flex justify-end">
              <StakingPointsPill staked={stakedCount} />
            </div>

            {/* Collection-wide staking progress (updates on every stake/unstake) */}
            <StakingProgressBar staked={totalStaked} loading={isLoadingTotal} />

            {/* Unified collection */}
            <section aria-label="Your Zenith collection">
              {holdingsLoading ? (
                <SkeletonGrid />
              ) : unified.length === 0 ? (
                holdingsError ? (
                  // Only surface the error when we have NOTHING to render —
                  // a failed background refetch must never hide live data.
                  <div className="glass-card rounded-2xl p-10 text-center border-red-500/20">
                    <p className="text-slate-400 mb-4 text-sm">Couldn&apos;t load your collection.</p>
                    <button
                      onClick={() => void refetchHoldings()}
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-purple-500/15 border border-purple-500/40 text-purple-300 hover:bg-purple-500/25 transition-colors text-sm"
                    >
                      <RefreshCw size={14} /> Try again
                    </button>
                  </div>
                ) : (
                  <div className="text-center py-16 animate-fade-in">
                    <div className="mx-auto mb-4 w-14 h-14 rounded-full bg-slate-800/50 border border-slate-700 flex items-center justify-center">
                      <Coins size={26} className="text-slate-600" />
                    </div>
                    <p className="text-slate-300 font-medium">No Zenith NFTs found</p>
                    <p className="text-slate-500 text-sm mt-1">
                      This wallet doesn&apos;t hold or stake any InkScore Zenith NFTs yet.
                    </p>
                  </div>
                )
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-5">
                  {unified.map(({ token, mode }, index) => {
                    const lock = lockInfoById[token.id];
                    return (
                      <StakingCard
                        key={`${mode === 'staked' ? 's' : 'h'}-${token.id}`}
                        token={token}
                        mode={mode}
                        index={index}
                        feeLabel={mode === 'staked' ? unstakeFeeLabel : stakeFeeLabel}
                        otherActionPending={!!busyTokenId}
                        imageUrl={imageOverrides?.[token.id] ?? null}
                        imagePending={imagesPending}
                        phase={
                          activeOp?.tokenId === token.id ? activeOp.phase : 'idle'
                        }
                        syncing={pendingSettle?.tokenId === token.id}
                        errorMessage={activeOp?.errorMessage}
                        stakedAtSec={mode === 'staked' ? lock?.stakedAtSec : undefined}
                        unlockAtSec={mode === 'staked' ? lock?.unlockAtSec : undefined}
                        durationLabel={
                          mode === 'staked' && lock
                            ? durationLabelFor(lock.stakedAtSec, lock.unlockAtSec)
                            : undefined
                        }
                        onAction={() =>
                          mode === 'available'
                            ? setStakeModalToken(token)
                            : void runTx('unstake', token.id)
                        }
                      />
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* Stake lock-period modal */}
        {stakeModalToken && (
          <StakeModal
            token={stakeModalToken}
            feeLabel={stakeFeeLabel}
            imageUrl={imageOverrides?.[stakeModalToken.id] ?? null}
            onClose={() => setStakeModalToken(null)}
            onConfirm={(duration) => {
              const token = stakeModalToken;
              setStakeModalToken(null);
              if (token) void runTx('stake', token.id, duration);
            }}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-800 bg-ink-950 py-12 px-6 mt-auto relative z-10">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6">
          <div className="flex items-center gap-2 opacity-50 grayscale hover:grayscale-0 transition-all duration-500">
            <Logo size="sm" showText={false} />
            <span className="text-slate-500 text-sm">&copy; 2026 INKSCORE.</span>
          </div>
          <div className="flex gap-6">
            <a href="/about" className="text-slate-500 hover:text-white transition-colors">About</a>
            <a href="/how-it-works" className="text-slate-500 hover:text-white transition-colors">Documentation</a>
            <a href="https://x.com/Inkscore" target="_blank" rel="noopener noreferrer" className="text-slate-500 hover:text-white transition-colors">Twitter</a>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ==================================================================== */
/* Local presentational helpers                                         */
/* ==================================================================== */

function StatChip({
  icon,
  label,
  value,
  tone,
  href,
}: {
  icon: React.ReactNode;
  label?: string;
  value: string;
  tone: 'emerald' | 'purple' | 'slate';
  href?: string;
}) {
  const tones: Record<string, string> = {
    emerald: 'border-emerald-400/30 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25',
    purple: 'border-purple-400/30 bg-purple-500/15 text-purple-300 hover:bg-purple-500/25',
    slate: 'border-white/15 bg-white/10 text-white hover:bg-white/20',
  };
  const content = (
    <span
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-xs backdrop-blur-md transition-colors ${tones[tone]}`}
    >
      {icon}
      <span className="font-semibold">{value}</span>
      {label ? <span className="text-slate-400">{label}</span> : null}
    </span>
  );
  return href ? (
    <a href={href} target="_blank" rel="noopener noreferrer" className="hover:-translate-y-0.5 transition-transform">
      {content}
    </a>
  ) : (
    content
  );
}

/**
 * Collection staking-points total: flat tiers on the currently-staked count —
 * 1 staked → 2,000 pts · 2-8 → 4,000 pts · 9+ → 6,000 pts. These points are
 * part of the main inkscore wallet score (points-service-v2), credited
 * server-side; the pill mirrors the tier the wallet currently sits in.
 */
function StakingPointsPill({ staked }: { staked: number }) {
  const points = staked > 8 ? 6000 : staked >= 2 ? 4000 : staked >= 1 ? 2000 : 0;
  const display = useSmoothPoints(points);

  return (
    <div
      className="glass-card animate-fade-in inline-flex items-center gap-2 rounded-full border border-emerald-500/20 px-4 py-2"
      title="Points earned by staked NFTs — 2,000 for 1 staked, 4,000 for 2-8, 6,000 for 9+"
    >
      <Zap size={14} className="shrink-0 text-emerald-400" />
      <span className="text-sm font-bold tabular-nums text-white">
        {Math.round(display).toLocaleString('en-US')}
      </span>
      <span className="text-xs font-medium text-slate-400">pts</span>
      <span className="hidden text-[10px] font-semibold uppercase tracking-wider text-slate-500 md:inline">
        Staking points
      </span>
    </div>
  );
}

/**
 * Collection-wide staking progress: staked Zeniths vs the fixed 888 supply.
 * Reads the same `totalStaked` wagmi result as the rest of the page, so it
 * re-renders (and the width transition animates) on every refetch — e.g. the
 * immediate `refreshAll()` after a confirmed stake/unstake or the 10s poll.
 */
function StakingProgressBar({
  staked,
  loading,
}: {
  staked: bigint | undefined;
  loading: boolean;
}) {
  const current = staked === undefined ? 0 : Number(staked);
  const clamped = Math.min(Math.max(current, 0), ZENITH_TOTAL_SUPPLY);
  const percent = (clamped / ZENITH_TOTAL_SUPPLY) * 100;
  const complete = percent >= 100;
  // A single NFT is ~0.1% — keep a visible sliver once anything is staked.
  const width = loading ? 0 : Math.max(percent, clamped > 0 ? 3 : 0);

  return (
    <div>
      <div className="flex items-end justify-between gap-4 mb-2.5">
        <span className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-slate-400">
          <Lock
            size={13}
            className={complete ? 'text-emerald-400' : 'text-purple-400'}
          />
          {complete ? 'Fully staked' : 'Zenith staked'}
        </span>
        {loading ? (
          <span className="text-sm text-slate-500">loading…</span>
        ) : (
          <span className="flex items-baseline gap-2">
            <span className="text-xl font-bold text-white tabular-nums">{clamped}</span>
            <span className="text-sm text-slate-400">/ {ZENITH_TOTAL_SUPPLY}</span>
            <span className="text-xs font-semibold text-purple-300 tabular-nums">
              {percent.toFixed(1)}%
            </span>
          </span>
        )}
      </div>
      <div
        role="progressbar"
        aria-label="Zenith NFTs staked"
        aria-valuemin={0}
        aria-valuemax={ZENITH_TOTAL_SUPPLY}
        aria-valuenow={loading ? undefined : clamped}
        className="relative h-3 rounded-full bg-black/40 border border-white/10 overflow-hidden"
      >
        {loading ? (
          <div className="absolute inset-0 skeleton" />
        ) : (
          <div
            className={`absolute inset-y-0 left-0 rounded-full overflow-hidden bg-gradient-to-r shadow-lg transition-[width] duration-700 ease-out ${
              complete
                ? 'from-emerald-500 to-emerald-300 shadow-emerald-500/50'
                : 'from-ink-purple via-ink-accent to-blue-400 shadow-purple-500/50'
            }`}
            style={{ width: `${width}%` }}
          >
            <span aria-hidden className="progress-shimmer" />
          </div>
        )}
      </div>
      <p className="mt-2.5 text-xs text-slate-500">
        {complete
          ? 'Every Zenith is staked — the collection is fully committed.'
          : 'Every staked Zenith strengthens the on-chain reputation layer.'}
      </p>
    </div>
  );
}

function StatusBar({ op, onDismiss }: { op: ActiveOp; onDismiss: () => void }) {
  const texts: Record<string, string> = {
    signing: op.detail ?? 'Waiting for you in your wallet…',
    broadcasting: op.detail
      ? 'Approval broadcast — waiting to confirm…'
      : `${op.kind === 'stake' ? 'Staking' : 'Unstaking'} #${op.tokenId}…`,
    confirming: 'Waiting for confirmation…',
    error: '',
    success: '',
    idle: '',
  };
  const success = op.phase === 'success';
  return (
    <div
      role="status"
      aria-live="polite"
      className={`glass-card rounded-2xl px-5 py-4 flex items-center gap-3 animate-fade-in max-w-3xl mx-auto ${
        success ? 'border-emerald-500/40' : 'border-purple-500/30'
      }`}
    >
      <Loader2
        size={18}
        className={`animate-spin shrink-0 ${success ? 'text-emerald-400' : 'text-purple-400'}`}
      />
      <p className="text-sm text-slate-300 flex-1 truncate">
        {success
          ? `${op.kind === 'stake' ? 'Staked' : 'Unstaked'} #${op.tokenId} — collection updated.`
          : texts[op.phase]}
      </p>
      {op.detail?.startsWith('http') && (
        <a
          href={op.detail}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-medium text-purple-300 hover:text-purple-200 flex items-center gap-1 shrink-0"
        >
          View <ExternalLink size={12} />
        </a>
      )}
      {(op.phase === 'error' || success) && (
        <button onClick={onDismiss} className="text-slate-500 hover:text-white" aria-label="Dismiss">
          <X size={16} />
        </button>
      )}
    </div>
  );
}

function ComingSoonPanel() {
  return (
    <section className="max-w-md mx-auto text-center py-20 animate-fade-in-up">
      <div className="glass-card rounded-3xl border border-white/5 p-10">
        <div className="mx-auto mb-6 w-16 h-16 rounded-full bg-slate-800/70 border border-white/10 flex items-center justify-center">
          <Lock size={28} className="text-slate-500" />
        </div>
        <h2 className="text-xl font-bold text-white mb-2">Staking launches soon</h2>
        <p className="text-slate-400 text-sm">
          The InkScore Staking contract hasn&apos;t been deployed yet. Check back shortly.
        </p>
      </div>
    </section>
  );
}

function SkeletonGrid({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 md:gap-5">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl overflow-hidden glass-card border border-white/5" style={{ animationDelay: `${i * 60}ms` }}>
          <div className="skeleton aspect-[4/5]" />
        </div>
      ))}
    </div>
  );
}

/** Nav shell shared by mobile/desktop states. Mirrors leaderboard styling. */
function MobileAwareNav({ items }: { items: React.ReactNode }) {
  const [openMenu, setOpenMenu] = useState(false);
  return (
    <div>
      <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
        <Link href="/" className="cursor-pointer hover:opacity-90 transition-opacity">
          <Logo size="sm" />
        </Link>
        <div className="hidden md:flex items-center gap-8">{items}</div>
        <button
          className="md:hidden text-slate-400 hover:text-white"
          onClick={() => setOpenMenu((v) => !v)}
          aria-expanded={openMenu}
          aria-label="Toggle navigation"
        >
          {openMenu ? <X /> : <Menu />}
        </button>
      </div>
      {openMenu && (
        <div className="md:hidden bg-ink-900 border-b border-slate-800 p-6 space-y-4 animate-fade-in-up">
          <Link href="/" className="block text-slate-300">Home</Link>
          <Link href="/how-it-works" className="block text-slate-300">How it Works</Link>
          <Link href="/leaderboard" className="block text-slate-300">Leaderboard</Link>
          <Link href="/staking" className="block text-white font-semibold">Staking</Link>
        </div>
      )}
    </div>
  );
}
