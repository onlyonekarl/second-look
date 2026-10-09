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
import { getTransferSolInstruction } from '@solana-program/system';

const rpc = createSolanaRpc('https://api.devnet.solana.com');
const me = address('EBHUTzoz8MwTS3QcjhtwjguREcR5VagF2n9wXydppjbi');
const { address: friend } = await generateKeyPairSigner();

const { value: latestBlockhash } = await rpc.getLatestBlockhash().send();
const { value: myBefore } = await rpc.getBalance(me).send();

const message = pipe(
  createTransactionMessage({ version: 0 }),
  (tx) => setTransactionMessageFeePayer(me, tx),
  (tx) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, tx),
  (tx) => appendTransactionMessageInstruction(
    getTransferSolInstruction({
      source: createNoopSigner(me),
      destination: friend,
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
  accounts: { encoding: 'base64', addresses: [me, friend] },
}).send();

const [myAfter, friendAfter] = value.accounts;

console.log('Error:', value.err);
console.log('Your balance, before:', myBefore, 'after:', myAfter.lamports);
console.log('New address balance, after:', friendAfter.lamports);
const sent = myBefore - myAfter.lamports;
console.log(`This transaction takes ${sent} lamports (${Number(sent) / 1_000_000_000} SOL) out of your wallet.`);
if (sent > 0n) console.log('Verdict: review carefully before you sign.');