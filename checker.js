import {
  address,
  createSolanaRpc,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from '@solana/kit';

// SPL Token and Token-2022 share the same core instruction numbers
const TOKEN_PROGRAMS = [
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA', // SPL Token
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb', // Token-2022
];

function decodeMessage(base64Tx) {
  const bytes = Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0));
  const wire = getTransactionDecoder().decode(bytes);
  return getCompiledTransactionMessageDecoder().decode(wire.messageBytes);
}

// The wallet that pays the fee. This is the wallet that would sign.
export function feePayerOf(base64Tx) {
  return decodeMessage(base64Tx).staticAccounts[0];
}

// Checks one base64 transaction. Optional: the wallet to check, and the RPC URL.
// The RPC URL defaults to devnet.
export async function checkTransaction(
  base64Tx,
  owner = null,
  rpcUrl = 'https://api.devnet.solana.com',
) {
  const rpc = createSolanaRpc(rpcUrl);
  const message = decodeMessage(base64Tx);

  const flags = [];     // approvals and ownership changes: do not sign
  const transfers = []; // token transfers: review
  for (const ix of message.instructions) {
    if (!TOKEN_PROGRAMS.includes(message.staticAccounts[ix.programAddressIndex])) continue;
    const kind = ix.data[0];
    if (kind === 4 || kind === 13) {
      flags.push('Token approval: this gives another address the right to spend your tokens.');
    }
    if (kind === 6) {
      flags.push('Ownership change: this hands control of a token account to someone else.');
    }
    if (kind === 3 || kind === 12) {
      transfers.push('Token transfer: this moves tokens from one token account to another. Check the recipient and the amount.');
    }
  }

  // Simulate, without sending anything
  const before = owner ? (await rpc.getBalance(address(owner)).send()).value : null;
  const { value } = await rpc.simulateTransaction(base64Tx, {
    encoding: 'base64',
    sigVerify: false,
    replaceRecentBlockhash: true,
    ...(owner ? { accounts: { encoding: 'base64', addresses: [owner] } } : {}),
  }).send();

  const simOk = value.err === null;
  const sentLamports = simOk && owner ? before - (value.accounts?.[0]?.lamports ?? before) : null;

  let verdict = 'ok';
  if (flags.length > 0 || !simOk) verdict = 'danger';
  else if ((sentLamports !== null && sentLamports > 0n) || transfers.length > 0) verdict = 'review';

  return { simOk, simError: value.err, sentLamports, flags, transfers, verdict };
}