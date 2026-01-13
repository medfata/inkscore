import 'dotenv/config';
import type { Abi } from 'viem';

export const config = {
  databaseUrl: process.env.DATABASE_URL!,
  rpcUrl: process.env.RPC_URL || 'https://rpc-qnd.inkonchain.com',
  pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '15000'),
  chainId: 57073, // Ink Mainnet
};

// Multiple RPC endpoints for load balancing (official Ink RPCs only)
export const RPC_ENDPOINTS = [
  'https://rpc-qnd.inkonchain.com',
];

// Round-robin RPC selector
let rpcIndex = 0;
export function getNextRpc(): string {
  const rpc = RPC_ENDPOINTS[rpcIndex];
  rpcIndex = (rpcIndex + 1) % RPC_ENDPOINTS.length;
  return rpc;
}

export interface ContractConfig {
  address: `0x${string}`;
  name: string;
  deployBlock: number;
  abi: Abi;
  // If true, fetch full transaction details (for contracts without events)
  fetchTransactions?: boolean;
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
  { //https://inkyswap.com/swap func being called: execute
    address: '0x551134e92e537cEAa217c2ef63210Af3CE96a065',
    name: 'UniversalRouter',
    deployBlock: 29465815, // Set to actual deploy block for faster backfill
    fetchTransactions: true,
    abi: [
      {
        "inputs": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "permit2",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "weth9",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "v2Factory",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "v3Factory",
                "type": "address"
              },
              {
                "internalType": "bytes32",
                "name": "pairInitCodeHash",
                "type": "bytes32"
              },
              {
                "internalType": "bytes32",
                "name": "poolInitCodeHash",
                "type": "bytes32"
              },
              {
                "internalType": "address",
                "name": "v4PoolManager",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "v3NFTPositionManager",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "v4PositionManager",
                "type": "address"
              }
            ],
            "internalType": "struct RouterParameters",
            "name": "params",
            "type": "tuple"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "inputs": [],
        "name": "BalanceTooLow",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "ContractLocked",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "Currency",
            "name": "currency",
            "type": "address"
          }
        ],
        "name": "DeltaNotNegative",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "Currency",
            "name": "currency",
            "type": "address"
          }
        ],
        "name": "DeltaNotPositive",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "ETHNotAccepted",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "commandIndex",
            "type": "uint256"
          },
          {
            "internalType": "bytes",
            "name": "message",
            "type": "bytes"
          }
        ],
        "name": "ExecutionFailed",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "FromAddressIsNotOwner",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InputLengthMismatch",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InsufficientBalance",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InsufficientETH",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InsufficientToken",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "bytes4",
            "name": "action",
            "type": "bytes4"
          }
        ],
        "name": "InvalidAction",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidBips",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "commandType",
            "type": "uint256"
          }
        ],
        "name": "InvalidCommandType",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidEthSender",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidPath",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidReserves",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "LengthMismatch",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "tokenId",
            "type": "uint256"
          }
        ],
        "name": "NotAuthorizedForToken",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "NotPoolManager",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "OnlyMintAllowed",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "SliceOutOfBounds",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "TransactionDeadlinePassed",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "UnsafeCast",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "action",
            "type": "uint256"
          }
        ],
        "name": "UnsupportedAction",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V2InvalidPath",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V2TooLittleReceived",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V2TooMuchRequested",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V3InvalidAmountOut",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V3InvalidCaller",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V3InvalidSwap",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V3TooLittleReceived",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V3TooMuchRequested",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "minAmountOutReceived",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountReceived",
            "type": "uint256"
          }
        ],
        "name": "V4TooLittleReceived",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "maxAmountInRequested",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountRequested",
            "type": "uint256"
          }
        ],
        "name": "V4TooMuchRequested",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V3_POSITION_MANAGER",
        "outputs": [
          {
            "internalType": "contract INonfungiblePositionManager",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "V4_POSITION_MANAGER",
        "outputs": [
          {
            "internalType": "contract IPositionManager",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "commands",
            "type": "bytes"
          },
          {
            "internalType": "bytes[]",
            "name": "inputs",
            "type": "bytes[]"
          }
        ],
        "name": "execute",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "commands",
            "type": "bytes"
          },
          {
            "internalType": "bytes[]",
            "name": "inputs",
            "type": "bytes[]"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "execute",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "msgSender",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "poolManager",
        "outputs": [
          {
            "internalType": "contract IPoolManager",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "int256",
            "name": "amount0Delta",
            "type": "int256"
          },
          {
            "internalType": "int256",
            "name": "amount1Delta",
            "type": "int256"
          },
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          }
        ],
        "name": "uniswapV3SwapCallback",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          }
        ],
        "name": "unlockCallback",
        "outputs": [
          {
            "internalType": "bytes",
            "name": "",
            "type": "bytes"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "stateMutability": "payable",
        "type": "receive"
      }
    ],
  },
  { //https://inkypump.com/
    address: '0x1D74317d760f2c72A94386f50E8D10f2C902b899',
    name: 'ERC1967Proxy',
    deployBlock: 1895455, // Set to actual deploy block for faster backfill
    abi: [
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "implementation",
            "type": "address"
          },
          {
            "internalType": "bytes",
            "name": "_data",
            "type": "bytes"
          }
        ],
        "stateMutability": "payable",
        "type": "constructor"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "target",
            "type": "address"
          }
        ],
        "name": "AddressEmptyCode",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "implementation",
            "type": "address"
          }
        ],
        "name": "ERC1967InvalidImplementation",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "ERC1967NonPayable",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "FailedInnerCall",
        "type": "error"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "implementation",
            "type": "address"
          }
        ],
        "name": "Upgraded",
        "type": "event"
      },
      {
        "stateMutability": "payable",
        "type": "fallback"
      }
    ],
  },
  { // https://app.tydro.com/ func being called: depositeETH + BorrowETH
    address: '0xDe090EfCD6ef4b86792e2D84E55a5fa8d49D25D2',
    name: 'WrappedTokenGatewayV3',
    deployBlock: 19954050, // Set to actual deploy block for faster backfill
    fetchTransactions: true,
    abi: [
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "weth",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "owner",
            "type": "address"
          },
          {
            "internalType": "contract IPool",
            "name": "pool",
            "type": "address"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "previousOwner",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "OwnershipTransferred",
        "type": "event"
      },
      {
        "stateMutability": "payable",
        "type": "fallback"
      },
      {
        "inputs": [],
        "name": "POOL",
        "outputs": [
          {
            "internalType": "contract IPool",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "WETH",
        "outputs": [
          {
            "internalType": "contract IWETH",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "uint16",
            "name": "referralCode",
            "type": "uint16"
          }
        ],
        "name": "borrowETH",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "onBehalfOf",
            "type": "address"
          },
          {
            "internalType": "uint16",
            "name": "referralCode",
            "type": "uint16"
          }
        ],
        "name": "depositETH",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "emergencyEtherTransfer",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "emergencyTokenTransfer",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "getWETHAddress",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "owner",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "renounceOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "onBehalfOf",
            "type": "address"
          }
        ],
        "name": "repayETH",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "transferOwnership",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          }
        ],
        "name": "withdrawETH",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          },
          {
            "internalType": "uint8",
            "name": "permitV",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "permitR",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "permitS",
            "type": "bytes32"
          }
        ],
        "name": "withdrawETHWithPermit",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "stateMutability": "payable",
        "type": "receive"
      }
    ],
  },
  { // https://app.tydro.com/ - Tydro Pool contract for Borrow transactions
    address: '0x2816cf15F6d2A220E789aA011D5EE4eB6c47FEbA',
    name: 'TydroPool',
    deployBlock: 19954047, // Set to actual deploy block for faster backfill
    fetchTransactions: true,
    abi: [],
  },
  { //https://velodrome.finance/swap func being called: execute
    address: '0x01D40099fCD87C018969B0e8D4aB1633Fb34763C',
    name: 'UniversalRouter',
    deployBlock: 16728376, // Set to actual deploy block for faster backfill
    fetchTransactions: true,
    abi: [
      {
        "inputs": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "permit2",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "weth9",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "v2Factory",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "v3Factory",
                "type": "address"
              },
              {
                "internalType": "bytes32",
                "name": "pairInitCodeHash",
                "type": "bytes32"
              },
              {
                "internalType": "bytes32",
                "name": "poolInitCodeHash",
                "type": "bytes32"
              },
              {
                "internalType": "address",
                "name": "v4PoolManager",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "veloV2Factory",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "veloCLFactory",
                "type": "address"
              },
              {
                "internalType": "bytes32",
                "name": "veloV2InitCodeHash",
                "type": "bytes32"
              },
              {
                "internalType": "bytes32",
                "name": "veloCLInitCodeHash",
                "type": "bytes32"
              }
            ],
            "internalType": "struct RouterDeployParameters",
            "name": "params",
            "type": "tuple"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "inputs": [],
        "name": "BalanceTooLow",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "ContractLocked",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "Currency",
            "name": "currency",
            "type": "address"
          }
        ],
        "name": "DeltaNotNegative",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "Currency",
            "name": "currency",
            "type": "address"
          }
        ],
        "name": "DeltaNotPositive",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "ETHNotAccepted",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "commandIndex",
            "type": "uint256"
          },
          {
            "internalType": "bytes",
            "name": "message",
            "type": "bytes"
          }
        ],
        "name": "ExecutionFailed",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "FromAddressIsNotOwner",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InputLengthMismatch",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InsufficientBalance",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InsufficientETH",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InsufficientToken",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidBips",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint8",
            "name": "bridgeType",
            "type": "uint8"
          }
        ],
        "name": "InvalidBridgeType",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "commandType",
            "type": "uint256"
          }
        ],
        "name": "InvalidCommandType",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidEthSender",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidPath",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidRecipient",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidReserves",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidTokenAddress",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "LengthMismatch",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "NotPoolManager",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "SliceOutOfBounds",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "StableExactOutputUnsupported",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "TransactionDeadlinePassed",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "UnsafeCast",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "action",
            "type": "uint256"
          }
        ],
        "name": "UnsupportedAction",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V2InvalidPath",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V2TooLittleReceived",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V2TooMuchRequested",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V3InvalidAmountOut",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V3InvalidCaller",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V3InvalidSwap",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V3TooLittleReceived",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "V3TooMuchRequested",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "minAmountOutReceived",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountReceived",
            "type": "uint256"
          }
        ],
        "name": "V4TooLittleReceived",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "maxAmountInRequested",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountRequested",
            "type": "uint256"
          }
        ],
        "name": "V4TooMuchRequested",
        "type": "error"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "caller",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "localRouter",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "uint32",
            "name": "destinationDomain",
            "type": "uint32"
          },
          {
            "indexed": false,
            "internalType": "bytes32",
            "name": "commitment",
            "type": "bytes32"
          }
        ],
        "name": "CrossChainSwap",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "uint32",
            "name": "domain",
            "type": "uint32"
          }
        ],
        "name": "UniversalRouterBridge",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          }
        ],
        "name": "UniversalRouterSwap",
        "type": "event"
      },
      {
        "inputs": [],
        "name": "OPTIMISM_CHAIN_ID",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "PERMIT2",
        "outputs": [
          {
            "internalType": "contract IPermit2",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "UNISWAP_V2_FACTORY",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "UNISWAP_V2_PAIR_INIT_CODE_HASH",
        "outputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "UNISWAP_V3_FACTORY",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "UNISWAP_V3_POOL_INIT_CODE_HASH",
        "outputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "VELODROME_CL_FACTORY",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "VELODROME_CL_POOL_INIT_CODE_HASH",
        "outputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "VELODROME_V2_FACTORY",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "VELODROME_V2_INIT_CODE_HASH",
        "outputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "WETH9",
        "outputs": [
          {
            "internalType": "contract IWETH9",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "commands",
            "type": "bytes"
          },
          {
            "internalType": "bytes[]",
            "name": "inputs",
            "type": "bytes[]"
          }
        ],
        "name": "execute",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "commands",
            "type": "bytes"
          },
          {
            "internalType": "bytes[]",
            "name": "inputs",
            "type": "bytes[]"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "execute",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "msgSender",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "poolManager",
        "outputs": [
          {
            "internalType": "contract IPoolManager",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "int256",
            "name": "amount0Delta",
            "type": "int256"
          },
          {
            "internalType": "int256",
            "name": "amount1Delta",
            "type": "int256"
          },
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          }
        ],
        "name": "uniswapV3SwapCallback",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "data",
            "type": "bytes"
          }
        ],
        "name": "unlockCallback",
        "outputs": [
          {
            "internalType": "bytes",
            "name": "",
            "type": "bytes"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "stateMutability": "payable",
        "type": "receive"
      }
    ],
  },
  { //https://dyorswap.finance/swap/ func being called: swapExactETHForTokensSupportingFeeOnTransferTokens
    address: '0x9b17690dE96FcFA80a3acaEFE11d936629cd7a77',
    name: 'DyorRouterV2',
    deployBlock: 933619, // Set to actual deploy block for faster backfill
    fetchTransactions: true,
    abi: [
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "_factory",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "_WETH",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "_feeToSetter",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "_feeTo",
            "type": "address"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "inputs": [],
        "name": "WETH",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "tokenA",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "tokenB",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amountADesired",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountBDesired",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountAMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountBMin",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "addLiquidity",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountA",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountB",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "liquidity",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amountTokenDesired",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountTokenMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountETHMin",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "addLiquidityETH",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountToken",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountETH",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "liquidity",
            "type": "uint256"
          }
        ],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "factory",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "name": "feeCurrency",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "feeTo",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "feeToSetter",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountOut",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "reserveIn",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "reserveOut",
            "type": "uint256"
          }
        ],
        "name": "getAmountIn",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountIn",
            "type": "uint256"
          }
        ],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountIn",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "reserveIn",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "reserveOut",
            "type": "uint256"
          }
        ],
        "name": "getAmountOut",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountOut",
            "type": "uint256"
          }
        ],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountOut",
            "type": "uint256"
          },
          {
            "internalType": "address[]",
            "name": "path",
            "type": "address[]"
          }
        ],
        "name": "getAmountsIn",
        "outputs": [
          {
            "internalType": "uint256[]",
            "name": "amounts",
            "type": "uint256[]"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountIn",
            "type": "uint256"
          },
          {
            "internalType": "address[]",
            "name": "path",
            "type": "address[]"
          }
        ],
        "name": "getAmountsOut",
        "outputs": [
          {
            "internalType": "uint256[]",
            "name": "amounts",
            "type": "uint256[]"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountA",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "reserveA",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "reserveB",
            "type": "uint256"
          }
        ],
        "name": "quote",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountB",
            "type": "uint256"
          }
        ],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "ratePercent",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "tokenA",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "tokenB",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "liquidity",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountAMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountBMin",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "removeLiquidity",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountA",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountB",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "liquidity",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountTokenMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountETHMin",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "removeLiquidityETH",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountToken",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountETH",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "liquidity",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountTokenMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountETHMin",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "removeLiquidityETHSupportingFeeOnTransferTokens",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountETH",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "liquidity",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountTokenMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountETHMin",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "approveMax",
            "type": "bool"
          },
          {
            "internalType": "uint8",
            "name": "v",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "r",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "s",
            "type": "bytes32"
          }
        ],
        "name": "removeLiquidityETHWithPermit",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountToken",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountETH",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "liquidity",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountTokenMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountETHMin",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "approveMax",
            "type": "bool"
          },
          {
            "internalType": "uint8",
            "name": "v",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "r",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "s",
            "type": "bytes32"
          }
        ],
        "name": "removeLiquidityETHWithPermitSupportingFeeOnTransferTokens",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountETH",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "tokenA",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "tokenB",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "liquidity",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountAMin",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountBMin",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          },
          {
            "internalType": "bool",
            "name": "approveMax",
            "type": "bool"
          },
          {
            "internalType": "uint8",
            "name": "v",
            "type": "uint8"
          },
          {
            "internalType": "bytes32",
            "name": "r",
            "type": "bytes32"
          },
          {
            "internalType": "bytes32",
            "name": "s",
            "type": "bytes32"
          }
        ],
        "name": "removeLiquidityWithPermit",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "amountA",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountB",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "currency",
            "type": "address"
          },
          {
            "internalType": "bool",
            "name": "fee",
            "type": "bool"
          }
        ],
        "name": "setFeeCurrency",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address[]",
            "name": "currencyList",
            "type": "address[]"
          },
          {
            "internalType": "bool",
            "name": "fee",
            "type": "bool"
          }
        ],
        "name": "setFeeCurrencyList",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "_feeTo",
            "type": "address"
          }
        ],
        "name": "setFeeTo",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "_feeToSetter",
            "type": "address"
          }
        ],
        "name": "setFeeToSetter",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "_ratePercent",
            "type": "uint256"
          }
        ],
        "name": "setRatePercent",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountOut",
            "type": "uint256"
          },
          {
            "internalType": "address[]",
            "name": "path",
            "type": "address[]"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "swapETHForExactTokens",
        "outputs": [
          {
            "internalType": "uint256[]",
            "name": "amounts",
            "type": "uint256[]"
          }
        ],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountOutMin",
            "type": "uint256"
          },
          {
            "internalType": "address[]",
            "name": "path",
            "type": "address[]"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "swapExactETHForTokens",
        "outputs": [
          {
            "internalType": "uint256[]",
            "name": "amounts",
            "type": "uint256[]"
          }
        ],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountOutMin",
            "type": "uint256"
          },
          {
            "internalType": "address[]",
            "name": "path",
            "type": "address[]"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "swapExactETHForTokensSupportingFeeOnTransferTokens",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountIn",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountOutMin",
            "type": "uint256"
          },
          {
            "internalType": "address[]",
            "name": "path",
            "type": "address[]"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "swapExactTokensForETH",
        "outputs": [
          {
            "internalType": "uint256[]",
            "name": "amounts",
            "type": "uint256[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountIn",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountOutMin",
            "type": "uint256"
          },
          {
            "internalType": "address[]",
            "name": "path",
            "type": "address[]"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "swapExactTokensForETHSupportingFeeOnTransferTokens",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountIn",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountOutMin",
            "type": "uint256"
          },
          {
            "internalType": "address[]",
            "name": "path",
            "type": "address[]"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "swapExactTokensForTokens",
        "outputs": [
          {
            "internalType": "uint256[]",
            "name": "amounts",
            "type": "uint256[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountIn",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountOutMin",
            "type": "uint256"
          },
          {
            "internalType": "address[]",
            "name": "path",
            "type": "address[]"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "swapExactTokensForTokensSupportingFeeOnTransferTokens",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountOut",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountInMax",
            "type": "uint256"
          },
          {
            "internalType": "address[]",
            "name": "path",
            "type": "address[]"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "swapTokensForExactETH",
        "outputs": [
          {
            "internalType": "uint256[]",
            "name": "amounts",
            "type": "uint256[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amountOut",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amountInMax",
            "type": "uint256"
          },
          {
            "internalType": "address[]",
            "name": "path",
            "type": "address[]"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "deadline",
            "type": "uint256"
          }
        ],
        "name": "swapTokensForExactTokens",
        "outputs": [
          {
            "internalType": "uint256[]",
            "name": "amounts",
            "type": "uint256[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "stateMutability": "payable",
        "type": "receive"
      }
    ],
  },
  { //https://www.curve.finance/dex/ink/swap func being called: exchange
    address: '0xd7E72f3615aa65b92A4DBdC211E296a35512988B',
    name: 'CurveRouter',
    deployBlock: 2761426, // Set to actual deploy block for faster backfill
    fetchTransactions: true,
    abi: [
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "name": "sender",
            "type": "address"
          },
          {
            "indexed": true,
            "name": "receiver",
            "type": "address"
          },
          {
            "indexed": false,
            "name": "route",
            "type": "address[11]"
          },
          {
            "indexed": false,
            "name": "swap_params",
            "type": "uint256[4][5]"
          },
          {
            "indexed": false,
            "name": "in_amount",
            "type": "uint256"
          },
          {
            "indexed": false,
            "name": "out_amount",
            "type": "uint256"
          }
        ],
        "name": "Exchange",
        "type": "event"
      },
      {
        "stateMutability": "payable",
        "type": "fallback"
      },
      {
        "inputs": [
          {
            "name": "_weth",
            "type": "address"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "inputs": [
          {
            "name": "_route",
            "type": "address[11]"
          },
          {
            "name": "_swap_params",
            "type": "uint256[4][5]"
          },
          {
            "name": "_amount",
            "type": "uint256"
          },
          {
            "name": "_min_dy",
            "type": "uint256"
          }
        ],
        "name": "exchange",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "_route",
            "type": "address[11]"
          },
          {
            "name": "_swap_params",
            "type": "uint256[4][5]"
          },
          {
            "name": "_amount",
            "type": "uint256"
          },
          {
            "name": "_min_dy",
            "type": "uint256"
          },
          {
            "name": "_receiver",
            "type": "address"
          }
        ],
        "name": "exchange",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "_route",
            "type": "address[11]"
          },
          {
            "name": "_swap_params",
            "type": "uint256[4][5]"
          },
          {
            "name": "_amount",
            "type": "uint256"
          }
        ],
        "name": "get_dy",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "_route",
            "type": "address[11]"
          },
          {
            "name": "_swap_params",
            "type": "uint256[4][5]"
          },
          {
            "name": "_out_amount",
            "type": "uint256"
          }
        ],
        "name": "get_dx",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "name": "_route",
            "type": "address[11]"
          },
          {
            "name": "_swap_params",
            "type": "uint256[4][5]"
          },
          {
            "name": "_out_amount",
            "type": "uint256"
          },
          {
            "name": "_base_pools",
            "type": "address[5]"
          }
        ],
        "name": "get_dx",
        "outputs": [
          {
            "name": "",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "version",
        "outputs": [
          {
            "name": "",
            "type": "string"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      }
    ],
  },
  { //https://www.gas.zip/
    address: '0x2a37D63EAdFe4b4682a3c28C1c2cD4F109Cc2762',
    name: 'GasZipV2',
    deployBlock: 5946389, // Set to actual deploy block for faster backfill
    fetchTransactions: true,
    abi: [{ "inputs": [{ "internalType": "address", "name": "_owner", "type": "address" }], "stateMutability": "nonpayable", "type": "constructor" }, { "anonymous": false, "inputs": [{ "indexed": false, "internalType": "address", "name": "from", "type": "address" }, { "indexed": false, "internalType": "uint256", "name": "chains", "type": "uint256" }, { "indexed": false, "internalType": "uint256", "name": "amount", "type": "uint256" }, { "indexed": false, "internalType": "bytes32", "name": "to", "type": "bytes32" }], "name": "Deposit", "type": "event" }, { "inputs": [{ "internalType": "uint256", "name": "chains", "type": "uint256" }, { "internalType": "address", "name": "to", "type": "address" }], "name": "deposit", "outputs": [], "stateMutability": "payable", "type": "function" }, { "inputs": [{ "internalType": "uint256", "name": "chains", "type": "uint256" }, { "internalType": "bytes32", "name": "to", "type": "bytes32" }], "name": "deposit", "outputs": [], "stateMutability": "payable", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "_owner", "type": "address" }], "name": "newOwner", "outputs": [], "stateMutability": "nonpayable", "type": "function" }, { "inputs": [], "name": "owner", "outputs": [{ "internalType": "address", "name": "", "type": "address" }], "stateMutability": "view", "type": "function" }, { "inputs": [{ "internalType": "address", "name": "token", "type": "address" }], "name": "withdraw", "outputs": [], "stateMutability": "nonpayable", "type": "function" }],
  },
  { //https://relay.link/bridge/ink?includeChainIds=57073
    address: '0x4cD00E387622C35bDDB9b4c962C136462338BC31',
    name: 'RelayDepository',
    deployBlock: 17521844, // Set to actual deploy block for faster backfill
    fetchTransactions: true,
    abi: [
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "_owner",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "_allocator",
            "type": "address"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "inputs": [],
        "name": "AddressCannotBeZero",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "AlreadyInitialized",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "returnData",
            "type": "bytes"
          }
        ],
        "name": "CallFailed",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "CallRequestAlreadyUsed",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "CallRequestExpired",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidSignature",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "NewOwnerIsZeroAddress",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "NoHandoverRequest",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "Unauthorized",
        "type": "error"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "pendingOwner",
            "type": "address"
          }
        ],
        "name": "OwnershipHandoverCanceled",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "pendingOwner",
            "type": "address"
          }
        ],
        "name": "OwnershipHandoverRequested",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "oldOwner",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "OwnershipTransferred",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "bytes32",
            "name": "id",
            "type": "bytes32"
          },
          {
            "components": [
              {
                "internalType": "address",
                "name": "to",
                "type": "address"
              },
              {
                "internalType": "bytes",
                "name": "data",
                "type": "bytes"
              },
              {
                "internalType": "uint256",
                "name": "value",
                "type": "uint256"
              },
              {
                "internalType": "bool",
                "name": "allowFailure",
                "type": "bool"
              }
            ],
            "indexed": false,
            "internalType": "struct Call",
            "name": "call",
            "type": "tuple"
          }
        ],
        "name": "RelayCallExecuted",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "address",
            "name": "from",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "bytes32",
            "name": "id",
            "type": "bytes32"
          }
        ],
        "name": "RelayErc20Deposit",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "address",
            "name": "from",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "bytes32",
            "name": "id",
            "type": "bytes32"
          }
        ],
        "name": "RelayNativeDeposit",
        "type": "event"
      },
      {
        "inputs": [],
        "name": "_CALL_REQUEST_TYPEHASH",
        "outputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "_CALL_TYPEHASH",
        "outputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "allocator",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "name": "callRequests",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "cancelOwnershipHandover",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "pendingOwner",
            "type": "address"
          }
        ],
        "name": "completeOwnershipHandover",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "depositor",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "id",
            "type": "bytes32"
          }
        ],
        "name": "depositErc20",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "depositor",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "id",
            "type": "bytes32"
          }
        ],
        "name": "depositErc20",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "depositor",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "id",
            "type": "bytes32"
          }
        ],
        "name": "depositNative",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "eip712Domain",
        "outputs": [
          {
            "internalType": "bytes1",
            "name": "fields",
            "type": "bytes1"
          },
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "version",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "chainId",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "verifyingContract",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "salt",
            "type": "bytes32"
          },
          {
            "internalType": "uint256[]",
            "name": "extensions",
            "type": "uint256[]"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "address",
                    "name": "to",
                    "type": "address"
                  },
                  {
                    "internalType": "bytes",
                    "name": "data",
                    "type": "bytes"
                  },
                  {
                    "internalType": "uint256",
                    "name": "value",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bool",
                    "name": "allowFailure",
                    "type": "bool"
                  }
                ],
                "internalType": "struct Call[]",
                "name": "calls",
                "type": "tuple[]"
              },
              {
                "internalType": "uint256",
                "name": "nonce",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "expiration",
                "type": "uint256"
              }
            ],
            "internalType": "struct CallRequest",
            "name": "request",
            "type": "tuple"
          },
          {
            "internalType": "bytes",
            "name": "signature",
            "type": "bytes"
          }
        ],
        "name": "execute",
        "outputs": [
          {
            "components": [
              {
                "internalType": "bool",
                "name": "success",
                "type": "bool"
              },
              {
                "internalType": "bytes",
                "name": "returnData",
                "type": "bytes"
              }
            ],
            "internalType": "struct CallResult[]",
            "name": "results",
            "type": "tuple[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "owner",
        "outputs": [
          {
            "internalType": "address",
            "name": "result",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "pendingOwner",
            "type": "address"
          }
        ],
        "name": "ownershipHandoverExpiresAt",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "result",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "renounceOwnership",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "requestOwnershipHandover",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "_allocator",
            "type": "address"
          }
        ],
        "name": "setAllocator",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "transferOwnership",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      }
    ],
  },
  { //https://owlto.finance/
    address: '0x7CFE8Aa0d8E92CCbBDfB12b95AEB7a54ec40f0F5',
    name: 'Owlto',
    deployBlock: 999464, // Set to actual deploy block for faster backfill
    fetchTransactions: true,
    abi: [],
  },
  { //https://inkonchain.com/
    address: '0x4cD00E387622C35bDDB9b4c962C136462338BC31',
    name: 'RelayDepository',
    deployBlock: 17521844, // Set to actual deploy block for faster backfill
    fetchTransactions: true,
    abi: [
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "_owner",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "_allocator",
            "type": "address"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "inputs": [],
        "name": "AddressCannotBeZero",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "AlreadyInitialized",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "bytes",
            "name": "returnData",
            "type": "bytes"
          }
        ],
        "name": "CallFailed",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "CallRequestAlreadyUsed",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "CallRequestExpired",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidSignature",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "NewOwnerIsZeroAddress",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "NoHandoverRequest",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "Unauthorized",
        "type": "error"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "pendingOwner",
            "type": "address"
          }
        ],
        "name": "OwnershipHandoverCanceled",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "pendingOwner",
            "type": "address"
          }
        ],
        "name": "OwnershipHandoverRequested",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": true,
            "internalType": "address",
            "name": "oldOwner",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "OwnershipTransferred",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "bytes32",
            "name": "id",
            "type": "bytes32"
          },
          {
            "components": [
              {
                "internalType": "address",
                "name": "to",
                "type": "address"
              },
              {
                "internalType": "bytes",
                "name": "data",
                "type": "bytes"
              },
              {
                "internalType": "uint256",
                "name": "value",
                "type": "uint256"
              },
              {
                "internalType": "bool",
                "name": "allowFailure",
                "type": "bool"
              }
            ],
            "indexed": false,
            "internalType": "struct Call",
            "name": "call",
            "type": "tuple"
          }
        ],
        "name": "RelayCallExecuted",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "address",
            "name": "from",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "bytes32",
            "name": "id",
            "type": "bytes32"
          }
        ],
        "name": "RelayErc20Deposit",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "address",
            "name": "from",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "indexed": false,
            "internalType": "bytes32",
            "name": "id",
            "type": "bytes32"
          }
        ],
        "name": "RelayNativeDeposit",
        "type": "event"
      },
      {
        "inputs": [],
        "name": "_CALL_REQUEST_TYPEHASH",
        "outputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "_CALL_TYPEHASH",
        "outputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "allocator",
        "outputs": [
          {
            "internalType": "address",
            "name": "",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "",
            "type": "bytes32"
          }
        ],
        "name": "callRequests",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "cancelOwnershipHandover",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "pendingOwner",
            "type": "address"
          }
        ],
        "name": "completeOwnershipHandover",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "depositor",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "id",
            "type": "bytes32"
          }
        ],
        "name": "depositErc20",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "depositor",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          },
          {
            "internalType": "bytes32",
            "name": "id",
            "type": "bytes32"
          }
        ],
        "name": "depositErc20",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "depositor",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "id",
            "type": "bytes32"
          }
        ],
        "name": "depositNative",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "eip712Domain",
        "outputs": [
          {
            "internalType": "bytes1",
            "name": "fields",
            "type": "bytes1"
          },
          {
            "internalType": "string",
            "name": "name",
            "type": "string"
          },
          {
            "internalType": "string",
            "name": "version",
            "type": "string"
          },
          {
            "internalType": "uint256",
            "name": "chainId",
            "type": "uint256"
          },
          {
            "internalType": "address",
            "name": "verifyingContract",
            "type": "address"
          },
          {
            "internalType": "bytes32",
            "name": "salt",
            "type": "bytes32"
          },
          {
            "internalType": "uint256[]",
            "name": "extensions",
            "type": "uint256[]"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "address",
                    "name": "to",
                    "type": "address"
                  },
                  {
                    "internalType": "bytes",
                    "name": "data",
                    "type": "bytes"
                  },
                  {
                    "internalType": "uint256",
                    "name": "value",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bool",
                    "name": "allowFailure",
                    "type": "bool"
                  }
                ],
                "internalType": "struct Call[]",
                "name": "calls",
                "type": "tuple[]"
              },
              {
                "internalType": "uint256",
                "name": "nonce",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "expiration",
                "type": "uint256"
              }
            ],
            "internalType": "struct CallRequest",
            "name": "request",
            "type": "tuple"
          },
          {
            "internalType": "bytes",
            "name": "signature",
            "type": "bytes"
          }
        ],
        "name": "execute",
        "outputs": [
          {
            "components": [
              {
                "internalType": "bool",
                "name": "success",
                "type": "bool"
              },
              {
                "internalType": "bytes",
                "name": "returnData",
                "type": "bytes"
              }
            ],
            "internalType": "struct CallResult[]",
            "name": "results",
            "type": "tuple[]"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "owner",
        "outputs": [
          {
            "internalType": "address",
            "name": "result",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "pendingOwner",
            "type": "address"
          }
        ],
        "name": "ownershipHandoverExpiresAt",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "result",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "renounceOwnership",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "requestOwnershipHandover",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "_allocator",
            "type": "address"
          }
        ],
        "name": "setAllocator",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "newOwner",
            "type": "address"
          }
        ],
        "name": "transferOwnership",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
      }
    ],
  },

  { //https://www.netprotocol.app/  func fulfillOrder
    address: '0xD00C96804e9fF35f10C7D2a92239C351Ff3F94e5',
    name: 'Seaport',
    deployBlock: 1069213, // Set to actual deploy block for faster backfill
    fetchTransactions: true,
    abi: [
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "conduitController",
            "type": "address"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "constructor"
      },
      {
        "inputs": [],
        "name": "BadContractSignature",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "BadFraction",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "from",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "BadReturnValueFromERC20OnTransfer",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint8",
            "name": "v",
            "type": "uint8"
          }
        ],
        "name": "BadSignatureV",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "CannotCancelOrder",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "ConsiderationCriteriaResolverOutOfRange",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "ConsiderationLengthNotEqualToTotalOriginal",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "orderIndex",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "considerationIndex",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "shortfallAmount",
            "type": "uint256"
          }
        ],
        "name": "ConsiderationNotMet",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "CriteriaNotEnabledForItem",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "from",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256[]",
            "name": "identifiers",
            "type": "uint256[]"
          },
          {
            "internalType": "uint256[]",
            "name": "amounts",
            "type": "uint256[]"
          }
        ],
        "name": "ERC1155BatchTransferGenericFailure",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InexactFraction",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InsufficientNativeTokensSupplied",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "Invalid1155BatchTransferEncoding",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidBasicOrderParameterEncoding",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "conduit",
            "type": "address"
          }
        ],
        "name": "InvalidCallToConduit",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "conduitKey",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "conduit",
            "type": "address"
          }
        ],
        "name": "InvalidConduit",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          }
        ],
        "name": "InvalidContractOrder",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "InvalidERC721TransferAmount",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidFulfillmentComponentData",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "value",
            "type": "uint256"
          }
        ],
        "name": "InvalidMsgValue",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidNativeOfferItem",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidProof",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          }
        ],
        "name": "InvalidRestrictedOrder",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidSignature",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "InvalidSigner",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "startTime",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "endTime",
            "type": "uint256"
          }
        ],
        "name": "InvalidTime",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "fulfillmentIndex",
            "type": "uint256"
          }
        ],
        "name": "MismatchedFulfillmentOfferAndConsiderationComponents",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "enum Side",
            "name": "side",
            "type": "uint8"
          }
        ],
        "name": "MissingFulfillmentComponentOnAggregation",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "MissingItemAmount",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "MissingOriginalConsiderationItems",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "account",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "NativeTokenTransferGenericFailure",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "account",
            "type": "address"
          }
        ],
        "name": "NoContract",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "NoReentrantCalls",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "NoSpecifiedOrdersAvailable",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "OfferAndConsiderationRequiredOnFulfillment",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "OfferCriteriaResolverOutOfRange",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          }
        ],
        "name": "OrderAlreadyFilled",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "enum Side",
            "name": "side",
            "type": "uint8"
          }
        ],
        "name": "OrderCriteriaResolverOutOfRange",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          }
        ],
        "name": "OrderIsCancelled",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          }
        ],
        "name": "OrderPartiallyFilled",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "PartialFillsNotEnabledForOrder",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "TStoreAlreadyActivated",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "TStoreNotSupported",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "TloadTestContractDeploymentFailed",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "token",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "from",
            "type": "address"
          },
          {
            "internalType": "address",
            "name": "to",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "identifier",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "amount",
            "type": "uint256"
          }
        ],
        "name": "TokenTransferGenericFailure",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "orderIndex",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "considerationIndex",
            "type": "uint256"
          }
        ],
        "name": "UnresolvedConsiderationCriteria",
        "type": "error"
      },
      {
        "inputs": [
          {
            "internalType": "uint256",
            "name": "orderIndex",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "offerIndex",
            "type": "uint256"
          }
        ],
        "name": "UnresolvedOfferCriteria",
        "type": "error"
      },
      {
        "inputs": [],
        "name": "UnusedItemParameters",
        "type": "error"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "uint256",
            "name": "newCounter",
            "type": "uint256"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "offerer",
            "type": "address"
          }
        ],
        "name": "CounterIncremented",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "offerer",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "zone",
            "type": "address"
          }
        ],
        "name": "OrderCancelled",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "offerer",
            "type": "address"
          },
          {
            "indexed": true,
            "internalType": "address",
            "name": "zone",
            "type": "address"
          },
          {
            "indexed": false,
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "components": [
              {
                "internalType": "enum ItemType",
                "name": "itemType",
                "type": "uint8"
              },
              {
                "internalType": "address",
                "name": "token",
                "type": "address"
              },
              {
                "internalType": "uint256",
                "name": "identifier",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
              }
            ],
            "indexed": false,
            "internalType": "struct SpentItem[]",
            "name": "offer",
            "type": "tuple[]"
          },
          {
            "components": [
              {
                "internalType": "enum ItemType",
                "name": "itemType",
                "type": "uint8"
              },
              {
                "internalType": "address",
                "name": "token",
                "type": "address"
              },
              {
                "internalType": "uint256",
                "name": "identifier",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "amount",
                "type": "uint256"
              },
              {
                "internalType": "address payable",
                "name": "recipient",
                "type": "address"
              }
            ],
            "indexed": false,
            "internalType": "struct ReceivedItem[]",
            "name": "consideration",
            "type": "tuple[]"
          }
        ],
        "name": "OrderFulfilled",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          },
          {
            "components": [
              {
                "internalType": "address",
                "name": "offerer",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "zone",
                "type": "address"
              },
              {
                "components": [
                  {
                    "internalType": "enum ItemType",
                    "name": "itemType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "address",
                    "name": "token",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "identifierOrCriteria",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "startAmount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "endAmount",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct OfferItem[]",
                "name": "offer",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "enum ItemType",
                    "name": "itemType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "address",
                    "name": "token",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "identifierOrCriteria",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "startAmount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "endAmount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "address payable",
                    "name": "recipient",
                    "type": "address"
                  }
                ],
                "internalType": "struct ConsiderationItem[]",
                "name": "consideration",
                "type": "tuple[]"
              },
              {
                "internalType": "enum OrderType",
                "name": "orderType",
                "type": "uint8"
              },
              {
                "internalType": "uint256",
                "name": "startTime",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "endTime",
                "type": "uint256"
              },
              {
                "internalType": "bytes32",
                "name": "zoneHash",
                "type": "bytes32"
              },
              {
                "internalType": "uint256",
                "name": "salt",
                "type": "uint256"
              },
              {
                "internalType": "bytes32",
                "name": "conduitKey",
                "type": "bytes32"
              },
              {
                "internalType": "uint256",
                "name": "totalOriginalConsiderationItems",
                "type": "uint256"
              }
            ],
            "indexed": false,
            "internalType": "struct OrderParameters",
            "name": "orderParameters",
            "type": "tuple"
          }
        ],
        "name": "OrderValidated",
        "type": "event"
      },
      {
        "anonymous": false,
        "inputs": [
          {
            "indexed": false,
            "internalType": "bytes32[]",
            "name": "orderHashes",
            "type": "bytes32[]"
          }
        ],
        "name": "OrdersMatched",
        "type": "event"
      },
      {
        "inputs": [],
        "name": "__activateTstore",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "offerer",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "zone",
                "type": "address"
              },
              {
                "components": [
                  {
                    "internalType": "enum ItemType",
                    "name": "itemType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "address",
                    "name": "token",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "identifierOrCriteria",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "startAmount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "endAmount",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct OfferItem[]",
                "name": "offer",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "enum ItemType",
                    "name": "itemType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "address",
                    "name": "token",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "identifierOrCriteria",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "startAmount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "endAmount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "address payable",
                    "name": "recipient",
                    "type": "address"
                  }
                ],
                "internalType": "struct ConsiderationItem[]",
                "name": "consideration",
                "type": "tuple[]"
              },
              {
                "internalType": "enum OrderType",
                "name": "orderType",
                "type": "uint8"
              },
              {
                "internalType": "uint256",
                "name": "startTime",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "endTime",
                "type": "uint256"
              },
              {
                "internalType": "bytes32",
                "name": "zoneHash",
                "type": "bytes32"
              },
              {
                "internalType": "uint256",
                "name": "salt",
                "type": "uint256"
              },
              {
                "internalType": "bytes32",
                "name": "conduitKey",
                "type": "bytes32"
              },
              {
                "internalType": "uint256",
                "name": "counter",
                "type": "uint256"
              }
            ],
            "internalType": "struct OrderComponents[]",
            "name": "orders",
            "type": "tuple[]"
          }
        ],
        "name": "cancel",
        "outputs": [
          {
            "internalType": "bool",
            "name": "cancelled",
            "type": "bool"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "address",
                    "name": "offerer",
                    "type": "address"
                  },
                  {
                    "internalType": "address",
                    "name": "zone",
                    "type": "address"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct OfferItem[]",
                    "name": "offer",
                    "type": "tuple[]"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "address payable",
                        "name": "recipient",
                        "type": "address"
                      }
                    ],
                    "internalType": "struct ConsiderationItem[]",
                    "name": "consideration",
                    "type": "tuple[]"
                  },
                  {
                    "internalType": "enum OrderType",
                    "name": "orderType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "uint256",
                    "name": "startTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "endTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "zoneHash",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "salt",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "conduitKey",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "totalOriginalConsiderationItems",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct OrderParameters",
                "name": "parameters",
                "type": "tuple"
              },
              {
                "internalType": "uint120",
                "name": "numerator",
                "type": "uint120"
              },
              {
                "internalType": "uint120",
                "name": "denominator",
                "type": "uint120"
              },
              {
                "internalType": "bytes",
                "name": "signature",
                "type": "bytes"
              },
              {
                "internalType": "bytes",
                "name": "extraData",
                "type": "bytes"
              }
            ],
            "internalType": "struct AdvancedOrder",
            "name": "",
            "type": "tuple"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "orderIndex",
                "type": "uint256"
              },
              {
                "internalType": "enum Side",
                "name": "side",
                "type": "uint8"
              },
              {
                "internalType": "uint256",
                "name": "index",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "identifier",
                "type": "uint256"
              },
              {
                "internalType": "bytes32[]",
                "name": "criteriaProof",
                "type": "bytes32[]"
              }
            ],
            "internalType": "struct CriteriaResolver[]",
            "name": "",
            "type": "tuple[]"
          },
          {
            "internalType": "bytes32",
            "name": "fulfillerConduitKey",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          }
        ],
        "name": "fulfillAdvancedOrder",
        "outputs": [
          {
            "internalType": "bool",
            "name": "fulfilled",
            "type": "bool"
          }
        ],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "address",
                    "name": "offerer",
                    "type": "address"
                  },
                  {
                    "internalType": "address",
                    "name": "zone",
                    "type": "address"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct OfferItem[]",
                    "name": "offer",
                    "type": "tuple[]"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "address payable",
                        "name": "recipient",
                        "type": "address"
                      }
                    ],
                    "internalType": "struct ConsiderationItem[]",
                    "name": "consideration",
                    "type": "tuple[]"
                  },
                  {
                    "internalType": "enum OrderType",
                    "name": "orderType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "uint256",
                    "name": "startTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "endTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "zoneHash",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "salt",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "conduitKey",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "totalOriginalConsiderationItems",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct OrderParameters",
                "name": "parameters",
                "type": "tuple"
              },
              {
                "internalType": "uint120",
                "name": "numerator",
                "type": "uint120"
              },
              {
                "internalType": "uint120",
                "name": "denominator",
                "type": "uint120"
              },
              {
                "internalType": "bytes",
                "name": "signature",
                "type": "bytes"
              },
              {
                "internalType": "bytes",
                "name": "extraData",
                "type": "bytes"
              }
            ],
            "internalType": "struct AdvancedOrder[]",
            "name": "",
            "type": "tuple[]"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "orderIndex",
                "type": "uint256"
              },
              {
                "internalType": "enum Side",
                "name": "side",
                "type": "uint8"
              },
              {
                "internalType": "uint256",
                "name": "index",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "identifier",
                "type": "uint256"
              },
              {
                "internalType": "bytes32[]",
                "name": "criteriaProof",
                "type": "bytes32[]"
              }
            ],
            "internalType": "struct CriteriaResolver[]",
            "name": "",
            "type": "tuple[]"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "orderIndex",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "itemIndex",
                "type": "uint256"
              }
            ],
            "internalType": "struct FulfillmentComponent[][]",
            "name": "",
            "type": "tuple[][]"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "orderIndex",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "itemIndex",
                "type": "uint256"
              }
            ],
            "internalType": "struct FulfillmentComponent[][]",
            "name": "",
            "type": "tuple[][]"
          },
          {
            "internalType": "bytes32",
            "name": "fulfillerConduitKey",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          },
          {
            "internalType": "uint256",
            "name": "maximumFulfilled",
            "type": "uint256"
          }
        ],
        "name": "fulfillAvailableAdvancedOrders",
        "outputs": [
          {
            "internalType": "bool[]",
            "name": "",
            "type": "bool[]"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "enum ItemType",
                    "name": "itemType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "address",
                    "name": "token",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "identifier",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "amount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "address payable",
                    "name": "recipient",
                    "type": "address"
                  }
                ],
                "internalType": "struct ReceivedItem",
                "name": "item",
                "type": "tuple"
              },
              {
                "internalType": "address",
                "name": "offerer",
                "type": "address"
              },
              {
                "internalType": "bytes32",
                "name": "conduitKey",
                "type": "bytes32"
              }
            ],
            "internalType": "struct Execution[]",
            "name": "",
            "type": "tuple[]"
          }
        ],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "address",
                    "name": "offerer",
                    "type": "address"
                  },
                  {
                    "internalType": "address",
                    "name": "zone",
                    "type": "address"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct OfferItem[]",
                    "name": "offer",
                    "type": "tuple[]"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "address payable",
                        "name": "recipient",
                        "type": "address"
                      }
                    ],
                    "internalType": "struct ConsiderationItem[]",
                    "name": "consideration",
                    "type": "tuple[]"
                  },
                  {
                    "internalType": "enum OrderType",
                    "name": "orderType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "uint256",
                    "name": "startTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "endTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "zoneHash",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "salt",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "conduitKey",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "totalOriginalConsiderationItems",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct OrderParameters",
                "name": "parameters",
                "type": "tuple"
              },
              {
                "internalType": "bytes",
                "name": "signature",
                "type": "bytes"
              }
            ],
            "internalType": "struct Order[]",
            "name": "",
            "type": "tuple[]"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "orderIndex",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "itemIndex",
                "type": "uint256"
              }
            ],
            "internalType": "struct FulfillmentComponent[][]",
            "name": "",
            "type": "tuple[][]"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "orderIndex",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "itemIndex",
                "type": "uint256"
              }
            ],
            "internalType": "struct FulfillmentComponent[][]",
            "name": "",
            "type": "tuple[][]"
          },
          {
            "internalType": "bytes32",
            "name": "fulfillerConduitKey",
            "type": "bytes32"
          },
          {
            "internalType": "uint256",
            "name": "maximumFulfilled",
            "type": "uint256"
          }
        ],
        "name": "fulfillAvailableOrders",
        "outputs": [
          {
            "internalType": "bool[]",
            "name": "",
            "type": "bool[]"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "enum ItemType",
                    "name": "itemType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "address",
                    "name": "token",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "identifier",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "amount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "address payable",
                    "name": "recipient",
                    "type": "address"
                  }
                ],
                "internalType": "struct ReceivedItem",
                "name": "item",
                "type": "tuple"
              },
              {
                "internalType": "address",
                "name": "offerer",
                "type": "address"
              },
              {
                "internalType": "bytes32",
                "name": "conduitKey",
                "type": "bytes32"
              }
            ],
            "internalType": "struct Execution[]",
            "name": "",
            "type": "tuple[]"
          }
        ],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "considerationToken",
                "type": "address"
              },
              {
                "internalType": "uint256",
                "name": "considerationIdentifier",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "considerationAmount",
                "type": "uint256"
              },
              {
                "internalType": "address payable",
                "name": "offerer",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "zone",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "offerToken",
                "type": "address"
              },
              {
                "internalType": "uint256",
                "name": "offerIdentifier",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "offerAmount",
                "type": "uint256"
              },
              {
                "internalType": "enum BasicOrderType",
                "name": "basicOrderType",
                "type": "uint8"
              },
              {
                "internalType": "uint256",
                "name": "startTime",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "endTime",
                "type": "uint256"
              },
              {
                "internalType": "bytes32",
                "name": "zoneHash",
                "type": "bytes32"
              },
              {
                "internalType": "uint256",
                "name": "salt",
                "type": "uint256"
              },
              {
                "internalType": "bytes32",
                "name": "offererConduitKey",
                "type": "bytes32"
              },
              {
                "internalType": "bytes32",
                "name": "fulfillerConduitKey",
                "type": "bytes32"
              },
              {
                "internalType": "uint256",
                "name": "totalOriginalAdditionalRecipients",
                "type": "uint256"
              },
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "amount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "address payable",
                    "name": "recipient",
                    "type": "address"
                  }
                ],
                "internalType": "struct AdditionalRecipient[]",
                "name": "additionalRecipients",
                "type": "tuple[]"
              },
              {
                "internalType": "bytes",
                "name": "signature",
                "type": "bytes"
              }
            ],
            "internalType": "struct BasicOrderParameters",
            "name": "",
            "type": "tuple"
          }
        ],
        "name": "fulfillBasicOrder",
        "outputs": [
          {
            "internalType": "bool",
            "name": "fulfilled",
            "type": "bool"
          }
        ],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "considerationToken",
                "type": "address"
              },
              {
                "internalType": "uint256",
                "name": "considerationIdentifier",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "considerationAmount",
                "type": "uint256"
              },
              {
                "internalType": "address payable",
                "name": "offerer",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "zone",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "offerToken",
                "type": "address"
              },
              {
                "internalType": "uint256",
                "name": "offerIdentifier",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "offerAmount",
                "type": "uint256"
              },
              {
                "internalType": "enum BasicOrderType",
                "name": "basicOrderType",
                "type": "uint8"
              },
              {
                "internalType": "uint256",
                "name": "startTime",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "endTime",
                "type": "uint256"
              },
              {
                "internalType": "bytes32",
                "name": "zoneHash",
                "type": "bytes32"
              },
              {
                "internalType": "uint256",
                "name": "salt",
                "type": "uint256"
              },
              {
                "internalType": "bytes32",
                "name": "offererConduitKey",
                "type": "bytes32"
              },
              {
                "internalType": "bytes32",
                "name": "fulfillerConduitKey",
                "type": "bytes32"
              },
              {
                "internalType": "uint256",
                "name": "totalOriginalAdditionalRecipients",
                "type": "uint256"
              },
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "amount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "address payable",
                    "name": "recipient",
                    "type": "address"
                  }
                ],
                "internalType": "struct AdditionalRecipient[]",
                "name": "additionalRecipients",
                "type": "tuple[]"
              },
              {
                "internalType": "bytes",
                "name": "signature",
                "type": "bytes"
              }
            ],
            "internalType": "struct BasicOrderParameters",
            "name": "",
            "type": "tuple"
          }
        ],
        "name": "fulfillBasicOrder_efficient_6GL6yc",
        "outputs": [
          {
            "internalType": "bool",
            "name": "fulfilled",
            "type": "bool"
          }
        ],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "address",
                    "name": "offerer",
                    "type": "address"
                  },
                  {
                    "internalType": "address",
                    "name": "zone",
                    "type": "address"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct OfferItem[]",
                    "name": "offer",
                    "type": "tuple[]"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "address payable",
                        "name": "recipient",
                        "type": "address"
                      }
                    ],
                    "internalType": "struct ConsiderationItem[]",
                    "name": "consideration",
                    "type": "tuple[]"
                  },
                  {
                    "internalType": "enum OrderType",
                    "name": "orderType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "uint256",
                    "name": "startTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "endTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "zoneHash",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "salt",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "conduitKey",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "totalOriginalConsiderationItems",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct OrderParameters",
                "name": "parameters",
                "type": "tuple"
              },
              {
                "internalType": "bytes",
                "name": "signature",
                "type": "bytes"
              }
            ],
            "internalType": "struct Order",
            "name": "",
            "type": "tuple"
          },
          {
            "internalType": "bytes32",
            "name": "fulfillerConduitKey",
            "type": "bytes32"
          }
        ],
        "name": "fulfillOrder",
        "outputs": [
          {
            "internalType": "bool",
            "name": "fulfilled",
            "type": "bool"
          }
        ],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "contractOfferer",
            "type": "address"
          }
        ],
        "name": "getContractOffererNonce",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "nonce",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "address",
            "name": "offerer",
            "type": "address"
          }
        ],
        "name": "getCounter",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "counter",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "components": [
              {
                "internalType": "address",
                "name": "offerer",
                "type": "address"
              },
              {
                "internalType": "address",
                "name": "zone",
                "type": "address"
              },
              {
                "components": [
                  {
                    "internalType": "enum ItemType",
                    "name": "itemType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "address",
                    "name": "token",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "identifierOrCriteria",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "startAmount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "endAmount",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct OfferItem[]",
                "name": "offer",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "enum ItemType",
                    "name": "itemType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "address",
                    "name": "token",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "identifierOrCriteria",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "startAmount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "endAmount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "address payable",
                    "name": "recipient",
                    "type": "address"
                  }
                ],
                "internalType": "struct ConsiderationItem[]",
                "name": "consideration",
                "type": "tuple[]"
              },
              {
                "internalType": "enum OrderType",
                "name": "orderType",
                "type": "uint8"
              },
              {
                "internalType": "uint256",
                "name": "startTime",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "endTime",
                "type": "uint256"
              },
              {
                "internalType": "bytes32",
                "name": "zoneHash",
                "type": "bytes32"
              },
              {
                "internalType": "uint256",
                "name": "salt",
                "type": "uint256"
              },
              {
                "internalType": "bytes32",
                "name": "conduitKey",
                "type": "bytes32"
              },
              {
                "internalType": "uint256",
                "name": "counter",
                "type": "uint256"
              }
            ],
            "internalType": "struct OrderComponents",
            "name": "",
            "type": "tuple"
          }
        ],
        "name": "getOrderHash",
        "outputs": [
          {
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "internalType": "bytes32",
            "name": "orderHash",
            "type": "bytes32"
          }
        ],
        "name": "getOrderStatus",
        "outputs": [
          {
            "internalType": "bool",
            "name": "isValidated",
            "type": "bool"
          },
          {
            "internalType": "bool",
            "name": "isCancelled",
            "type": "bool"
          },
          {
            "internalType": "uint256",
            "name": "totalFilled",
            "type": "uint256"
          },
          {
            "internalType": "uint256",
            "name": "totalSize",
            "type": "uint256"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "incrementCounter",
        "outputs": [
          {
            "internalType": "uint256",
            "name": "newCounter",
            "type": "uint256"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "information",
        "outputs": [
          {
            "internalType": "string",
            "name": "version",
            "type": "string"
          },
          {
            "internalType": "bytes32",
            "name": "domainSeparator",
            "type": "bytes32"
          },
          {
            "internalType": "address",
            "name": "conduitController",
            "type": "address"
          }
        ],
        "stateMutability": "view",
        "type": "function"
      },
      {
        "inputs": [
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "address",
                    "name": "offerer",
                    "type": "address"
                  },
                  {
                    "internalType": "address",
                    "name": "zone",
                    "type": "address"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct OfferItem[]",
                    "name": "offer",
                    "type": "tuple[]"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "address payable",
                        "name": "recipient",
                        "type": "address"
                      }
                    ],
                    "internalType": "struct ConsiderationItem[]",
                    "name": "consideration",
                    "type": "tuple[]"
                  },
                  {
                    "internalType": "enum OrderType",
                    "name": "orderType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "uint256",
                    "name": "startTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "endTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "zoneHash",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "salt",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "conduitKey",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "totalOriginalConsiderationItems",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct OrderParameters",
                "name": "parameters",
                "type": "tuple"
              },
              {
                "internalType": "uint120",
                "name": "numerator",
                "type": "uint120"
              },
              {
                "internalType": "uint120",
                "name": "denominator",
                "type": "uint120"
              },
              {
                "internalType": "bytes",
                "name": "signature",
                "type": "bytes"
              },
              {
                "internalType": "bytes",
                "name": "extraData",
                "type": "bytes"
              }
            ],
            "internalType": "struct AdvancedOrder[]",
            "name": "",
            "type": "tuple[]"
          },
          {
            "components": [
              {
                "internalType": "uint256",
                "name": "orderIndex",
                "type": "uint256"
              },
              {
                "internalType": "enum Side",
                "name": "side",
                "type": "uint8"
              },
              {
                "internalType": "uint256",
                "name": "index",
                "type": "uint256"
              },
              {
                "internalType": "uint256",
                "name": "identifier",
                "type": "uint256"
              },
              {
                "internalType": "bytes32[]",
                "name": "criteriaProof",
                "type": "bytes32[]"
              }
            ],
            "internalType": "struct CriteriaResolver[]",
            "name": "",
            "type": "tuple[]"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "orderIndex",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "itemIndex",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct FulfillmentComponent[]",
                "name": "offerComponents",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "orderIndex",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "itemIndex",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct FulfillmentComponent[]",
                "name": "considerationComponents",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct Fulfillment[]",
            "name": "",
            "type": "tuple[]"
          },
          {
            "internalType": "address",
            "name": "recipient",
            "type": "address"
          }
        ],
        "name": "matchAdvancedOrders",
        "outputs": [
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "enum ItemType",
                    "name": "itemType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "address",
                    "name": "token",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "identifier",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "amount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "address payable",
                    "name": "recipient",
                    "type": "address"
                  }
                ],
                "internalType": "struct ReceivedItem",
                "name": "item",
                "type": "tuple"
              },
              {
                "internalType": "address",
                "name": "offerer",
                "type": "address"
              },
              {
                "internalType": "bytes32",
                "name": "conduitKey",
                "type": "bytes32"
              }
            ],
            "internalType": "struct Execution[]",
            "name": "",
            "type": "tuple[]"
          }
        ],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "address",
                    "name": "offerer",
                    "type": "address"
                  },
                  {
                    "internalType": "address",
                    "name": "zone",
                    "type": "address"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct OfferItem[]",
                    "name": "offer",
                    "type": "tuple[]"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "address payable",
                        "name": "recipient",
                        "type": "address"
                      }
                    ],
                    "internalType": "struct ConsiderationItem[]",
                    "name": "consideration",
                    "type": "tuple[]"
                  },
                  {
                    "internalType": "enum OrderType",
                    "name": "orderType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "uint256",
                    "name": "startTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "endTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "zoneHash",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "salt",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "conduitKey",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "totalOriginalConsiderationItems",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct OrderParameters",
                "name": "parameters",
                "type": "tuple"
              },
              {
                "internalType": "bytes",
                "name": "signature",
                "type": "bytes"
              }
            ],
            "internalType": "struct Order[]",
            "name": "",
            "type": "tuple[]"
          },
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "orderIndex",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "itemIndex",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct FulfillmentComponent[]",
                "name": "offerComponents",
                "type": "tuple[]"
              },
              {
                "components": [
                  {
                    "internalType": "uint256",
                    "name": "orderIndex",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "itemIndex",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct FulfillmentComponent[]",
                "name": "considerationComponents",
                "type": "tuple[]"
              }
            ],
            "internalType": "struct Fulfillment[]",
            "name": "",
            "type": "tuple[]"
          }
        ],
        "name": "matchOrders",
        "outputs": [
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "enum ItemType",
                    "name": "itemType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "address",
                    "name": "token",
                    "type": "address"
                  },
                  {
                    "internalType": "uint256",
                    "name": "identifier",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "amount",
                    "type": "uint256"
                  },
                  {
                    "internalType": "address payable",
                    "name": "recipient",
                    "type": "address"
                  }
                ],
                "internalType": "struct ReceivedItem",
                "name": "item",
                "type": "tuple"
              },
              {
                "internalType": "address",
                "name": "offerer",
                "type": "address"
              },
              {
                "internalType": "bytes32",
                "name": "conduitKey",
                "type": "bytes32"
              }
            ],
            "internalType": "struct Execution[]",
            "name": "",
            "type": "tuple[]"
          }
        ],
        "stateMutability": "payable",
        "type": "function"
      },
      {
        "inputs": [],
        "name": "name",
        "outputs": [
          {
            "internalType": "string",
            "name": "",
            "type": "string"
          }
        ],
        "stateMutability": "pure",
        "type": "function"
      },
      {
        "inputs": [
          {
            "components": [
              {
                "components": [
                  {
                    "internalType": "address",
                    "name": "offerer",
                    "type": "address"
                  },
                  {
                    "internalType": "address",
                    "name": "zone",
                    "type": "address"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      }
                    ],
                    "internalType": "struct OfferItem[]",
                    "name": "offer",
                    "type": "tuple[]"
                  },
                  {
                    "components": [
                      {
                        "internalType": "enum ItemType",
                        "name": "itemType",
                        "type": "uint8"
                      },
                      {
                        "internalType": "address",
                        "name": "token",
                        "type": "address"
                      },
                      {
                        "internalType": "uint256",
                        "name": "identifierOrCriteria",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "startAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "uint256",
                        "name": "endAmount",
                        "type": "uint256"
                      },
                      {
                        "internalType": "address payable",
                        "name": "recipient",
                        "type": "address"
                      }
                    ],
                    "internalType": "struct ConsiderationItem[]",
                    "name": "consideration",
                    "type": "tuple[]"
                  },
                  {
                    "internalType": "enum OrderType",
                    "name": "orderType",
                    "type": "uint8"
                  },
                  {
                    "internalType": "uint256",
                    "name": "startTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "uint256",
                    "name": "endTime",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "zoneHash",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "salt",
                    "type": "uint256"
                  },
                  {
                    "internalType": "bytes32",
                    "name": "conduitKey",
                    "type": "bytes32"
                  },
                  {
                    "internalType": "uint256",
                    "name": "totalOriginalConsiderationItems",
                    "type": "uint256"
                  }
                ],
                "internalType": "struct OrderParameters",
                "name": "parameters",
                "type": "tuple"
              },
              {
                "internalType": "bytes",
                "name": "signature",
                "type": "bytes"
              }
            ],
            "internalType": "struct Order[]",
            "name": "",
            "type": "tuple[]"
          }
        ],
        "name": "validate",
        "outputs": [
          {
            "internalType": "bool",
            "name": "",
            "type": "bool"
          }
        ],
        "stateMutability": "nonpayable",
        "type": "function"
      },
      {
        "stateMutability": "payable",
        "type": "receive"
      }
    ],
  },
  //https://mintiq.market  func : buyNFT
  {
    address: '0xBd6A027b85fD5285b1623563BBEf6fADbe396afB',
    name: 'mintiq.market',
    deployBlock: 23378839, // Set to actual deploy block for faster backfill
    fetchTransactions: true,
    abi: [],
  },
  //https://www.squidmarket.xyz/ func : buyItem
  {
    address: '0x9eBf93fdBA9F32aCCAb3D6716322dcCd617a78F3',
    name: 'squidmarket',
    deployBlock: 25314960, // Set to actual deploy block for faster backfill
    fetchTransactions: true,
    abi: [],
  }
];

// Bridge platform hot wallets on Ink chain
// These wallets send bridged funds to users - we track transfers FROM these addresses
export interface BridgeHotWallet {
  platform: string;
  walletAddress: `0x${string}`;
  website: string;
  logo?: string;
  // Optional: method selectors to distinguish sub-platforms (e.g., Relay vs Ink Official)
  methodSelectors?: {
    selector: string;
    subPlatform: string;
  }[];
}

export const BRIDGE_HOT_WALLETS: BridgeHotWallet[] = [
  {
    platform: 'Owlto',
    walletAddress: '0x74F665BE90ffcd9ce9dcA68cB5875570B711CEca',
    website: 'https://owlto.finance/',
    logo: 'https://owlto.finance/favicon.ico',
  },
  {
    platform: 'Orbiter',
    walletAddress: '0x3bDB03ad7363152DFBc185Ee23eBC93F0CF93fd1',
    website: 'https://www.orbiter.finance/',
    logo: 'https://www.orbiter.finance/favicon.ico',
  },
  {
    platform: 'Gas.zip',
    walletAddress: '0x8C826F795466E39acbfF1BB4eEeB759609377ba1',
    website: 'https://www.gas.zip/',
    logo: 'https://www.gas.zip/favicon.ico',
  },
  {
    platform: 'Relay', // Shared wallet for Relay and Ink Official bridge
    walletAddress: '0xf70da97812CB96acDF810712Aa562db8dfA3dbEF',
    website: 'https://relay.link/',
    logo: 'https://relay.link/favicon.ico',
    methodSelectors: [
      { selector: '0x0c6d9703', subPlatform: 'Ink Official' },
      { selector: '0x5819bf3d', subPlatform: 'Ink Official' }, // Bridge IN method
      { selector: '0xce033e52', subPlatform: 'Relay' },
      { selector: '0xc9b9bfcc', subPlatform: 'Relay' },
    ],
  },
];
