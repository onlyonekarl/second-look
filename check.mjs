import { address, createSolanaRpc } from '@solana/kit';

const rpc = createSolanaRpc('https://api.devnet.solana.com');
const wallet = address('EBHUTzoz8MwTS3QcjhtwjguREcR5VagF2n9wXydppjbi');

const { value: lamports } = await rpc.getBalance(wallet).send();
console.log('Balance in lamports:', lamports);