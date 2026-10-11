import {
  address,
  createSolanaRpc,
  getAddressDecoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from '@solana/kit';

const SPL_TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const TOKEN_PROGRAMS = [SPL_TOKEN, TOKEN_2022];
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const ASSOCIATED_TOKEN = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const MEMO = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
const VOTE_PROGRAM = 'Vote111111111111111111111111111111111111111';
// Programs this checker understands. A transaction that calls anything else gets a review note.
const KNOWN_PROGRAMS = [SYSTEM_PROGRAM, SPL_TOKEN, TOKEN_2022, COMPUTE_BUDGET, ASSOCIATED_TOKEN, MEMO, VOTE_PROGRAM];
const TOKEN_PROGRAM_NAMES = ['spl-token', 'spl-token-2022']; // as the RPC names them
const TOKEN_ACCOUNT_LENGTH = 165;
const TLV_OFFSET = 166;              // Token-2022 extension entries start here
const LOOKUP_TABLE_HEADER = 56;      // lookup table addresses start after this many bytes
const MAX_SIMULATED_ACCOUNTS = 100;  // the RPC limits account lists to this many
const EXT_PERMANENT_DELEGATE = 12;
const EXT_TRANSFER_HOOK = 14;
// Token-2022 extensions that only describe the token (metadata and grouping), not risks
const DESCRIPTIVE_EXTENSIONS = [18, 19, 20, 21, 22, 23];

// Direct token instructions: the first data byte says which one
const TOKEN_KIND = { 3: 'transfer', 12: 'transfer', 4: 'approve', 13: 'approve', 6: 'setAuthority' };
// Inner token instructions arrive decoded, with a type name
const INNER_TOKEN_KIND = {
  transfer: 'transfer',
  transferChecked: 'transfer',
  approve: 'approve',
  approveChecked: 'approve',
  setAuthority: 'setAuthority',
};
// System instructions: Assign (1) and AssignWithSeed (10) hand an account to another program
const DIRECT_SYSTEM_KIND = { 1: 'assign', 10: 'assign' };
const INNER_SYSTEM_KIND = { assign: 'assign', assignWithSeed: 'assign' };

const NOTES = {
  approve: ['Token approval', 'this gives another address the right to spend your tokens.'],
  setAuthority: ['Ownership change', 'this hands control of a token account to someone else.'],
  assign: ['Account ownership change', 'this hands an account to another program, which can then move its SOL.'],
  permanentDelegate: ['Permanent delegate', 'a token in this transaction has a permanent delegate. That delegate can move tokens out of any holder account, including yours.'],
  transferHook: ['Transfer hook', 'a token in this transaction runs custom code on every transfer. Check the program it calls before you sign.'],
  transfer: ['Token transfer', 'this moves tokens from one token account to another. Check the recipient and the amount.'],
};
// These kinds get a review, not a stop
const REVIEW_KINDS = ['transfer', 'transferHook'];

function decodeMessage(base64Tx) {
  const bytes = Uint8Array.from(atob(base64Tx), (c) => c.charCodeAt(0));
  const wire = getTransactionDecoder().decode(bytes);
  return getCompiledTransactionMessageDecoder().decode(wire.messageBytes);
}

// One entry per instruction, for both version 0 and version 1 messages
function instructionsOf(message) {
  if (Array.isArray(message.instructions)) {
    return message.instructions.map((ix) => ({ programIndex: ix.programAddressIndex, data: ix.data }));
  }
  return message.instructionHeaders.map((h, i) => ({
    programIndex: h.programAccountIndex,
    data: Uint8Array.from(message.instructionPayloads[i].instructionData),
  }));
}

// The wallet that pays the fee. This is the wallet that would sign.
export function feePayerOf(base64Tx) {
  return decodeMessage(base64Tx).staticAccounts[0];
}

// Reads the mint, owner, and amount of a token account from its base64 data
export function readTokenAccount(base64Data) {
  const data = Buffer.from(base64Data, 'base64');
  if (data.length < TOKEN_ACCOUNT_LENGTH) return null;
  return {
    mint: getAddressDecoder().decode(data.subarray(0, 32)),
    owner: getAddressDecoder().decode(data.subarray(32, 64)),
    amount: data.readBigUInt64LE(64),
  };
}

// Lists the Token-2022 extension types on a mint, from its base64 data. Empty for classic mints.
export function mintExtensionTypes(base64Data) {
  const data = Buffer.from(base64Data, 'base64');
  if (data.length <= TLV_OFFSET || data[TOKEN_ACCOUNT_LENGTH] !== 1) return []; // 1 = mint
  const types = [];
  let offset = TLV_OFFSET;
  while (offset + 4 <= data.length) {
    const type = data.readUInt16LE(offset);
    const length = data.readUInt16LE(offset + 2);
    if (type === 0 || offset + 4 + length > data.length) break;
    types.push(type);
    offset += 4 + length;
  }
  return types;
}

// Reads accounts in batches, since the RPC takes up to 100 at a time
async function getAccounts(rpc, list) {
  const out = [];
  for (let i = 0; i < list.length; i += 100) {
    const chunk = (await rpc.getMultipleAccounts(list.slice(i, i + 100), { encoding: 'base64' }).send()).value;
    out.push(...chunk);
  }
  return out;
}

// Every account a transaction uses: static accounts, then accounts loaded from address lookup tables
async function allAccountsOf(rpc, message) {
  const lookups = message.addressTableLookups ?? [];
  if (lookups.length === 0) return [...message.staticAccounts];
  const tables = await getAccounts(rpc, lookups.map((l) => l.lookupTableAddress));
  const writable = [];
  const readonly = [];
  lookups.forEach((lookup, i) => {
    const table = tables[i];
    if (!table) throw new Error('A lookup table used by this transaction could not be loaded.');
    const data = Buffer.from(table.data[0], 'base64');
    const addresses = [];
    for (let offset = LOOKUP_TABLE_HEADER; offset + 32 <= data.length; offset += 32) {
      addresses.push(getAddressDecoder().decode(data.subarray(offset, offset + 32)));
    }
    for (const index of lookup.writableIndexes) {
      if (addresses[index] === undefined) throw new Error('A lookup table index is out of range.');
      writable.push(addresses[index]);
    }
    for (const index of lookup.readonlyIndexes) {
      if (addresses[index] === undefined) throw new Error('A lookup table index is out of range.');
      readonly.push(addresses[index]);
    }
  });
  return [...message.staticAccounts, ...writable, ...readonly];
}

// Token accounts owned by the wallet that lost tokens during the simulation.
// The two arrays must line up: each pre-state with its simulated post-state.
function tokenOutflows(preAccounts, simAccounts, owner) {
  const outflows = [];
  preAccounts.forEach((pre, i) => {
    const post = simAccounts[i];
    if (!pre || !post || !TOKEN_PROGRAMS.includes(pre.owner)) return;
    const a = readTokenAccount(pre.data[0]);
    const b = readTokenAccount(post.data[0]);
    if (!a || !b || a.owner !== owner) return;
    const sent = a.amount - b.amount;
    if (sent > 0n) {
      outflows.push(`Token balance: ${sent} base units of ${a.mint.slice(0, 6)}… would leave your wallet.`);
    }
  });
  return outflows;
}

// Turns a simulation error into a plain-language reason. It is shown apart from the findings.
function describeSimError(err) {
  const text = JSON.stringify(err, (_, v) => (typeof v === 'bigint' ? v.toString() : v));
  if (/InsufficientFunds|AccountNotFound/.test(text)) {
    return 'This wallet does not have enough SOL to run this transaction. Add SOL and check again.';
  }
  return `The network reported an error: ${text.slice(0, 120)}`;
}

// Checks one base64 transaction. Optional: the wallet to check, and the RPC URL.
export async function checkTransaction(
  base64Tx,
  owner = null,
  rpcUrl = 'https://api.devnet.solana.com',
) {
  const rpc = createSolanaRpc(rpcUrl);
  const message = decodeMessage(base64Tx);

  // A format this checker cannot read: stop, and say so
  if (!Array.isArray(message.instructions) && !Array.isArray(message.instructionHeaders)) {
    return {
      simOk: false,
      simError: 'unreadable format',
      simReason: null,
      sentLamports: null,
      flags: ['This transaction is in a format this checker cannot read yet. Do not sign it through this checker.'],
      transfers: [],
      verdict: 'danger',
    };
  }

  const accounts = await allAccountsOf(rpc, message);
  // Include the wallet in the account list so its SOL balance is measured too
  const addresses = owner && !accounts.includes(owner) ? [...accounts, owner] : accounts;

  const flags = [];     // stop: do not sign until you understand these
  const transfers = []; // review: token moves, risky token settings, unknown programs

  // Records a finding, whether the transaction calls the program itself or another program does
  const add = (kindName, calledByOtherProgram) => {
    const [label, detail] = NOTES[kindName];
    const text = `${label}${calledByOtherProgram ? ' (called by another program)' : ''}: ${detail}`;
    if (REVIEW_KINDS.includes(kindName)) transfers.push(text);
    else flags.push(text);
  };

  // 1. Instructions the transaction calls directly
  const unknownPrograms = new Set();
  for (const ix of instructionsOf(message)) {
    const program = accounts[ix.programIndex];
    if (!KNOWN_PROGRAMS.includes(program)) unknownPrograms.add(program);
    if (TOKEN_PROGRAMS.includes(program)) {
      const kind = TOKEN_KIND[ix.data[0]];
      if (kind) add(kind, false);
    } else if (program === SYSTEM_PROGRAM && ix.data.length >= 4) {
      const kind = DIRECT_SYSTEM_KIND[Buffer.from(ix.data).readUInt32LE(0)];
      if (kind) add(kind, false);
    }
  }
  for (const program of unknownPrograms) {
    transfers.push(`This transaction calls a program the checker does not recognize (${program.slice(0, 6)}…). Only sign if you know what it does.`);
  }

  // 2. Read every account and the wallet's SOL before the simulation
  const preAccounts = await getAccounts(rpc, addresses);
  const before = owner ? (await rpc.getBalance(address(owner)).send()).value : null;

  // 3. Token-2022 risks on the mints behind the token accounts in this transaction
  const mints = new Set();
  for (const pre of preAccounts) {
    if (!pre || !TOKEN_PROGRAMS.includes(pre.owner)) continue;
    const acc = readTokenAccount(pre.data[0]);
    if (acc) mints.add(acc.mint);
  }
  if (mints.size > 0) {
    const mintAccounts = await getAccounts(rpc, [...mints]);
    const known = [EXT_PERMANENT_DELEGATE, EXT_TRANSFER_HOOK, ...DESCRIPTIVE_EXTENSIONS];
    for (const m of mintAccounts) {
      if (!m || m.owner !== TOKEN_2022) continue;
      const types = mintExtensionTypes(m.data[0]);
      if (types.includes(EXT_PERMANENT_DELEGATE)) add('permanentDelegate', false);
      if (types.includes(EXT_TRANSFER_HOOK)) add('transferHook', false);
      if (types.some((t) => !known.includes(t))) {
        transfers.push('Token-2022 feature: this token uses a feature the checker does not read. Check it before you sign.');
      }
    }
  }

  // 4. Choose what to measure: the wallet first, then its token accounts.
  // The RPC limits account lists to 100, so this list is capped.
  const watched = [];
  if (owner) {
    watched.push(addresses.indexOf(owner));
    addresses.forEach((a, i) => {
      if (a === owner) return;
      const pre = preAccounts[i];
      if (!pre || !TOKEN_PROGRAMS.includes(pre.owner)) return;
      const acc = readTokenAccount(pre.data[0]);
      if (acc && acc.owner === owner) watched.push(i);
    });
  }
  const truncated = watched.length > MAX_SIMULATED_ACCOUNTS;
  const used = watched.slice(0, MAX_SIMULATED_ACCOUNTS);
  const usedAddresses = used.map((i) => addresses[i]);

  // 5. Simulate, without sending anything
  const simConfig = {
    encoding: 'base64',
    sigVerify: false,
    replaceRecentBlockhash: true,
    innerInstructions: true,
    ...(usedAddresses.length > 0 ? { accounts: { encoding: 'base64', addresses: usedAddresses } } : {}),
  };
  let value;
  try {
    ({ value } = await rpc.simulateTransaction(base64Tx, simConfig).send());
  } catch (err) {
    throw new Error(`simulation: ${err.message} (requested ${usedAddresses.length} accounts)`);
  }

  // 6. Calls that other programs make inside the transaction (returned only if the simulation succeeds)
  for (const group of value.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      if (TOKEN_PROGRAM_NAMES.includes(ix.program)) {
        const kind = INNER_TOKEN_KIND[ix.parsed?.type];
        if (kind) add(kind, true);
      } else if (ix.program === 'system') {
        const kind = INNER_SYSTEM_KIND[ix.parsed?.type];
        if (kind) add(kind, true);
      }
    }
  }

  const simOk = value.err === null;

  // 7. How much SOL and tokens leave the wallet
  let sentLamports = null;
  if (simOk && owner) {
    // The wallet is always first in the simulated list
    sentLamports = before - (value.accounts?.[0]?.lamports ?? before);
    const watchedPre = used.map((i) => preAccounts[i]);
    transfers.push(...tokenOutflows(watchedPre, value.accounts ?? [], owner));
    if (truncated) {
      transfers.push(`Balances were measured for ${MAX_SIMULATED_ACCOUNTS} of your token accounts only. Review the rest before you sign.`);
    }
  }

  let verdict = 'ok';
  if (flags.length > 0 || !simOk) verdict = 'danger';
  else if ((sentLamports !== null && sentLamports > 0n) || transfers.length > 0) verdict = 'review';

  return {
    simOk,
    simError: value.err,
    simReason: simOk ? null : describeSimError(value.err),
    sentLamports,
    flags,
    transfers,
    verdict,
  };
}