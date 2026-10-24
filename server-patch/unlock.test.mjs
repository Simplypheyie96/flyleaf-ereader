// node server-patch/unlock.test.mjs — the checks that need no store: bad input is refused, the unlock is read per app.
import assert from 'node:assert/strict';
import { appleSignIn, verifyPurchase, unlockOf, appleNotice } from './unlock.js';

const rows = [{ user_id: 'g1', app: 'reader', product: 'com.feyidesigns.ereader.unlock', revoked: null }];
const DB = { prepare: (sql) => ({ bind: (...v) => ({
  all: async () => ({ results: sql.includes('FROM unlocks') ? rows.filter((r) => r.user_id === v[0] && r.app === v[1] && !r.revoked) : [] }),
  first: async () => null, run: async () => ({ meta: { changes: 0 } }),
}) }) };
const env = { DB };
const req = (body) => new Request('https://x', { method: 'POST', body: JSON.stringify(body) });
const read = async (r) => [r.status, await r.json()];

assert.deepEqual(await read(await unlockOf(env, { uid: 'g1' }, 'reader')), [200, { unlocked: true, products: ['com.feyidesigns.ereader.unlock'] }]);
assert.deepEqual(await read(await unlockOf(env, { uid: 'g2' }, 'reader')), [200, { unlocked: false, products: [] }]);
assert.equal((await unlockOf(env, { uid: 'g1' }, 'nope')).status, 404);
assert.equal((await verifyPurchase(env, req({ app: 'nope', jws: 'a.b.c' }), { uid: 'g1' })).status, 400);
assert.equal((await verifyPurchase(env, req({ app: 'reader', jws: 'not-a-jws' }), { uid: 'g1' })).status, 400);
assert.equal((await verifyPurchase(env, req({ app: 'reader', token: 'x'.repeat(40), product: 'com.feyidesigns.ereader.unlock' }), { uid: 'g1' })).status, 400);
assert.equal((await appleSignIn(env, req({ credential: 'bad' }), new Set(['reader']))).status, 401);
assert.equal((await appleNotice(env, req({ signedPayload: 'bad' }), 'reader')).status, 401);
console.log('unlock: 8 checks passed');
