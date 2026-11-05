// Can this build show a "buy BOQs" button?
//
// On the website: always. Inside the iOS app: only when the build opts in
// with REACT_APP_NATIVE_PURCHASES=1. App Store Review Guideline 3.1.1 does not
// allow an app to link out to Stripe for something that is used inside the
// app, so the default native build shows where to top up instead of a buy
// button (the same "manage it on the web" approach Netflix/Kindle use — see
// docs/IOS_APP.md, "Payments").
import { isNative } from '../native/platform';

export const NATIVE_PURCHASES_ENABLED = process.env.REACT_APP_NATIVE_PURCHASES === '1';

export function canShowPurchases() {
  return !isNative() || NATIVE_PURCHASES_ENABLED;
}
