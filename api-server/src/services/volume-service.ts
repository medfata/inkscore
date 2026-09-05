import { withInflight } from '../cache';
import { getNativeOutflow } from './blockscout-service';
import { priceService } from './price-service';

export interface TotalVolumeResponse {
    totalEth: number;
    totalUsd: number;
    txCount: number;
    incoming: {
        eth: number;
        usd: number;
        count: number;
    };
    outgoing: {
        eth: number;
        usd: number;
        count: number;
    };
    partial?: boolean;
}

export async function getTotalVolumeData(walletAddress: string): Promise<TotalVolumeResponse> {
    // The 30-page outflow walk is shared, not repeated, when the
    // frontend + score fire together.
    return withInflight<TotalVolumeResponse>('long:wallet:volume:' + walletAddress, async () => {
        const ethPrice = await priceService.getCurrentPrice().catch(() => 3500);
        // Circulated volume = native ETH sent (status ok), via Blockscout
        // with incremental refresh (see blockscout-service).
        const { outWei, count: outgoingCount, complete: volumeComplete } =
            await getNativeOutflow(walletAddress);
        let outgoingEth = 0;
        try {
            outgoingEth = Number(BigInt(outWei || '0')) / 1e18;
        } catch {
            outgoingEth = 0;
        }

        const incomingEth = 0;
        const incomingCount = 0;

        const totalEth = outgoingEth + incomingEth;
        const totalUsd = totalEth * ethPrice;

        const response: TotalVolumeResponse = {
            totalEth,
            totalUsd,
            txCount: outgoingCount + incomingCount,
            partial: !volumeComplete,
            incoming: {
                eth: incomingEth,
                usd: incomingEth * ethPrice,
                count: incomingCount,
            },
            outgoing: {
                eth: outgoingEth,
                usd: outgoingEth * ethPrice,
                count: outgoingCount,
            },
        };

        return response;
    });
}
