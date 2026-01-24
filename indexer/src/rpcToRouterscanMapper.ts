/**
 * RPC to Routerscan Mapper
 * 
 * Transforms RPC transaction + receipt responses to match Routerscan's format.
 * This allows using RPC data with the same structure as Routerscan API.
 */

// Routerscan-style transaction format
export interface RouterscanTx {
    chainId: string;
    blockNumber: number;
    txIndex: number;
    timestamp: string;
    from: {
        id: string;
        isContract: boolean;
    };
    to: {
        id: string;
        isContract: boolean;
    };
    blockHash: string;
    txHash: string;
    value: string;
    gasLimit: string;
    gasUsed: string;
    gasPrice: string;
    effectiveGasPrice: string;
    burnedFees: string;
    methodId: string | null;
    method: string | null;
    status: boolean;
    nonce: number;
    type: number;
    input: string;
    logs: RouterscanLog[];
    // L1 fields (for L2 chains like Ink/Optimism)
    l1GasPrice: string | null;
    l1GasUsed: string | null;
    l1Fee: string | null;
    l1BaseFeeScalar: string | null;
    l1BlobBaseFee: string | null;
    l1BlobBaseFeeScalar: string | null;
    // EIP-1559 fields
    maxFeePerGas: string | null;
    maxPriorityFeePerGas: string | null;
}

export interface RouterscanLog {
    index: number;
    address: {
        id: string;
        isContract: boolean;
    };
    topics: string[];
    data: string;
    removed: boolean;
    event: string | null;
}

// RPC response types
interface RpcTransaction {
    hash: string;
    blockNumber: string;
    blockHash: string;
    transactionIndex: string;
    from: string;
    to: string | null;
    value: string;
    gas: string;
    gasPrice: string;
    input: string;
    nonce: string;
    type?: string;
    maxFeePerGas?: string;
    maxPriorityFeePerGas?: string;
    chainId?: string;
    accessList?: any[];
}

interface RpcReceipt {
    transactionHash: string;
    blockNumber: string;
    blockHash: string;
    transactionIndex: string;
    from: string;
    to: string | null;
    gasUsed: string;
    effectiveGasPrice: string;
    status: string;
    logs: RpcLog[];
    contractAddress?: string;
    // L1 fields
    l1GasPrice?: string;
    l1GasUsed?: string;
    l1Fee?: string;
    l1BaseFeeScalar?: string;
    l1BlobBaseFee?: string;
    l1BlobBaseFeeScalar?: string;
}

interface RpcLog {
    address: string;
    topics: string[];
    data: string;
    logIndex: string;
    removed: boolean;
    blockTimestamp?: string;
}

// Known method signatures (4byte directory subset)
const METHOD_SIGNATURES: Record<string, string> = {
    // ERC20
    '0xa9059cbb': 'transfer(address,uint256)',
    '0x23b872dd': 'transferFrom(address,address,uint256)',
    '0x095ea7b3': 'approve(address,uint256)',
    // Common DEX
    '0x38ed1739': 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
    '0x7ff36ab5': 'swapExactETHForTokens(uint256,address[],address,uint256)',
    '0x18cbafe5': 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
    '0x3593564c': 'execute(bytes,bytes[],uint256)',
    // InkyPump specific
    '0x6d97786e': 'sell(address,uint256,string)',
    '0xa6f2ae3a': 'buy()',
    '0xd96a094a': 'buy(uint256)',
    // NFT
    '0x42842e0e': 'safeTransferFrom(address,address,uint256)',
    '0xb88d4fde': 'safeTransferFrom(address,address,uint256,bytes)',
    // Misc
    '0x': 'transfer()', // Native ETH transfer
};

// Known event signatures
const EVENT_SIGNATURES: Record<string, string> = {
    '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef': 'Transfer(address,address,uint256)',
    '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925': 'Approval(address,address,uint256)',
    '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62': 'TransferSingle(address,address,address,uint256,uint256)',
    '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb': 'TransferBatch(address,address,address,uint256[],uint256[])',
    '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822': 'Swap(address,uint256,uint256,uint256,uint256,address)',
    '0x4b5824a0f21039d7160b2a57d8c140cae3ba13e4f15bcd879cc63e4964681a9e': 'Trade(address,uint256,uint256,uint256,address,uint256,uint256,bytes)',
};

/**
 * Convert hex string to decimal string
 */
function hexToDecimal(hex: string): string {
    if (!hex || hex === '0x') return '0';
    return BigInt(hex).toString();
}

/**
 * Convert hex to number
 */
function hexToNumber(hex: string): number {
    if (!hex || hex === '0x') return 0;
    return parseInt(hex, 16);
}

/**
 * Get method name from method ID
 */
function getMethodName(methodId: string | null): string | null {
    if (!methodId) return null;
    return METHOD_SIGNATURES[methodId.toLowerCase()] || null;
}

/**
 * Get event name from topic0
 */
function getEventName(topic0: string | null): string | null {
    if (!topic0) return null;
    return EVENT_SIGNATURES[topic0.toLowerCase()] || null;
}

/**
 * Extract method ID from input data
 */
function extractMethodId(input: string): string | null {
    if (!input || input === '0x' || input.length < 10) return null;
    return input.slice(0, 10).toLowerCase();
}

/**
 * Calculate burned fees (for EIP-1559 transactions)
 * burnedFees = gasUsed * baseFee
 * Since we don't have baseFee directly, we approximate:
 * baseFee = effectiveGasPrice - maxPriorityFeePerGas (for type 2 txs)
 */
function calculateBurnedFees(
    gasUsed: string,
    effectiveGasPrice: string,
    maxPriorityFeePerGas?: string
): string {
    const gasUsedBn = BigInt(gasUsed);
    const effectivePriceBn = BigInt(effectiveGasPrice);
    
    if (maxPriorityFeePerGas) {
        const priorityFeeBn = BigInt(maxPriorityFeePerGas);
        const baseFee = effectivePriceBn - priorityFeeBn;
        if (baseFee > 0n) {
            return (gasUsedBn * baseFee).toString();
        }
    }
    
    // Fallback: assume all gas price is burned (legacy tx approximation)
    return (gasUsedBn * effectivePriceBn).toString();
}

/**
 * Convert block timestamp hex to ISO string
 */
function hexTimestampToISO(hexTimestamp: string): string {
    const timestamp = hexToNumber(hexTimestamp);
    return new Date(timestamp * 1000).toISOString();
}

/**
 * Map RPC log to Routerscan log format
 */
function mapLog(rpcLog: RpcLog): RouterscanLog {
    return {
        index: hexToNumber(rpcLog.logIndex),
        address: {
            id: rpcLog.address,
            isContract: true, // Logs always come from contracts
        },
        topics: rpcLog.topics,
        data: rpcLog.data,
        removed: rpcLog.removed,
        event: getEventName(rpcLog.topics[0] || null),
    };
}

/**
 * Main mapper: Convert RPC transaction + receipt to Routerscan format
 */
export function mapRpcToRouterscan(
    rpcTx: RpcTransaction,
    rpcReceipt: RpcReceipt,
    blockTimestamp?: string // Optional: pass if you have it from block data
): RouterscanTx {
    const methodId = extractMethodId(rpcTx.input);
    
    // Get timestamp from first log if available, otherwise use provided or current time
    const timestamp = blockTimestamp 
        || (rpcReceipt.logs[0]?.blockTimestamp ? hexTimestampToISO(rpcReceipt.logs[0].blockTimestamp) : new Date().toISOString());

    return {
        chainId: rpcTx.chainId ? hexToDecimal(rpcTx.chainId) : '57073',
        blockNumber: hexToNumber(rpcTx.blockNumber),
        txIndex: hexToNumber(rpcTx.transactionIndex),
        timestamp,
        from: {
            id: rpcTx.from,
            isContract: false, // Would need code check to determine
        },
        to: {
            id: rpcTx.to || '',
            isContract: true, // Assume true if we're indexing contract txs
        },
        blockHash: rpcTx.blockHash,
        txHash: rpcTx.hash,
        value: hexToDecimal(rpcTx.value),
        gasLimit: hexToDecimal(rpcTx.gas),
        gasUsed: hexToDecimal(rpcReceipt.gasUsed),
        gasPrice: hexToDecimal(rpcTx.gasPrice),
        effectiveGasPrice: hexToDecimal(rpcReceipt.effectiveGasPrice),
        burnedFees: calculateBurnedFees(
            rpcReceipt.gasUsed,
            rpcReceipt.effectiveGasPrice,
            rpcTx.maxPriorityFeePerGas
        ),
        methodId,
        method: getMethodName(methodId),
        status: rpcReceipt.status === '0x1',
        nonce: hexToNumber(rpcTx.nonce),
        type: rpcTx.type ? hexToNumber(rpcTx.type) : 0,
        input: rpcTx.input,
        logs: rpcReceipt.logs.map(mapLog),
        // L1 fields
        l1GasPrice: rpcReceipt.l1GasPrice ? hexToDecimal(rpcReceipt.l1GasPrice) : null,
        l1GasUsed: rpcReceipt.l1GasUsed ? hexToDecimal(rpcReceipt.l1GasUsed) : null,
        l1Fee: rpcReceipt.l1Fee ? hexToDecimal(rpcReceipt.l1Fee) : null,
        l1BaseFeeScalar: rpcReceipt.l1BaseFeeScalar ? hexToDecimal(rpcReceipt.l1BaseFeeScalar) : null,
        l1BlobBaseFee: rpcReceipt.l1BlobBaseFee ? hexToDecimal(rpcReceipt.l1BlobBaseFee) : null,
        l1BlobBaseFeeScalar: rpcReceipt.l1BlobBaseFeeScalar ? hexToDecimal(rpcReceipt.l1BlobBaseFeeScalar) : null,
        // EIP-1559 fields
        maxFeePerGas: rpcTx.maxFeePerGas ? hexToDecimal(rpcTx.maxFeePerGas) : null,
        maxPriorityFeePerGas: rpcTx.maxPriorityFeePerGas ? hexToDecimal(rpcTx.maxPriorityFeePerGas) : null,
    };
}

/**
 * Batch map multiple transactions
 */
export function batchMapRpcToRouterscan(
    transactions: Map<string, RpcTransaction>,
    receipts: Map<string, RpcReceipt>,
    blockTimestamps?: Map<string, string> // blockNumber -> ISO timestamp
): RouterscanTx[] {
    const results: RouterscanTx[] = [];

    for (const [hash, tx] of transactions) {
        const receipt = receipts.get(hash);
        if (!receipt) continue;

        const blockTimestamp = blockTimestamps?.get(tx.blockNumber);
        results.push(mapRpcToRouterscan(tx, receipt, blockTimestamp));
    }

    return results;
}
