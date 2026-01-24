/**
 * Test the RPC to Routerscan mapper
 * Run with: npx tsx src/test-mapper.ts
 */

import { mapRpcToRouterscan } from './rpcToRouterscanMapper.js';

// RPC response for tx 0xe777242578ab63e59b0557a64532f72aae0896b9d73334143c292561706a8c48
const rpcTx = {
    hash: '0xe777242578ab63e59b0557a64532f72aae0896b9d73334143c292561706a8c48',
    blockNumber: '0x1fd8a85',
    blockHash: '0x868c2babf68bc4d5306328aa29ea1b079da1f9248ce7446ee88d8f7aaab9bf67',
    transactionIndex: '0x6',
    from: '0x9282317af4632cd493618c7c05935eb021551c93',
    to: '0x1d74317d760f2c72a94386f50e8d10f2c902b899',
    value: '0x0',
    gas: '0x2a554',
    gasPrice: '0xa7a',
    input: '0x6d97786e00000000000000000000000093ef700eaa13d3aad542dd43949409faee3142560000000000000000000000000000000000000000000000000011f28dde593f3600000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000000',
    nonce: '0x403',
    type: '0x2',
    maxFeePerGas: '0xb60',
    maxPriorityFeePerGas: '0x83e',
    chainId: '0xdef1',
};

const rpcReceipt = {
    transactionHash: '0xe777242578ab63e59b0557a64532f72aae0896b9d73334143c292561706a8c48',
    blockNumber: '0x1fd8a85',
    blockHash: '0x868c2babf68bc4d5306328aa29ea1b079da1f9248ce7446ee88d8f7aaab9bf67',
    transactionIndex: '0x6',
    from: '0x9282317af4632cd493618c7c05935eb021551c93',
    to: '0x1d74317d760f2c72a94386f50e8d10f2c902b899',
    gasUsed: '0x1a893',
    effectiveGasPrice: '0xa7a',
    status: '0x1',
    l1GasPrice: '0x1ad4a98',
    l1GasUsed: '0x662',
    l1Fee: '0x14af066f',
    l1BaseFeeScalar: '0x1148',
    l1BlobBaseFee: '0x1a7752',
    l1BlobBaseFeeScalar: '0xc5f4f',
    logs: [
        {
            address: '0x93ef700eaa13d3aad542dd43949409faee314256',
            blockHash: '0x868c2babf68bc4d5306328aa29ea1b079da1f9248ce7446ee88d8f7aaab9bf67',
            blockNumber: '0x1fd8a85',
            blockTimestamp: '0x6950a0b0',
            data: '0x0000000000000000000000000000000000000000000000000011f28dde593f36',
            logIndex: '0x2',
            removed: false,
            topics: [
                '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
                '0x0000000000000000000000009282317af4632cd493618c7c05935eb021551c93',
                '0x0000000000000000000000000000000000000000000000000000000000000000',
            ],
            transactionHash: '0xe777242578ab63e59b0557a64532f72aae0896b9d73334143c292561706a8c48',
            transactionIndex: '0x6',
        },
        {
            address: '0x1d74317d760f2c72a94386f50e8d10f2c902b899',
            blockHash: '0x868c2babf68bc4d5306328aa29ea1b079da1f9248ce7446ee88d8f7aaab9bf67',
            blockNumber: '0x1fd8a85',
            blockTimestamp: '0x6950a0b0',
            data: '0x000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000339d41b3000000000000000000000000000000000000000000000181490da6191f51e786000000000000000000000000000000000000000000000000000000006950a0b00000000000000000000000009282317af4632cd493618c7c05935eb021551c930000000000000000000000000000000000000000000000000011f28dde593f36000000000000000000000000000000000000000000000000000000000042c01100000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000000',
            logIndex: '0x3',
            removed: false,
            topics: [
                '0x4b5824a0f21039d7160b2a57d8c140cae3ba13e4f15bcd879cc63e4964681a9e',
                '0x00000000000000000000000093ef700eaa13d3aad542dd43949409faee314256',
                '0x0000000000000000000000000000000000000000000000000000000000000000',
            ],
            transactionHash: '0xe777242578ab63e59b0557a64532f72aae0896b9d73334143c292561706a8c48',
            transactionIndex: '0x6',
        },
    ],
};

// Routerscan response for comparison
const routerscanTx = {
    chainId: '57073',
    blockNumber: 33393285,
    txIndex: 6,
    timestamp: '2025-12-28T03:14:56.000Z',
    from: { id: '0x9282317AF4632CD493618c7C05935eB021551C93', isContract: false },
    to: { id: '0x1D74317d760f2c72A94386f50E8D10f2C902b899', isContract: true },
    txHash: '0xe777242578ab63e59b0557a64532f72aae0896b9d73334143c292561706a8c48',
    value: '0',
    gasLimit: '173396',
    gasUsed: '108691',
    gasPrice: '2682',
    methodId: '0x6d97786e',
    method: 'sell(address _to, uint256 _value, string _note) returns (bool)',
    status: true,
    nonce: 1027,
    l1GasPrice: '28134040',
    l1GasUsed: '1634',
    l1Fee: '347014767',
};

// Map RPC to Routerscan format
const mapped = mapRpcToRouterscan(rpcTx as any, rpcReceipt as any);

console.log('=== MAPPED RPC TRANSACTION ===\n');
console.log(JSON.stringify(mapped, null, 2));

console.log('\n=== COMPARISON ===\n');

const comparisons = [
    ['chainId', routerscanTx.chainId, mapped.chainId],
    ['blockNumber', routerscanTx.blockNumber, mapped.blockNumber],
    ['txIndex', routerscanTx.txIndex, mapped.txIndex],
    ['from', routerscanTx.from.id.toLowerCase(), mapped.from.id.toLowerCase()],
    ['to', routerscanTx.to.id.toLowerCase(), mapped.to.id.toLowerCase()],
    ['value', routerscanTx.value, mapped.value],
    ['gasLimit', routerscanTx.gasLimit, mapped.gasLimit],
    ['gasUsed', routerscanTx.gasUsed, mapped.gasUsed],
    ['gasPrice', routerscanTx.gasPrice, mapped.gasPrice],
    ['methodId', routerscanTx.methodId, mapped.methodId],
    ['status', routerscanTx.status, mapped.status],
    ['nonce', routerscanTx.nonce, mapped.nonce],
    ['l1GasPrice', routerscanTx.l1GasPrice, mapped.l1GasPrice],
    ['l1GasUsed', routerscanTx.l1GasUsed, mapped.l1GasUsed],
    ['l1Fee', routerscanTx.l1Fee, mapped.l1Fee],
    ['logsCount', 2, mapped.logs.length],
];

let allMatch = true;
for (const [field, expected, actual] of comparisons) {
    const match = String(expected) === String(actual);
    const icon = match ? '✅' : '❌';
    console.log(`${icon} ${field}: ${expected} vs ${actual}`);
    if (!match) allMatch = false;
}

console.log('\n=== LOGS ===\n');
for (const log of mapped.logs) {
    console.log(`Log #${log.index}:`);
    console.log(`  address: ${log.address.id}`);
    console.log(`  event: ${log.event || 'unknown'}`);
    console.log(`  topics: ${log.topics.length}`);
}

console.log('\n=== RESULT ===\n');
if (allMatch) {
    console.log('✅ All fields match! Mapper is working correctly.');
} else {
    console.log('❌ Some fields do not match. Check the comparison above.');
}

// Show method decoding
console.log('\n=== METHOD DECODING ===\n');
console.log(`Routerscan method: ${routerscanTx.method}`);
console.log(`Mapped method: ${mapped.method}`);
console.log(`Note: Routerscan has full signature with param names, we have basic signature`);
