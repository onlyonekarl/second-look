import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createNoopSigner,
  createSolanaRpc,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import { getApproveInstruction } from '@solana-program/token';

const rpc = createSolanaRpc('https://api.devnet.solana.com');
const me = address('EBHUTzoz8MwTS3QcjhtwjguREcR5VagF2n9wXydppjbi');
const { address: tokenAccount } = await generateKeyPairSigner();
const { address: spender } = await generateKeyPairSigner();

const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();

const message = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayer(me, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
  (tx) => appendTransactionMessageInstruction(
    getApproveInstruction({
      source: tokenAccount,
      delegate: spender,
      owner: createNoopSigner(me),
      amount: 1_000_000n,
    }),
    tx,
  ),
);

const base64Tx = getBase64EncodedWireTransaction(compileTransaction(message));

const { value } = await rpc.simulateTransaction(base64Tx, {
  encoding: 'base64',
  sigVerify: false,
  replaceRecentBlockhash: true,
}).send();

console.log('Error:', value.err);
console.log('Logs:', value.logs);

// Read what the transaction asks for, instead of relying on the logs
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const flags = [];
for (const ix of message.instructions) {
  if (ix.programAddress !== TOKEN_PROGRAM) continue;
  const kind = ix.data[0]; // the first byte says which token instruction this is
  if (kind === 4 || kind === 13) {
    flags.push('Token approval: this gives another address the right to spend your tokens.');
  }
  if (kind === 6) {
    flags.push('Ownership change: this hands control of a token account to someone else.');
  }
}
console.log(flags.length ? flags.join('\n') : 'No approval or ownership flags.');