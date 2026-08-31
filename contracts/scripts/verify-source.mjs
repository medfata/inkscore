/**
 * InkScoreStaking — publish source verification to the Ink Blockscout
 * explorer (explorer.inkonchain.com) via the standard-input endpoint.
 *
 * Uses the byte-exact solc standard JSON input from _compile-shared.mjs —
 * the same input that produced the deployment bytecode — so the verifier
 * matches the on-chain bytecode exactly (this is how the first deployment
 * was verified).
 *
 * Endpoint expects multipart/form-data (per Blockscout API docs):
 *   compiler_version, contract_name, files[0] (= standard JSON input),
 *   constructor_args (hex), license_type.
 *
 * Usage:
 *   node contracts/scripts/verify-source.mjs <contractAddress>
 */

import fs from 'node:fs';
import solc from 'solc';
import { encodeAbiParameters } from 'viem';
import { ARTIFACTS, EVM_VERSION, OPTIMIZER_RUNS, solcStandardInput } from './_compile-shared.mjs';

const EXPLORER_API = 'https://explorer.inkonchain.com/api/v2';
const LICENSE_TYPE = 'mit'; // SPDX-License-Identifier: MIT
const CONTRACT_NAME = 'InkScoreStaking';

const address = process.argv[2];
if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) {
  console.error('Usage: node contracts/scripts/verify-source.mjs <contractAddress>');
  process.exit(1);
}

// solc.version() → "0.8.24+commit.e11b9ed9.Emscripten.clang"
// Blockscout expects the short form → "v0.8.24+commit.e11b9ed9"
const compilerVersion = `v${solc.version().replace(/^v?/, '').split('.Emscripten')[0]}`;

// Constructor is (address, uint256, uint256) — encode args from the
// deployment record so the verifier can match creation code + args.
const record = JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8'));
const args = record.constructorArgs ?? {};
if (!args.nftAddress) {
  console.error(`No constructorArgs found in ${ARTIFACTS}. Deploy first.`);
  process.exit(1);
}
const constructorArgs = encodeAbiParameters(
  [
    { type: 'address' },
    { type: 'uint256' },
    { type: 'uint256' },
  ],
  [
    args.nftAddress,
    BigInt(args.initialStakeFee ?? 0),
    BigInt(args.initialUnstakeFee ?? 0),
  ]
).slice(2); // strip 0x — verifier wants bare hex

const standardInput = solcStandardInput();

const form = new FormData();
form.append('compiler_version', compilerVersion);
form.append('contract_name', CONTRACT_NAME);
form.append('files[0]', new Blob([standardInput], { type: 'application/json' }), 'standard-input.json');
form.append('autodetect_constructor_args', 'false');
form.append('constructor_args', constructorArgs);
form.append('license_type', LICENSE_TYPE);

console.log(`Submitting source verification for ${address}`);
console.log(`  compiler: ${compilerVersion} (evm ${EVM_VERSION}, optimizer ${OPTIMIZER_RUNS} runs)`);

const res = await fetch(`${EXPLORER_API}/smart-contracts/${address}/verification/via/standard-input`, {
  method: 'POST',
  body: form,
});

const text = await res.text();
let json = null;
try { json = JSON.parse(text); } catch { /* non-JSON error page */ }

if (res.ok) {
  console.log('Submission accepted:', JSON.stringify(json));
  console.log('Poll the explorer for is_verified:true, then the source appears on-chain.');
} else {
  const msg = JSON.stringify(json ?? text.slice(0, 300));
  console.error(`Verification failed (HTTP ${res.status}):`, msg);
  if (/already verif/i.test(msg)) {
    console.error('→ This contract is already verified on the explorer; nothing to do.');
    process.exit(0);
  }
  process.exit(1);
}
