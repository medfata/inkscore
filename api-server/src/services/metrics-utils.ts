// Shared helpers for metric computations. Extracted so swap/tydro/bridge
// services don't duplicate them; backup_wallet.ts still carries its own
// copies until tydro extraction completes (Sprint 1, incremental).

// Safe wei -> ETH: one malformed `value` must not throw and wipe a whole
// flow's volume.
export function safeWeiToEth(value: string | null | undefined): number {
    if (!value || value === '0') return 0;
    try {
        return Number(BigInt(value)) / 1e18;
    } catch {
        return 0;
    }
}

// Bounded parallel map (concurrency cap so we don't spike DeFi Llama /
// Blockscout). Preserves input order.
export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
    const results: R[] = new Array(items.length);
    let next = 0;
    const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
        while (next < items.length) {
            const idx = next++;
            results[idx] = await fn(items[idx]);
        }
    });
    await Promise.all(workers);
    return results;
}
