# Second Look

Second Look checks a Solana transaction before you sign it. It simulates the transaction on Solana devnet, without sending anything, and reports what it would do to your wallet.

Built for the Colosseum Crypto World's Fair Hackathon, Solana track.

## What it checks

- How much SOL would leave your wallet, including the fee
- Token approvals, which give another address the right to spend your tokens
- Ownership changes, which hand control of a token account to someone else

## Run it

1. Install Node.js.
2. Run `npm install`.
3. Put your wallet address in `simulate.mjs` and `review.mjs`, replacing the placeholder.
4. Run `node simulate.mjs` to save a sample transfer to `tx.txt`.
5. Run `node review.mjs` to check it.

`approve-test.mjs` saves a sample token approval to `tx.txt`, so you can see the approval warning.

## Status

Working prototype on Solana devnet. It reads a transaction from `tx.txt`, flags approvals and ownership changes, and reports SOL leaving the wallet. Next: paste a transaction into a web page and check more instruction types.

## Business plan

Wallet apps and treasury teams would pay for Second Look, because they want a check before anyone signs.

- **Per check:** a small fee for each transaction checked through the API.
- **Monthly plan:** a flat fee for teams that check many transactions, with alerts when a risky one appears.
