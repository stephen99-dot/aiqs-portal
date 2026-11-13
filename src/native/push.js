// Push notifications in the iOS app: "your job is ready" on the lock screen.
//
// After sign-in the app asks iOS for permission (once — iOS never shows the
// prompt twice), registers with Apple, and gives the device token to the
// portal (POST /api/push/register). The server sends alongside the emails it
// already sends (server/pushNotifications.js). Tapping a notification opens
// the project it is about.
//
// On the web, and in an app build without the plugin, everything here is a
// no-op.
import { PushNotifications } from '@capacitor/push-notifications';
import { isNative, hasPlugin, platform } from './platform';
import { apiFetch } from '../utils/api';

const PLUGIN = 'PushNotifications';
const TOKEN_KEY = 'aiqs_push_token';

export const pushAvailable = () => isNative() && hasPlugin(PLUGIN);

const storedToken = () => { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } };
const storeToken = (t) => { try { if (t) localStorage.setItem(TOKEN_KEY, t); else localStorage.removeItem(TOKEN_KEY); } catch (e) { /* ignore */ } };

async function sendTokenToServer(token) {
  if (!token) return;
  storeToken(token);
  try {
    await apiFetch('/push/register', { method: 'POST', body: JSON.stringify({ token, platform: platform() }) });
  } catch (e) { /* retried on the next launch */ }
}

/**
 * Start listening. Call once; returns a cleanup function.
 *   onOpen(path)  a notification was tapped — navigate there
 */
export function listenForPush({ onOpen } = {}) {
  if (!pushAvailable()) return () => {};
  const handles = [];
  const keep = (p) => p.then((h) => handles.push(h)).catch(() => {});
  keep(PushNotifications.addListener('registration', ({ value }) => { sendTokenToServer(value); }));
  keep(PushNotifications.addListener('registrationError', () => {}));
  keep(PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
    const data = (action && action.notification && action.notification.data) || {};
    const path = typeof data.path === 'string' ? data.path : '';
    // Only ever an in-app path; anything else is ignored.
    if (onOpen && /^\/[^/]/.test(path)) onOpen(path);
  }));
  return () => { handles.forEach((h) => { try { h.remove(); } catch (e) { /* ignore */ } }); };
}

/**
 * For a signed-in user: ask permission if it has never been asked, then
 * register. If the user said no, this does nothing — they can turn
 * notifications on later in iOS Settings and it takes effect on next launch.
 */
export async function enablePushForUser() {
  if (!pushAvailable()) return;
  try {
    let perm = await PushNotifications.checkPermissions();
    if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
      perm = await PushNotifications.requestPermissions();
    }
    if (perm.receive !== 'granted') return;
    await PushNotifications.register(); // → 'registration' listener above
    // iOS does not always re-fire 'registration'; make sure the server has
    // the token for whoever is signed in now.
    if (storedToken()) sendTokenToServer(storedToken());
  } catch (e) { /* not available on this device (e.g. simulator) */ }
}

/**
 * On sign-out, BEFORE the session token is cleared: stop this phone getting
 * the account's notifications.
 */
export async function disablePushForUser() {
  if (!pushAvailable()) return;
  const token = storedToken();
  if (!token) return;
  try {
    await apiFetch('/push/unregister', { method: 'POST', body: JSON.stringify({ token }) });
  } catch (e) { /* the server also moves the token when the next user signs in */ }
}

/** "Send test notification" in the menu → the server's plain-English result. */
export async function sendTestPush() {
  try {
    const r = await apiFetch('/push/test', { method: 'POST' });
    return (r && r.message) || 'Sent.';
  } catch (e) {
    return 'Could not send a test notification: ' + (e.message || 'unknown error');
  }
}
