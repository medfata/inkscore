/**
 * InkScoreStaking — compile (solc-js 0.8.20) + deploy (viem) to Ink Chain.
 *
 * No secrets in this file. The deployer key is read from the STAKING_PK
 * environment variable and never printed or persisted.
 *
 * Usage:
 *   STAKING_PK=0x... node contracts/scripts/deploy-staking.mjs derive
 *   STAKING_PK=0x... node contracts/scripts/deploy-staking.mjs deploy
 *   node contracts/scripts/deploy-staking.mjs verify
 */

import fs from 'node:fs';
import path from 'node:path';
import solc from 'solc';
import { createPublicClient, createWalletClient, http, defineChain, formatEther, encodeDeployData, encodeFunctionData } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { REPO, ROOT_CONTRACT, ARTIFACTS, ZENITH_NFT, EVM_VERSION, OPTIMIZER_RUNS, buildSources, solcStandardInput } from './_compile-shared.mjs';

const inkChain = defineChain({
  id: 57073,
  name: 'Ink',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc-gel.inkonchain.com'] } },
  blockExplorers: { default: { name: 'Ink Explorer', url: 'https://explorer.inkonchain.com' } },
});

/* ------------------------------------------------------------------ */
/* Compilation                                                          */
/* ------------------------------------------------------------------ */

function compile() {
  // Uses the shared standard input so deploy/verify compile identically.
  const output = JSON.parse(
    solc.compile(solcStandardInput(), {
      import: () => ({ error: 'All imports should be inlined' }),
    })
  );

  const errors = (output.errors ?? []).filter((e) => e.severity === 'error');
  if (errors.length) {
    console.error(errors.map((e) => e.formattedMessage).join('\n'));
    process.exit(1);
  }
  (output.errors ?? []).forEach((e) => console.error('[solc]', e.formattedMessage.trim()));

  const artifact = output.contracts['contracts/InkScoreStaking.sol']?.InkScoreStaking;
  if (!artifact || !artifact.evm?.bytecode?.object) {
    console.error('Compilation produced no bytecode.');
    process.exit(1);
  }
  const bytecode = artifact.evm.bytecode.object;
  if (bytecode.length < 2000) {
    console.error(`Bytecode suspiciously short (${bytecode.length} chars).`);
    process.exit(1);
  }
  return { abi: artifact.abi, bytecode: `0x${bytecode}` };
}

/* ------------------------------------------------------------------ */
/* Modes                                                                */
/* ------------------------------------------------------------------ */

const mode = process.argv[2] ?? 'derive';

if (mode === 'derive') {
  const account = privateKeyToAccount(process.env.STAKING_PK);
  const publicClient = createPublicClient({ chain: inkChain, transport: http() });
  const balance = await publicClient.getBalance({ address: account.address });
  console.log(JSON.stringify({ deployer: account.address, balanceETH: formatEther(balance) }, null, 2));
} else if (mode === 'deploy') {
  const pk = process.env.STAKING_PK;
  if (!pk) {
    console.error('STAKING_PK env var is required.');
    process.exit(1);
  }
  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({ chain: inkChain, transport: http() });
  const walletClient = createWalletClient({ account, chain: inkChain, transport: http() });

  const balance = await publicClient.getBalance({ address: account.address });
  if (balance === 0n) {
    console.error(`Deployer ${account.address} has zero balance on Ink. Fund it first.`);
    process.exit(1);
  }

  const { abi, bytecode } = compile();
  console.log(`Compiled. Bytecode ${bytecode.length} chars. Deploying from ${account.address}…`);

  const hash = await walletClient.deployContract({
    abi,
    bytecode,
    args: [ZENITH_NFT, 0n, 0n], // initialStakeFee=0, initialUnstakeFee=0 (set via setFees later)
  });
  console.log('Tx:', hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const record = {
    contractAddress: receipt.contractAddress,
    abi,
    deployer: account.address,
    deploymentTx: hash,
    blockNumber: Number(receipt.blockNumber),
    gasUsed: receipt.gasUsed.toString(),
    deployedAt: new Date().toISOString(),
    network: { name: 'Ink', chainId: inkChain.id, rpc: inkChain.rpcUrls.default.http[0], explorer: inkChain.blockExplorers.default.url },
    constructorArgs: { nftAddress: ZENITH_NFT, initialStakeFee: '0', initialUnstakeFee: '0' },
    compiler: { solc: solc.version(), evmVersion: EVM_VERSION, optimizer: { enabled: true, runs: OPTIMIZER_RUNS } },
  };

  fs.writeFileSync(ARTIFACTS, JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ address: receipt.contractAddress, tx: hash, block: Number(receipt.blockNumber), gasUsed: receipt.gasUsed.toString(), artifacts: ARTIFACTS }, null, 2));
} else if (mode === 'estimate') {
  const account = privateKeyToAccount(process.env.STAKING_PK);
  const publicClient = createPublicClient({ chain: inkChain, transport: http() });

  const { abi, bytecode } = compile();
  const data = encodeDeployData({ abi, bytecode, args: [ZENITH_NFT, 0n, 0n] });

  const GPO_ABI = [
    {
      inputs: [{ internalType: 'bytes', name: '_data', type: 'bytes' }],
      name: 'getL1Fee',
      outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
  ];
  const [l2Gas, gasPrice, balance, l1Call] = await Promise.all([
    publicClient.estimateGas({ account, data }),
    publicClient.getGasPrice(),
    publicClient.getBalance({ address: account.address }),
    // OP-stack GasPriceOracle predeploy at 0x420…000F
    publicClient
      .call({
        to: '0x420000000000000000000000000000000000000F',
        data: encodeFunctionData({ abi: GPO_ABI, functionName: 'getL1Fee', args: [data] }),
      })
      .catch(() => null),
  ]);

  const l1Fee = l1Call?.data && l1Call.data !== '0x' ? BigInt(l1Call.data) : null;
  const l2Cost = l2Gas * gasPrice;
  const total = l2Cost + (l1Fee ?? 0n);
  const sufficient = balance > total;

  console.log(JSON.stringify({
    deployer: account.address,
    balanceETH: formatEther(balance),
    l2GasEstimate: l2Gas.toString(),
    gasPriceWei: gasPrice.toString(),
    l2CostETH: formatEther(l2Cost),
    l1DataFeeETH: l1Fee === null ? 'unknown' : formatEther(l1Fee),
    estimatedTotalETH: formatEther(total),
    sufficientFunds: sufficient,
    shortfallETH: sufficient ? '0' : formatEther(total - balance),
  }, null, 2));
} else if (mode === 'verify') {
  const record = JSON.parse(fs.readFileSync(ARTIFACTS, 'utf8'));
  const publicClient = createPublicClient({ chain: inkChain, transport: http() });
  const addr = record.contractAddress;

  const [owner, stakeFee, unstakeFee, totalStaked, zenithSupported, staked1] = await Promise.all([
    publicClient.readContract({ address: addr, abi: record.abi, functionName: 'owner' }),
    publicClient.readContract({ address: addr, abi: record.abi, functionName: 'stakeFee' }),
    publicClient.readContract({ address: addr, abi: record.abi, functionName: 'unstakeFee' }),
    publicClient.readContract({ address: addr, abi: record.abi, functionName: 'totalStaked' }),
    publicClient.readContract({ address: addr, abi: record.abi, functionName: 'nft' }),
    publicClient.readContract({ address: addr, abi: record.abi, functionName: 'isStaked', args: [1n] }),
  ]);

  console.log(JSON.stringify({
    address: addr,
    owner,
    stakeFeeWei: stakeFee.toString(),
    unstakeFeeWei: unstakeFee.toString(),
    totalStaked: totalStaked.toString(),
    acceptedNft: zenithSupported,
    isStaked_token1: staked1,
    nftMatchesZenith: zenithSupported.toLowerCase() === ZENITH_NFT.toLowerCase(),
  }, null, 2));
} else {
  console.error('Unknown mode. Use: derive | deploy | verify');
  process.exit(1);
}
