# AI QS on Android — building and shipping the Play Store app

Same React code, same API, same native glue as the iPhone app
(`docs/IOS_APP.md` explains the architecture; everything in `src/native/`
checks for "native", not "iOS", so it all applies here). This document is
the Android-specific part: the project in `android/`, how to build a release
bundle, and what Google Play wants.

## What you need

| | Notes |
|---|---|
| Android Studio (current stable) | On the Mac or the PC; it bundles the Android SDK and a JDK. Install, open once, let it finish downloading components. |
| Node 22 | Same as the web build |
| The upload keystore | The `.jks` file and its passwords that signed the build already on Google Play. **Without the same key, Play rejects the upload.** See "Signing" below. |

## Build and open

```bash
git pull
npm ci              # only when package.json changed
npm run android     # builds the web app, syncs it into android/, opens Android Studio
```

First open: Android Studio syncs Gradle (several minutes, downloads
dependencies). A green ▶ with a device or emulator selected runs the debug app.

## Versions

`android/app/build.gradle` → `versionCode` and `versionName`. Play requires
every upload to have a **higher versionCode** than the last one it accepted.
The build on Play today is 3 (1.0.1); this project starts at **4 (1.1)**.
Bump `versionCode` by one for every upload, and keep `versionName` as the
number people see.

## Package name

`applicationId` in `android/app/build.gradle` is `uk.co.theaiqs.portal`. It
**must be exactly the package name of the existing Play listing** (Play Console
→ the app → the name shown under the title, or Setup → App integrity). If the
first upload used something else, change `applicationId` and `namespace` to
match; the package name of a Play app can never change.

## Signing (read this before the first upload)

Play keeps two keys: the *app signing key* (Google holds it) and the *upload
key* (you hold it, Google verifies uploads against it). Whatever signed the
build currently on Play is the upload key.

- **You built the first version yourself in Android Studio:** you were asked to
  create or choose a keystore. Use the same `.jks` and passwords.
- **A website-wrapping service built it:** they hold the upload key. Either get
  the `.jks` from them, or in Play Console → Setup → App integrity → *Request
  upload key reset*, which takes a couple of days and needs a new key's
  certificate.
- **No build has ever been uploaded:** create a keystore in the dialog below
  and keep it somewhere safe and backed up. Losing it means the reset process
  above for every future update.

Build the release bundle: Android Studio → **Build → Generate Signed App
Bundle / APK** → **Android App Bundle** → choose the keystore, enter the
passwords → **release** → Create. The `.aab` lands in
`android/app/release/`.

## Upload to Google Play

Play Console → the app → **Production** → **Create new release** → drop the
`.aab` in → release notes ("Phone layouts, downloads via the share sheet,
account deletion, faster start-up") → Next → **Save and publish** (or Review
release). Google's review is usually a day or two for an update.

## Server settings (optional, for links that open in the app)

| Variable | Value |
|---|---|
| `ANDROID_PACKAGE` | the package name, default `uk.co.theaiqs.portal` |
| `ANDROID_SHA256_CERT` | the **app signing** certificate's SHA-256 fingerprint from Play Console → Setup → App integrity (colon-separated). Comma-separate several if you also want a debug key. |

With both set, `https://<portal>/.well-known/assetlinks.json` is served
(`server/appLinks.js`) and Android verifies the links in
`android/app/src/main/AndroidManifest.xml`, so magic links, quotes and
invoices open in the app. Without them the app still works; links open in
the browser.

## What Google Play asks for that the app already covers

- **Account deletion**: in-app (menu → Delete account) and the web page at
  `/delete-account` for the Data safety form.
- **Data safety**: the same answers as Apple's App Privacy (name, email, phone,
  photos, other user content, user ID, product interaction; all for app
  functionality; none shared or used for advertising).
- **Payments**: no purchases in the app. Selling credit packs on Android means
  Google Play Billing, the same decision as Apple's In-App Purchase; both go in
  together in the purchases release.
- **Target audience** 16+, no ads, not a health app, trader status declared.

## Phone-specific behaviour on Android

- The hardware/gesture back button steps back through the app's own history,
  closes an open sheet first, and from a top-level screen sends the app to the
  background instead of quitting it.
- The status bar takes the header colour in light and dark mode.
- Downloads open the Android share sheet (Files, Drive, Gmail, WhatsApp,
  Open with Excel…).
- Icons are adaptive (`resources/icon-foreground.png` + `icon-background.png`);
  `npm run android:assets` regenerates them and the splash screens.

## Troubleshooting

| Symptom | Fix |
|---|---|
| Upload rejected: "signed with a different key" | Wrong keystore. See Signing. |
| Upload rejected: "version code 4 has already been used" | Bump `versionCode` in `build.gradle`. |
| Upload rejected: "package name doesn't match" | Change `applicationId` to the Play listing's package name. |
| Gradle sync fails on first open | Android Studio → Settings → check the SDK is installed; File → Sync Project with Gradle Files. |
| White screen on launch | `android/app/src/main/assets/public` is missing: run `npm run android:sync`. |
