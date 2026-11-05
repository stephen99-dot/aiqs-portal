// Where is the portal running? The same React bundle ships three ways:
//
//   • the website (aiqs-portal.onrender.com) — plain browser, same-origin API
//   • the iOS app — the bundle is packaged inside the app and served from
//     capacitor://localhost by Capacitor, talking to the live API over HTTPS
//   • (later) Android — same as iOS
//
// Everything that has to behave differently inside the app asks here, so the
// checks read the same everywhere and are trivial to grep for.
import { Capacitor } from '@capacitor/core';

export function isNative() {
  try { return Capacitor.isNativePlatform(); } catch (e) { return false; }
}

export function platform() {
  try { return Capacitor.getPlatform(); } catch (e) { return 'web'; }
}

export const isIOS = () => platform() === 'ios';

// True when a Capacitor plugin is actually available on this platform. On the
// web most of them are not, and calling one throws.
export function hasPlugin(name) {
  try { return Capacitor.isPluginAvailable(name); } catch (e) { return false; }
}
