# App Store and Google Play launch

The store apps are the same reader as read.flyleaf.cc in a Capacitor shell (`app/ios`, `app/android`),
built from the `store` branch with `VITE_STORE=1`. Bundle id and package: `com.feyidesigns.ereader`.
The web build is unchanged. Every native path is behind the `__STORE__` build constant and
`Capacitor.isNativePlatform()`, and the web build compiles them out.

| | Free | Unlock ($4.99) or Supporter ($9.99) |
|---|---|---|
| Reading EPUB and PDF, positions, highlights, backup export | yes | yes |
| Marks export (notes), page stocks other than Day, themes other than System | | yes |
| Sync through the Flyleaf account (1 GB) | | yes |

Both products are non-consumables and unlock the same thing; Supporter only pays more. Restore purchases is
in the unlock sheet and in Settings. A purchase works without signing in. Signing in links it to the Flyleaf
account (`/iap/verify`), so it carries to the other platform and to a new phone.

## 0 · Before anything (you)

- [ ] **Trademark check for "Octavo".** Search USPTO, UKIPO and EUIPO in classes 9 and 42, and search both
      stores for apps already named Octavo. The name is set in `app/capacitor.config.ts` (`appName`),
      `ios/App/App/Info.plist` (`CFBundleDisplayName`, via the Xcode target), and
      `android/app/src/main/res/values/strings.xml`. Change all three if it fails.
- [ ] **D-U-N-S for Feyi Designs.** An Organization account on either store needs one, and it can take up to
      30 days. Without it, Apple lists the seller as your personal name, and Play needs the closed test (§ 8).
- [ ] **Deploy the server patch** in `server-patch/unlock.md`. It covers Sign in with Apple, the receipt
      checks, the unlock flag, and the CORS origins for the webviews. Without it, sign-in and sync fail in
      the apps, though purchases still unlock the phone they were made on.
- [ ] **Deploy the web app once** from this branch (or cherry-pick `app/api/article.ts`). The apps call
      `https://read.flyleaf.cc/api/article` to import articles, and that route now answers the two webview
      origins with CORS. Nothing changes for the website itself.
- [ ] **Account deletion (blocker for Apple, 5.1.1(v)).** Settings can remove the library from the account,
      but the account itself (the `users` row) stays. Apple requires an in-app way to delete the account. Add
      a `DELETE /me` route to the shared API that removes the user's sessions, docs, media, R2 objects and
      unlocks, then a button under "Remove my library". Play asks for the same thing as a web link (§ 7).
- [ ] **Privacy page** (`app/src/pages/Legal.tsx`). It says Google signs you in and Vercel counts page
      views. In the apps, Apple signs people in too, purchases go through the stores, and there is no Vercel
      measurement (analytics only render on flyleaf.cc hosts). Add a short "In the iPhone and Android apps"
      section before submitting.

## 1 · Build

```bash
cd app && npm run ios          # web build with VITE_STORE=1, then cap sync ios; open ios/App/App.xcodeproj
```

```bash
cd app && npm run android:bundle   # signed .aab at android/app/build/outputs/bundle/release/
```

Raise `CFBundleVersion` in Xcode and `versionCode` in `android/app/build.gradle` by one for every upload.
`npm run ios` and `npm run android` set `VITE_GOOGLE_CLIENT_ID` to the web client. Add `VITE_GOOGLE_IOS=…`
in front once you have an iOS Google client (§ 3).

## 2 · App Store Connect

- [ ] Apple Developer Program ($99 a year). Use an Organization account if the D-U-N-S has come through.
- [ ] Certificates, IDs & Profiles → Identifiers → App ID `com.feyidesigns.ereader`. Turn on **Sign in with
      Apple** and **In-App Purchase**. The entitlement is already in `ios/App/App/App.entitlements`.
- [ ] In Xcode, open Signing & Capabilities, choose your team, and leave automatic signing on.
- [ ] My Apps → New App: iOS, name **Octavo: EPUB & PDF Reader**, primary language English (UK), bundle id
      as above, SKU `octavo-ereader`.
- [ ] Monetization → In-App Purchases. Create both products, then submit them with the first build:
  - Non-Consumable `com.feyidesigns.ereader.unlock`, reference name Unlock, price $4.99 (tier 5);
  - Non-Consumable `com.feyidesigns.ereader.supporter`, reference name Supporter, price $9.99 (tier 10).
  - Each needs a display name, a description and a review screenshot. The unlock sheet works as that
    screenshot.
- [ ] App Information → App Store Server Notifications. Set both URLs to
      `https://api.flyleaf.cc/iap/notify/reader`, Version 2.
- [ ] Agreements, Tax and Banking: sign the Paid Apps agreement. Products can't be fetched until it is active.
- [ ] Encryption: `ITSAppUsesNonExemptEncryption` is already `false` (the app uses HTTPS only).
- [ ] Sandbox tester (Users and Access → Sandbox): use it on a real device to buy and restore without paying.
- [ ] TestFlight: upload from Xcode (Product → Archive → Distribute), then install it on your phone.

### Listing

- **Name:** Octavo: EPUB & PDF Reader (30 characters max; this is 25).
- **Subtitle:** A quiet reader for your own books.
- **Category:** Books; secondary Reference.
- **Age rating:** 4+. The questionnaire is all "None"; the app has unrestricted web access only through
  the article import, which fetches one page the reader pastes in.
- **Privacy policy URL:** `https://read.flyleaf.cc/privacy`. **Support URL:** `https://read.flyleaf.cc`.
- **Screenshots:** 6.9" (1320 × 2868) and 13" iPad if iPad stays enabled. Show the library, a page,
  highlights, and the page stocks.
- **Review notes:** "Open any DRM-free EPUB or PDF from Files (Share → Octavo) or from the + button. The
  unlock is in Settings. Sync needs a Flyleaf account: Sign in with Apple works."

### Privacy labels (App Privacy)

| Data | Collected | Linked to the user | Tracking | Why |
|---|---|---|---|---|
| Email address | yes, only when signed in | yes | no | App functionality (the account) |
| Name | yes, only with Google sign-in | yes | no | App functionality |
| User content: books, highlights, notes | yes, only when syncing | yes | no | App functionality (sync) |
| Purchases | yes | yes | no | App functionality (unlock on the account) |
| Usage data, diagnostics, identifiers, location | no | | | |

Without signing in, nothing leaves the phone except the store purchase itself.

## 3 · Google sign-in

The apps sign in natively, because Google's web button cannot run in a webview. Their ID tokens are
addressed to the **web** client `1093925806507-geheius…`, which the API already accepts.

- [ ] **Android:** in Google Cloud console → Credentials, create OAuth client IDs of type **Android**,
      package `com.feyidesigns.ereader`. You need one per SHA-1:
  - the debug key: `keytool -list -v -keystore ~/.android/debug.keystore -storepass android | grep SHA1`;
  - the upload key (§ 6);
  - the Play App Signing key (Play Console → App integrity).
- [ ] **iOS (optional):** without an iOS client, the iPhone app offers Sign in with Apple only, which is
      enough. To add Google:
  1. Create an OAuth client of type **iOS** with bundle id `com.feyidesigns.ereader`.
  2. Put its id in `VITE_GOOGLE_IOS` in the `ios` script.
  3. Add its reversed id (`com.googleusercontent.apps.…`) to `CFBundleURLTypes` in `ios/App/App/Info.plist`.
- [ ] Sign in with Apple needs nothing beyond the App ID capability. The server checks that the token's
      `aud` is the bundle id.

## 4 · Opening books from the phone

- **iOS:** the app registers for EPUB (`org.idpf.epub-container`) and PDF (`com.adobe.pdf`) as a Viewer.
  Files, Mail and Safari downloads offer "Open in Octavo", and the book lands on /open as a drop does.
- **Android:** VIEW and SEND intent filters for `application/epub+zip` and `application/pdf` (content and
  file URIs). "Open with" and "Share" both work.
- The service worker is not registered in the apps. The shell serves the files itself, and a stale worker
  inside a webview would pin old builds.

## 5 · Google Play Console

- [ ] Developer account at play.google.com/console ($25 one-off). Choose **Organization** if the D-U-N-S
      has come through, which skips the closed-test rule.
- [ ] Create the app: name **Octavo: EPUB & PDF Reader**, App, Free, English (UK).
- [ ] Monetize → Payments profile, then Products → In-app products. Create and activate both:
  - `com.feyidesigns.ereader.unlock` at $4.99;
  - `com.feyidesigns.ereader.supporter` at $9.99.
  - Other countries' prices are converted automatically.
- [ ] Server check: create a service account with a JSON key, then enable the Google Play Android Developer
      API. In Play Console → Users and permissions, invite the account's email with **View financial data**
      on this app. It can take a day to work. Then run `npx wrangler secret put GOOGLE_PLAY_SA`
      (`server-patch/unlock.md`).
- [ ] License testing (Settings → License testing): add your Google account so test purchases cost nothing.

## 6 · Upload key (you, once, keep it forever)

```bash
keytool -genkeypair -v -keystore ~/octavo-upload.jks -keyalg RSA -keysize 2048 -validity 10000 -alias upload
```

Then create `app/android/keystore.properties`. Git ignores it, along with `*.jks` and `*.keystore`.

```
storeFile=/Users/simplypheyie/octavo-upload.jks
storePassword=…
keyAlias=upload
keyPassword=…
```

Keep the .jks and both passwords in your password manager. Play App Signing holds the real key, so a lost
upload key can be reset through Play support, which takes days.

## 7 · Play listing and policy forms

- [ ] Store listing:
  - short description: "A quiet reader for your own EPUB and PDF books.";
  - 512 × 512 icon from `public/icons`;
  - 1024 × 500 feature graphic (not made yet);
  - phone screenshots.
- [ ] Privacy policy: `https://read.flyleaf.cc/privacy`.
- [ ] Data safety: email address and name are collected only when signed in, for account management.
      Books, highlights and notes are collected only when syncing, for app functionality. Purchase history
      is collected for app functionality. All data is encrypted in transit, nothing is shared with third
      parties, and users can ask for deletion. Ads: none.
- [ ] Content rating (IARC): a reference and reading app with no user interaction. Target audience: 13+.
- [ ] Account deletion: Play wants a web URL that explains how to delete the account without the app.
      Add a section to the privacy page once `DELETE /me` exists (§ 0).

## 8 · Testing tracks

- [ ] Internal testing: upload the .aab, add yourself, install from the opt-in link. Buy and restore with
      the license-tester account, so no money moves.
- [ ] **Closed testing (personal accounts):** at least **12 testers opted in for 14 days in a row** before
      you can apply for production. Use a Google Group as the tester list. Count the 14 days from when the
      12th tester opted in, not from the upload.
- [ ] Apply for production, answering the questions about the closed test, then stage the rollout at 20%.

## Checks before each submission

- [ ] Web unchanged: `cd app && npm run build` and `node audit/*.mjs` still pass, and the dist bundle holds
      no `NativePurchases` or `SocialLogin`.
- [ ] On a device:
  - open an EPUB from Files;
  - buy with a sandbox or test account;
  - delete and reinstall the app, then Restore;
  - sign in with Apple and with Google, then sync to the web.
- [ ] Safe areas: the bar clears the notch and the home indicator in portrait and landscape.
