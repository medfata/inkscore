/**
 * Cross-checks the frontend ABI (lib/staking-contract.ts) against the
 * deployed artifact ABI (contracts/deployed-staking.json) by comparing
 * canonical 4-byte function selectors — the ground truth for on-chain
 * communication. Exits non-zero on any mismatch.
 *
 * Usage: npx tsx contracts/scripts/check-frontend-abi.ts
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toFunctionSelector } from 'viem';
import { STAKING_ABI, STAKING_CONTRACT_ADDRESS, ZENITH_NFT_ADDRESS, STAKING_CONFIGURED } from '../../lib/staking-contract';

const here = dirname(fileURLToPath(import.meta.url));
const artifact = JSON.parse(readFileSync(resolve(here, '../deployed-staking.json'), 'utf8'));

function selectorOf(item: { name: string; inputs: readonly { type: string }[] }): string {
  const sig = `${item.name}(${item.inputs.map((i) => i.type).join(',')})`;
  return toFunctionSelector(sig);
}

type AbiFunction = {
  readonly type: string;
  readonly name: string;
  readonly inputs: readonly { readonly type: string }[];
  readonly outputs?: readonly { readonly type: string }[];
  readonly stateMutability: string;
};

const deployed = new Map<string, { inputs: string[]; outputs: string[]; stateMutability: string }>();
for (const item of artifact.abi as AbiFunction[]) {
  if (item.type !== 'function') continue;
  deployed.set(selectorOf(item), {
    inputs: item.inputs.map((i) => i.type),
    outputs: (item.outputs ?? []).map((o) => o.type),
    stateMutability: item.stateMutability,
  });
}

let failures = 0;
console.log(`Frontend ABI entries: ${STAKING_ABI.length}\n`);

for (const item of STAKING_ABI as readonly AbiFunction[]) {
  if (item.type !== 'function') continue;
  const sel = selectorOf(item);
  const onChain = deployed.get(sel);
  const sig = `${item.name}(${item.inputs.map((i) => i.type).join(',')})`;
  if (!onChain) {
    console.log(`❌ ${sig} -> selector ${sel} NOT FOUND in deployed ABI`);
    failures++;
    continue;
  }
  const inOk = onChain.inputs.join(',') === item.inputs.map((i) => i.type).join(',');
  const outOk = onChain.outputs.join(',') === (item.outputs ?? []).map((o) => o.type).join(',');
  const mutOk = onChain.stateMutability === item.stateMutability;
  if (inOk && outOk && mutOk) {
    console.log(`✅ ${sig} selector=${sel} mutability=${item.stateMutability}`);
  } else {
    console.log(`❌ ${sig}: inputs=${inOk ? 'ok' : `MISMATCH deployed=[${onChain.inputs}]`}, outputs=${outOk ? 'ok' : `MISMATCH deployed=[${onChain.outputs}]`}, mutability=${mutOk ? 'ok' : `MISMATCH deployed=${onChain.stateMutability}`}`);
    failures++;
  }
}

// Address wiring checks
const addrOk = STAKING_CONTRACT_ADDRESS.toLowerCase() === artifact.contractAddress.toLowerCase();
const zenithOk = ZENITH_NFT_ADDRESS.toLowerCase() === artifact.constructorArgs.nftAddress.toLowerCase();
console.log(`\nSTAKING_CONTRACT_ADDRESS matches artifact: ${addrOk ? '✅' : '❌'} (${STAKING_CONTRACT_ADDRESS})`);
console.log(`ZENITH_NFT_ADDRESS matches constructor arg:  ${zenithOk ? '✅' : '❌'} (${ZENITH_NFT_ADDRESS})`);
console.log(`STAKING_CONFIGURED (page active):           ${STAKING_CONFIGURED ? '✅' : '❌'}`);

if (!addrOk || !zenithOk || failures > 0 || !STAKING_CONFIGURED) process.exit(1);
console.log('\nAll frontend↔contract wiring checks passed.');
