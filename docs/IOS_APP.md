# AI QS on iPhone — the iOS app, from zero to the App Store

The portal now ships as a native iOS app as well as a website. Same React
code, same API, one extra folder (`ios/`). This document is the whole
journey: what was changed and why, how to build and run it in Xcode, how to
test it on every current iPhone (including the iPhone Duo), and how to get
it through App Review.

Read it top to bottom the first time. Afterwards the only part you need is
**"Shipping an update"**.

---

## 1. How it is put together

```
React app (src/)  ──build──►  build/  ──cap sync──►  ios/App/App/public/
                                                          │
                                        Capacitor WKWebView shell (Swift, SPM)
                                                          │
                              HTTPS ───► https://aiqs-portal.onrender.com/api
```

* **Capacitor 8** wraps the production web build in a native shell. The
  bundle is packaged *inside* the app (served from `capacitor://localhost`),
  so the app opens instantly and works through a lost signal; only the API
  goes over the network, to the same Express server the website uses.
* **The API host** comes from `REACT_APP_API_URL` at build time, else the
  production portal (`src/utils/api.js`). Nothing in the app is hard-wired to
  the phone's own origin any more.
* **Native plugins** (all official Capacitor, all Swift Package Manager, no
  CocoaPods): App (deep links, foreground/background), Browser (in-app
  Safari), Filesystem + Share (saving files), Haptics, Keyboard, SplashScreen,
  StatusBar.
* **Everything else is the website.** Camera and photo library come free from
  `<input type="file">` in WKWebView; drag-and-drop, upload progress, SSE chat
  streaming and the blob-based downloads all already worked over HTTPS.

### What changed in the web app (and therefore on the website too)

| Area | Before | Now |
|---|---|---|
| Downloads | Hidden `<a download>` click — silently does nothing in an iOS app | `saveBlob()` (`src/native/saveFile.js`): browser download on the web, iOS share sheet (Save to Files / AirDrop / Mail / Open in Excel) in the app. Every download in the portal goes through it. |
| API calls | 28 raw `fetch('/api/…')` calls relative to the page origin | `resolveUrl()` / `apiUrl()` from `src/utils/api.js`, native-aware |
| Share links | `window.location.origin + …` (would be `capacitor://localhost` in the app) | `portalOrigin()` |
| Safe areas | Only the bottom nav knew about the home indicator | `--safe-top/bottom/left/right` CSS variables; the mobile header, sidebar, chat shell, toasts, floating buttons and bottom sheets all respect the notch, Dynamic Island, home indicator and landscape corners |
| Hover | `:hover` styles stuck on after a tap (the "lifted" primary button) | Every hover rule is inside `@media (hover: hover)`; touch devices get a pressed state instead |
| Tap feel | Default | `touch-action: manipulation`, no grey tap flash, no text-selection handles on chrome, no document rubber-banding inside the app |
| Fonts | Three Google Fonts requests before first paint | Bundled with `@fontsource` — paints offline, no third-party request (also a small GDPR win) |
| Viewport units | `100vh` on auth/public pages (too tall under Safari's toolbar) | `100dvh` |
| Buttons on phones | `button { font-size: 16px !important }` in `index.html` flattened every small button and the bottom-nav labels to 16px | Only text fields are forced to 16px (that is what stops iOS zooming); buttons keep their designed sizes |
| Google sign-in | Server redirected to `/auth/google/success?token=…` which the client had no route for — the token was dropped and you bounced back to `/login` | `OAuthSuccessPage` stores the token and signs you in. In the app the Google button is hidden (see §6). |
| Account deletion | Admin-only | "Delete account" at the foot of the menu → `DELETE /api/auth/me` (password or typed DELETE; removes rows and uploaded files, cancels Stripe). App Store rule 5.1.1(v) requires this. |
| Purchases | Stripe payment links everywhere | Hidden in the app unless `REACT_APP_NATIVE_PURCHASES=1` (see §6) |
| Offline | Nothing | A red strip when the device is offline |
| Web manifest / icons | `logo192.png` only | `public/manifest.json` + 192/512/maskable/apple-touch icons |

Nothing about the *desktop* layout changed.

---

## 2. What you need on the Mac

| | Version | Notes |
|---|---|---|
| macOS | 15.6 or later | Required by Xcode 26 |
| Xcode | **26.0 or later** | Capacitor 8 requires it. Install from the App Store, open it once, let it install the iOS platform |
| Command Line Tools | matching Xcode | `xcode-select --install` |
| Node.js | 22 (same as CI) | `node -v` |
| Apple Developer Program | active | developer.apple.com — you said you have this |
| CocoaPods | **not needed** | Capacitor 8 uses Swift Package Manager |

Sign in to Xcode with your Apple ID: Xcode → Settings → Accounts → **+**.
Your team should appear with the role "Admin" or "Account Holder".

---

## 3. First run (about 15 minutes)

```bash
git clone https://github.com/stephen99-dot/aiqs-portal.git
cd aiqs-portal
npm ci
npm run ios
```

`npm run ios` = `npm run build` (React) → `cap sync ios` (copies `build/`
into the app and refreshes the Swift package list) → opens
`ios/App/App.xcodeproj` in Xcode.

In Xcode:

1. In the left pane click the blue **App** project, then the **App** target,
   then the **Signing & Capabilities** tab.
2. Tick **Automatically manage signing** and pick your **Team**. Xcode
   registers the bundle ID `uk.co.theaiqs.portal` on your account the first
   time (change the ID here if you prefer another; also change
   `appId` in `capacitor.config.json` and `IOS_BUNDLE_ID` on the server).
3. You should see **Associated Domains** already listed with
   `applinks:aiqs-portal.onrender.com` and `webcredentials:…` — that comes
   from `ios/App/App/App.entitlements`. If Xcode shows a red warning next to
   it, click it once and it will add the capability to your App ID.
4. At the top, pick a simulator (e.g. **iPhone 18 Pro**) and press **⌘R**.

The first build downloads the Capacitor Swift packages (a minute or two).
After that the app launches, shows the amber splash, then the sign-in page,
and signs in against the live portal.

### On a real iPhone

1. Plug the phone in (or pair over Wi-Fi), unlock it, tap **Trust**.
2. On the phone: Settings → Privacy & Security → **Developer Mode** → on
   (iOS 16+; the phone restarts).
3. Pick the phone as the run destination and **⌘R**.
4. First launch: Settings → General → VPN & Device Management → trust your
   developer certificate.

---

## 4. The device matrix

Apple's current range (November 2026) and the CSS viewport the app sees.
iOS reports points, not pixels — all current iPhones are @3x.

| Device | Screen | Viewport (CSS px, portrait) | Layout the app uses |
|---|---|---|---|
| iPhone 16, iPhone 17e | 6.1″ | 390 × 844 | Phone: hamburger + bottom nav |
| iPhone 17, iPhone 18 Pro | 6.3″ | 402 × 874 | Phone |
| iPhone Air | 6.5″ | 420 × 912 | Phone |
| iPhone 18 Pro Max | 6.9″ | 440 × 956 | Phone |
| **iPhone Duo — cover display** | 5.4″, 1398 × 2034 | ≈ 466 × 678 | Phone (short and wide; bottom sheets and the chat composer were checked here) |
| **iPhone Duo — inner display** | 7.6″, 1878 × 2670, 1.4:1 | ≈ 626 × 890 | Phone layout, two-column stats, wider cards. Landscape (890 × 626) crosses the 768px breakpoint and gets the **desktop** layout with the sidebar — the same one you see on a laptop |

Breakpoints (unchanged): `≤ 640px` bottom nav + bottom-sheet modals,
`≤ 768px` hamburger sidebar, `≤ 1024px` tighter page padding.

### The iPhone Duo specifically

* **Folding and unfolding resizes the web view live.** Every layout decision
  is CSS media queries plus the `useIsMobile()` hook, both of which re-run on
  resize, so the app re-flows from cover to inner display without a reload.
  The chat composer stays pinned because its height is in `dvh`.
* **Both displays share the 1.4:1 aspect ratio**, so the inner display is a
  big, almost square phone, not an iPad. That is why it keeps the bottom nav
  in portrait: the thumb reach argument is the same.
* **Rotate it.** Inner-display landscape is the one orientation where the
  app shows the desktop sidebar on a handheld. It was checked; the chat
  header was the only thing that overflowed and that is fixed.
* **Safe areas** are not the notch shape of a slab iPhone. The CSS only uses
  `env(safe-area-inset-*)`, so whatever Apple reports is what gets padded.

### What was verified here, and what you need to check on hardware

Verified on this branch with a headless Chromium at every viewport above,
portrait and landscape, on `/login`, `/dashboard`, `/submit-drawings` and
`/chat`: no horizontal overflow, no JS errors, bottom nav and sheets in place.

Headless Chromium cannot emulate iOS safe-area insets, the keyboard or the
share sheet, so on a real device (or Simulator) please run through this list
once per release:

- [ ] Status bar text readable in light **and** dark mode (toggle in the menu)
- [ ] Mobile header sits below the Dynamic Island; nothing hidden under it
- [ ] Bottom nav clears the home indicator; landscape: content clears the corners
- [ ] Chat: keyboard opens, composer rides up, last message still visible, send works
- [ ] Submit Drawings: pick from Photos, take a photo with the camera, pick a PDF from Files, progress bar moves, submission appears in My Projects
- [ ] Project page: download a BOQ → share sheet → **Save to Files** works, **Open in Excel/Numbers** works
- [ ] Open a magic-link email on the phone → it opens the app, not Safari (after §5)
- [ ] Put the phone to sleep mid-chat → wake → still signed in, response finishes
- [ ] Delete account flow on a throwaway account (then confirm it is gone in Admin → Users)
- [ ] iPhone Duo: start a chat on the cover display, unfold — layout re-flows, composer still pinned

---

## 5. Server settings for the app

Two environment variables on Render (Dashboard → aiqs-portal → Environment):

| Variable | Value | What it does |
|---|---|---|
| `APPLE_TEAM_ID` | your 10-character Team ID (developer.apple.com → Membership details) | Turns on `GET /.well-known/apple-app-site-association` so iOS opens portal links in the app (universal links) and offers the website's saved password inside the app |
| `IOS_BUNDLE_ID` | leave unset unless you changed the bundle ID | defaults to `uk.co.theaiqs.portal` |

Check it after the deploy:

```bash
curl -s https://aiqs-portal.onrender.com/.well-known/apple-app-site-association
```

You should see JSON with `"appIDs": ["TEAMID.uk.co.theaiqs.portal"]`. Apple's
CDN caches this for up to 24 hours and fetches it when the app is installed,
so install a fresh build *after* it is live, then tap a magic link in Mail.

If the portal moves to a custom domain (e.g. `portal.theaiqs.co.uk`), change
the two `applinks:` / `webcredentials:` entries in
`ios/App/App/App.entitlements` and rebuild. The API host in
`src/utils/api.js` and `PORTAL_BASE_URL` move with it.

CORS is already open (`cors({ origin: true })`), which is what lets
`capacitor://localhost` call the API. Auth is a bearer token in
`localStorage`, which WKWebView persists for the app's lifetime — no cookies
involved, so nothing to change.

---

## 6. The App Review landmines (already handled, but you must know why)

**Payments — rule 3.1.1.** An app may not link out to Stripe (or anywhere)
to buy something that is used inside the app. BOQ credits are used inside
the app. Three ways to handle this:

| Option | Effort | Apple's cut | Status |
|---|---|---|---|
| **A. Don't sell in the app** (what this branch does). Every buy button is replaced by a neutral "credits are managed in your AI QS account outside the app" card — no link, no price. Customers top up on the website, and the app refreshes the balance when it comes to the foreground. | none | 0% | **default** |
| B. In-App Purchase. Consumable products (5/10/20 BOQ packs) via StoreKit — `@revenuecat/purchases-capacitor` is the sane route; the Stripe webhook logic gets a StoreKit twin. | 2–4 days | 15–30% | later, if the app becomes a real sales channel |
| C. External purchase link entitlements (US, EU, UK now have them in various forms). Reporting obligations, still a commission in most regions. | medium | varies | not recommended |

`REACT_APP_NATIVE_PURCHASES=1` at build time brings the Stripe buttons back
in the app (they open in an in-app Safari sheet). Use that only for an
internal TestFlight build that is never submitted.

**Sign in — rule 4.8.** If an app offers Google sign-in it must also offer
Sign in with Apple. Google also refuses OAuth inside embedded web views. So
the app hides the Google button; email + password and magic links need
nothing extra. If you want Google in the app later, add Sign in with Apple at
the same time (`@capacitor-community/apple-sign-in` + a
`POST /api/auth/apple` that verifies Apple's identity token) and move Google
to the native Google SDK.

**Account deletion — rule 5.1.1(v).** Present: menu → Delete account.

**Minimum functionality — rule 4.2.** "Just a website in a wrapper" gets
rejected. This app has camera capture, native share/save, haptics, universal
links, in-app browser, offline state, a native splash and status bar — and
the whole product is a workflow, not content. That is comfortably past the
bar, but keep the App Store description about what the app *does* (submit
drawings, track jobs, read BOQs) rather than "access our website".

**Privacy.** `ios/App/App/PrivacyInfo.xcprivacy` declares what is collected
(email, name, phone, photos/user content — all linked to the account, none
used for tracking) and the "required reason" APIs Capacitor touches. Your
App Store Connect → App Privacy answers must say the same. You also need a
public **privacy policy URL** (theaiqs.co.uk/privacy or similar) — App Store
Connect will not let you submit without it.

**Demo account.** Review will sign in. Create a dedicated account with a few
credits and a finished project, and put the email + password in the App
Review notes. Mention that BOQs are produced by your QS team within 24 h, so
the reviewer does not wait for a document that will not arrive during review.

**Encryption.** `ITSAppUsesNonExemptEncryption = false` is set (the app
only uses HTTPS), so there is no export-compliance questionnaire per build.

---

## 7. App Store Connect, step by step

1. **appstoreconnect.apple.com → My Apps → + → New App.**
   Platform iOS · Name **AI QS** · Primary language English (UK) · Bundle ID
   `uk.co.theaiqs.portal` (appears once Xcode has registered it; otherwise
   Certificates, Identifiers & Profiles → Identifiers → + ) · SKU `aiqs-portal-ios`.
2. **App Information:** category *Business* (secondary *Productivity*),
   content rights, age rating questionnaire (all "None" → 4+).
3. **Pricing:** Free.
4. **App Privacy:** Data collected → Contact Info (email, name, phone),
   User Content (photos/videos, other user content), Identifiers (user ID),
   Usage Data (product interaction); all *linked to the user*, none *used to
   track you*; purpose *App functionality* (email also *Developer's
   communications*). This mirrors `ios/App/App/PrivacyInfo.xcprivacy`.
5. **Version page:**
   * Screenshots: Xcode Simulator → iPhone 18 Pro Max → **⌘S** saves a PNG at
     the exact 6.9″ size Apple wants (1320 × 2868). That one size is
     mandatory; others are optional and scale from it. Take: sign-in,
     dashboard, submit drawings, project with downloads, chat.
   * Description, keywords (quantity surveying, BOQ, bill of quantities,
     estimating, builder, construction), support URL, marketing URL,
     privacy policy URL.
   * App Review Information: contact details, **demo account**, notes (§6).
6. **Build:** see §8, then select the processed build on the version page.
7. **Submit for Review.** First review typically takes 24–48 hours.
   Rejections arrive as messages in Resolution Center; most are a sentence to
   reply to, not a rebuild.

---

## 8. Shipping a build (and every update after)

```bash
git pull
npm ci                 # only when package.json changed
npm run ios:sync       # build the React app and copy it into ios/
npx cap open ios
```

In Xcode:

1. Bump the version: App target → **General** → *Version* (e.g. 1.0.1, what
   users see) and *Build* (must increase every upload, e.g. 2). Or from the
   terminal: `cd ios/App && agvtool next-version -all`.
2. Destination **Any iOS Device (arm64)** → **Product → Archive**.
3. Organizer opens → **Distribute App** → **App Store Connect** → Upload.
   Accept the defaults (automatic signing, include symbols).
4. 5–20 minutes later the build appears in App Store Connect → TestFlight.
   Add yourself as an internal tester; TestFlight on your phone installs it.
5. When happy, attach it to a version and submit.

Web-only changes (anything in `src/`) still need steps above — the bundle is
inside the app. If that becomes tedious, Capacitor supports over-the-air
updates of the web bundle (Capgo / Ionic Appflow) within Apple's rules; the
native shell only changes when a plugin does.

Useful scripts (`package.json`):

| Script | Does |
|---|---|
| `npm run ios` | build + sync + open Xcode |
| `npm run ios:sync` | build + sync (CI-friendly) |
| `npm run ios:open` | open Xcode |
| `npm run ios:assets` | regenerate the icon and splash set from `scripts/build-app-icons.js` |

---

## 9. Where things live

| File | Purpose |
|---|---|
| `capacitor.config.json` | App ID, name, `webDir`, splash/keyboard/status-bar plugin settings |
| `ios/App/App.xcodeproj` | The Xcode project (iPhone only, iOS 15.0+, automatic signing) |
| `ios/App/App/Info.plist` | Display name, camera/photo usage strings, orientations, encryption flag |
| `ios/App/App/App.entitlements` | Associated domains (universal links, password autofill) |
| `ios/App/App/PrivacyInfo.xcprivacy` | Privacy manifest |
| `ios/App/App/Assets.xcassets` | App icon + launch images (generated — do not hand-edit) |
| `ios/App/CapApp-SPM/Package.swift` | Plugin list — written by `cap sync`, never by hand |
| `ios/App/App/public/` | The web build — gitignored, created by `cap sync` |
| `resources/` | Source artwork for icons/splash (`scripts/build-app-icons.js` makes them) |
| `src/native/` | `platform.js`, `saveFile.js`, `openExternal.js`, `haptics.js`, `NativeBridge.js` |
| `src/utils/purchases.js` | The native purchase gate |
| `server/appLinks.js` | The apple-app-site-association route |

---

## 10. Known limits and sensible next steps

* **Uploads do not continue in the background.** iOS suspends the web view
  about 30 seconds after the app leaves the foreground, so a 100 MB drawing
  set needs the app kept open (the progress bar makes this obvious). If
  customers upload big sets from site often, the next step is a native
  background-upload plugin (`@capgo/capacitor-uploader`) behind the same
  `apiUpload()` call.
* **No push notifications yet.** The admin bell polls; clients get email.
  Adding APNs is `@capacitor/push-notifications` + a device-token table +
  sends from the places that already email — a day's work when wanted.
* **Dynamic Type** (the iOS text-size setting) does not affect web content.
  Font sizes follow the app's own scale.
* **Android** is the same `cap add android` away. Everything in
  `src/native/` is platform-neutral; only the icon/splash flags and a
  Play Console pass differ.
* **Sign in with Apple + Google in-app** — see §6.
* **In-App Purchase** — see §6, option B.

---

## 11. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Xcode: "Signing for App requires a development team" | Signing & Capabilities → pick your Team |
| White screen on launch | `ios/App/App/public` is missing or stale → `npm run ios:sync` |
| Sign-in spins, then "Something went wrong" | The app cannot reach the API. Check `REACT_APP_API_URL` was *not* set to something odd at build time, and that the portal is up |
| Magic link opens Safari, not the app | AASA not live yet (`curl` it, §5), Apple's CDN cache (wait, reinstall), or the Team ID in `APPLE_TEAM_ID` does not match the signing team |
| "disallowed_useragent" from Google | You rebuilt with the Google button visible inside the app — it must stay hidden or move to the native SDK |
| Downloads do nothing | A page is using a hand-rolled `<a download>` again — route it through `saveBlob()` |
| Buttons look tiny on the website after this change | They are at their designed sizes now; the old 16px `!important` on buttons was a bug |
| Package resolution fails in Xcode | File → Packages → Reset Package Caches; check the Mac can reach github.com |
| Archive greyed out | Destination must be "Any iOS Device", not a simulator |
