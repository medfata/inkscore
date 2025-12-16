import 'dotenv/config';
import type { Abi } from 'viem';

export const config = {
  databaseUrl: process.env.DATABASE_URL!,
  rpcUrl: process.env.RPC_URL || 'https://rpc-qnd.inkonchain.com',
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '15000'),
  chainId: 57073, // Ink Mainnet
};

export interface ContractConfig {
  address: `0x${string}`;
  name: string;
  deployBlock: number;
  abi: Abi;
}

// Contracts to index - add your contracts here
export const CONTRACTS_TO_INDEX: ContractConfig[] = [
  {
    address: '0x9F500d075118272B3564ac6Ef2c70a9067Fd2d3F',
    name: 'DailyGM',
    deployBlock: 3816036, // Set to actual deploy block for faster backfill
    abi: [
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "user",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          }
        ],
        "name": "GM",
        "type": "event"
      },
      {
        "inputs": [],
        "name": "gm",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          }
        ],
        "name": "gmTo",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "user",
            "type": "address"
          }
        ],
        "name": "lastGM",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "lastGM",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      }
    ],
  },
  // Add more contracts...
];
