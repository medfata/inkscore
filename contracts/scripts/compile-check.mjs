/**
 * Compile-only check for InkScoreStaking.sol — same solc settings as deploy.
 * Usage: node contracts/scripts/compile-check.mjs
 */
import solc from 'solc';
import { solcStandardInput } from './_compile-shared.mjs';

const output = JSON.parse(
  solc.compile(solcStandardInput(), { import: () => ({ error: 'All imports should be inlined' }) })
);

const errors = (output.errors ?? []).filter((e) => e.severity === 'error');
if (errors.length) {
  console.error(errors.map((e) => e.formattedMessage).join('\n'));
  process.exit(1);
}
(output.errors ?? []).forEach((e) => console.error('[solc]', e.formattedMessage.trim()));

const artifact = output.contracts['contracts/InkScoreStaking.sol']?.InkScoreStaking;
if (!artifact?.evm?.bytecode?.object) {
  console.error('Compilation produced no bytecode.');
  process.exit(1);
}
console.log(`OK — bytecode ${artifact.evm.bytecode.object.length} chars`);
