// A little physical feedback on the phone. Every call is a no-op on the web
// and swallows errors, so pages can sprinkle these without guards.
import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNative } from './platform';

async function run(fn) {
  if (!isNative()) return;
  try { await fn(); } catch (e) { /* no haptic engine — fine */ }
}

export const tapLight = () => run(() => Haptics.impact({ style: ImpactStyle.Light }));
export const tapMedium = () => run(() => Haptics.impact({ style: ImpactStyle.Medium }));
export const notifySuccess = () => run(() => Haptics.notification({ type: NotificationType.Success }));
export const notifyWarning = () => run(() => Haptics.notification({ type: NotificationType.Warning }));
export const notifyError = () => run(() => Haptics.notification({ type: NotificationType.Error }));
export const selectionChanged = () => run(() => Haptics.selectionChanged());
