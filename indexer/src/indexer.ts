import {
  createPublicClient,
  http,
  decodeFunctionData,
  type Abi,
  type Log,
  type Transaction,
} from 'viem';
import { config, CONTRACTS_TO_INDEX, type ContractConfig } from './config.js';
import { getCursor, upsertCursor } from './db/cursor.js';
import { insertInteractions, type Interaction } from './db/interactions.js';

const client = createPublicClient({
  transport: http(config.rpcUrl),
});

const CHUNK_SIZE = 10000n; // Larger chunks for getLogs
const PARALLEL_CHUNKS = 4; // Process multiple chunks in parallel

export async function indexContract(contract: ContractConfig) {
  const { address, deployBlock, abi, name } = contract;
  const cursor = await getCursor(address);
  const latestBlock = await client.getBlockNumber();

  const startBlock = cursor
    ? BigInt(cursor.last_indexed_block + 1)
    : BigInt(deployBlock);

  if (startBlock > latestBlock) {
    console.log(`${name} is up to date at block ${latestBlock}`);
    return;
  }

  const totalBlocks = latestBlock - startBlock;
  console.log(`Indexing ${name} (${address})`);
  console.log(`  From block ${startBlock} to ${latestBlock} (${totalBlocks} blocks)`);

  // Process in parallel chunks
  let currentBlock = startBlock;

  while (currentBlock <= latestBlock) {
    const chunkPromises: Promise<void>[] = [];
    const chunksToProcess: { from: bigint; to: bigint }[] = [];

    // Prepare parallel chunks
    for (let i = 0; i < PARALLEL_CHUNKS && currentBlock <= latestBlock; i++) {
      const fromBlock = currentBlock;
      const toBlock =
        currentBlock + CHUNK_SIZE - 1n > latestBlock
          ? latestBlock
          : currentBlock + CHUNK_SIZE - 1n;

      chunksToProcess.push({ from: fromBlock, to: toBlock });
      currentBlock = toBlock + 1n;
    }

    // Process chunks in parallel
    const results = await Promise.all(
      chunksToProcess.map((chunk) =>
        processChunkWithLogs(address, abi, chunk.from, chunk.to)
      )
    );

    // Insert all interactions
    const allInteractions = results.flat();
    if (allInteractions.length > 0) {
      await insertInteractions(allInteractions);
      console.log(`  Inserted ${allInteractions.length} interactions`);
    }

    // Update cursor to the last processed block
    const lastProcessedBlock = chunksToProcess[chunksToProcess.length - 1].to;
    await upsertCursor(
      address,
      Number(lastProcessedBlock),
      deployBlock,
      lastProcessedBlock >= latestBlock
    );

    const progress = ((Number(lastProcessedBlock - startBlock) / Number(totalBlocks)) * 100).toFixed(1);
    console.log(`  Progress: ${progress}% (block ${lastProcessedBlock})`);
  }

  console.log(`  ✓ ${name} indexing complete!`);
}

async function processChunkWithLogs(
  contractAddress: `0x${string}`,
  abi: Abi,
  fromBlock: bigint,
  toBlock: bigint
): Promise<Interaction[]> {
  const interactions: Interaction[] = [];

  try {
    // Get all logs (events) from the contract - this catches all activity
    const logs = await client.getLogs({
      address: contractAddress,
      fromBlock,
      toBlock,
    });

    // Get unique transaction hashes from logs
    const txHashes = [...new Set(logs.map((log) => log.transactionHash))];

    if (txHashes.length === 0) {
      return [];
    }

    // Fetch transactions in parallel (batch of 10)
    const batchSize = 10;
    for (let i = 0; i < txHashes.length; i += batchSize) {
      const batch = txHashes.slice(i, i + batchSize);

      const txResults = await Promise.all(
        batch.map(async (hash) => {
          try {
            const tx = await client.getTransaction({ hash: hash as `0x${string}` });
            const block = await client.getBlock({ blockNumber: tx.blockNumber! });
            return { tx, timestamp: block.timestamp };
          } catch {
            return null;
          }
        })
      );

      for (const result of txResults) {
        if (!result || !result.tx) continue;
        const { tx, timestamp } = result;

        if (!tx.input || tx.input === '0x') continue;

        const functionSelector = tx.input.slice(0, 10);
        let functionName: string | null = null;

        try {
          const decoded = decodeFunctionData({ abi, data: tx.input });
          functionName = decoded.functionName;
        } catch {
          // Unknown function, just store selector
        }

        interactions.push({
          wallet_address: tx.from,
          contract_address: contractAddress,
          function_selector: functionSelector,
          function_name: functionName,
          tx_hash: tx.hash,
          block_number: Number(tx.blockNumber),
          block_timestamp: new Date(Number(timestamp) * 1000),
        });
      }
    }
  } catch (err) {
    console.error(`Error processing blocks ${fromBlock}-${toBlock}:`, err);
  }

  return interactions;
}

export async function runIndexer() {
  console.log('Starting indexer...');
  console.log(`Processing ${CONTRACTS_TO_INDEX.length} contracts with ${PARALLEL_CHUNKS} parallel workers`);

  for (const contract of CONTRACTS_TO_INDEX) {
    try {
      await indexContract(contract);
    } catch (err) {
      console.error(`Error indexing ${contract.name}:`, err);
    }
  }
}
