import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { checkTransaction, feePayerOf } from './checker.js';

const cases = [
  {
    name: 'sol-transfer.txt',
    check: (r) => {
      assert.equal(r.simOk, true, 'simulation should succeed');
      assert.equal(r.flags.length, 0, 'should have no flags');
      assert.equal(r.verdict, 'review', 'verdict should be review');
      assert.ok(
        r.sentLamports >= 1000000n && r.sentLamports <= 1010000n,
        `SOL out should be about 1,005,000 lamports, got ${r.sentLamports}`,
      );
    },
  },
  {
    name: 'token-approval.txt',
    check: (r) => {
      assert.equal(r.simOk, false, 'simulation should fail for the test token account');
      assert.equal(r.flags.length, 1, 'should flag exactly one approval');
      assert.match(r.flags[0], /Token approval/, 'the flag should be a token approval');
      assert.equal(r.verdict, 'danger', 'verdict should be danger');
    },
  },
];

let failed = 0;
for (const c of cases) {
  try {
    const base64Tx = readFileSync(`samples/${c.name}`, 'utf8').trim();
    const owner = feePayerOf(base64Tx);
    const result = await checkTransaction(base64Tx, owner);
    c.check(result);
    console.log(`PASS  ${c.name}`);
  } catch (err) {
    failed++;
    console.log(`FAIL  ${c.name}: ${err.message}`);
  }
}

console.log(failed === 0 ? 'All samples passed.' : `${failed} sample(s) failed.`);
process.exitCode = failed === 0 ? 0 : 1;