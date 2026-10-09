import { checkTransaction } from '../checker.js';

const MAX_LENGTH = 10000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Send a POST request.' });
  }

  const rpcUrl = process.env.RPC_URL;
  if (!rpcUrl) {
    return res.status(500).json({ error: 'The server has no RPC_URL set.' });
  }

  const { transaction, owner } = req.body ?? {};
  if (typeof transaction !== 'string' || transaction.length === 0 || transaction.length > MAX_LENGTH) {
    return res.status(400).json({ error: 'Send a base64 transaction.' });
  }

  try {
    const r = await checkTransaction(
      transaction.trim(),
      typeof owner === 'string' && owner.length > 0 ? owner : null,
      rpcUrl,
    );
    return res.status(200).json({
      simOk: r.simOk,
      sentLamports: r.sentLamports === null ? null : r.sentLamports.toString(),
      flags: r.flags,
      transfers: r.transfers,
      verdict: r.verdict,
    });
  } catch (err) {
    console.error('check failed:', err.message);
    return res.status(400).json({ error: 'Could not read this transaction.' });
  }
}
