import {
  address,
  createSolanaRpc,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from '@solana/kit';
import { readFileSync } from 'node:fs';

const rpc = createSolanaRpc('https://api.devnet.solana.com');
const me = address('EBHUTzoz8MwTS3QcjhtwjguREcR5VagF2n9wXydppjbi');

// Read the transaction (base64) that the dApp gave you
const base64Tx = readFileSync('tx.txt', 'utf8').trim();

// Decode it so we can read its instructions
const wire = getTransactionDecoder().decode(new Uint8Array(Buffer.from(base64Tx, 'base64')));
const message = getCompiledTransactionMessageDecoder().decode(wire.messageBytes);

// Check each token instruction
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const flags = [];
for (const ix of message.instructions) {
  const program = message.staticAccounts[ix.programAddressIndex];
  if (program !== TOKEN_PROGRAM) continue;
  const kind = ix.data[0];
  if (kind === 4 || kind === 13) {
    flags.push('Token approval: this gives another address the right to spend your tokens.');
  }
  if (kind === 6) {
    flags.push('Ownership change: this hands control of a token account to someone else.');
  }
}

// Simulate to see what happens to your SOL
const { value: before } = await rpc.getBalance(me).send();
const { value } = await rpc.simulateTransaction(base64Tx, {
  encoding: 'base64',
  sigVerify: false,
  replaceRecentBlockhash: true,
  accounts: { encoding: 'base64', addresses: [me] },
}).send();

console.log('Simulation error:', value.err);
if (value.err === null) {
  const sent = before - value.accounts[0].lamports;
  console.log(`SOL leaving your wallet (including fee): ${Number(sent) / 1_000_000_000} SOL`);
} else {
  console.log('SOL leaving your wallet: unknown, because the simulation failed.');
}
console.log(flags.length ? flags.join('\n') : 'No approval or ownership flags.');