import {
  address,
  createSolanaRpc,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from '@solana/kit';

const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const rpc = createSolanaRpc('https://api.devnet.solana.com');

function decodeMessage(base64Tx) {
  const bytes = Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0));
  const wire = getTransactionDecoder().decode(bytes);
  return getCompiledTransactionMessageDecoder().decode(wire.messageBytes);
}

// The wallet that pays the fee. This is the wallet that would sign.
export function feePayerOf(base64Tx) {
  return decodeMessage(base64Tx).staticAccounts[0];
}

// Checks one base64 transaction. Pass the wallet to check (optional).
export async function checkTransaction(base64Tx, owner = null) {
  const message = decodeMessage(base64Tx);

  const flags = [];
  for (const ix of message.instructions) {
    if (message.staticAccounts[ix.programAddressIndex] !== TOKEN_PROGRAM) continue;
    const kind = ix.data[0];
    if (kind === 4 || kind === 13) {
      flags.push('Token approval: this gives another address the right to spend your tokens.');
    }
    if (kind === 6) {
      flags.push('Ownership change: this hands control of a token account to someone else.');
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
  else if (sentLamports !== null && sentLamports > 0n) verdict = 'review';

  return { simOk, simError: value.err, sentLamports, flags, verdict };
}