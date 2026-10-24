# Server patch: store unlocks and Sign in with Apple

For the shared API at api.flyleaf.cc (`flyleaf/server/` in the Journal repo).
**Nothing here is deployed.** Review it, then apply it yourself. The web apps don't
change: every new route is new, and no existing route behaves differently.

## What it adds

| Route | Session | Does |
|---|---|---|
| `POST /auth/apple` | no | Sign in with Apple from an iOS app. Body `{ app, credential }` (the Apple ID token). Creates user `a<sub>` and returns `{ token, user }` like `/auth/google` does. |
| `POST /iap/verify` | yes | Body `{ app, jws }` (App Store) or `{ app, token, product }` (Play). Checks the purchase with Apple's certificate chain or the Play Developer API, then records it once against the account. Returns 409 when the purchase is already on another account. |
| `GET /unlock/<app>` | yes | `{ unlocked, products }` for that app. |
| `POST /iap/notify/<app>` | no | App Store Server Notifications V2. REFUND and REVOKE set `revoked`. |

The table is `unlocks` (`unlock.sql`). Apps are listed in `STORE_APPS` at the top of
`unlock.js`. When Journal or Press go to the stores, each one adds a line there:
its bundle id, Play package and products.

The sync quota needs no change: `USER_MEDIA_MAX` is already 1 GB. Sync is gated in
the app, not on the server, so web sync stays free as it is today.

## Applying it

1. Copy `unlock.js` to `server/unlock.js`, then add the following to `worker.js`:
   ```js
   import { appleSignIn, appleNotice, verifyPurchase, unlockOf } from './unlock.js';
   // in route(), next to the /auth/google line (before the session check):
   if (a === 'auth' && b === 'apple' && m === 'POST') return appleSignIn(env, req, APPS);
   if (a === 'iap' && b === 'notify' && m === 'POST') return appleNotice(env, req, url.pathname.split('/')[3]);
   // after the session check:
   if (a === 'iap' && b === 'verify' && m === 'POST') return verifyPurchase(env, req, s);
   if (a === 'unlock' && b && m === 'GET') return unlockOf(env, s, b);
   ```
2. Copy `unlock.test.mjs` next to it and run `node server/unlock.test.mjs`.
3. Append `unlock.sql` to `schema.sql`, then run:
   `npx wrangler d1 execute flyleaf --remote --file=server/unlock.sql`
4. Make these `wrangler.toml` changes, in both the top-level and the env blocks:
   - Add `capacitor://localhost,https://localhost` to `SITES`. These are the iOS and Android webview origins.
   - `GOOGLE_CLIENT_IDS` already holds the web client `1093925806507-geheius…`. The Android app signs in with that same client, so nothing new is needed for Android. If you create an iOS Google client, its ID tokens are still addressed to the web (server) client, so nothing new is needed there either.
5. Add the secrets:
   - `npx wrangler secret put GOOGLE_PLAY_SA`: the JSON key of a Google Cloud service account that is linked in Play Console (Users and permissions) with *View financial data*. Naija Farm's account works if you add the Octavo app to it.
   - Optional, local only: `IAP_XCODE=1` in `.dev.vars` lets Xcode's StoreKit testing through. Never set it in production.
6. Run `npx wrangler deploy`.
7. In App Store Connect, open the app, then App Information, then App Store Server Notifications. Set Production and Sandbox to `https://api.flyleaf.cc/iap/notify/reader` and choose Version 2.

## Known gap

Play refunds are not pushed to the server, because that would need Real-time
developer notifications over Pub/Sub. The phone still drops a refunded purchase
from what it owns, so the unlock closes on that phone the next time it starts. An
account row that another phone relies on stays unlocked. Add a Voided Purchases
API check later if refunds become a problem.
