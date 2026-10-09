# Second Look

Second Look checks a Solana transaction before you sign it. It simulates the transaction on Solana devnet and reports what it would do to your wallet, such as how much SOL it sends out.

## Run it

1. Install Node.js.
2. Run `npm install`.
3. Put your wallet address in `simulate.mjs`, replacing the placeholder.
4. Run `node simulate.mjs`.

## Status

Prototype. It runs on devnet and currently flags any outgoing SOL. Token approval and ownership-change checks are next.
