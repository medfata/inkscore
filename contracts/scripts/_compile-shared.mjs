/**
 * Shared helpers for InkScoreStaking deploy/verify scripts.
 * Keeps compilation byte-identical between deployment and verification —
 * a requirement for source-code verification to succeed.
 */

import fs from 'node:fs';
import path from 'node:path';
import * as posix from 'node:path/posix';

export const REPO = path.resolve(import.meta.dirname, '..', '..');
export const ROOT_CONTRACT = path.join(REPO, 'contracts', 'InkScoreStaking.sol');
export const ARTIFACTS = path.join(REPO, 'contracts', 'deployed-staking.json');

/** InkScore Zenith collection accepted by the staking contract */
export const ZENITH_NFT = '0xd0282f4Cb5c6FE4e3F2fecacFcb9477F42ce8c78';

/** Compiler settings — MUST stay in sync with the deployment run */
export const EVM_VERSION = 'cancun';
export const OPTIMIZER_RUNS = 200;

/**
 * Inline all transitive imports into a standard-JSON sources map.
 * Keys equal the import specifiers (bare '@openzeppelin/...' style) or the
 * unit-relative paths derived from them, exactly how solc resolves them.
 */
export function buildSources() {
  const sources = {};
  const queue = [{ unit: 'contracts/InkScoreStaking.sol', fsPath: ROOT_CONTRACT }];

  while (queue.length) {
    const { unit, fsPath } = queue.shift();
    const content = fs.readFileSync(fsPath, 'utf8');
    sources[unit] = { content };

    const importRegex = /import\s+(?:[\w*\s{},]+\s+from\s+)?["']([^"']+)["']\s*;/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const spec = match[1];
      let key, resolved;
      if (!spec.startsWith('.')) {
        key = spec;
        resolved = path.join(REPO, 'node_modules', key);
      } else {
        key = posix.normalize(posix.join(posix.dirname(unit), spec));
        resolved = unit.startsWith('@')
          ? path.join(REPO, 'node_modules', key)
          : path.join(REPO, key);
      }
      if (!sources[key]) queue.push({ unit: key, fsPath: resolved });
    }
  }
  return sources;
}

/** The exact standard-JSON input string used by solc.compile at deploy time. */
export function solcStandardInput() {
  return JSON.stringify({
    language: 'Solidity',
    sources: buildSources(),
    settings: {
      evmVersion: EVM_VERSION,
      optimizer: { enabled: true, runs: OPTIMIZER_RUNS },
      outputSelection: {
        '*': { '*': ['abi', 'evm.bytecode.object'] },
      },
    },
  });
}
