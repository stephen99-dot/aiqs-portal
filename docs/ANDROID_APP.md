# AI QS on Android — from zero to Google Play

The Android app is the same thing as the iPhone app: the portal's React
screens inside a native shell (Capacitor 8), talking to the live portal over
HTTPS. Read `docs/IOS_APP.md` §1 for how that fits together — everything
there applies here unless this page says otherwise.

What is already in the repository:

* `android/` — the Android Studio project (app ID `uk.co.theaiqs.portal`,
  version 1.0.1, version code 1, Android 7.0+).
* Icons and launch screens, generated from the same artwork as iOS.
* Push notifications (Firebase Cloud Messaging), the back button, links that
  open in the app, safe areas under the status and navigation bars, and
  screen updates without a new build.

What has **not** happened: nobody has compiled or run it. The project was set
up on a machine without the Android SDK, so the first build in Android Studio
is the first build. Expect to send an error message or two back.

---

## 1. What you need

| | Notes |
|---|---|
| Android Studio | Free, developer.android.com/studio. Runs on the Mac you already use for iOS. First launch downloads the Android SDK (several GB). |
| A device to test on | The **emulator** inside Android Studio is enough to build, test and publish. A real phone is worth borrowing for a final check — push, camera uploads, feel. |
| Google Play developer account | play.google.com/console, one-time $25. **Individual accounts** must run a closed test with at least 12 testers for 14 days before going public. **Organisation accounts** skip that but need a D-U-N-S number. |
| Firebase project | Free, console.firebase.google.com. Required: Android push goes through Google, and the app will not build without its config file (§3). |

---

## 2. First run

```bash
git pull
npm ci
```

Do §3 (the Firebase file) first — the build refuses to start without it —
then:

```bash
npm run android
```

`npm run android` builds the React app, copies it into the Android project
and opens Android Studio. The first open takes several minutes while Gradle
downloads its dependencies (bottom status bar).

To run it: **Device Manager** (phone icon, right edge) → **+** → *Create
Virtual Device* → pick a Pixel → pick a system image **with Google Play**
(needed for push) → Finish. Then press the green **Run** arrow at the top.

On a real phone: Settings → About phone → tap *Build number* seven times →
back → Developer options → **USB debugging** on → plug in → allow → choose
the phone in the device dropdown → Run.

---

## 3. Push notifications (Firebase) — required before the first build

1. **console.firebase.google.com → Add project.** Name it "AI QS". Google
   Analytics is not needed.
2. In the project: **Add app → Android.** Package name
   `uk.co.theaiqs.portal` exactly. Register.
3. **Download `google-services.json`** and put it in `android/app/`
   (next to `build.gradle`). It identifies the Firebase project; it is not a
   secret and can be committed so the next build has it.
4. **Server key:** Firebase console → ⚙ Project settings → **Service
   accounts** → **Generate new private key**. A `.json` file downloads. This
   one **is** secret — do not commit it or paste it into chat.
5. **Render → aiqs-portal → Environment:** add `FCM_SERVICE_ACCOUNT` and
   paste the whole contents of that file as the value. Save; let it redeploy.

Checking it works is the same as iOS: sign in to the app as an admin, allow
notifications, open the menu, **Send test notification**. The message says
what happened — sent, or exactly what is missing. The emulator needs a
"Google Play" system image and a signed-in Google account to receive pushes.

Customers get "Your job is ready" on Android from the same code path as on
iPhone; nothing else to switch on.

---

## 4. Publishing to Google Play

### Build the release file

Android Studio → **Build → Generate Signed App Bundle / APK** → *Android App
Bundle* → Next.

* First time: **Create new…** keystore. Save the file somewhere backed up
  **outside the repository**, set passwords, alias `upload`. **Do not lose
  this file or its passwords** — it is how Google knows later uploads are
  yours. (If it is lost, Google can reset it, but it takes days.)
* Choose **release** → Create. The `.aab` lands in
  `android/app/release/`.

### Play Console

1. **Create app:** name "AI QS", default language English (UK), App, Free.
2. Work through the **Set up your app** checklist. The answers mirror the
   App Store ones:
   * *Privacy policy:* the same URL as iOS.
   * *App access:* "All or some functionality is restricted" → give the
     review demo account (as for Apple).
   * *Data safety:* collects email, name, phone, photos/files, user ID,
     **device ID** (the push token); all for app functionality, linked to
     the user, not shared, encrypted in transit; users can request deletion
     (in-app **Delete account**, and give the web URL for it).
   * *Content rating:* questionnaire, all "No". *Target audience:* 18+.
   * *Ads:* No.
3. **Store listing:** reuse `docs/APP_STORE_LISTING.md`. Google also wants a
   512×512 icon (`public/icons/icon-512.png`), a 1024×500 feature graphic,
   and at least two phone screenshots (take them in the emulator: the camera
   icon in its side toolbar).
4. **Testing → Internal testing → Create release** → upload the `.aab` →
   add yourself as a tester → open the opt-in link on the phone and install
   from Play. Test here first.
5. Individual account: **Closed testing** with 12+ testers for 14 days, then
   **Apply for production**. Organisation account: go straight to
   **Production → Create release**.

Google's first review usually takes a few days.

### Every later release

Bump the numbers in `android/app/build.gradle` — `versionCode` must go up by
at least one every upload, `versionName` is what users see — then
`npm run android`, generate the signed bundle with the **same keystore**, and
upload it as a new release.

---

## 5. Links that open in the app

Portal links (magic sign-in, project pages) open in the app once Android can
verify the app belongs to the site.

1. Play Console → your app → **Setup → App signing** → copy the **SHA-256
   certificate fingerprint** under *App signing key certificate*.
2. Render → Environment: `ANDROID_CERT_SHA256` = that fingerprint. To make
   builds run straight from Android Studio work too, add the *Upload key*
   fingerprint after a comma.
3. Check:

```bash
curl -s https://aiqs-portal.onrender.com/.well-known/assetlinks.json
```

Until this is set, links simply open in the browser — nothing breaks.

---

## 6. Screen updates without a new build

Same mechanism as iOS (`docs/IOS_APP.md` §10), with its own switch because
the two stores number builds separately:

| Variable | Value |
|---|---|
| `APP_LIVE_UPDATE_BUILDS_ANDROID` | the Android **version codes** that may take updates, e.g. `1` or `1,2` |

Add a version code only after Google has approved that release.

---

## 7. Things that differ from iOS

* **Buying credits.** Google Play has the same rule as Apple about selling
  digital goods outside its billing. The app hides the Stripe buttons in the
  same way (`src/utils/purchases.js`); leave `REACT_APP_NATIVE_PURCHASES`
  unset.
* **Back button.** Goes back a page; on the first page it sends the app to
  the background.
* **Notification channel.** "Job updates" — users can mute or tune it in
  Android's settings for the app.
* **Icons.** Generated by `npm run android:assets` from
  `resources/icon-only.png`. If the iOS icon was changed on the Mac and not
  committed, run that script there so Android matches.
* **Google sign-in** is hidden in the app, as on iOS.

---

## 8. Where things live

| File | Purpose |
|---|---|
| `android/app/build.gradle` | App ID, `versionCode` / `versionName`, the Firebase file check |
| `android/app/src/main/AndroidManifest.xml` | Permissions, app-link filter, notification icon and channel |
| `android/app/google-services.json` | Firebase config — you add this (§3) |
| `android/app/src/main/res/` | Icons, launch screens, notification icon (generated — do not hand-edit the PNGs) |
| `android/variables.gradle` | Minimum / target Android versions |
| `android/app/src/main/assets/public/` | The web build — gitignored, created by `cap sync` |
| `server/pushNotifications.js` | Sending to Apple and Google |
| `server/appLinks.js` | `assetlinks.json` for app links |
| `server/appBundle.js` | Screen updates, per platform |

---

## 9. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Build fails: "google-services.json is missing" | §3, step 3 |
| "SDK location not found" | Open the project through Android Studio once; it writes `android/local.properties` |
| Gradle sync fails on first open | Let Android Studio install what it offers (SDK platform 36, build tools), then **File → Sync Project with Gradle Files** |
| White screen on launch | Run `npm run android:sync` — the web build was not copied in |
| Test notification says "Android push not configured" | `FCM_SERVICE_ACCOUNT` is missing or not the service-account file (§3, steps 4–5) |
| Test notification "Sent" but nothing arrives on the emulator | Use a system image with Google Play and sign in to a Google account on it |
| Content hidden under the status bar | Tell Claude — safe-area handling on that Android version needs a look |
