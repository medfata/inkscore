import { query } from './index.js';
import { config } from '../config.js';

export interface TransactionDetail {
    tx_hash: string;
    wallet_address: string;
    contract_address: string;
    to_address: string | null;
    function_selector: string | null;
    function_name: string | null;
    input_data: string | null;
    eth_value: string;
    gas_limit: string | null;
    gas_used: string | null;
    gas_price: string | null;
    effective_gas_price: string | null;
    max_fee_per_gas: string | null;
    max_priority_fee_per_gas: string | null;
    tx_fee_wei: string | null;
    burned_fees: string | null;
    block_number: number;
    block_hash: string | null;
    block_timestamp: Date;
    transaction_index: number | null;
    nonce: number | null;
    tx_type: number;
    status: number;
    chain_id: number;
    // L2 gas fields (Optimism/Ink)
    l1_gas_price: string | null;
    l1_gas_used: string | null;
    l1_fee: string | null;
    l1_base_fee_scalar: string | null;
    l1_blob_base_fee: string | null;
    l1_blob_base_fee_scalar: string | null;
}

const BATCH_SIZE = 500;

export async function insertTransactionDetails(txs: TransactionDetail[]): Promise<number> {
    if (txs.length === 0) return 0;

    let totalInserted = 0;
    for (let i = 0; i < txs.length; i += BATCH_SIZE) {
        const batch = txs.slice(i, i + BATCH_SIZE);
        totalInserted += await insertBatch(batch);
    }
    return totalInserted;
}

async function insertBatch(txs: TransactionDetail[]): Promise<number> {
    const values: unknown[] = [];
    const placeholders: string[] = [];

    txs.forEach((tx, idx) => {
        const offset = idx * 30;
        placeholders.push(
            `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, $${offset + 5}, $${offset + 6}, $${offset + 7}, $${offset + 8}, $${offset + 9}, $${offset + 10}, $${offset + 11}, $${offset + 12}, $${offset + 13}, $${offset + 14}, $${offset + 15}, $${offset + 16}, $${offset + 17}, $${offset + 18}, $${offset + 19}, $${offset + 20}, $${offset + 21}, $${offset + 22}, $${offset + 23}, $${offset + 24}, $${offset + 25}, $${offset + 26}, $${offset + 27}, $${offset + 28}, $${offset + 29}, $${offset + 30})`
        );
        values.push(
            tx.tx_hash,
            tx.wallet_address.toLowerCase(),
            tx.contract_address.toLowerCase(),
            tx.to_address?.toLowerCase() || null,
            tx.function_selector,
            tx.function_name,
            tx.input_data,
            tx.eth_value,
            tx.gas_limit,
            tx.gas_used,
            tx.gas_price,
            tx.effective_gas_price,
            tx.max_fee_per_gas,
            tx.max_priority_fee_per_gas,
            tx.tx_fee_wei,
            tx.burned_fees,
            tx.block_number,
            tx.block_hash,
            tx.block_timestamp,
            tx.transaction_index,
            tx.nonce,
            tx.tx_type,
            tx.status,
            tx.chain_id,
            tx.l1_gas_price,
            tx.l1_gas_used,
            tx.l1_fee,
            tx.l1_base_fee_scalar,
            tx.l1_blob_base_fee,
            tx.l1_blob_base_fee_scalar
        );
    });

    // ON CONFLICT DO NOTHING - duplicates are skipped
    await query(
        `INSERT INTO transaction_details 
         (tx_hash, wallet_address, contract_address, to_address, function_selector, function_name, input_data, eth_value, gas_limit, gas_used, gas_price, effective_gas_price, max_fee_per_gas, max_priority_fee_per_gas, tx_fee_wei, burned_fees, block_number, block_hash, block_timestamp, transaction_index, nonce, tx_type, status, chain_id, l1_gas_price, l1_gas_used, l1_fee, l1_base_fee_scalar, l1_blob_base_fee, l1_blob_base_fee_scalar)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (tx_hash) DO NOTHING`,
        values
    );

    return txs.length;
}


/**
 * Convert RouterscanTx to TransactionDetail for DB insertion
 */
export function routerscanToTransactionDetail(
    tx: {
        txHash: string;
        from: { id: string };
        to: { id: string };
        blockNumber: number;
        blockHash: string;
        timestamp: string;
        txIndex: number;
        value: string;
        gasLimit: string;
        gasUsed: string;
        gasPrice: string;
        effectiveGasPrice: string;
        maxFeePerGas: string | null;
        maxPriorityFeePerGas: string | null;
        burnedFees: string;
        methodId: string | null;
        method: string | null;
        input: string;
        status: boolean;
        nonce: number;
        type: number;
        l1GasPrice: string | null;
        l1GasUsed: string | null;
        l1Fee: string | null;
        l1BaseFeeScalar: string | null;
        l1BlobBaseFee: string | null;
        l1BlobBaseFeeScalar: string | null;
    },
    contractAddress: string
): TransactionDetail {
    const txFeeWei =
        tx.gasUsed && tx.effectiveGasPrice
            ? (BigInt(tx.gasUsed) * BigInt(tx.effectiveGasPrice)).toString()
            : null;

    return {
        tx_hash: tx.txHash,
        wallet_address: tx.from.id,
        contract_address: contractAddress,
        to_address: tx.to.id || null,
        function_selector: tx.methodId,
        function_name: tx.method?.split('(')[0] || null,
        input_data: tx.input,
        eth_value: tx.value,
        gas_limit: tx.gasLimit,
        gas_used: tx.gasUsed,
        gas_price: tx.gasPrice,
        effective_gas_price: tx.effectiveGasPrice,
        max_fee_per_gas: tx.maxFeePerGas,
        max_priority_fee_per_gas: tx.maxPriorityFeePerGas,
        tx_fee_wei: txFeeWei,
        burned_fees: tx.burnedFees,
        block_number: tx.blockNumber,
        block_hash: tx.blockHash,
        block_timestamp: new Date(tx.timestamp),
        transaction_index: tx.txIndex,
        nonce: tx.nonce,
        tx_type: tx.type,
        status: tx.status ? 1 : 0,
        chain_id: config.chainId,
        l1_gas_price: tx.l1GasPrice,
        l1_gas_used: tx.l1GasUsed,
        l1_fee: tx.l1Fee,
        l1_base_fee_scalar: tx.l1BaseFeeScalar,
        l1_blob_base_fee: tx.l1BlobBaseFee,
        l1_blob_base_fee_scalar: tx.l1BlobBaseFeeScalar,
    };
}
