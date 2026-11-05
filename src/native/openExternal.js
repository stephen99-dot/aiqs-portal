// Opening something outside the portal: a signed PDF link, the Google Docs
// viewer, Stripe checkout, a help page.
//
// Browser: a new tab. iOS app: an in-app Safari sheet (SFSafariViewController)
// so the user never loses the portal — a bare window.open would hand off to
// the Safari app, and tapping back lands on the home screen, not on us.
// Links that are meant to open another app (wa.me → WhatsApp, mailto:, tel:)
// still go through window.open / the anchor so iOS routes them to that app.
import { Browser } from '@capacitor/browser';
import { isNative } from './platform';

const APP_SCHEME = /^(mailto|tel|sms|facetime|whatsapp|maps):/i;
const APP_HOSTS = /(^|\.)(wa\.me|api\.whatsapp\.com|maps\.apple\.com|apps\.apple\.com)$/i;

export function opensAnotherApp(url) {
  try {
    if (APP_SCHEME.test(url)) return true;
    const u = new URL(url, window.location.href);
    return APP_HOSTS.test(u.hostname);
  } catch (e) {
    return false;
  }
}

export async function openExternal(url) {
  if (!url) return;
  if (isNative() && !opensAnotherApp(url)) {
    await Browser.open({ url, presentationStyle: 'popover' });
    return;
  }
  window.open(url, '_blank', 'noopener');
}

/** Is this href somewhere other than the portal itself? */
export function isExternalHref(href) {
  if (!href) return false;
  try {
    const u = new URL(href, window.location.href);
    if (!/^https?:$/.test(u.protocol)) return false;
    return u.origin !== window.location.origin;
  } catch (e) {
    return false;
  }
}
