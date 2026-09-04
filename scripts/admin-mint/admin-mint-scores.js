const { ethers } = require('ethers');
const { parse } = require('csv-parse/sync');
const fs = require('fs');
const { Pool } = require('pg');
const readline = require('readline');
require('dotenv').config();

const SIGNATURE_EXPIRY_SECONDS = 5 * 60;
const MIN_ETH_BALANCE = 0.001;

const CONTRACT_ADDRESS = process.env.NEXT_PUBLIC_NFT_CONTRACT_ADDRESS;
const SIGNER_PRIVATE_KEY = process.env.NFT_SIGNER_PRIVATE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const RPC_URL = 'https://rpc-gel.inkonchain.com';

const CONTRACT_ABI = [
  'function mint(uint256 score, string rank, uint256 expiry, bytes signature) external payable returns (uint256)',
  'function mintPrice() view returns (uint256)',
  'function hasNFT(address wallet) view returns (bool, uint256)',
];

function log(message, type = 'info') {
  const prefix = {
    info: 'ℹ',
    success: '✓',
    error: '✗',
    warning: '⚠',
  }[type] || '';
  console.log(`${prefix} ${message}`);
}

function extractContractError(error) {
  if (!error) return 'Unknown error';
  
  if (error.reason) {
    return `Contract error: ${error.reason}`;
  }
  
  if (error.code === 'INSUFFICIENT_FUNDS') {
    return 'Insufficient ETH balance for gas fees';
  }
  
  if (error.code === 'NETWORK_ERROR') {
    return 'Network connection failed. Check your internet connection.';
  }
  
  if (error.code === 'TIMEOUT') {
    return 'Transaction timed out. The network may be congested.';
  }
  
  if (error.message) {
    const msg = error.message;
    
    if (msg.includes('SignatureAlreadyUsed')) {
      return 'This wallet already has an NFT with this score';
    }
    if (msg.includes('SignatureExpired')) {
      return 'Signature expired. Try again.';
    }
    if (msg.includes('InvalidSignature')) {
      return 'Invalid signature. Check NFT_SIGNER_PRIVATE_KEY in .env';
    }
    if (msg.includes('InsufficientPayment')) {
      return 'Insufficient payment for mint';
    }
    
    if (msg.length > 200) {
      return msg.substring(0, 200) + '...';
    }
    return msg;
  }
  
  return 'Unknown error occurred';
}

function isValidPrivateKey(key) {
  if (!key) return false;
  return /^0x[a-fA-F0-9]{64}$/.test(key);
}

function calculateRank(score) {
  if (score >= 10000) return 'Ink God';
  if (score >= 8500) return 'The Kraken';
  if (score >= 7000) return 'Abyss Lord';
  if (score >= 5000) return 'Commander';
  if (score >= 3500) return 'Captain';
  if (score >= 2000) return 'Deep Diver';
  if (score >= 1000) return 'Explorer';
  if (score >= 500) return 'Little Squid';
  return 'Ink Drop';
}

async function confirmAction(message) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(`${message} (y/n): `, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes');
    });
  });
}

function parseCSV(filePath) {
  try {
    if (!fs.existsSync(filePath)) {
      log(`File not found: ${filePath}`, 'error');
      log('Make sure the CSV file exists in the current directory', 'info');
      process.exit(1);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const records = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
    });

    if (records.length === 0) {
      log('CSV file is empty or has no data rows', 'error');
      log('Expected format: private_key,score,rank', 'info');
      process.exit(1);
    }

    return records.map((row, index) => {
      const rowNum = index + 2;
      const privateKey = row.private_key || row.privateKey || row.pk;
      const score = parseInt(row.score, 10);
      const rank = row.rank || undefined;

      if (!privateKey) {
        log(`Row ${rowNum}: Missing private_key`, 'error');
        process.exit(1);
      }

      if (!isValidPrivateKey(privateKey)) {
        log(`Row ${rowNum}: Invalid private key format`, 'error');
        log('Private key must be 0x followed by 64 hex characters', 'info');
        process.exit(1);
      }

      if (isNaN(score) || score < 0) {
        log(`Row ${rowNum}: Invalid score "${row.score}"`, 'error');
        log('Score must be a positive number', 'info');
        process.exit(1);
      }

      return { privateKey, score, rank };
    });
  } catch (error) {
    log(`Failed to parse CSV file: ${error.message}`, 'error');
    log('Check that the CSV format is correct (private_key,score,rank)', 'info');
    process.exit(1);
  }
}

async function mintForWallet(provider, signerKey, row, contract, pool) {
  try {
    const wallet = new ethers.Wallet(row.privateKey, provider);
    const walletAddress = wallet.address;
    const score = row.score;
    const rank = row.rank || calculateRank(score);
    const expiry = Math.floor(Date.now() / 1000) + SIGNATURE_EXPIRY_SECONDS;

    const balance = await provider.getBalance(walletAddress);
    const balanceEth = parseFloat(ethers.formatEther(balance));
    
    if (balanceEth < MIN_ETH_BALANCE) {
      return { 
        success: false, 
        error: `Low balance: ${balanceEth.toFixed(4)} ETH (need at least ${MIN_ETH_BALANCE} ETH for gas)`,
      };
    }

    const signerWallet = new ethers.Wallet(signerKey);

    const messageHash = ethers.solidityPackedKeccak256(
      ['address', 'uint256', 'string', 'uint256'],
      [walletAddress, score, rank, expiry]
    );

    const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));

    const mintPrice = await contract.mintPrice();

    const tx = await contract.connect(wallet).mint(
      BigInt(score),
      rank,
      BigInt(expiry),
      signature,
      { value: mintPrice }
    );

    log(`Waiting for confirmation...`, 'info');
    const receipt = await tx.wait();

    await pool.query(
      `INSERT INTO admin_score_overrides (wallet_address, score, rank, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (wallet_address)
       DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank, updated_at = NOW()`,
      [walletAddress.toLowerCase(), score, rank]
    );

    await pool.query(
      `INSERT INTO nft_mints (wallet_address, score, rank, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (wallet_address)
       DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank, updated_at = NOW()`,
      [walletAddress.toLowerCase(), score, rank]
    );

    return { success: true, wallet: walletAddress, txHash: receipt.hash };
  } catch (error) {
    return { success: false, error: extractContractError(error) };
  }
}

async function main() {
  console.log('\n=== InkScore Admin Mint Tool ===\n');

  const csvPath = process.argv[2];
  if (!csvPath) {
    log('No CSV file specified', 'error');
    console.log('\nUsage: node admin-mint-scores.js <path-to-csv>');
    console.log('Example: node admin-mint-scores.js mint.csv\n');
    process.exit(1);
  }

  if (!CONTRACT_ADDRESS) {
    log('Missing NEXT_PUBLIC_NFT_CONTRACT_ADDRESS in .env', 'error');
    process.exit(1);
  }

  if (!SIGNER_PRIVATE_KEY) {
    log('Missing NFT_SIGNER_PRIVATE_KEY in .env', 'error');
    process.exit(1);
  }

  if (!DATABASE_URL) {
    log('Missing DATABASE_URL in .env', 'error');
    process.exit(1);
  }

  const rows = parseCSV(csvPath);
  log(`Loaded ${rows.length} wallet(s) from ${csvPath}`, 'success');

  log('Testing database connection...', 'info');
  const pool = new Pool({
    connectionString: DATABASE_URL,
    max: 2,
  });

  try {
    const client = await pool.connect();
    client.release();
    log('Database connection OK', 'success');
  } catch (error) {
    log('Failed to connect to database', 'error');
    log(`Error: ${error.message}`, 'error');
    log('Check DATABASE_URL in .env', 'info');
    await pool.end();
    process.exit(1);
  }

  log('Testing RPC connection...', 'info');
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  
  try {
    const network = await provider.getNetwork();
    log(`Connected to network: ${network.name} (chain ${network.chainId})`, 'success');
  } catch (error) {
    log('Failed to connect to InkChain RPC', 'error');
    log('Check your internet connection', 'info');
    await pool.end();
    process.exit(1);
  }

  const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, provider);

  console.log('\n--- Preview ---');
  rows.forEach((row, i) => {
    const tempWallet = new ethers.Wallet(row.privateKey);
    const rank = row.rank || calculateRank(row.score);
    console.log(`  ${i + 1}. ${tempWallet.address} → Score: ${row.score} (${rank})`);
  });
  console.log('');

  const confirmed = await confirmAction(`About to mint ${rows.length} NFT(s). Continue?`);
  
  if (!confirmed) {
    log('Cancelled by user', 'warning');
    await pool.end();
    process.exit(0);
  }

  console.log('\n--- Minting ---\n');

  const results = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const tempWallet = new ethers.Wallet(row.privateKey);
    const addr = tempWallet.address;
    const rank = row.rank || calculateRank(row.score);

    log(`[${i + 1}/${rows.length}] Minting score ${row.score} (${rank}) for ${addr}`, 'info');

    const result = await mintForWallet(provider, SIGNER_PRIVATE_KEY, row, contract, pool);
    results.push({ wallet: addr, ...result });

    if (result.success) {
      log(`Success! TX: ${result.txHash}`, 'success');
    } else {
      log(`Failed: ${result.error}`, 'error');
    }
    console.log('');
  }

  const successCount = results.filter(r => r.success).length;
  const failCount = results.filter(r => !r.success).length;

  console.log('=== Summary ===');
  console.log(`Total: ${results.length}`);
  console.log(`Success: ${successCount}`);
  console.log(`Failed: ${failCount}`);

  if (failCount > 0) {
    console.log('\nFailed wallets:');
    results.filter(r => !r.success).forEach(r => {
      console.log(`  - ${r.wallet}: ${r.error}`);
    });
  }

  console.log('');
  await pool.end();
}

main().catch((error) => {
  log('Unexpected error occurred', 'error');
  log(error.message, 'error');
  process.exit(1);
});
