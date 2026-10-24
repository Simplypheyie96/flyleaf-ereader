/* Flyleaf account unlocks for the store apps, written for the shared API
   (flyleaf/server/worker.js in the Journal repo). Not deployed: see unlock.md.

   One table and four routes, shared by every Flyleaf app that sells through a
   store. An app name (reader, journal, press) picks the bundle id, the Play
   package and the products that count as its unlock.

     POST /auth/apple          Sign in with Apple from an iOS app (no session)
     POST /iap/notify/<app>    App Store Server Notifications V2 (no session)
     POST /iap/verify          { app, jws } or { app, token, product }, signed in
     GET  /unlock/<app>        { unlocked, products }, signed in

   Ported from Naija Farm's server (verifyApple, appleJws, playToken,
   verifyPlay, appleNotice); the StoreKit check expects a Non-Consumable. */

export const STORE_APPS = {
  reader: {
    bundle: 'com.feyidesigns.ereader',
    pkg: 'com.feyidesigns.ereader',
    products: ['com.feyidesigns.ereader.unlock', 'com.feyidesigns.ereader.supporter'],
  },
};

const enc = (s) => new TextEncoder().encode(s);
const dec = (b) => new TextDecoder().decode(b);
const b64u = (buf) => { let s = ''; const a = new Uint8Array(buf); for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = (s) => { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; const b = atob(s), a = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return a; };
const hex = (buf) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, '0')).join('');
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', enc(s)));
const nonce = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
const json = (v, status) => new Response(JSON.stringify(v), { status: status || 200, headers: { 'content-type': 'application/json' } });
const bundles = () => Object.values(STORE_APPS).map((x) => x.bundle);

/* ---------- Sign in with Apple ---------- */
let akeys = null, akeysAt = 0;
async function appleKeys(force) {
  if (!force && akeys && Date.now() - akeysAt < 3600000) return akeys;
  const r = await fetch('https://appleid.apple.com/auth/keys');
  akeys = (await r.json()).keys; akeysAt = Date.now();
  return akeys;
}
async function verifyApple(idt) {
  const k = String(idt || '').split('.');
  if (k.length !== 3) return null;
  try {
    const head = JSON.parse(dec(unb64u(k[0]))), pay = JSON.parse(dec(unb64u(k[1])));
    let jwk = (await appleKeys(false)).find((x) => x.kid === head.kid);
    if (!jwk) jwk = (await appleKeys(true)).find((x) => x.kid === head.kid);
    if (!jwk || head.alg !== 'RS256') return null;
    const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, unb64u(k[2]), enc(k[0] + '.' + k[1])))) return null;
    if (!bundles().includes(pay.aud) || pay.iss !== 'https://appleid.apple.com' || pay.exp * 1000 < Date.now() || !pay.sub) return null;
    return pay;
  } catch { return null; }
}

/* The same shape as signIn for Google: uid 'a' + Apple's sub. Apple can leave the
   email out after the first sign-in, so a known account keeps the one it has; a
   relay address (privaterelay.appleid.com) is stored like any other. */
export async function appleSignIn(env, req, APPS) {
  const body = await req.json().catch(() => ({}));
  const app = APPS.has(body.app) ? body.app : 'journal';
  const a = await verifyApple(body.credential);
  if (!a) return json({ error: 'apple' }, 401);
  const uid = 'a' + a.sub, now = Date.now(), token = nonce(32);
  const had = await env.DB.prepare('SELECT email, name FROM users WHERE id = ?').bind(uid).first();
  const email = a.email || (had && had.email) || 'Apple ID';
  await env.DB.batch([
    env.DB.prepare('INSERT INTO users (id, email, name, created) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET email = excluded.email')
      .bind(uid, email, null, now),
    env.DB.prepare('INSERT INTO sessions (hash, user_id, app, seen) VALUES (?, ?, ?, ?)').bind(await sha(token), uid, app, now),
  ]);
  return json({ token, user: { email, name: (had && had.name) || '' } });
}

/* ---------- App Store transactions ---------- */
// A StoreKit 2 transaction is a JWS whose x5c chain must end in Apple Root CA - G3 (pinned by its SHA-256), with
// Apple's App Store receipt-signing marks on the leaf and the intermediate, as Apple's own server library checks.
const APPLE_ROOT_G3 = '63343abfb89a6a03ebb57e9b3f5fa7be7c4f5c756f3017b3a8c488c3653e9179';
const OID_LEAF = '2a864886f76364060b01', OID_MID = '2a864886f76364060201';
// Minimal DER reader: a node is { tag, at (header start), cs (content start), ce (content end) }.
function derAt(b, at) {
  let i = at + 1, len = b[i++];
  if (len & 0x80) { const n = len & 0x7f; len = 0; for (let j = 0; j < n; j++) len = len * 256 + b[i++]; }
  return { tag: b[at], at: at, cs: i, ce: i + len };
}
function derKids(b, n) { const out = []; for (let i = n.cs; i < n.ce;) { const c = derAt(b, i); out.push(c); i = c.ce; } return out; }
// DER ECDSA signature -> the raw r||s WebCrypto wants
function rawSig(b, size) {
  const out = new Uint8Array(size * 2);
  derKids(b, derAt(b, 0)).forEach((x, k) => { let v = b.subarray(x.cs, x.ce); while (v.length > size && v[0] === 0) v = v.subarray(1); out.set(v, k * size + size - v.length); });
  return out;
}
async function certKey(b) {
  const tbs = derKids(b, derAt(b, 0))[0], kids = derKids(b, tbs), spki = kids[(kids[0].tag === 0xa0 ? 1 : 0) + 5];
  const alg = derKids(b, derKids(b, spki)[0]), curve = hex(b.subarray(alg[1].cs, alg[1].ce)) === '2b81040022' ? 'P-384' : 'P-256';
  return { key: await crypto.subtle.importKey('spki', b.subarray(spki.at, spki.ce), { name: 'ECDSA', namedCurve: curve }, false, ['verify']), size: curve === 'P-384' ? 48 : 32 };
}
async function signedBy(child, parent) {
  const [tbs, alg, sig] = derKids(child, derAt(child, 0)), p = await certKey(parent);
  const oid = derKids(child, alg)[0], hash = hex(child.subarray(oid.cs, oid.ce)) === '2a8648ce3d040303' ? 'SHA-384' : 'SHA-256';
  return crypto.subtle.verify({ name: 'ECDSA', hash: hash }, p.key, rawSig(child.subarray(sig.cs + 1, sig.ce), p.size), child.subarray(tbs.at, tbs.ce));
}
// Checks the chain and signature of any App Store JWS (transactions and server notifications share them) and
// returns its payload. Xcode's local StoreKit testing signs with its own certificate: accepted only where IAP_XCODE
// is set (local dev) and the payload says it came from Xcode.
async function appleJws(env, jws, envOf) {
  const k = String(jws || '').split('.');
  if (k.length !== 3) return null;
  try {
    const head = JSON.parse(dec(unb64u(k[0]))), pay = JSON.parse(dec(unb64u(k[1])));
    const x5c = (head.x5c || []).map((c) => Uint8Array.from(atob(c), (ch) => ch.charCodeAt(0)));
    if (head.alg !== 'ES256' || !x5c.length) return null;
    const xcode = env.IAP_XCODE === '1' && envOf(pay) === 'Xcode';
    if (!xcode) {
      if (x5c.length !== 3 || hex(new Uint8Array(await crypto.subtle.digest('SHA-256', x5c[2]))) !== APPLE_ROOT_G3) return null;
      if (!hex(x5c[0]).includes(OID_LEAF) || !hex(x5c[1]).includes(OID_MID)) return null;
      if (!(await signedBy(x5c[1], x5c[2])) || !(await signedBy(x5c[0], x5c[1]))) return null;
      if (envOf(pay) !== 'Production' && envOf(pay) !== 'Sandbox') return null;
    }
    const leaf = await certKey(x5c[0]);
    if (!(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, leaf.key, unb64u(k[2]), enc(k[0] + '.' + k[1])))) return null;
    return pay;
  } catch (e) { return null; }
}
async function verifyStoreKit(env, jws, app) {
  const pay = await appleJws(env, jws, (p) => p.environment);
  if (!pay || pay.bundleId !== app.bundle || pay.type !== 'Non-Consumable' || pay.revocationDate || !pay.transactionId) return null;
  return app.products.includes(pay.productId) ? pay : null;
}

/* ---------- Google Play purchases ---------- */
let playTok = null, playTokAt = 0;
async function playToken(env) {
  if (playTok && Date.now() < playTokAt) return playTok;
  const sa = JSON.parse(env.GOOGLE_PLAY_SA), now = Math.floor(Date.now() / 1000);
  const claims = { iss: sa.client_email, scope: 'https://www.googleapis.com/auth/androidpublisher', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const head = b64u(enc(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))) + '.' + b64u(enc(JSON.stringify(claims)));
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, '')), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const jwt = head + '.' + b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, enc(head)));
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }) });
  const t = await r.json();
  if (!t.access_token) throw new Error('play token');
  playTokAt = Date.now() + (t.expires_in - 300) * 1000;
  return (playTok = t.access_token);
}
/** A paid one-time purchase of one of the app's products, or null. purchaseType 0 marks a licence tester's order. */
async function verifyPlay(env, app, product, token) {
  if (!env.GOOGLE_PLAY_SA || !app.products.includes(product) || !/^[\w.\-]{20,600}$/.test(token)) return null;
  try {
    const r = await fetch('https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' + app.pkg + '/purchases/products/' + product + '/tokens/' + token,
      { headers: { Authorization: 'Bearer ' + (await playToken(env)) } });
    if (!r.ok) return null;
    const p = await r.json();
    return p.purchaseState === 0 && p.orderId ? p : null;
  } catch { return null; }
}

/* ---------- routes ---------- */

/** POST /iap/notify/<app>: a refund (REFUND) or a family-sharing revoke (REVOKE)
    takes the unlock back. Everything else is acknowledged; a bad signature gets
    401 so Apple retries. */
export async function appleNotice(env, req, name) {
  const app = STORE_APPS[name];
  if (!app) return json({ error: 'route' }, 404);
  const n = await appleJws(env, ((await req.json().catch(() => ({}))) || {}).signedPayload, (p) => p.data && p.data.environment);
  if (!n || !n.data || n.data.bundleId !== app.bundle) return json({ error: 'signature' }, 401);
  if (n.notificationType === 'REFUND' || n.notificationType === 'REVOKE') {
    const t = await appleJws(env, n.data.signedTransactionInfo, (p) => p.environment);
    if (t && t.bundleId === app.bundle && t.transactionId)
      await env.DB.prepare('UPDATE unlocks SET revoked = ? WHERE ref = ? AND revoked IS NULL').bind(Date.now(), 'ios_' + t.transactionId).run();
  }
  return json({ ok: true });
}

/** POST /iap/verify: records a store purchase against the signed-in account,
    once (ios_<transactionId>, android_<orderId>). The same purchase sent from
    another account gets 409: a store purchase unlocks one Flyleaf account. */
export async function verifyPurchase(env, req, s) {
  const b = await req.json().catch(() => ({}));
  const app = STORE_APPS[b.app];
  if (!app) return json({ error: 'app' }, 400);
  let ref, product, store, mode;
  if (b.token) {
    const t = await verifyPlay(env, app, String(b.product || ''), String(b.token));
    if (!t) return json({ error: 'purchase' }, 400);
    ref = 'android_' + t.orderId; product = b.product; store = 'play'; mode = t.purchaseType === 0 ? 'Test' : 'Production';
  } else {
    const t = await verifyStoreKit(env, b.jws, app);
    if (!t) return json({ error: 'purchase' }, 400);
    ref = 'ios_' + t.transactionId; product = t.productId; store = 'apple'; mode = String(t.environment || '').slice(0, 40);
  }
  await env.DB.prepare('INSERT OR IGNORE INTO unlocks (ref, user_id, app, product, store, env, at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(ref, s.uid, b.app, product, store, mode, Date.now()).run();
  const row = await env.DB.prepare('SELECT user_id, revoked FROM unlocks WHERE ref = ?').bind(ref).first();
  if (row.user_id !== s.uid) return json({ error: 'owned' }, 409);
  return json({ ok: true, revoked: !!row.revoked });
}

/** GET /unlock/<app>: whether this account has unlocked the app. */
export async function unlockOf(env, s, name) {
  if (!STORE_APPS[name]) return json({ error: 'route' }, 404);
  const { results } = await env.DB.prepare('SELECT DISTINCT product FROM unlocks WHERE user_id = ? AND app = ? AND revoked IS NULL').bind(s.uid, name).all();
  return json({ unlocked: results.length > 0, products: results.map((r) => r.product) });
}
