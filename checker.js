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
// How the RPC names these programs in decoded inner instructions
const TOKEN_PROGRAM_NAMES = ['spl-token', 'spl-token-2022'];

// Direct instructions are identified by their first data byte
const TOP_LEVEL_KIND = { 3: 'transfer', 12: 'transfer', 4: 'approve', 13: 'approve', 6: 'setAuthority' };
// Inner instructions arrive decoded, with a type name
const INNER_KIND = {
  transfer: 'transfer',
  transferChecked: 'transfer',
  approve: 'approve',
  approveChecked: 'approve',
  setAuthority: 'setAuthority',
};

const NOTES = {
  approve: ['Token approval', 'this gives another address the right to spend your tokens.'],
  setAuthority: ['Ownership change', 'this hands control of a token account to someone else.'],
  transfer: ['Token transfer', 'this moves tokens from one token account to another. Check the recipient and the amount.'],
};

const rpc = null; // placeholder, replaced per call below

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

  // Records a finding, whether the transaction calls the token program itself or another program calls it
  const add = (kindName, calledByOtherProgram) => {
    const [label, detail] = NOTES[kindName];
    const text = `${label}${calledByOtherProgram ? ' (called by another program)' : ''}: ${detail}`;
    if (kindName === 'transfer') transfers.push(text);
    else flags.push(text);
  };

  // 1. Instructions the transaction calls directly
  for (const ix of message.instructions) {
    if (!TOKEN_PROGRAMS.includes(message.staticAccounts[ix.programAddressIndex])) continue;
    const kindName = TOP_LEVEL_KIND[ix.data[0]];
    if (kindName) add(kindName, false);
  }

  // 2. Simulate, without sending anything
  const before = owner ? (await rpc.getBalance(address(owner)).send()).value : null;
  const { value } = await rpc.simulateTransaction(base64Tx, {
    encoding: 'base64',
    sigVerify: false,
    replaceRecentBlockhash: true,
    innerInstructions: true,
    ...(owner ? { accounts: { encoding: 'base64', addresses: [owner] } } : {}),
  }).send();

  // 3. Token calls that other programs make inside this transaction.
  // The RPC returns these only when the simulation succeeds.
  for (const group of value.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      if (!TOKEN_PROGRAM_NAMES.includes(ix.program)) continue;
      const kindName = INNER_KIND[ix.parsed?.type];
      if (kindName) add(kindName, true);
    }
  }

  const simOk = value.err === null;
  const sentLamports = simOk && owner ? before - (value.accounts?.[0]?.lamports ?? before) : null;

  let verdict = 'ok';
  if (flags.length > 0 || !simOk) verdict = 'danger';
  else if ((sentLamports !== null && sentLamports > 0n) || transfers.length > 0) verdict = 'review';

  return { simOk, simError: value.err, sentLamports, flags, transfers, verdict };
}