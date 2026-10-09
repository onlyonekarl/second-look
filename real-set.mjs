import { createSolanaRpc } from '@solana/kit';
import { readFileSync } from 'node:fs';
import { checkTransaction } from './checker.js';

const MAINNET = 'https://api.mainnet-beta.solana.com';
const rpc = createSolanaRpc(MAINNET);

// One signature or solscan link per line. Lines starting with # are ignored.
const signatures = readFileSync('real-signatures.txt', 'utf8')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => line.split('/tx/').pop().split('?')[0]);

let errors = 0;
for (const signature of signatures) {
  const label = signature.slice(0, 8);
  try {
    const tx = await rpc.getTransaction(signature, {
      encoding: 'base64',
      maxSupportedTransactionVersion: 1,
    }).send();
    if (!tx) {
      errors++;
      console.log(`MISSING  ${label}  transaction not found`);
      continue;
    }
    const r = await checkTransaction(tx.transaction[0], null, MAINNET);
    console.log(`${r.verdict.padEnd(7)}  ${label}  flags=${r.flags.length}  notes=${r.transfers.length}  simulated=${r.simOk}`);
    for (const line of [...r.flags, ...r.transfers]) {
      console.log(`           ${line.slice(0, 100)}`);
    }
  } catch (err) {
    errors++;
    console.log(`ERROR    ${label}  ${err.message}`);
  }
}

console.log(`\n${signatures.length} checked, ${errors} with errors or missing transactions.`);