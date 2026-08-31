/**
 * InkScoreStaking — source verification on Ink Explorer (Blockscout).
 *
 * Uses the same byte-identical standard-JSON input as deployment
 * (see _compile-shared.mjs) and submits it to the Blockscout
 * "standard-input" verification endpoint, then polls until verified.
 *
 * Usage: node contracts/scripts/verify-staking.mjs
 */

import solc from 'solc';
import { encodeAbiParameters, parseAbiParameters } from 'viem';
import {
  ARTIFACTS,
  ZENITH_NFT,
  EVM_VERSION,
  OPTIMIZER_RUNS,
  solcStandardInput,
} from './_compile-shared.mjs';

const EXPLORER_API = 'https://explorer.inkonchain.com/api/v2';

const record = JSON.parse(await import('node:fs/promises').then((fs) => fs.readFile(ARTIFACTS, 'utf8')));
const contractAddress = record.contractAddress;
console.log(`Verifying ${contractAddress} …`);

/* ---------------------------- sanity checks ------------------------- */

const cfgRes = await fetch(`${EXPLORER_API}/smart-contracts/verification/config`);
console.log(`Verification service: HTTP ${cfgRes.status}`);

const infoRes = await fetch(`${EXPLORER_API}/smart-contracts/${contractAddress}`);
const info = await infoRes.json();
if (info.is_verified) {
  console.log('Contract is already verified. Nothing to do.');
  process.exit(0);
}
if (!info.creation_bytecode) {
  console.error('No creation bytecode found on-chain — aborting.');
  process.exit(1);
}

/* ------------------------- build the payload ------------------------ */

// Compiler version in Blockscout format: v0.8.24+commit.e11b9ed9
const rawVersion = solc.version(); // "0.8.24+commit.e11b9ed9.Emscripten.clang"
const compilerVersion = `v${rawVersion.split('.Emscripten')[0]}`;

// Constructor args (address, uint256, uint256) — same values as deployment.
const constructorArgs = encodeAbiParameters(
  parseAbiParameters('address, uint256, uint256'),
  [ZENITH_NFT, 0n, 0n]
).slice(2); // hex WITHOUT 0x, as Blockscout expects

const standardInput = solcStandardInput();

const form = new FormData();
form.append('compiler_version', compilerVersion);
form.append('contract_name', 'InkScoreStaking');
form.append('license_type', 'mit');
form.append('autodetect_constructor_args', 'false');
form.append('constructor_args', constructorArgs);
form.append(
  'files[0]',
  new Blob([standardInput], { type: 'application/json' }),
  'standard-input.json'
);

console.log(`Submitting via standard-input (compiler ${compilerVersion}, evm ${EVM_VERSION}, optimizer ${OPTIMIZER_RUNS} runs)…`);
const submitRes = await fetch(
  `${EXPLORER_API}/smart-contracts/${contractAddress}/verification/via/standard-input`,
  { method: 'POST', body: form }
);

const submitBody = await submitRes.text();
console.log(`Submission: HTTP ${submitRes.status}`);
if (!submitRes.ok) {
  console.error(submitBody.slice(0, 4000));
  process.exit(1);
}

/* ------------------------------- poll ------------------------------- */

for (let i = 0; i < 30; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const res = await fetch(`${EXPLORER_API}/smart-contracts/${contractAddress}`);
  const data = await res.json();
  if (data.is_verified === true) {
    console.log(JSON.stringify({
      verified: true,
      address: contractAddress,
      url: `https://explorer.inkonchain.com/address/${contractAddress}`,
      license: data.license_type ?? 'mit',
      compiler: data.compiler_version ?? compilerVersion,
    }, null, 2));
    process.exit(0);
  }
  process.stdout.write('.');
}
console.log('\nVerification still pending after 60s — check the explorer URL manually.');
